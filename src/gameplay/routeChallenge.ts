// Route Challenge: drive from the deployment point (the UEMR apartment at
// University Village Building 11, or Safety and Grounds) to a destination
// building as quickly, efficiently and lawfully as possible, keeping to roads
// and walkways. Pure game logic; the UI layer reads it and the renderer draws
// the beacon and route from it.
import type { CampusData, Pt, Bump, StopLine } from '../world/campusData.ts';
import { NavGraph } from './navGraph.ts';

/**
 * `target` is the beacon/reference point; arrival is anywhere within ARRIVAL_M of
 * the building's walls, or anywhere inside (or within ARRIVAL_M of) a lot.
 */
export interface Destination {
  name: string; target: Pt; node: number; outlines: Pt[][]; kind: 'building' | 'lot';
  /** Network nodes that reach the arrival zone: within 25 m of the walls, or in or beside the lot. The best route ends at whichever is nearest. */
  access: number[];
  /** Official abbreviations and other names it is searched by. */
  aliases?: string[];
}

/** One leg of a run: from the previous stop (or the start) to `name`. */
export interface Leg { name: string; time: number; optimal: number }

/** Assistance chosen for a run; each costs 10 % of the score. */
export interface Assist { route: boolean; beam: boolean }

export interface RunResult {
  destination: string; legs: Leg[]; collisions: number; time: number; driven: number; optimal: number; offNetwork: number;
  efficiency: number; timeScore: number; onNetwork: number; traffic: number;
  stops: { obeyed: number; total: number }; bumps: { slow: number; total: number }; hits: number;
  score: number; grade: string; assisted: boolean; best: number | null;
}

export type Phase = 'idle' | 'countdown' | 'running' | 'finished';

const REFERENCE_SPEED = 7; // m/s (~15.7 mph): a brisk but legal average for a campus cart
export const ARRIVAL_M = 6; // close to any side of the building: buildings have several entrances
const STOP_SPEED = 4.5; // m/s (~10 mph): an emergency cart slows and rolls through a stop sign; it need not stop
const BUMP_SPEED = 3.6; // m/s (~8 mph) or slower over a speed bump
/** UT Dallas building codes and common names, searchable in the destination list. */
const ALIASES: Record<string, string[]> = {
  'Engineering and Computer Science West': ['ECSW'], 'Engineering and Computer Science South': ['ECSS'], 'Engineering and Computer Science North': ['ECSN'],
  'Bioengineering and Sciences Building': ['BSB', 'Bioengineering Science Building'], 'Naveen Jindal School of Management': ['JSOM', 'SOM'],
  'Student Union': ['SU'], 'Student Services Building': ['SSB'], 'Student Services Building Addition': ['SSA', 'SSB Addition'],
  "Edith O'Donnell Arts & Technology Building": ['ATC', 'ATEC'], 'Natural Science and Engineering Research Lab': ['NSERL'],
  'Science Learning Center': ['SLC'], 'Eugene McDermott Library': ['MC', 'Library'], 'Sciences Building': ['SCI'],
  'Founders Building': ['FO'], 'Founders North': ['FN'], 'Erik Jonsson Academic Center': ['JO'], 'Karl Hoblitzelle Hall': ['HH'],
  'Lloyd V. Berkner Hall': ['BE'], 'Cecil H. Green Hall': ['GR'], 'Administration Building': ['AD'], 'Activity Center': ['AB', 'Rec Center'],
  'Callier Center Richardson': ['CR'], 'Callier Center Richardson Addition': ['CRA'], 'Research Operations Center West': ['ROW', 'Reasearch Operations Center West'],
  'Research and Operations Center': ['ROC'], 'Davidson-Gundy Alumni Center': ['AL'], 'Physics Building': ['PHY'], 'Classroom Building': ['CB'],
  'Recreation Center West': ['RCW'], 'Comets LANding': ['Esports'], 'Dining Hall West': ['DHW'], 'Parking Structure 1': ['PS1'],
  'Parking Structure 3': ['PS3'], 'Parking Structure 4': ['PS4'],
};
const CAMPUS_KINDS = new Set(['university', 'dormitory', 'public', 'school', 'garage', 'apartments']);
/**
 * Buildings not offered as destinations: Waterview, and the Northside apartments
 * (UEMR no longer responds there).
 */
const EXCLUDED = (name: string) => name === 'Waterview Science and Technology Center' || /^Northside/.test(name);
/** Points taken off per collision with something solid. */
export const COLLISION_PENALTY = 100;

/** A traffic control the run is checked against: passed when the cart crosses it moving along `dir`. */
interface Control { kind: 'stop' | 'bump'; p: Pt; dir: Pt | null; minSpeed: number; armed: boolean; done: boolean }

export class RouteChallenge {
  readonly graph: NavGraph;
  readonly destinations: Destination[];
  phase: Phase = 'idle';
  dest: Destination | null = null;
  optimal: { pts: Pt[]; length: number } | null = null;
  assisted = false;
  assist: Assist = { route: false, beam: false };
  /** Stops still to visit after `dest` (multi-stop runs). */
  queue: Destination[] = [];
  /** Finished legs of the current run. */
  legs: Leg[] = [];
  /** Total length of the best routes for all legs so far (including the current one). */
  optimalTotal = 0;
  collisions = 0;
  private legStart = 0;
  countdown = 0;
  time = 0;
  driven = 0;
  offNetwork = 0;
  hits = 0;
  trail: Pt[] = [];
  /** True while the cart is currently off roads and walkways. */
  lastOff = false;
  /** Latest traffic event, for the HUD ('Stop: good', 'Bump: too fast', ...). */
  event: { text: string; good: boolean; t: number } | null = null;
  result: RunResult | null = null;
  private last: Pt | null = null;
  private recent: string[] = [];
  private controls: Control[] = [];
  private stopsOk = 0; private stopsAll = 0; private bumpsOk = 0; private bumpsAll = 0;

  constructor(data: CampusData, public startPoint: Pt, private onNetwork: (p: Pt) => boolean,
    private stops: StopLine[] = [], private bumps: Bump[] = []) {
    this.graph = new NavGraph(data);
    const area = (r: Pt[]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(a / 2); };
    const seen = new Set<string>();
    this.destinations = [];
    for (const b of data.buildings) {
      if (!b.name || !CAMPUS_KINDS.has(b.kind) || EXCLUDED(b.name)) continue;
      const name = /^\d+$/.test(b.name) ? `University Village Building ${b.name}` : b.name;
      if (seen.has(name) || ['canopy', 'skybridge', 'shelter'].includes(b.style) || area(b.outer) < 250) continue;
      // Reference point: a mapped entrance, else the network node nearest the walls.
      let best = -1, bd = Infinity, at: Pt = b.outer[0];
      const cands: Pt[] = data.entrances.filter(e => b.outer.some((p, i) => segDist([e[0], e[1]], p, b.outer[(i + 1) % b.outer.length]) < 2)).map(e => [e[0], e[1]] as Pt);
      if (!cands.length) for (let i = 0; i < b.outer.length; i++) cands.push(b.outer[i]);
      for (const p of cands) {
        const n = this.graph.nearest(p, 120);
        if (n < 0) continue;
        const d = Math.hypot(this.graph.pts[n][0] - p[0], this.graph.pts[n][1] - p[1]);
        if (d < bd) { bd = d; best = n; at = this.graph.pts[n]; }
      }
      if (best < 0 || bd > 60) continue;
      seen.add(name);
      this.destinations.push({ name, target: at, node: best, outlines: [b.outer], kind: 'building', access: [] });
    }
    // Named parking lots (one destination per name; some lots are mapped in parts).
    const lots = new Map<string, Pt[][]>();
    for (const a of data.areas) if (a.kind === 'parking' && a.name) { if (!lots.has(a.name)) lots.set(a.name, []); lots.get(a.name)!.push(a.outer); }
    for (const [name, rings] of lots) {
      if (seen.has(name)) continue;
      const big = rings.reduce((x, y) => (area(y) > area(x) ? y : x));
      const c: Pt = [big.reduce((t, p) => t + p[0], 0) / big.length, big.reduce((t, p) => t + p[1], 0) / big.length];
      const n = this.graph.nearest(c, 150);
      if (n < 0) continue;
      seen.add(name);
      this.destinations.push({ name, target: this.graph.pts[n], node: n, outlines: rings, kind: 'lot', access: [] });
    }
    for (const d of this.destinations) {
      const reach = d.kind === 'lot' ? 10 : 25;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const r of d.outlines) for (const p of r) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      d.aliases = ALIASES[d.name];
      d.access = this.graph.nodesNear([x0 - reach, y0 - reach, x1 + reach, y1 + reach], p => this.distanceTo(d, p) <= reach);
      if (!d.access.includes(d.node)) d.access.push(d.node);
    }
    this.destinations.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  /**
   * Begins a run. `dests` is one destination name, a list of names visited in
   * order (a multi-stop run), or undefined for random stops; `stops` is how many
   * random stops to chain. Random picks are uniform, not repeated within a run
   * or among the last few, and not trivially close to the previous stop.
   */
  start(dests?: string | string[], assist: Assist | boolean = false, stops = 1) {
    this.assist = typeof assist === 'boolean' ? { route: assist, beam: false } : assist;
    const rnd = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 2 ** 32; };
    const chosen: Destination[] = [];
    if (dests !== undefined) {
      for (const n of Array.isArray(dests) ? dests : [dests]) { const d = this.destinations.find(x => x.name === n); if (d) chosen.push(d); }
    } else {
      let from = this.startPoint;
      for (let k = 0; k < Math.max(1, stops); k++) {
        let pool = this.destinations.filter(d => this.distanceTo(d, from) > 150 && !this.recent.includes(d.name) && !chosen.includes(d));
        if (!pool.length) pool = this.destinations.filter(d => !chosen.includes(d));
        const order = pool.map(d => ({ d, k: rnd() })).sort((a, b) => a.k - b.k).map(x => x.d);
        const fromNode = this.graph.nearest(from);
        const pick = order.slice(0, 20).find(d => this.graph.route(fromNode, d.access));
        if (!pick) break;
        chosen.push(pick);
        from = pick.target;
      }
    }
    if (!chosen.length) return false;
    const r = this.graph.route(this.graph.nearest(this.startPoint), chosen[0].access);
    if (!r) return false;
    this.dest = chosen[0];
    this.queue = chosen.slice(1);
    this.optimal = r;
    this.optimalTotal = r.length;
    this.legs = [];
    this.legStart = 0;
    this.assisted = this.assist.route || this.assist.beam;
    this.phase = 'countdown';
    this.countdown = 3;
    this.time = this.driven = this.offNetwork = this.hits = this.collisions = 0;
    this.stopsOk = this.stopsAll = this.bumpsOk = this.bumpsAll = 0;
    this.trail = [];
    this.last = null;
    this.result = null;
    this.event = null;
    this.recent = [...chosen.map(d => d.name), ...this.recent].slice(0, 6);
    this.controls = [
      ...this.stops.map(s => ({ kind: 'stop' as const, p: s.p, dir: s.fwd === 0 ? null : (s.fwd > 0 ? s.dir : [-s.dir[0], -s.dir[1]] as Pt), minSpeed: Infinity, armed: false, done: false })),
      ...this.bumps.map(b => ({ kind: 'bump' as const, p: b.p, dir: null, minSpeed: Infinity, armed: false, done: false })),
    ];
    return true;
  }

  /** Stop number (1-based) and total stops of the current run. */
  get stopIndex() { const of = this.legs.length + (this.phase === 'finished' ? 0 : 1) + this.queue.length; return { n: Math.min(of, this.legs.length + 1), of }; }

  cancel() { this.phase = 'idle'; this.dest = null; this.optimal = null; }

  /** Called when the cart touches a pedestrian. */
  pedestrianHit() { if (this.phase === 'running') { this.hits++; this.flash('Pedestrian contact −50', false); } }

  /** Called when the cart hits something solid (a wall, post, parked car, tree...). */
  collision() { if (this.phase === 'running') { this.collisions++; this.flash(`Collision −${COLLISION_PENALTY}`, false); } }

  private flash(text: string, good: boolean) { this.event = { text, good, t: this.time }; }

  /** Advances the run; `pos` is the cart's map position, `speed` its speed (m/s), `heading` its map direction. */
  update(dt: number, pos: Pt, speed = 0, heading: Pt = [0, 1]) {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      this.last = pos;
      if (this.countdown <= 0) this.phase = 'running';
      return;
    }
    if (this.phase !== 'running' || !this.dest) return;
    this.time += dt;
    if (this.last) {
      const d = Math.hypot(pos[0] - this.last[0], pos[1] - this.last[1]);
      if (d < 20) { // ignore teleports (reset/recover)
        this.driven += d;
        this.lastOff = !this.onNetwork(pos);
        if (this.lastOff) this.offNetwork += d;
      }
    }
    this.last = pos;
    this.checkControls(pos, Math.abs(speed), heading);
    if (!this.trail.length || Math.hypot(pos[0] - this.trail[this.trail.length - 1][0], pos[1] - this.trail[this.trail.length - 1][1]) > 3) this.trail.push(pos);
    if (this.distanceTo(this.dest, pos) < ARRIVAL_M) this.arrive(pos);
  }

  /**
   * Stop signs: armed within 12 m on the approach (moving along the sign's direction);
   * scored when the cart passes the line — obeyed if its slowest speed on the approach
   * was 10 mph or less (slowed and rolled through). Bumps: scored on crossing, by the speed there.
   */
  private checkControls(pos: Pt, v: number, h: Pt) {
    for (const c of this.controls) {
      if (c.done) continue;
      const dx = pos[0] - c.p[0], dy = pos[1] - c.p[1], d = Math.hypot(dx, dy);
      if (d > 14) { c.armed = false; c.minSpeed = Infinity; continue; }
      if (c.kind === 'stop') {
        const along = c.dir ?? h; // unknown direction: whichever way the cart is going
        if (c.dir && h[0] * c.dir[0] + h[1] * c.dir[1] < 0.5) continue; // other direction of travel
        const s = dx * along[0] + dy * along[1]; // <0 before the line
        if (s < -0.5 && s > -12) { c.armed = true; c.minSpeed = Math.min(c.minSpeed, v); }
        if (c.armed && s >= 0 && Math.abs(dx * along[1] - dy * along[0]) < 8) {
          c.done = true;
          this.stopsAll++;
          const ok = c.minSpeed <= STOP_SPEED;
          if (ok) this.stopsOk++;
          this.flash(ok ? 'Stop sign — slowed through' : 'Stop sign — too fast', ok);
        }
      } else if (d < 2.5) {
        c.armed = true;
        c.minSpeed = Math.min(c.minSpeed, v);
      } else if (c.armed) {
        c.done = true;
        this.bumpsAll++;
        const ok = c.minSpeed <= BUMP_SPEED;
        if (ok) this.bumpsOk++;
        this.flash(ok ? 'Speed bump — eased over' : 'Speed bump — too fast', ok);
      }
    }
  }

  /** Distance from p to the destination's arrival area: its walls, or 0 inside a lot. */
  distanceTo(d: Destination, p: Pt) {
    let m = Infinity;
    for (const r of d.outlines) {
      if (d.kind === 'lot' && inRing(p, r)) return 0;
      for (let i = 0; i < r.length; i++) m = Math.min(m, segDist(p, r[i], r[(i + 1) % r.length]));
    }
    return m;
  }

  /** Reached the current stop: record the leg, then go on to the next stop or finish. */
  private arrive(pos: Pt) {
    this.legs.push({ name: this.dest!.name, time: this.time - this.legStart, optimal: this.optimal!.length });
    const next = this.queue.shift();
    if (!next) { this.finish(); return; }
    const r = this.graph.route(this.graph.nearest(pos), next.access);
    this.dest = next;
    this.optimal = r ?? { pts: [pos, next.target], length: Math.hypot(next.target[0] - pos[0], next.target[1] - pos[1]) };
    this.optimalTotal += this.optimal.length;
    this.legStart = this.time;
    this.flash(`Stop ${this.legs.length} reached — next: ${next.name}`, true);
  }

  distanceLeft(pos: Pt) { return this.dest ? Math.max(0, this.distanceTo(this.dest, pos) - ARRIVAL_M) : 0; }

  private finish() {
    const optimal = this.optimalTotal;
    const driven = Math.max(this.driven, 1);
    // Arriving anywhere within ARRIVAL_M can be shorter than the route to the reference node.
    const onNetwork = 1 - Math.min(1, this.offNetwork / driven);
    // A shortcut across grass, walls or lots is not a better route: efficiency and pace only
    // count in proportion to the driving done on roads, walks and lots.
    const efficiency = Math.max(0, Math.min(1, (optimal - ARRIVAL_M * this.legs.length) / driven)) * onNetwork;
    const timeScore = Math.min(1, optimal / REFERENCE_SPEED / Math.max(this.time, 0.1)) * onNetwork;
    const events = this.stopsAll + this.bumpsAll;
    const traffic = events ? (this.stopsOk + this.bumpsOk) / events : 1;
    let score = Math.round(1000 * (0.4 * efficiency + 0.3 * timeScore + 0.15 * onNetwork + 0.15 * traffic)) - 50 * this.hits - COLLISION_PENALTY * this.collisions;
    score = Math.round(score * (1 - 0.1 * (+this.assist.route + +this.assist.beam)));
    score = Math.max(0, score);
    const grade = score >= 900 ? 'S' : score >= 800 ? 'A' : score >= 680 ? 'B' : score >= 550 ? 'C' : 'D';
    const runName = this.legs.length > 1 ? this.legs.map(l => l.name).join(' → ') : this.dest!.name;
    const key = 'utd-ems-best:' + runName;
    let best: number | null = null;
    try { best = Number(localStorage.getItem(key)) || null; if (!best || score > best) localStorage.setItem(key, String(score)); } catch { /* storage unavailable */ }
    this.result = {
      destination: runName, legs: this.legs, collisions: this.collisions, time: this.time, driven, optimal, offNetwork: this.offNetwork, efficiency, timeScore, onNetwork, traffic,
      stops: { obeyed: this.stopsOk, total: this.stopsAll }, bumps: { slow: this.bumpsOk, total: this.bumpsAll }, hits: this.hits,
      score, grade, assisted: this.assisted, best,
    };
    this.phase = 'finished';
  }
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function inRing(p: Pt, r: Pt[]) {
  let q = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) q = !q;
  }
  return q;
}

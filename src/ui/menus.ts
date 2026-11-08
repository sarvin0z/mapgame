// Dispatch (main and pause menu), the call card in play, and the run result.
// Runs are presented as dispatch calls: a call type with a one-line dispatch note
// (flavor only; gameplay is the Route Challenge), a destination with its code,
// the drive distance along the campus network and an estimated drive time.
// Talks to the game through callbacks; holds no game state.
import type { Destination, RouteChallenge, RunResult } from '../gameplay/routeChallenge.ts';
import type { Pt } from '../world/campusData.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface MenuHooks {
  free(): void;
  /** One destination, an ordered list of stops, or random (`stops` random stops). */
  start(dest?: string | string[], stops?: number): void;
  quality(q: string): void;
  time(t: string): void;
  menuOpen(open: boolean): void;
  /** Map position the cart deploys from (for call distances). */
  deployPoint(): Pt;
  /** A photo of the destination rendered from the game, as an image URL. */
  thumb?(d: Destination): Promise<string | null>;
}

interface CallType { name: string; icon: string; lines: string[]; lots?: boolean; buildings?: boolean }
/** Call types and dispatch notes (flavor for route runs; no patient care is simulated). */
const CALL_TYPES: CallType[] = [
  { name: 'Medical Assist', icon: 'i-cross', buildings: true, lines: ['Student reports dizziness and near-fainting.', 'Caller feeling faint after skipping meals; conscious and talking.', 'Staff member with chest discomfort, alert, sitting down.'] },
  { name: 'Fall Injury', icon: 'i-fall', lines: ['Reported fall with possible ankle injury.', 'Student tripped on the stairs; wrist pain, no head strike reported.'] },
  { name: 'Difficulty Breathing', icon: 'i-lungs', buildings: true, lines: ['Student with a history of asthma, short of breath; inhaler not helping.'] },
  { name: 'Allergic Reaction', icon: 'i-allergy', buildings: true, lines: ['Hives and itching after lunch; caller says no trouble breathing.'] },
  { name: 'Event Standby', icon: 'i-people', buildings: true, lines: ['Medical coverage requested for a well-attended student event.'] },
  { name: 'Vehicle Incident', icon: 'i-car', lots: true, lines: ['Minor collision in the lot with a possible injury.', 'Pedestrian bumped by a slow-moving car; reports hip pain.'] },
];

interface Call { type: CallType; dest: Destination; line: string; dist: number | null }

const REFERENCE_SPEED = 7; // m/s, the pace the Route Challenge rewards
const rnd = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 2 ** 32; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

/** Short location code: "Lot M East" -> "M EAST", "University Village Building 11" -> "UV11", "Andromeda Hall" -> "AH". */
export function locationCode(name: string) {
  const uv = name.match(/^University Village Building (\d+)/);
  if (uv) return 'UV' + uv[1];
  if (/^Lot /.test(name)) return name.slice(4).toUpperCase();
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !/^(and|of|the|for|at|jr)$/i.test(w));
  return words.map(w => (/^\d+$/.test(w) ? w : w[0].toUpperCase())).join('').slice(0, 5);
}

function difficulty(m: number | null) { return m === null ? '—' : m < 500 ? 'Beginner' : m < 1100 ? 'Intermediate' : 'Advanced'; }
function miles(m: number) { return (m / 1609.34).toFixed(m < 1609 ? 2 : 1) + ' mi'; }
function mmss(s: number) { const t = Math.round(s), m = Math.floor(t / 60), r = t - m * 60; return `${m}:${String(r).padStart(2, '0')}`; }
/** m:ss.d, rounded once so 69.96 s reads 1:10.0 (not 1:010.0). */
export function fmt(t: number) { const d = Math.round(t * 10), m = Math.floor(d / 600), s = (d - m * 600) / 10; return `${m}:${s.toFixed(1).padStart(4, '0')}`; }
/** Restarts a CSS animation class on an element. */
function replay(el: Element, cls: string) { el.classList.remove(cls); void (el as HTMLElement).offsetWidth; el.classList.add(cls); }

export class Menus {
  private menu = $('menu');
  private result = $('result');
  private list = $('dest-list');
  private search = $<HTMLInputElement>('dest-search');
  private assist = $<HTMLInputElement>('assist');
  private card = $('callcard');
  private cd = $('countdown');
  private calls: Call[] = [];
  private selected: Call | null = null;
  /** The call being driven, and per-stop calls of a multi-call run. */
  private current: Call | null = null;
  private stopCalls = new Map<string, Call>();
  private thumbs = new Map<string, string>();
  private thumbQueue: Promise<unknown> = Promise.resolve();
  lastDest: string | string[] | undefined;
  lastStops = 1;
  private picking = false;
  private stops: string[] = [];
  private shownDest = '';
  private shownEvent = '';
  private shownCount = '';
  started = false;

  constructor(private rc: RouteChallenge, private hooks: MenuHooks) {
    const act = (a: string) => {
      if (a === 'free') { this.close(); hooks.free(); }
      if (a === 'start' && this.selected) this.startCall(this.selected);
      if (a === 'reroll') this.newCalls();
      if (a === 'retry') { this.close(); hooks.start(this.lastDest ?? rc.result?.legs.map(l => l.name), this.lastStops); }
      if (a === 'next') { this.newCalls(); this.startCall(this.calls[0]); }
      if (a === 'dispatch') { this.result.hidden = true; this.open(); }
      if (a === 'multi-random') {
        const n = Math.max(2, Math.min(10, Number($<HTMLInputElement>('multi-count').value) || 3));
        this.current = null; this.stopCalls.clear();
        this.close(); this.lastDest = undefined; this.lastStops = n; hooks.start(undefined, n);
      }
      if (a === 'multi-choose') { this.picking = true; this.stops = []; this.renderStops(); this.tab('locations'); this.search.focus(); }
      if (a === 'multi-start' && this.stops.length) {
        const s = this.stops.slice();
        this.current = null; this.stopCalls.clear(); this.picking = false;
        this.close(); this.lastDest = s; this.lastStops = s.length; hooks.start(s);
      }
      if (a === 'resume') this.close();
    };
    document.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-action],[data-view],[data-tab]');
      if (!b || !(this.menu.contains(b) || this.result.contains(b))) return;
      if (b.dataset.action) act(b.dataset.action);
      else if (b.dataset.view && b.classList.contains('nav')) this.view(b.dataset.view);
      else if (b.dataset.tab && b.getAttribute('role') === 'tab') this.tab(b.dataset.tab);
    });
    this.search.addEventListener('input', () => this.renderList());
    $('dest-clear').addEventListener('click', () => { this.search.value = ''; this.renderList(); this.search.focus(); });
    $<HTMLSelectElement>('quality-select').addEventListener('change', e => hooks.quality((e.target as HTMLSelectElement).value));
    $<HTMLSelectElement>('time-select').addEventListener('change', e => hooks.time((e.target as HTMLSelectElement).value));
    $<HTMLSelectElement>('start-select').addEventListener('change', () => { this.updateDeploy(); this.newCalls(); });
    addEventListener('keydown', e => {
      if (e.code === 'Enter' && !this.menu.hidden && this.selected && document.activeElement?.tagName !== 'INPUT') { this.startCall(this.selected); return; }
      if (e.code !== 'Escape' || !this.started) return;
      if (!this.result.hidden) { this.result.hidden = true; this.open(); return; }
      if (this.menu.hidden) this.open(); else this.close();
    });
    this.updateDeploy();
    this.newCalls();
    this.renderList();
  }

  get assisted() { return this.assist.checked; }
  get showTarget() { return $<HTMLInputElement>('show-target').checked; }
  get showBeam() { return $<HTMLInputElement>('show-beam').checked; }
  /** Shows the given time of day in the selector (e.g. one set from the URL). */
  setTime(t: string) { $<HTMLSelectElement>('time-select').value = t; }
  get startKey() { return $<HTMLSelectElement>('start-select').value; }
  get isOpen() { return !this.menu.hidden || !this.result.hidden; }

  open() {
    this.menu.hidden = false;
    $('resume-btn').hidden = !this.started;
    // Assists are fixed for a run once it starts; while paused, changes apply to the next call.
    const active = this.rc.phase === 'running' || this.rc.phase === 'countdown';
    $('assist-note').hidden = !active;
    replay(this.menu, 'enter');
    document.body.classList.add('menu-open');
    this.hooks.menuOpen(true);
  }
  /** Opens dispatch on the controls page (F1). */
  showControls() { if (this.menu.hidden) this.open(); this.view('controls'); }
  close() { this.showFirstDriveTip(); this.view('dispatch'); this.menu.hidden = true; this.result.hidden = true; this.started = true; document.body.classList.remove('menu-open'); this.hooks.menuOpen(false); }

  private view(v: string) {
    for (const n of this.menu.querySelectorAll<HTMLElement>('.nav[data-view]')) n.classList.toggle('on', n.dataset.view === v);
    for (const el of this.menu.querySelectorAll<HTMLElement>('.view')) el.hidden = el.dataset.view !== v;
  }

  private tab(t: string) {
    for (const b of this.menu.querySelectorAll<HTMLElement>('[role="tab"]')) { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-selected', String(b.dataset.tab === t)); }
    for (const p of this.menu.querySelectorAll<HTMLElement>('.tabpanel')) p.hidden = p.dataset.tab !== t;
    $('reroll').hidden = t !== 'calls';
    if (t === 'locations') this.renderList();
  }

  private updateDeploy() { $('deploy-label').textContent = this.startKey === 'sg' ? 'Safety and Grounds' : 'the UEMR apartment'; }

  /** A call to `dest`: a type that suits it (vehicle incidents in lots, the rest at buildings). */
  private makeCall(dest: Destination): Call {
    const types = CALL_TYPES.filter(t => (dest.kind === 'lot' ? t.lots || !t.buildings : !t.lots));
    const type = pick(types);
    const from = this.hooks.deployPoint();
    const r = this.rc.graph.route(this.rc.graph.nearest(from), dest.access);
    return { type, dest, line: pick(type.lines), dist: r ? r.length : null };
  }

  /** Six open calls: random destinations, uniformly drawn, none trivially close to the deploy point. */
  private newCalls() {
    const from = this.hooks.deployPoint();
    const pool = this.rc.destinations.filter(d => this.rc.distanceTo(d, from) > 150);
    const order = pool.map(d => ({ d, k: rnd() })).sort((a, b) => a.k - b.k).map(x => x.d);
    this.calls = order.slice(0, 6).map(d => this.makeCall(d));
    this.renderCalls();
    this.select(this.calls[0] ?? null);
  }

  private renderCalls() {
    const box = $('calls');
    box.innerHTML = '';
    for (const c of this.calls) {
      const b = document.createElement('button');
      b.className = 'call';
      b.innerHTML = `<img alt="" /><div><div class="t"><svg><use href="#${c.type.icon}" /></svg>${c.type.name}</div>`
        + `<div class="l">${c.dest.name}</div><div class="d">${c.line}</div>`
        + `<div class="m"><span><svg><use href="#i-route" /></svg>${c.dist ? miles(c.dist) : '—'}</span><span><svg><use href="#i-clock" /></svg>~${c.dist ? mmss(c.dist / REFERENCE_SPEED) : '—'}</span><span><svg><use href="#i-level" /></svg>${difficulty(c.dist)}</span></div></div>`
        + `<svg class="chev"><use href="#i-back" /></svg>`;
      b.addEventListener('click', () => this.select(c));
      b.addEventListener('dblclick', () => this.startCall(c));
      box.appendChild(b);
      this.loadThumb(c.dest, b.querySelector('img')!);
    }
  }

  /** Thumbnails render one at a time (each is a full frame of the campus). */
  private loadThumb(d: Destination, img: HTMLImageElement) {
    const hit = this.thumbs.get(d.name);
    if (hit) { img.src = hit; return; }
    img.classList.add('loading');
    if (!this.hooks.thumb) return;
    this.thumbQueue = this.thumbQueue.then(async () => {
      const url = this.thumbs.get(d.name) ?? await this.hooks.thumb!(d);
      if (!url) return;
      this.thumbs.set(d.name, url);
      for (const el of document.querySelectorAll<HTMLImageElement>(`img[data-dest="${CSS.escape(d.name)}"]`)) { el.src = url; el.classList.remove('loading'); }
      img.src = url; img.classList.remove('loading');
    });
    img.dataset.dest = d.name;
  }

  private select(c: Call | null) {
    this.selected = c;
    for (const [i, el] of [...$('calls').children].entries()) el.classList.toggle('on', this.calls[i] === c);
    const brief = $('brief');
    $<HTMLButtonElement>('start-btn').disabled = !c;
    if (!c) return;
    $('brief-type').textContent = c.type.name;
    $('brief-loc').textContent = `${c.dest.name} (${locationCode(c.dest.name)})`;
    $('brief-icon').setAttribute('href', '#' + c.type.icon);
    $('brief-text').textContent = c.line;
    $('brief-dist').textContent = c.dist ? miles(c.dist) : '—';
    $('brief-time').textContent = c.dist ? '~' + mmss(c.dist / REFERENCE_SPEED) : '—';
    $('brief-diff').textContent = difficulty(c.dist);
    $('brief-code').textContent = locationCode(c.dest.name);
    const where = c.dest.kind === 'lot' ? `into ${c.dest.name}` : `to ${c.dest.name}, within 6 m of any wall`;
    $('brief-obj').innerHTML = [`Drive ${where}`, 'Keep to roads, walks and lots', 'Stop at stop signs and ease over speed bumps', 'Warn pedestrians with the horn or siren'].map(t => `<li>${t}</li>`).join('');
    this.loadThumb(c.dest, $<HTMLImageElement>('brief-img'));
    replay(brief, 'swap');
  }

  /** First-drive tip: the controls, once, until dismissed or after 12 s. */
  private tipShown = false;
  showFirstDriveTip() {
    let seen = false;
    try { seen = localStorage.getItem('utd-ems-tip') === '1'; } catch { /* storage unavailable */ }
    if (seen || this.tipShown) return;
    this.tipShown = true;
    const tip = $('first-tip');
    tip.hidden = false;
    const done = () => { tip.hidden = true; try { localStorage.setItem('utd-ems-tip', '1'); } catch { /* storage unavailable */ } };
    $('first-tip-ok').addEventListener('click', done, { once: true });
    setTimeout(done, 12000);
  }

  private startCall(c: Call) {
    this.current = c;
    this.stopCalls.clear();
    this.lastDest = c.dest.name; this.lastStops = 1;
    this.close();
    this.hooks.start(c.dest.name);
  }

  private renderList() {
    const q = this.search.value.trim().toLowerCase();
    this.list.innerHTML = '';
    const hits = this.rc.destinations.filter(d => !q || d.name.toLowerCase().includes(q) || locationCode(d.name).toLowerCase() === q
      || (d.aliases ?? []).some(a => a.toLowerCase().includes(q)));
    $('dest-empty').hidden = hits.length > 0;
    $('dest-empty-q').textContent = this.search.value.trim();
    for (const d of hits) {
      const b = document.createElement('button');
      const code = d.aliases?.[0] && /^[A-Z0-9]+$/.test(d.aliases[0]) ? d.aliases[0] : locationCode(d.name);
      b.innerHTML = (d.kind === 'lot' ? '<i>P</i>' : '') + `<span>${d.name}</span><small>${code}</small>`;
      b.addEventListener('click', () => {
        if (this.picking) {
          if (this.stops[this.stops.length - 1] !== d.name && this.stops.length < 10) this.stops.push(d.name);
          this.renderStops();
          return;
        }
        // A chosen location becomes a call in the brief, started from there.
        const c = this.makeCall(d);
        this.selected = c;
        this.select(c);
      });
      this.list.appendChild(b);
    }
  }

  /** The multi-call list being built; click a stop to remove it. */
  private renderStops() {
    const list = $('multi-list');
    list.innerHTML = '';
    this.stops.forEach((n, i) => {
      const chip = document.createElement('button');
      chip.textContent = `${i + 1}. ${n} ✕`;
      chip.setAttribute('aria-label', `Remove stop ${i + 1}, ${n}`);
      chip.addEventListener('click', () => { this.stops.splice(i, 1); this.renderStops(); });
      list.appendChild(chip);
    });
    if (this.stops.length) {
      const go = document.createElement('button');
      go.className = 'primary';
      go.dataset.action = 'multi-start';
      go.style.marginTop = '0';
      go.innerHTML = `<svg><use href="#i-play" /></svg>Start ${this.stops.length} call${this.stops.length === 1 ? '' : 's'}`;
      list.appendChild(go);
    }
    if (this.picking) this.tab('gauntlet');
  }

  /** The call for the stop being driven (a multi-call run gets a call per stop). */
  private callFor(d: Destination): Call {
    if (this.current && this.current.dest.name === d.name) return this.current;
    let c = this.stopCalls.get(d.name);
    if (!c) { c = this.makeCall(d); this.stopCalls.set(d.name, c); }
    return c;
  }

  /** Per-frame call card, countdown and unit state. */
  update(pos: Pt) {
    const rc = this.rc;
    const active = rc.phase === 'running' || rc.phase === 'countdown';
    $('unit-state').textContent = active ? 'Responding' : 'Available';
    $('unit-dot').classList.toggle('busy', active);
    this.card.hidden = rc.phase === 'idle' || rc.phase === 'finished' || !rc.dest;
    if (rc.phase === 'idle') $('event').hidden = true;
    this.cd.hidden = rc.phase !== 'countdown';
    if (rc.phase === 'idle' || !rc.dest) { this.shownDest = ''; return; }
    if (rc.phase === 'countdown') {
      const n = String(Math.ceil(rc.countdown));
      if (n !== this.shownCount) { this.shownCount = n; this.cd.textContent = n; replay(this.cd, 'tick'); }
    } else this.shownCount = '';
    if (rc.dest.name !== this.shownDest) {
      // A new stop: the card changes in place, flipping like a dispatch board.
      this.shownDest = rc.dest.name;
      const c = this.callFor(rc.dest);
      $('cc-type').textContent = c.type.name;
      $('cc-icon').setAttribute('href', '#' + c.type.icon);
      $('obj-target').textContent = `${rc.dest.name} · ${locationCode(rc.dest.name)}`;
      replay(this.card, 'flip');
    }
    const si = rc.stopIndex;
    $('obj-label').textContent = (si.of > 1 ? `Stop ${si.n} of ${si.of}` : 'Responding') + (rc.assisted ? ' · assisted' : '');
    $('obj-time').textContent = fmt(rc.time);
    const left = rc.distanceLeft(pos);
    $('obj-dist').textContent = left > 400 ? miles(left) : Math.round(left) + ' m';
    $('obj-driven').textContent = rc.driven > 400 ? miles(rc.driven) : Math.round(rc.driven) + ' m';
    $('obj-warn').hidden = !(rc.phase === 'running' && rc.offNetwork > 0 && rc.lastOff);
    const ev = $('event');
    const show = !!rc.event && rc.phase === 'running' && rc.time - rc.event.t < 2.2;
    ev.hidden = !show;
    if (show && rc.event!.text + rc.event!.t !== this.shownEvent) {
      this.shownEvent = rc.event!.text + rc.event!.t;
      ev.textContent = rc.event!.text;
      ev.className = rc.event!.good ? 'good' : 'bad';
      replay(ev, 'flip');
    }
  }

  showResult(r: RunResult, map: { image: HTMLCanvasElement; bounds: { minX: number; maxY: number }; scale: number }, route: Pt[], trail: Pt[]) {
    this.result.hidden = false;
    document.body.classList.add('menu-open');
    this.hooks.menuOpen(true);
    const multi = r.legs.length > 1;
    const typeName = multi ? 'Multi-call' : this.current?.type.name ?? 'Response';
    $('res-dest').textContent = `${typeName} · ${multi ? `${r.legs.length} stops` : r.destination}`;
    $('res-grade').textContent = r.grade;
    $('res-score').textContent = String(r.score);
    $('res-best').textContent = r.best && r.best > r.score ? `Best ${r.best}` : r.best ? 'New best' : 'First run';
    const ring = $('res-ring');
    ring.setAttribute('stroke-dasharray', '0 100');
    requestAnimationFrame(() => requestAnimationFrame(() => ring.setAttribute('stroke-dasharray', `${(r.score / 10).toFixed(1)} 100`)));
    const pct = (v: number) => Math.round(v * 100) + '%';
    const rows: [string, string][] = [
      ['Response time', fmt(r.time)], ['Distance driven', miles(r.driven)], ['Best route', miles(r.optimal)], ['Route efficiency', pct(r.efficiency)],
      ['On roads and walks', pct(r.onNetwork)], ['Stop signs', r.stops.total ? `${r.stops.obeyed} of ${r.stops.total}` : 'None passed'],
      ['Speed bumps', r.bumps.total ? `${r.bumps.slow} of ${r.bumps.total}` : 'None passed'],
      ...(multi ? r.legs.map((l, i) => [`Stop ${i + 1} · ${locationCode(l.name)}`, fmt(l.time)] as [string, string]) : []),
    ];
    $('res-grid').innerHTML = rows.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
    const target = r.optimal / REFERENCE_SPEED;
    const checks: [boolean, string][] = [
      [r.time <= target * 1.15, `Arrived near the target time (${mmss(target)})`],
      [r.onNetwork >= 0.95, 'Stayed on roads, walks and lots'],
      [r.stops.obeyed === r.stops.total, r.stops.total ? 'Stopped at every stop sign' : 'No stop signs on the way'],
      [r.bumps.slow === r.bumps.total, r.bumps.total ? 'Eased over every speed bump' : 'No speed bumps on the way'],
      [r.hits === 0, r.hits ? `${r.hits} pedestrian contact${r.hits === 1 ? '' : 's'}` : 'No pedestrian contact'],
      [r.collisions === 0, r.collisions ? `${r.collisions} collision${r.collisions === 1 ? '' : 's'}` : 'No collisions'],
    ];
    $('res-checks').innerHTML = checks.map(([ok, t]) => `<li class="${ok ? '' : 'miss'}"><svg><use href="#${ok ? 'i-check' : 'i-miss'}" /></svg>${t}</li>`).join('');
    replay(this.result.querySelector('.result')!, 'enter');
    // Map: both routes framed together over the minimap image.
    const c = $<HTMLCanvasElement>('res-map'), g = c.getContext('2d')!;
    const all = route.concat(trail);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of all) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const pad = 30, sc = Math.min((c.width - 2 * pad) / Math.max(1, x1 - x0), (c.height - 2 * pad) / Math.max(1, y1 - y0));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const P = (p: Pt) => [c.width / 2 + (p[0] - cx) * sc, c.height / 2 - (p[1] - cy) * sc] as const;
    g.clearRect(0, 0, c.width, c.height);
    const k = sc / map.scale;
    g.save();
    g.globalAlpha = 0.8;
    g.setTransform(k, 0, 0, k, c.width / 2 - ((cx - map.bounds.minX) * map.scale) * k, c.height / 2 - ((map.bounds.maxY - cy) * map.scale) * k);
    g.drawImage(map.image, 0, 0);
    g.restore();
    const line = (pts: Pt[], color: string, w: number) => { g.strokeStyle = color; g.lineWidth = w; g.lineJoin = g.lineCap = 'round'; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(...P(p)) : g.moveTo(...P(p)))); g.stroke(); };
    line(route, '#3fb27f', 5);
    line(trail, '#e87500', 3);
  }
}

// HUD: speedometer, status chips, location card, minimap (with route and target),
// performance monitor and help.
import type { CampusData, Pt } from '../world/campusData.ts';
import { DRIVABLE, PATHS } from '../world/campusData.ts';
import { centroid } from '../world/geometry.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface MapOverlay { target?: Pt; route?: Pt[]; trail?: Pt[] }

export class Hud {
  private speedEl = $('speed-value');
  private arc = document.getElementById('speed-arc') as unknown as SVGPathElement;
  private gears = [...document.querySelectorAll<HTMLElement>('#gear-strip span')];
  private statusEl = $('status');
  private locName = $('loc-name');
  private locSub = $('loc-sub');
  private perfEl = $('perf');
  private helpEl = $('help');
  private mapCanvas = $<HTMLCanvasElement>('minimap');
  private mapWrap = $('minimap-wrap');
  private toastEl = $('toast');
  private toastTimer = 0;
  readonly mapImage: HTMLCanvasElement;
  readonly bounds: { minX: number; maxY: number };
  readonly MAP_SCALE = 0.6; // px per meter in the pre-rendered map
  private named: { name: string; ring: Pt[]; c: Pt; r: number }[];
  private locCard = $('location');
  /** Called when a status chip is clicked (lights, siren, horn, headlights, camera, location). */
  onChip: (id: string) => void = () => {};
  private nearTimer = 0;
  private lastStatus = '';
  overlay: MapOverlay = {};

  constructor(private data: CampusData) {
    this.named = data.buildings.filter(b => b.name).map(b => {
      const c = centroid(b.outer);
      const r = Math.max(...b.outer.map(p => Math.hypot(p[0] - c[0], p[1] - c[1])));
      return { name: /^\d+$/.test(b.name!) ? `University Village Building ${b.name}` : b.name!, ring: b.outer, c, r };
    }).filter(n => !/Mail$/.test(n.name));
    this.statusEl.addEventListener('click', e => { const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id; if (id) this.onChip(id); });
    const pts = data.buildings.flatMap(b => b.outer).concat(data.roads.flatMap(r => r.pts));
    const minX = Math.min(...pts.map(p => p[0])) - 50, maxX = Math.max(...pts.map(p => p[0])) + 50;
    const minY = Math.min(...pts.map(p => p[1])) - 50, maxY = Math.max(...pts.map(p => p[1])) + 50;
    this.bounds = { minX, maxY };
    this.mapImage = this.renderMap(Math.ceil((maxX - minX) * this.MAP_SCALE), Math.ceil((maxY - minY) * this.MAP_SCALE));
    this.buildTicks();
    this.buildCompass();
  }

  /** Compass strip: a tick every 5 degrees, bearings every 15 and cardinal letters, laid out over -360..720 so it wraps. */
  private static readonly PX_PER_DEG = 4;
  private compassStrip = $('compass-strip');
  private compassTarget = $('compass-target');
  private buildCompass() {
    const names: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let html = '';
    for (let d = -360; d <= 720; d += 5) {
      const n = ((d % 360) + 360) % 360;
      const label = names[n] ?? (n % 15 === 0 ? String(n) : '');
      const cls = names[n] ? 'mj card' : n % 15 === 0 ? 'mj' : '';
      html += `<span class="${cls}" style="left:${d * Hud.PX_PER_DEG}px"><b>${label}</b></span>`;
    }
    this.compassStrip.innerHTML = html;
  }

  /** Speedometer ticks every mph from 0 to 25 along the 270° arc, labels every 5. */
  private buildTicks() {
    const g = document.getElementById('ticks')!;
    const ns = 'http://www.w3.org/2000/svg';
    for (let mph = 0; mph <= 25; mph += 1) {
      const a = (135 + (mph / 25) * 270) * Math.PI / 180;
      const major = mph % 5 === 0;
      const r0 = major ? 70 : 74, r1 = 79;
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', String(100 + Math.cos(a) * r0)); l.setAttribute('y1', String(100 + Math.sin(a) * r0));
      l.setAttribute('x2', String(100 + Math.cos(a) * r1)); l.setAttribute('y2', String(100 + Math.sin(a) * r1));
      if (major) l.setAttribute('class', 'major');
      g.appendChild(l);
      if (major) {
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('x', String(100 + Math.cos(a) * 60)); t.setAttribute('y', String(100 + Math.sin(a) * 60));
        t.textContent = String(mph);
        g.appendChild(t);
      }
    }
  }

  private renderMap(w: number, h: number) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    const s = this.MAP_SCALE;
    const tx = (p: Pt) => [(p[0] - this.bounds.minX) * s, (this.bounds.maxY - p[1]) * s] as const;
    const poly = (ring: Pt[]) => { g.beginPath(); ring.forEach((p, i) => (i ? g.lineTo(...tx(p)) : g.moveTo(...tx(p)))); g.closePath(); };
    g.fillStyle = '#1d211a'; g.fillRect(0, 0, w, h);
    for (const a of this.data.areas) {
      g.fillStyle = a.kind === 'water' || a.kind === 'pool' ? '#1f4a6b' : a.kind === 'parking' ? '#2e3338' : a.kind === 'plaza' ? '#4a4840' : '#24392a';
      poly(a.outer); g.fill();
    }
    g.lineCap = g.lineJoin = 'round';
    for (const pass of [0, 1]) for (const r of this.data.roads) {
      const drive = DRIVABLE.has(r.cls);
      if (!drive && !PATHS.has(r.cls)) continue;
      if ((pass === 0) !== drive) continue;
      g.strokeStyle = drive ? '#5b636c' : '#7f7a6e';
      g.lineWidth = Math.max(1, r.w * s);
      g.beginPath(); r.pts.forEach((p, i) => (i ? g.lineTo(...tx(p)) : g.moveTo(...tx(p)))); g.stroke();
    }
    for (const b of this.data.buildings) { g.fillStyle = b.name && !/^\d+$/.test(b.name) ? '#c9b58f' : '#8f8676'; poly(b.outer); g.fill(); }
    return c;
  }

  update(o: { speedMS: number; gear: string; x: number; z: number; heading: number; lights: boolean; siren: boolean; horn: boolean; headlights: boolean; camera: string; lat: number; lon: number }, dt: number) {
    const mph = Math.abs(o.speedMS) * 2.23694;
    this.speedEl.textContent = mph.toFixed(0);
    this.arc.setAttribute('stroke-dasharray', `${(Math.min(1, mph / 25) * 100).toFixed(1)} 100`);
    for (const s of this.gears) s.classList.toggle('on', s.dataset.g === o.gear);
    const loc = !this.locCard.hidden;
    const st = `${o.lights}${o.siren}${o.horn}${o.headlights}${o.camera}${loc}`;
    if (st !== this.lastStatus) {
      this.lastStatus = st;
      // Icon buttons; the state is carried by colour and aria-pressed, the name by the label.
      const chip = (id: string, label: string, on: boolean, key: string) =>
        `<button data-id="${id}" class="${on ? 'on' : ''}" aria-pressed="${on}" aria-label="${label} (${key})" title="${label} · ${key}"><svg><use href="#i-${id === 'location' ? 'pin' : id}" /></svg></button>`;
      this.statusEl.innerHTML = [
        chip('lights', 'Emergency lights', o.lights, 'L'), chip('siren', 'Siren', o.siren, 'H'), chip('horn', 'Horn', o.horn, 'B'),
        chip('headlights', 'Headlights', o.headlights, 'K'), chip('location', 'Location card', loc, 'I'),
        `<button data-id="camera" aria-label="Camera: ${o.camera} (C)" title="Camera: ${o.camera} · C"><svg><use href="#i-camera" /></svg></button>`,
      ].join('');
    }
    // Compass: bearing of travel (clockwise from north), and the destination's bearing when shown.
    const bearing = ((-o.heading * 180 / Math.PI) % 360 + 360) % 360;
    this.compassStrip.style.transform = `translateX(${-bearing * Hud.PX_PER_DEG}px)`;
    const t = this.overlay.target;
    if (t) {
      const tb = Math.atan2(t[0] - o.x, t[1] + o.z) * 180 / Math.PI;
      const diff = ((tb - bearing + 540) % 360) - 180;
      const half = this.compassStrip.parentElement!.clientWidth / 2 / Hud.PX_PER_DEG - 4;
      this.compassTarget.hidden = false;
      this.compassTarget.style.left = `calc(50% + ${Math.max(-half, Math.min(half, diff)) * Hud.PX_PER_DEG}px)`;
    } else this.compassTarget.hidden = true;
    this.nearTimer -= dt;
    if (this.nearTimer <= 0) {
      this.nearTimer = 0.4;
      const p: Pt = [o.x, -o.z];
      // Distance to each building's walls (0 inside), not to an approximate circle.
      let best = '', bd = Infinity;
      for (const n of this.named) {
        if (Math.hypot(n.c[0] - p[0], n.c[1] - p[1]) - n.r > bd) continue;
        const d = polyDist(p, n.ring);
        if (d < bd) { bd = d; best = n.name; }
      }
      this.locName.textContent = best;
      this.locSub.textContent = `${bd === 0 ? 'Inside' : bd < 25 ? 'Beside' : `${Math.round(bd)} m from`} · ${o.lat.toFixed(5)}°, ${o.lon.toFixed(5)}°`;
    }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.toastEl.hidden = true; }
    this.drawMinimap(o.x, -o.z, o.heading);
  }

  toast(msg: string, secs = 2.5) { this.toastEl.textContent = msg; this.toastEl.hidden = false; this.toastTimer = secs; }

  private drawMinimap(x: number, y: number, heading: number) {
    if (this.mapWrap.hidden) return;
    const c = this.mapCanvas, g = c.getContext('2d')!;
    const W = c.width, H = c.height, s = this.MAP_SCALE, zoom = 1.5;
    const toLocal = (p: Pt) => [(p[0] - this.bounds.minX) * s, (this.bounds.maxY - p[1]) * s] as const;
    g.save();
    g.clearRect(0, 0, W, H);
    g.translate(W / 2, H / 2);
    g.rotate(heading);
    g.scale(zoom, zoom);
    g.translate(-(x - this.bounds.minX) * s, -(this.bounds.maxY - y) * s);
    g.drawImage(this.mapImage, 0, 0);
    const line = (pts: Pt[], color: string, w: number) => {
      g.strokeStyle = color; g.lineWidth = w / zoom; g.lineCap = g.lineJoin = 'round';
      g.beginPath(); pts.forEach((p, i) => { const [px, py] = toLocal(p); if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.stroke();
    };
    if (this.overlay.trail?.length) line(this.overlay.trail, 'rgba(232,117,0,0.85)', 3);
    if (this.overlay.route?.length) line(this.overlay.route, 'rgba(61,220,151,0.95)', 4);
    g.restore();
    // Target: on the map, or pinned to the rim in its direction.
    if (this.overlay.target) {
      const dx = (this.overlay.target[0] - x) * s * zoom, dy = -(this.overlay.target[1] - y) * s * zoom;
      const rx = dx * Math.cos(heading) - dy * Math.sin(heading), ry = dx * Math.sin(heading) + dy * Math.cos(heading);
      const d = Math.hypot(rx, ry), R = W / 2 - 14, k = d > R ? R / d : 1;
      g.fillStyle = '#ff3b30'; g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.arc(W / 2 + rx * k, H / 2 + ry * k, 7, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.fillStyle = '#ffffff'; g.strokeStyle = '#e87500'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(W / 2, H / 2 - 10); g.lineTo(W / 2 + 7, H / 2 + 8); g.lineTo(W / 2, H / 2 + 4); g.lineTo(W / 2 - 7, H / 2 + 8); g.closePath(); g.fill(); g.stroke();
    g.save(); g.translate(W / 2, H / 2); g.rotate(heading); g.translate(0, -(W / 2 - 16));
    g.fillStyle = '#fff'; g.font = '700 12px Barlow, system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', 0, 0);
    g.restore();
  }

  toggleLocation() { this.locCard.hidden = !this.locCard.hidden; this.lastStatus = ''; }
  toggleMap() { this.mapWrap.hidden = !this.mapWrap.hidden; }
  togglePerf() { this.perfEl.hidden = !this.perfEl.hidden; }
  toggleHelp() { this.helpEl.hidden = !this.helpEl.hidden; }
  get perfVisible() { return !this.perfEl.hidden; }
  setPerf(lines: [string, string][]) { this.perfEl.innerHTML = lines.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join(''); }
}

function polyDist(p: Pt, r: Pt[]) {
  let inside = false, m = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    m = Math.min(m, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return inside ? 0 : m;
}

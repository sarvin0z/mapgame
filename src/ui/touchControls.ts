// Touch HUD for phones and tablets, after the mobile mock-up: an orange Menu button top
// left, the destination pill top centre, a column of cart buttons down the right edge
// beside the minimap, the drive stick bottom left and a speed pill bottom right.
// Shown on coarse pointers, or anywhere with ?touch=1 (for testing on a desktop).
// Also owns the accessibility preferences (Settings), which apply on every device.
import type { Input } from '../input.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface TouchPrefs { tap: boolean; left: boolean; reduce: boolean }
export interface HudState { mph: number; gear: string; lights: boolean; siren: boolean; horn: boolean; headlights: boolean; muted: boolean }

export class TouchControls {
  readonly enabled: boolean;
  prefs: TouchPrefs;
  onPrefs: (p: TouchPrefs) => void = () => {};
  /** A side button was pressed (sound, lights, siren, horn, headlights, camera). */
  onButton: (id: string) => void = () => {};
  private pillTimer = 0;
  private lastPill = '';
  private lastState = '';
  private mph = $('m-mph');
  private gear = $('m-gear');

  constructor(private input: Input, private hooks: { pause: () => void }) {
    const forced = new URLSearchParams(location.search).get('touch');
    this.enabled = forced === '1' || (forced !== '0' && matchMedia('(pointer: coarse)').matches);
    let saved: Partial<TouchPrefs> = {};
    try { saved = JSON.parse(localStorage.getItem('utd-ems-a11y') ?? '{}'); } catch { /* storage unavailable */ }
    this.prefs = { tap: !!saved.tap, left: !!saved.left, reduce: saved.reduce ?? matchMedia('(prefers-reduced-motion: reduce)').matches };
    const bind = (id: string, k: keyof TouchPrefs) => $<HTMLInputElement>(id).addEventListener('change', e => { this.prefs[k] = (e.target as HTMLInputElement).checked; this.apply(); });
    bind('a11y-tap', 'tap'); bind('a11y-left', 'left'); bind('a11y-reduce', 'reduce');
    if (this.enabled) {
      document.body.classList.add('touch-ui');
      $('touch').hidden = false;
      $('m-hud').hidden = false;
      this.joystick();
      this.pads();
      // Buttons act on finger-down. A browser only turns the *first* finger's tap into a click, so
      // with a thumb on the drive stick, a tap on another button would otherwise do nothing.
      // Keyboard and mouse activation still come through as clicks (detail 0 = keyboard).
      const press = (el: HTMLElement, fn: (e: Event) => void) => {
        el.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') { e.preventDefault(); fn(e); } });
        el.addEventListener('click', e => { if ((e as PointerEvent).pointerType === 'mouse' || e.detail === 0) fn(e); });
      };
      press($('m-menu'), () => this.hooks.pause());
      press($('m-side'), e => { const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id; if (id) this.onButton(id); });
    }
    this.apply();
  }

  /** Re-applies the preferences (body classes and the Settings switches), saves and reports them. */
  private apply() {
    const b = document.body.classList;
    b.toggle('tap-steer', this.enabled && this.prefs.tap);
    b.toggle('left-handed', this.enabled && this.prefs.left);
    b.toggle('reduce-motion', this.prefs.reduce);
    $<HTMLInputElement>('a11y-tap').checked = this.prefs.tap;
    $<HTMLInputElement>('a11y-left').checked = this.prefs.left;
    $<HTMLInputElement>('a11y-reduce').checked = this.prefs.reduce;
    this.input.analog.x = this.input.analog.y = 0;
    try { localStorage.setItem('utd-ems-a11y', JSON.stringify(this.prefs)); } catch { /* storage unavailable */ }
    this.onPrefs(this.prefs);
  }

  /**
   * Floating-origin joystick: the base sits where the thumb lands inside the zone, the knob
   * follows within its radius. Small dead zone, then a gentle curve so small deflections
   * steer finely; release springs the knob home and lets go of every input.
   */
  private joystick() {
    const zone = $('joy'), base = zone.querySelector<HTMLElement>('.joy-base')!, knob = zone.querySelector<HTMLElement>('.joy-knob')!;
    let id = -1, ox = 0, oy = 0, R = 60;
    const curve = (v: number) => { const a = Math.abs(v); return a < 0.1 ? 0 : Math.sign(v) * Math.pow((a - 0.1) / 0.9, 1.35); };
    const move = (cx: number, cy: number) => {
      let dx = cx - ox, dy = cy - oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.translate = `${dx}px ${dy}px`;
      this.input.analog.x = curve(dx / R);
      this.input.analog.y = curve(-dy / R);
      zone.classList.toggle('go', this.input.analog.y > 0.05);
      zone.classList.toggle('stop', this.input.analog.y < -0.05);
    };
    const end = () => {
      if (id < 0) return;
      id = -1;
      this.input.analog.x = this.input.analog.y = 0;
      zone.classList.remove('drag', 'go', 'stop');
      knob.style.translate = '';
      base.style.translate = '';
    };
    zone.addEventListener('pointerdown', e => {
      if (id >= 0) return;
      e.preventDefault();
      id = e.pointerId;
      try { zone.setPointerCapture(id); } catch { /* pointer already gone */ }
      const r = zone.getBoundingClientRect(), home = base.getBoundingClientRect();
      // Travel is a little under the base's radius, whatever size the layout gives it.
      R = home.width * 0.4;
      // The base jumps under the thumb (clamped inside the zone), so the stick never needs aiming.
      const half = home.width / 2;
      const cx = Math.min(r.right - half, Math.max(r.left + half, e.clientX));
      const cy = Math.min(r.bottom - half, Math.max(r.top + half, e.clientY));
      base.style.translate = `${cx - (home.left + half)}px ${cy - (home.top + half)}px`;
      ox = cx; oy = cy;
      zone.classList.add('drag');
      move(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', e => { if (e.pointerId === id) move(e.clientX, e.clientY); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) zone.addEventListener(ev, e => { if (e.pointerId === id) end(); });
    addEventListener('blur', end);
  }

  /**
   * Tap steering: on-screen pads hold the same keys as the keyboard (arrows). Release,
   * cancel and losing capture all let go, so a control can never stay stuck down.
   */
  private pads() {
    for (const b of document.querySelectorAll<HTMLButtonElement>('#touch button[data-key]')) {
      const code = b.dataset.key!;
      const up = () => { this.input.keys.delete(code); b.classList.remove('on'); };
      b.addEventListener('pointerdown', e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch { /* gone */ } this.input.keys.add(code); b.classList.add('on'); });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) b.addEventListener(ev, up);
    }
  }

  /** Per frame: speed pill and button states; the destination pill a few times a second. */
  update(dt: number, s: HudState) {
    if (!this.enabled) return;
    this.mph.textContent = String(Math.round(s.mph));
    this.gear.hidden = s.gear !== 'R';
    const key = `${s.lights}${s.siren}${s.horn}${s.headlights}${s.muted}`;
    if (key !== this.lastState) {
      this.lastState = key;
      const on: Record<string, boolean> = { sound: !s.muted, lights: s.lights, siren: s.siren, horn: s.horn, headlights: s.headlights };
      for (const b of document.querySelectorAll<HTMLElement>('#m-side [data-id]')) {
        const id = b.dataset.id!;
        if (!(id in on)) continue;
        b.classList.toggle('on', on[id] && id !== 'sound');
        b.classList.toggle('muted', id === 'sound' && !on[id]);
        b.setAttribute('aria-pressed', String(on[id]));
      }
    }
    this.pillTimer -= dt;
    if (this.pillTimer > 0) return;
    this.pillTimer = 0.2;
    const active = !$('callcard').hidden;
    const dest = active ? ($('obj-target').textContent ?? '').split(' · ')[0] : 'Free roam';
    const dist = active ? $('obj-dist').textContent ?? '' : '';
    const pill = `${active}|${dest}|${dist}`;
    if (pill === this.lastPill) return;
    this.lastPill = pill;
    $('m-dest').textContent = dest;
    $('m-dist').textContent = dist && dist !== '—' ? dist : '';
    $('m-dispatch').classList.toggle('live', active);
  }
}

/** Settings > Sound: four volume sliders and mute, bound to the mixer and saved. */
export function bindSoundSettings(get: () => { master: number; siren: number; cart: number; sfx: number; muted: boolean }, set: (v: Record<string, number | boolean>) => void) {
  const v = get();
  for (const k of ['master', 'siren', 'cart', 'sfx'] as const) {
    const input = $<HTMLInputElement>(`vol-${k}`), out = input.nextElementSibling as HTMLOutputElement;
    const show = () => { out.value = `${input.value}%`; input.style.setProperty('--fill', `${input.value}%`); };
    input.value = String(Math.round(v[k] * 100)); show();
    input.addEventListener('input', () => { show(); set({ [k]: Number(input.value) / 100 }); });
  }
  const mute = $<HTMLInputElement>('vol-mute');
  mute.checked = v.muted;
  mute.addEventListener('change', () => set({ muted: mute.checked }));
  /** Keeps the Settings switch in step when the HUD sound button toggles mute. */
  return (muted: boolean) => { mute.checked = muted; };
}

// Keyboard, mouse and touch state. Discrete actions are delivered via `onAction`.
export type Action = 'camera' | 'lights' | 'headlights' | 'siren' | 'horn' | 'location' | 'reset' | 'recover' | 'perf' | 'quality' | 'help' | 'map' | 'mute';

const ACTIONS: Record<string, Action> = {
  KeyC: 'camera', KeyL: 'lights', KeyK: 'headlights', KeyH: 'siren', KeyB: 'horn', KeyI: 'location', KeyR: 'recover',
  Backspace: 'reset', KeyP: 'perf', F3: 'perf', KeyG: 'quality', F1: 'help', Slash: 'help', KeyM: 'map', KeyN: 'mute',
};

/** The touch stick: x right, y up, each -1..1, with `active` while a finger holds it. */
export interface Stick { x: number; y: number; active: boolean }

export class Input {
  keys = new Set<string>();
  dragging = false;
  /** Analog stick (touch screens). Zero when nothing holds it. */
  readonly stick: Stick = { x: 0, y: 0, active: false };
  private mdx = 0;
  private mdy = 0;
  private wheel = 0;
  onAction: (a: Action) => void = () => {};

  constructor(el: HTMLElement) {
    addEventListener('keydown', e => {
      if (e.repeat) return;
      // Typing in a text field (destination search) is not driving. Sliders, switches and
      // selects keep focus after use, so they must not swallow the driving keys.
      const t = e.target as HTMLElement | null;
      if (t?.matches?.('textarea, input:not([type="range"]):not([type="checkbox"]):not([type="radio"])')) return;
      this.keys.add(e.code);
      // Shift+M belongs to the 3D annotation tool in dev builds, not the minimap.
      const a = e.shiftKey && e.code === 'KeyM' ? undefined : ACTIONS[e.code];
      if (a) { this.onAction(a); e.preventDefault(); }
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.releaseStick(); });
    el.addEventListener('pointerdown', e => { this.dragging = true; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointerup', e => { this.dragging = false; el.releasePointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => { if (this.dragging) { this.mdx += e.movementX; this.mdy += e.movementY; } });
    el.addEventListener('wheel', e => { this.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    el.addEventListener('contextmenu', e => e.preventDefault());
    this.touchStick();
  }

  private knob: HTMLElement | null = null;
  private releaseStick() {
    this.stick.x = this.stick.y = 0;
    this.stick.active = false;
    if (this.knob) { this.knob.classList.remove('held'); this.knob.style.transform = ''; }
  }

  /**
   * On touch screens, one analog stick drives the cart (shown on coarse pointers only).
   * The knob follows the finger inside the base's radius; release, cancel and losing the
   * pointer all spring it back to the centre, so the cart can never be left driving.
   * A small dead zone keeps a resting thumb from creeping the cart forward.
   */
  private touchStick() {
    const pad = document.getElementById('touch');
    const stickEl = document.getElementById('joystick');
    const knob = document.getElementById('joy-knob');
    if (!pad || !stickEl || !knob || !matchMedia('(pointer: coarse)').matches) return;
    pad.hidden = false;
    this.knob = knob;
    let id = -1;
    const move = (e: PointerEvent) => {
      const r = stickEl.getBoundingClientRect();
      const radius = r.width * 0.36;
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > radius) { dx *= radius / d; dy *= radius / d; }
      knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      const dead = 0.12;
      const shape = (v: number) => (Math.abs(v) < dead ? 0 : Math.sign(v) * (Math.abs(v) - dead) / (1 - dead));
      this.stick.x = shape(dx / radius);
      this.stick.y = shape(-dy / radius);
    };
    stickEl.addEventListener('pointerdown', e => {
      if (id !== -1) return;
      e.preventDefault();
      id = e.pointerId;
      try { stickEl.setPointerCapture(id); } catch { /* pointer already gone: the up handler still releases */ }
      this.stick.active = true;
      knob.classList.add('held');
      move(e);
    });
    stickEl.addEventListener('pointermove', e => { if (e.pointerId === id) move(e); });
    const up = (e: PointerEvent) => { if (e.pointerId !== id) return; id = -1; this.releaseStick(); };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) stickEl.addEventListener(ev, up);
  }

  axis(neg: string[], pos: string[]) {
    return (pos.some(k => this.keys.has(k)) ? 1 : 0) - (neg.some(k => this.keys.has(k)) ? 1 : 0);
  }

  consumeMouse() {
    const r = { dx: this.mdx, dy: this.mdy, wheel: this.wheel };
    this.mdx = this.mdy = this.wheel = 0;
    return r;
  }
}

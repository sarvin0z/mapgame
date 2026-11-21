// Keyboard and mouse state. Discrete actions are delivered via `onAction`.
export type Action = 'camera' | 'lights' | 'headlights' | 'siren' | 'horn' | 'location' | 'reset' | 'recover' | 'perf' | 'quality' | 'help' | 'map';

const ACTIONS: Record<string, Action> = {
  KeyC: 'camera', KeyL: 'lights', KeyK: 'headlights', KeyH: 'siren', KeyB: 'horn', KeyI: 'location', KeyR: 'recover',
  Backspace: 'reset', KeyP: 'perf', F3: 'perf', KeyG: 'quality', F1: 'help', Slash: 'help', KeyM: 'map',
};

export class Input {
  keys = new Set<string>();
  dragging = false;
  private mdx = 0;
  private mdy = 0;
  private wheel = 0;
  onAction: (a: Action) => void = () => {};

  constructor(el: HTMLElement) {
    addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const a = ACTIONS[e.code];
      if (a) { this.onAction(a); e.preventDefault(); }
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('pointerdown', e => { this.dragging = true; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointerup', e => { this.dragging = false; el.releasePointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => { if (this.dragging) { this.mdx += e.movementX; this.mdy += e.movementY; } });
    el.addEventListener('wheel', e => { this.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    el.addEventListener('contextmenu', e => e.preventDefault());
    this.touchControls();
  }

  /**
   * On touch screens, on-screen pads hold the same keys as the keyboard (arrows), so
   * the cart is drivable on phones. Release, cancel and leaving the button all let go,
   * so a control can never stay stuck down.
   */
  private touchControls() {
    const pad = document.getElementById('touch');
    if (!pad || !matchMedia('(pointer: coarse)').matches) return;
    pad.hidden = false;
    for (const b of pad.querySelectorAll<HTMLButtonElement>('button[data-key]')) {
      const code = b.dataset.key!;
      const up = () => { this.keys.delete(code); b.classList.remove('on'); };
      b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); this.keys.add(code); b.classList.add('on'); });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) b.addEventListener(ev, up);
    }
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

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
  }

  /** Analog drive from the touch joystick: x steer (-1 left .. 1 right), y pedal (1 go .. -1 brake). */
  analog = { x: 0, y: 0 };

  axis(neg: string[], pos: string[]) {
    return (pos.some(k => this.keys.has(k)) ? 1 : 0) - (neg.some(k => this.keys.has(k)) ? 1 : 0);
  }

  consumeMouse() {
    const r = { dx: this.mdx, dy: this.mdy, wheel: this.wheel };
    this.mdx = this.mdy = this.wheel = 0;
    return r;
  }
}

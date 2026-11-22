// Keyboard and mouse state. Discrete actions are delivered via `onAction`.
export type Action = 'camera' | 'lights' | 'headlights' | 'siren' | 'horn' | 'location' | 'reset' | 'recover' | 'perf' | 'quality' | 'help' | 'map';

const ACTIONS: Record<string, Action> = {
  KeyC: 'camera', KeyL: 'lights', KeyK: 'headlights', KeyH: 'siren', KeyB: 'horn', KeyI: 'location', KeyR: 'recover',
  Backspace: 'reset', KeyP: 'perf', F3: 'perf', KeyG: 'quality', F1: 'help', Slash: 'help', KeyM: 'map',
};

/** True while the user is typing into a field: game keys must not fire then. */
export function typingIn(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !(el as HTMLInputElement).type?.match(/^(checkbox|radio|range|button)$/);
}

export class Input {
  keys = new Set<string>();
  dragging = false;
  private mdx = 0;
  private mdy = 0;
  private wheel = 0;
  /** Active touch/pen pointers on the canvas, for two-finger pinch zoom. */
  private touches = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  onAction: (a: Action) => void = () => {};

  constructor(el: HTMLElement) {
    addEventListener('keydown', e => {
      // Typing in the destination search (or any field) is text, not driving.
      if (typingIn(e.target)) return;
      if (e.repeat) return;
      this.keys.add(e.code);
      const a = ACTIONS[e.code];
      if (a) { this.onAction(a); e.preventDefault(); }
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('pointerdown', e => {
      try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      if (e.pointerType !== 'mouse') {
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.touches.size === 2) { this.pinch = this.spread(); this.dragging = false; return; }
        if (this.touches.size > 2) return;
      }
      this.dragging = true;
    });
    const up = (e: PointerEvent) => {
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.pinch = 0;
      this.dragging = this.touches.size === 1;
      if (e.pointerType === 'mouse' || !this.touches.size) this.dragging = false;
      try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointermove', e => {
      const t = this.touches.get(e.pointerId);
      if (t) {
        const dx = e.clientX - t.x, dy = e.clientY - t.y;
        t.x = e.clientX; t.y = e.clientY;
        // Two fingers: pinch in or out moves the chase camera closer or farther (as the mouse wheel).
        if (this.touches.size === 2) {
          const s = this.spread();
          if (this.pinch > 0) this.wheel += (this.pinch - s) * 4;
          this.pinch = s;
          return;
        }
        if (this.touches.size === 1 && this.dragging) { this.mdx += dx; this.mdy += dy; }
        return;
      }
      if (this.dragging) { this.mdx += e.movementX; this.mdy += e.movementY; }
    });
    el.addEventListener('wheel', e => { this.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  private spread() {
    const [a, b] = [...this.touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
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

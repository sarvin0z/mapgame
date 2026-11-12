// Loading screen: a progress bar with the percentage loaded, the startup graphics-quality
// choice, and the credit line. Progress is real, not a timer: each asset download counts
// for its share when it lands, then the campus build and the first chunk stream fill the rest.
import { QUALITY_LABEL, type QualityName } from '../graphics/quality.ts';

export type QualityChoice = QualityName | 'auto';
const CHOICES: QualityChoice[] = ['auto', 'high', 'medium', 'low', 'verylow'];

const stored = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export class Loading {
  private el = document.getElementById('loading')!;
  private bar = document.getElementById('load-bar')!;
  private fill = this.bar.querySelector('i')!;
  private pctEl = document.getElementById('load-pct')!;
  private textEl = document.getElementById('load-text')!;
  private startBtn = document.getElementById('load-start') as HTMLButtonElement;
  private total = 0;
  private done = 0;
  /** Share of the bar the tracked downloads fill; build phases fill the rest. */
  private assetShare = 0.72;
  private shown = 0;

  /** Counts `p` toward the download share of the bar, `weight` relative to the others. */
  track<T>(p: Promise<T>, weight: number): Promise<T> {
    this.total += weight;
    return p.then(v => { this.done += weight; this.set(this.assetShare * this.done / this.total); return v; });
  }

  text(t: string) { this.textEl.textContent = t; }

  /** Quality already set (by the URL): no choice to show. */
  skipChoice() { document.getElementById('quality-pick')!.hidden = true; }

  /** Moves the bar to `f` (0..1). It never moves backward. */
  set(f: number) {
    f = Math.min(1, Math.max(this.shown, f));
    this.shown = f;
    const pct = Math.round(f * 100);
    this.fill.style.transform = `scaleX(${f.toFixed(3)})`;
    this.pctEl.textContent = pct + '%';
    this.bar.setAttribute('aria-valuenow', String(pct));
  }

  /** Where the bar stands after the downloads, for the build phases to continue from. */
  get afterAssets() { return this.assetShare; }

  /**
   * The graphics choice. Shows the device's own pick under Auto, preselects the player's
   * last choice, and resolves when Start is pressed (it can be pressed while still loading).
   */
  chooseQuality(detected: QualityName): Promise<QualityChoice> {
    const seg = [...this.el.querySelectorAll<HTMLButtonElement>('.seg [role="radio"]')];
    const last = stored('quality-choice') as QualityChoice | null;
    let choice: QualityChoice = last && CHOICES.includes(last) ? last : 'auto';
    document.getElementById('auto-note')!.textContent = `Starts ${QUALITY_LABEL[detected]}`;
    const mark = () => { for (const b of seg) { const on = b.dataset.q === choice; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; } };
    mark();
    for (const b of seg) b.addEventListener('click', () => { choice = b.dataset.q as QualityChoice; mark(); });
    // Arrow keys move the choice, as in any radio group.
    this.el.querySelector('.seg')!.addEventListener('keydown', e => {
      const k = (e as KeyboardEvent).key;
      const step = k === 'ArrowRight' || k === 'ArrowDown' ? 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      choice = CHOICES[(CHOICES.indexOf(choice) + step + CHOICES.length) % CHOICES.length];
      mark();
      seg.find(b => b.dataset.q === choice)?.focus();
    });
    this.startBtn.disabled = false;
    this.startBtn.querySelector('span')!.textContent = 'Start';
    return new Promise(resolve => {
      this.startBtn.addEventListener('click', () => {
        this.startBtn.disabled = true;
        this.startBtn.querySelector('span')!.textContent = 'Starting…';
        for (const b of seg) b.disabled = true;
        this.el.classList.add('chosen');
        store('quality-choice', choice);
        resolve(choice);
      }, { once: true });
    });
  }

  /** Fades the screen out, then removes it. */
  finish() {
    this.set(1);
    this.el.classList.add('done');
    const remove = () => this.el.remove();
    // Only the screen's own fade: the bar's fill transition bubbles up here too.
    this.el.addEventListener('transitionend', e => { if (e.target === this.el) remove(); });
    setTimeout(remove, 600); // in case no transition runs (reduced motion, hidden tab)
  }

  fail(msg: string) {
    this.text(msg);
    this.el.classList.add('failed');
  }
}

/** The GPU's name from a throwaway WebGL context, before the real renderer is made. */
export function probeGpu(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return '';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return ''; }
}

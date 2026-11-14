// Graphics presets, a first guess at the right one for the device, and an adaptive
// controller that moves render resolution and preset to hold the frame rate.
export type QualityName = 'verylow' | 'low' | 'medium' | 'high';

export interface QualityPreset {
  name: QualityName;
  pixelRatioCap: number;
  /** Most pixels drawn per frame (millions): keeps 4K monitors and 3x phone screens affordable. */
  maxPixelsM: number;
  shadows: boolean;
  shadowMapSize: number;
  viewDistance: number;
  detailDistance: number;
  nearDistance: number;
  /** Far ground paint (roads, lots, pitches on the coarse terrain) is drawn out to here; it lies edge-on beyond. */
  groundDistance: number;
  pointLights: boolean;
  /** Bloom at night (the only time the HDR post chain runs; see grade.ts). */
  bloom: boolean;
  treeFullDistance: number;
}

export const PRESETS: Record<QualityName, QualityPreset> = {
  // Very low: for old phones and entry-level laptop graphics. Under a megapixel even at
  // 1080p (about 0.75x resolution), a short view, near detail only close by, no shadows.
  verylow: { name: 'verylow', pixelRatioCap: 0.75, maxPixelsM: 0.6, shadows: false, shadowMapSize: 0, viewDistance: 480, detailDistance: 170, nearDistance: 80, groundDistance: 280, pointLights: false, bloom: false, treeFullDistance: 28 },
  low: { name: 'low', pixelRatioCap: 1, maxPixelsM: 1.0, shadows: false, shadowMapSize: 0, viewDistance: 700, detailDistance: 260, nearDistance: 120, groundDistance: 420, pointLights: false, bloom: false, treeFullDistance: 45 },
  medium: { name: 'medium', pixelRatioCap: 1.25, maxPixelsM: 1.7, shadows: true, shadowMapSize: 1024, viewDistance: 1100, detailDistance: 420, nearDistance: 200, groundDistance: 600, pointLights: true, bloom: false, treeFullDistance: 70 },
  high: { name: 'high', pixelRatioCap: 2, maxPixelsM: 4.2, shadows: true, shadowMapSize: 2048, viewDistance: 1400, detailDistance: 480, nearDistance: 200, groundDistance: 750, pointLights: true, bloom: true, treeFullDistance: 95 },
};
export const ORDER: QualityName[] = ['verylow', 'low', 'medium', 'high'];
/** Names shown in the menus. */
export const QUALITY_LABEL: Record<QualityName, string> = { verylow: 'Very low', low: 'Low', medium: 'Medium', high: 'High' };

/** Render-resolution scale steps the adaptive controller moves through (1 = the preset's full resolution). */
export const SCALES = [0.6, 0.7, 0.8, 0.9, 1];

/** Device pixel ratio to render at for a preset, a resolution scale and a window size in CSS pixels. */
export function pixelRatioFor(p: QualityPreset, scale: number, cssW: number, cssH: number, dpr: number): number {
  const budget = Math.sqrt((p.maxPixelsM * 1e6) / Math.max(1, cssW * cssH));
  return Math.max(0.4, Math.min(dpr, p.pixelRatioCap, budget) * scale);
}

export interface DeviceInfo {
  /** WEBGL_debug_renderer_info string, or '' when the browser hides it. */
  gpu: string;
  touch: boolean;
  /** navigator.deviceMemory (GB) and hardwareConcurrency, when reported. */
  memoryGB?: number;
  cores?: number;
  /** Shorter side of the screen in CSS pixels. */
  minScreen: number;
}

/**
 * First guess at a preset from what the browser reports. It only decides where the
 * adaptive controller starts, so it errs toward a smooth first minute: phones and
 * software renderers start low, integrated graphics in the middle.
 */
export function detectPreset(d: DeviceInfo): QualityName {
  const gpu = d.gpu.toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return 'verylow';
  const phone = d.touch && d.minScreen < 820;
  if (phone) {
    // Budget phones (3 GB or less, 4 cores or fewer, older Mali/Adreno/PowerVR) start at Very low.
    if ((d.memoryGB ?? 4) <= 3 || (d.cores ?? 8) <= 4 || /mali-[gt]?[4-7]\d\b|adreno \(tm\) [3-5]\d\d|powervr/.test(gpu)) return 'verylow';
    return (d.memoryGB ?? 4) >= 6 && (d.cores ?? 4) >= 8 ? 'medium' : 'low';
  }
  if ((d.memoryGB ?? 8) <= 4 || (d.cores ?? 8) <= 2) return 'low';
  // Entry-level laptop graphics (Intel UHD/HD/Iris, GeForce MX) hold 60 fps on Low, not Medium;
  // Auto steps up from there when frames are comfortably inside budget.
  if (/intel.*(uhd|hd graphics|iris)|geforce (mx|gt) ?\d/.test(gpu)) return 'low';
  // Discrete cards and Apple silicon; everything else (Intel, AMD APUs, mobile GPUs on tablets) is treated as integrated.
  if (/(rtx|gtx|quadro|geforce|radeon (rx|pro)|rx \d{3,4}|arc\(tm\) a\d|apple m\d)/.test(gpu) && !/geforce (mx|gt) ?\d/.test(gpu)) return 'high';
  if (d.touch) return 'medium';
  return gpu ? 'medium' : 'high';
}

export interface FrameSample {
  /** Frames per second over the sample window. */
  fps: number;
  /** Main-thread time of a frame (simulation plus render submission), ms. */
  cpuMs: number;
  /** GPU time of a frame from timer queries, ms; undefined where the browser has none. */
  gpuMs?: number;
  /** Fastest recent frame interval (ms): shows the display's cap even while frames are being missed. */
  bestIntervalMs: number;
}

export interface QualityChange { preset?: QualityName; scale?: number }

/**
 * Holds the frame rate by trading resolution first, then the preset.
 *
 * The target is the display's own rate, capped at 60: a browser held to 30 Hz (a power
 * saver, an embedded view, a 30 Hz monitor) is not "slow", and chasing 60 there used to
 * strip the picture to Low for nothing. Where GPU timer queries exist the decision uses
 * measured work (CPU and GPU milliseconds against the frame budget), which also tells
 * which side is the bottleneck: resolution only helps a GPU-bound frame, so a CPU-bound
 * one steps the preset (fewer draw calls) instead. Elsewhere it falls back to frame rate.
 * Steps up are tried only after a long stable spell, and a step up that fails doubles
 * the wait before the next try.
 */
export class AdaptiveQuality {
  enabled = true;
  /** Index into SCALES. */
  scaleIndex = SCALES.length - 1;
  private lowFor = 0;
  private highFor = 0;
  private cooldown = 4;
  private upWait = 12;
  private sinceUp = Infinity;

  constructor(public current: QualityName) {}

  get scale() { return SCALES[this.scaleIndex]; }

  sample(s: FrameSample, dt: number): QualityChange | null {
    if (!this.enabled) return null;
    this.sinceUp += dt;
    this.cooldown -= dt;
    if (this.cooldown > 0) return null;
    const targetFps = Math.min(60, 1000 / Math.max(8, s.bestIntervalMs));
    const budget = 1000 / targetFps;
    const measured = s.gpuMs !== undefined;
    // Work as a share of the frame budget. CPU and GPU overlap, so the larger one sets the pace.
    const load = measured ? Math.max(s.cpuMs * 1.1, s.gpuMs! * 1.1) / budget : s.cpuMs / budget;
    const slow = s.fps < targetFps * 0.8 || (measured && load > 1.0);
    const easy = s.fps > targetFps * 0.95 && (measured ? load < 0.62 : s.cpuMs < budget * 0.45);
    if (slow) { this.lowFor += dt; this.highFor = 0; }
    else if (easy) { this.highFor += dt; this.lowFor = 0; }
    else { this.lowFor = this.highFor = 0; }

    const i = ORDER.indexOf(this.current);
    let change: QualityChange | null = null;
    if (this.lowFor > 2) {
      // A step up that could not be held: back off, and wait twice as long before trying again.
      if (this.sinceUp < 12) this.upWait = Math.min(240, this.upWait * 2);
      const gpuBound = measured ? s.gpuMs! > s.cpuMs : s.cpuMs < budget * 0.6;
      if (gpuBound && this.scaleIndex > 0) change = { scale: SCALES[--this.scaleIndex] };
      else if (i > 0) change = { preset: (this.current = ORDER[i - 1]) };
      else if (this.scaleIndex > 0) change = { scale: SCALES[--this.scaleIndex] };
    } else if (this.highFor > this.upWait) {
      if (this.scaleIndex < SCALES.length - 1) change = { scale: SCALES[++this.scaleIndex] };
      else if (i < ORDER.length - 1) change = { preset: (this.current = ORDER[i + 1]) };
      if (change) this.sinceUp = 0;
    }
    if (change) { this.lowFor = this.highFor = 0; this.cooldown = change.preset ? 5 : 2.5; }
    return change;
  }
}

/**
 * GPU time per frame from EXT_disjoint_timer_query_webgl2 (desktop Chrome and Edge;
 * absent on most phones, Safari and Firefox). One query at a time wraps a whole frame's
 * rendering; results arrive a few frames later and are smoothed.
 */
export class GpuTimer {
  /** Smoothed GPU milliseconds per frame, or undefined until a first result (or without the extension). */
  ms: number | undefined;
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private pending: WebGLQuery | null = null;
  private active = false;

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }

  begin() {
    if (!this.ext || this.pending) return;
    this.pending = this.gl.createQuery();
    if (!this.pending) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.pending);
    this.active = true;
  }

  end() {
    const gl = this.gl;
    if (!this.ext) return;
    if (this.active) { gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.active = false; return; }
    if (!this.pending || !gl.getQueryParameter(this.pending, gl.QUERY_RESULT_AVAILABLE)) return;
    if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
      const ms = gl.getQueryParameter(this.pending, gl.QUERY_RESULT) / 1e6;
      this.ms = this.ms === undefined ? ms : this.ms + (ms - this.ms) * 0.25;
    }
    gl.deleteQuery(this.pending);
    this.pending = null;
  }
}

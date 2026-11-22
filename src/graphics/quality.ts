// Graphics presets and an adaptive controller that steps quality down when
// the frame rate stays low (and back up when there is clear headroom).
export type QualityName = 'low' | 'medium';

export interface QualityPreset {
  name: QualityName;
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  viewDistance: number;
  detailDistance: number;
  nearDistance: number;
  pointLights: boolean;
  bloom: boolean;
  /** Half-width (m) of the baked sun-shadow area around the player. */
  shadowExtent: number;
  /** Full tree crowns and parked cars within this distance (see WorldStreamer). */
  treeFullDistance: number;
}

export const PRESETS: Record<QualityName, QualityPreset> = {
  low: { name: 'low', pixelRatioCap: 0.8, shadows: true, shadowMapSize: 2048, shadowExtent: 110, viewDistance: 700, detailDistance: 240, nearDistance: 120, pointLights: false, bloom: false, treeFullDistance: 45 },
  medium: { name: 'medium', pixelRatioCap: 1.25, shadows: true, shadowMapSize: 2048, shadowExtent: 130, viewDistance: 1000, detailDistance: 340, nearDistance: 180, pointLights: true, bloom: false, treeFullDistance: 70 },
};
export const ORDER: QualityName[] = ['low', 'medium'];

export class AdaptiveQuality {
  enabled = true;
  private lowFor = 0;
  private highFor = 0;
  private cooldown = 3;

  constructor(public current: QualityName, private targetFps = 60) {}

  /** Returns a new preset name when a change is warranted. */
  sample(fps: number, dt: number, cpuMs = 0): QualityName | null {
    if (!this.enabled) return null;
    this.cooldown -= dt;
    if (this.cooldown > 0) return null;
    const i = ORDER.indexOf(this.current);
    // A display or power mode that caps the browser at 30 Hz (iPhone Low Power Mode, battery
    // saver, some monitors) shows a steady ~30 fps with little work per frame. That is the
    // screen's limit, not the game struggling, so it must not count as slow.
    const capped = Math.abs(fps - 30) < 1.5 && cpuMs > 0 && cpuMs < 12;
    if (capped) { this.lowFor = this.highFor = 0; return null; }
    if (fps < this.targetFps * 0.75) { this.lowFor += dt; this.highFor = 0; }
    else if (fps > this.targetFps * 0.97) { this.highFor += dt; this.lowFor = 0; }
    else { this.lowFor = this.highFor = 0; }
    let next: QualityName | null = null;
    if (this.lowFor > 3 && i > 0) next = ORDER[i - 1];
    // Only try stepping up after a long stable period, to avoid oscillation.
    else if (this.highFor > 20 && i < ORDER.length - 1) next = ORDER[i + 1];
    if (next) { this.current = next; this.lowFor = this.highFor = 0; this.cooldown = 6; }
    return next;
  }
}

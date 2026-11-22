// Graphics presets and an adaptive controller that steps quality down when
// the frame rate stays low (and back up when there is clear headroom).
export type QualityName = 'low' | 'medium' | 'high';

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
  medium: { name: 'medium', pixelRatioCap: 1, shadows: true, shadowMapSize: 2048, shadowExtent: 130, viewDistance: 1000, detailDistance: 340, nearDistance: 180, pointLights: true, bloom: false, treeFullDistance: 70 },
  high: { name: 'high', pixelRatioCap: 1.25, shadows: true, shadowMapSize: 2048, shadowExtent: 160, viewDistance: 1300, detailDistance: 420, nearDistance: 200, pointLights: true, bloom: false, treeFullDistance: 95 },
};
export const ORDER: QualityName[] = ['low', 'medium', 'high'];

export class AdaptiveQuality {
  enabled = true;
  private lowFor = 0;
  private highFor = 0;
  private cooldown = 3;

  constructor(public current: QualityName, private targetFps = 60) {}

  /** Returns a new preset name when a change is warranted. */
  sample(fps: number, dt: number): QualityName | null {
    if (!this.enabled) return null;
    this.cooldown -= dt;
    if (this.cooldown > 0) return null;
    const i = ORDER.indexOf(this.current);
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

// One shared Web Audio graph with buses, so groups are balanced, ducked and set by the
// player together:
//
//   vehicle (motor whirr, tyres, brake squeal) ─> hold (menus) ─> duck ─┐
//   siren   (siren, horn)                                              ├─> master ─> limiter ─> out
//   sfx     (impacts, chimes, countdown, menu taps)                    ─┘
//
// Player volume sliders (0..1) drive the bus gains as slider² (an even loudness change
// along the slider's travel); ducking and the menu hold live on their own nodes so they
// never overwrite a player setting. The limiter on master is a safety net, not the mix.
export const dB = (db: number) => Math.pow(10, db / 20);

interface Graph { ctx: AudioContext; master: GainNode; sfx: GainNode; vehicle: GainNode; siren: GainNode; hold: GainNode; duck: GainNode }
let g: Graph | null = null;

export interface Volumes { master: number; cart: number; siren: number; sfx: number; muted: boolean }
const KEY = 'utd-ems-audio';
export const volumes: Volumes = (() => {
  const v: Volumes = { master: 0.8, cart: 0.7, siren: 0.75, sfx: 0.8, muted: false };
  try { Object.assign(v, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { /* storage unavailable */ }
  return v;
})();

/** Mix levels at full slider: the cart sits well under the siren and the feedback sounds. */
const BASE = { master: dB(-2), cart: dB(-4), siren: dB(0), sfx: dB(0) };

function apply() {
  if (!g) return;
  const t = g.ctx.currentTime, k = (x: number) => Math.max(0, Math.min(1, x)) ** 2;
  g.master.gain.setTargetAtTime(volumes.muted ? 0 : BASE.master * k(volumes.master), t, 0.04);
  g.vehicle.gain.setTargetAtTime(BASE.cart * k(volumes.cart), t, 0.04);
  g.siren.gain.setTargetAtTime(BASE.siren * k(volumes.siren), t, 0.04);
  g.sfx.gain.setTargetAtTime(BASE.sfx * k(volumes.sfx), t, 0.04);
}

/** Changes and saves the player's volume settings. */
export function setVolumes(v: Partial<Volumes>) {
  Object.assign(volumes, v);
  try { localStorage.setItem(KEY, JSON.stringify(volumes)); } catch { /* storage unavailable */ }
  apply();
}

export function audio(): Graph {
  if (g) return g;
  const ctx = new AudioContext();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 2; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.2;
  const master = ctx.createGain();
  master.connect(limiter).connect(ctx.destination);
  const sfx = ctx.createGain(); sfx.connect(master);
  const siren = ctx.createGain(); siren.connect(master);
  const duck = ctx.createGain(); duck.connect(master);
  const hold = ctx.createGain(); hold.connect(duck);
  const vehicle = ctx.createGain(); vehicle.connect(hold);
  g = { ctx, master, sfx, vehicle, siren, hold, duck };
  apply();
  return g;
}

/** Dips the vehicle bus about 6 dB while the siren or horn sounds; recovers over ~0.5 s. */
export function duckVehicle(active: boolean) {
  if (!g) return;
  g.duck.gain.setTargetAtTime(active ? dB(-6) : 1, g.ctx.currentTime, active ? 0.04 : 0.18);
}

/** Holds the vehicle sounds silent (menus) with a short fade so nothing clicks. */
export function muteVehicle(muted: boolean) {
  if (!g) return;
  g.hold.gain.setTargetAtTime(muted ? 0 : 1, g.ctx.currentTime, 0.08);
}

/** Browsers start audio suspended; the first key press or tap resumes it. */
export function unlockAudio() {
  const go = () => { void audio().ctx.resume(); };
  for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) addEventListener(ev, go, { once: true, capture: true });
}

/** True once audio can play (after the first gesture). */
export const audioReady = () => !!g && g.ctx.state === 'running';

let noise: AudioBuffer | null = null;
/** Two seconds of white noise, shared by every noise source. */
export function noiseBuffer(ctx: AudioContext) {
  if (noise) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

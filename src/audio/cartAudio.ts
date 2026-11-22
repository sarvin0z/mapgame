// Electric golf cart sound (Web Audio, no assets), kept light under everything else.
//  Motor: a small DC drive motor and its reduction gear make a soft whirr that rises
//  with road speed: a triangle fundamental (about 45 Hz at a crawl to 260 Hz at top
//  speed) plus a quiet gear whine near 3x, low-passed. It leans in a little under
//  throttle and falls silent when the cart stands still (no idle, as on a real cart).
//  Tyres: band-limited noise that grows with speed. Bumps and hits: short low thumps
//  with small random pitch and level offsets so repeats never sound identical.
import { audio, noiseBuffer, dB } from './mixer.ts';

export class CartAudio {
  private ready = false;
  private motor!: GainNode;
  private oscA!: OscillatorNode;
  private oscB!: OscillatorNode;
  private whineGain!: GainNode;
  private motorLp!: BiquadFilterNode;
  private tyre!: GainNode;
  private tyreBp!: BiquadFilterNode;
  private squeal!: GainNode;

  private init() {
    const { ctx, vehicle } = audio();
    if (ctx.state !== 'running') return false;
    this.motor = ctx.createGain(); this.motor.gain.value = 0;
    this.motorLp = ctx.createBiquadFilter(); this.motorLp.type = 'lowpass'; this.motorLp.frequency.value = 900; this.motorLp.Q.value = 0.6;
    this.motor.connect(this.motorLp).connect(vehicle);
    this.oscA = ctx.createOscillator(); this.oscA.type = 'triangle'; this.oscA.frequency.value = 45;
    this.oscB = ctx.createOscillator(); this.oscB.type = 'sine'; this.oscB.frequency.value = 135;
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0.25;
    this.oscA.connect(this.motor);
    this.oscB.connect(this.whineGain).connect(this.motor);
    // A slow wobble in the whine, as the gear mesh is never perfectly even.
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 5.3; lg.gain.value = 1.6;
    lfo.connect(lg).connect(this.oscB.frequency);
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx); n.loop = true;
    this.tyreBp = ctx.createBiquadFilter(); this.tyreBp.type = 'bandpass'; this.tyreBp.frequency.value = 220; this.tyreBp.Q.value = 0.7;
    this.tyre = ctx.createGain(); this.tyre.gain.value = 0;
    n.connect(this.tyreBp).connect(this.tyre).connect(vehicle);
    // Brake squeal: a narrow band of the same noise, only under hard braking at speed.
    const sq = ctx.createBiquadFilter(); sq.type = 'bandpass'; sq.frequency.value = 2700; sq.Q.value = 9;
    this.squeal = ctx.createGain(); this.squeal.gain.value = 0;
    n.connect(sq).connect(this.squeal).connect(vehicle);
    this.oscA.start(); this.oscB.start(); lfo.start(); n.start();
    this.ready = true;
    return true;
  }

  /** `speed` in m/s (signed), `throttle` 0..1, `surface` 0 smooth road .. 1 rough (grass, dirt), `brake` 0..1. */
  update(speed: number, throttle: number, surface = 0, brake = 0) {
    if (!this.ready && !this.init()) return;
    const { ctx } = audio();
    const t = ctx.currentTime, v = Math.min(1, Math.abs(speed) / 8);
    const f = 45 + v * 215;
    this.oscA.frequency.setTargetAtTime(f, t, 0.06);
    this.oscB.frequency.setTargetAtTime(f * 3.02, t, 0.06);
    // Light: about -26 dB at full speed under throttle; silent when stopped.
    const load = Math.min(1, throttle);
    const level = v < 0.01 && load < 0.05 ? 0 : dB(-34) + (dB(-26) - dB(-34)) * Math.min(1, v * 0.75 + load * 0.35);
    this.motor.gain.setTargetAtTime(level, t, 0.09);
    this.whineGain.gain.setTargetAtTime(0.18 + load * 0.22, t, 0.12);
    this.motorLp.frequency.setTargetAtTime(700 + v * 900 + load * 300, t, 0.1);
    this.tyre.gain.setTargetAtTime(v < 0.01 ? 0 : dB(-40) * (0.4 + v) * (1 + surface * 1.5), t, 0.1);
    this.tyreBp.frequency.setTargetAtTime(160 + v * 260 + surface * 200, t, 0.1);
    const hard = brake > 0.5 && surface < 0.5 ? Math.max(0, Math.min(1, (Math.abs(speed) - 3) / 4)) : 0;
    this.squeal.gain.setTargetAtTime(dB(-30) * hard * brake, t, hard ? 0.05 : 0.08);
  }

  /** A low thump; `strength` 0..1 (0.25 a speed bump, 1 a hard collision). */
  thump(strength: number) {
    const { ctx, sfx } = audio();
    if (ctx.state !== 'running') return;
    const t = ctx.currentTime, s = Math.max(0.05, Math.min(1, strength));
    const vary = 1 + (Math.random() - 0.5) * 0.16;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(dB(-16) * s * (0.9 + Math.random() * 0.2), t + 0.006);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 + s * 0.25);
    out.connect(sfx);
    const body = ctx.createOscillator(); body.type = 'sine';
    body.frequency.setValueAtTime(95 * vary, t); body.frequency.exponentialRampToValueAtTime(48 * vary, t + 0.2);
    body.connect(out);
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380 + s * 900;
    const ng = ctx.createGain(); ng.gain.value = 0.35 + s * 0.5;
    n.connect(lp).connect(ng).connect(out);
    body.start(t); n.start(t, Math.random());
    body.stop(t + 0.5); n.stop(t + 0.5);
    setTimeout(() => out.disconnect(), 700);
  }

  /** A short relay click for switches (lights, headlights, gear change). */
  click(high = false) {
    const { ctx, sfx } = audio();
    if (ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = high ? 2400 : 1500;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(dB(-30), t); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(gn).connect(sfx);
    o.start(t); o.stop(t + 0.04);
  }
}

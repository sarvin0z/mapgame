// The game's audio mix (Web Audio, synthesized: no sound files).
//
// Every sound plays into one of four buses, never straight to the output:
//
//   vehicle   motor whine, tyre and road noise, wind in the open cab
//   ambience  the quiet outdoor air bed
//   sfx       impacts, suspension thuds, countdown beeps, the arrival chime
//   emergency siren and horn
//
// vehicle and ambience pass through a duck stage that dips 7 dB while the siren
// sounds, so the siren stays the loudest thing without the rest vanishing; the
// duck is its own gain node, so it never fights the player's volume setting.
// Everything then goes through the master gain (the Settings slider, squared so
// the audible change is spread over its whole travel) and a limiter that only
// catches peaks when several loud sounds coincide. Levels are set in decibels.
export const db = (d: number) => Math.pow(10, d / 20);

let shared: AudioContext | null = null;
export const audioContext = () => (shared ??= new AudioContext());

export type BusName = 'vehicle' | 'ambience' | 'sfx' | 'emergency';

export class AudioMix {
  readonly ctx = audioContext();
  readonly master = this.ctx.createGain();
  private duck = this.ctx.createGain();
  private buses: Record<BusName, GainNode>;
  private volume01 = 0.8;
  muted = false;

  constructor() {
    const c = this.ctx;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 2; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.25;
    this.master.connect(limiter).connect(c.destination);
    this.duck.connect(this.master);
    const bus = (level: number, to: AudioNode) => { const g = c.createGain(); g.gain.value = db(level); g.connect(to); return g; };
    this.buses = { vehicle: bus(-15, this.duck), ambience: bus(-14, this.duck), sfx: bus(-5, this.master), emergency: bus(-6, this.master) };
    this.setVolume(this.volume01);
    // Browsers start audio suspended until the player does something.
    const wake = () => { void c.resume(); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) addEventListener(ev, wake, { passive: true });
  }

  bus(name: BusName): AudioNode { return this.buses[name]; }

  /** Master volume from a 0..1 slider. */
  setVolume(slider01: number) {
    this.volume01 = Math.min(1, Math.max(0, slider01));
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume01 * this.volume01, this.ctx.currentTime, 0.03);
  }
  get volume() { return this.volume01; }

  setMuted(m: boolean) { this.muted = m; this.setVolume(this.volume01); }

  /** Dips the vehicle and ambience buses while the siren (or horn) sounds. */
  setDucked(on: boolean) {
    this.duck.gain.setTargetAtTime(on ? db(-7) : 1, this.ctx.currentTime, on ? 0.06 : 0.25);
  }
}

function noiseBuffer(c: AudioContext, seconds: number, brown = false) {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    d[i] = brown ? (last = (last + 0.02 * w) / 1.02) * 3.5 : w;
  }
  return buf;
}

/**
 * The cart itself. It is electric, so it is quiet: what a driver mostly hears is the tyres
 * on the pavement and the air in the open cab, with a soft, pure-toned motor and gear whine
 * underneath that follows road speed and lifts a little under load. There is no engine note
 * and nothing at all at a standstill.
 */
export class CartAudio {
  private motor: OscillatorNode[] = [];
  private motorGain: GainNode;
  private motorTone: BiquadFilterNode;
  private tyreGain: GainNode;
  private tyreTone: BiquadFilterNode;
  private windGain: GainNode;
  private load = 0;

  constructor(private mix: AudioMix) {
    const c = mix.ctx, out = mix.bus('vehicle');
    this.motorTone = c.createBiquadFilter(); this.motorTone.type = 'lowpass'; this.motorTone.frequency.value = 900; this.motorTone.Q.value = 0.7;
    this.motorGain = c.createGain(); this.motorGain.gain.value = 0;
    this.motorTone.connect(this.motorGain).connect(out);
    // Mostly sine and triangle: a sawtooth's harmonics are what made it sound like a combustion engine.
    for (const [type, level] of [['sawtooth', 0.06], ['triangle', 0.3], ['sine', 0.55]] as const) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = 40;
      const g = c.createGain(); g.gain.value = level;
      o.connect(g).connect(this.motorTone); o.start();
      this.motor.push(o);
    }
    const noise = c.createBufferSource(); noise.buffer = noiseBuffer(c, 2.5); noise.loop = true; noise.start();
    this.tyreTone = c.createBiquadFilter(); this.tyreTone.type = 'bandpass'; this.tyreTone.frequency.value = 400; this.tyreTone.Q.value = 0.6;
    this.tyreGain = c.createGain(); this.tyreGain.gain.value = 0;
    noise.connect(this.tyreTone).connect(this.tyreGain).connect(out);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5500;
    this.windGain = c.createGain(); this.windGain.gain.value = 0;
    noise.connect(hp).connect(lp).connect(this.windGain).connect(out);
    // Outdoor air: a very quiet low bed, so silence at a standstill is not digital silence.
    const air = c.createBufferSource(); air.buffer = noiseBuffer(c, 4, true); air.loop = true; air.start();
    const airLp = c.createBiquadFilter(); airLp.type = 'lowpass'; airLp.frequency.value = 500;
    air.connect(airLp).connect(mix.bus('ambience'));
  }

  /** `speed` m/s (signed), `throttle` 0..1, `grounded` false while the wheels are off the ground. */
  update(dt: number, speed: number, throttle: number, grounded = true) {
    const c = this.mix.ctx, t = c.currentTime, v = Math.abs(speed), f = Math.min(1, v / 10);
    this.load += (throttle - this.load) * (1 - Math.exp(-dt * 6));
    // Motor: about 55 Hz at a crawl to 430 Hz at the governed top speed; the gear whine sits an octave and a fifth above.
    const base = 55 + v * 37.5;
    this.motor[0].frequency.setTargetAtTime(base, t, 0.04);
    this.motor[1].frequency.setTargetAtTime(base * 3.01, t, 0.04);
    this.motor[2].frequency.setTargetAtTime(base * 0.5, t, 0.04);
    this.motorTone.frequency.setTargetAtTime(500 + v * 110 + this.load * 350, t, 0.05);
    const moving = v > 0.15 || this.load > 0.05 ? 1 : 0;
    this.motorGain.gain.setTargetAtTime(moving * (0.02 + 0.07 * this.load + 0.05 * f), t, 0.08);
    this.tyreTone.frequency.setTargetAtTime(320 + v * 70, t, 0.08);
    this.tyreGain.gain.setTargetAtTime(grounded ? 0.5 * Math.pow(f, 1.4) : 0, t, 0.08);
    this.windGain.gain.setTargetAtTime(0.22 * f * f, t, 0.15);
  }
}

/**
 * One-shot effects. Each play picks its pitch and level at random within a small range
 * (about a semitone, 2 dB), so a repeated sound never repeats exactly. Nodes are created
 * per play and stop themselves, so nothing accumulates.
 */
export class Sfx {
  private noise: AudioBuffer;
  constructor(private mix: AudioMix) { this.noise = noiseBuffer(mix.ctx, 0.6); }

  private vary() { return { pitch: Math.pow(2, (Math.random() * 2 - 1) / 12), level: db((Math.random() * 2 - 1) * 2) }; }

  private tone(freq: number, to: number, secs: number, level: number, type: OscillatorType = 'sine', delay = 0) {
    const c = this.mix.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to !== freq) o.frequency.exponentialRampToValueAtTime(to, t + secs);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + secs);
    o.connect(g).connect(this.mix.bus('sfx'));
    o.start(t); o.stop(t + secs + 0.02);
  }

  private burst(cutoff: number, secs: number, level: number) {
    const c = this.mix.ctx, t = c.currentTime;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    f.type = 'lowpass'; f.frequency.value = cutoff;
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + secs);
    s.connect(f).connect(g).connect(this.mix.bus('sfx'));
    s.start(t, Math.random() * 0.2); s.stop(t + secs + 0.02);
  }

  /** The cart hitting something solid; `strength` 0..1. */
  impact(strength: number) {
    const v = this.vary(), s = 0.35 + 0.65 * Math.min(1, Math.max(0, strength));
    this.tone(95 * v.pitch, 38, 0.24, 0.8 * s * v.level);
    this.burst(1400 * v.pitch, 0.2, 0.7 * s * v.level);
    this.burst(5200 * v.pitch, 0.05, 0.25 * s * v.level); // the rattle of the body and canopy
  }

  /** A speed bump, kerb or landing taken through the suspension. */
  thud(strength: number) {
    const v = this.vary(), s = 0.3 + 0.7 * Math.min(1, Math.max(0, strength));
    this.tone(120 * v.pitch, 55, 0.13, 0.5 * s * v.level);
    this.burst(600 * v.pitch, 0.07, 0.22 * s * v.level);
  }

  /** Countdown tick; `go` is the longer, higher start tone. */
  beep(go = false) { this.tone(go ? 988 : 659, go ? 988 : 659, go ? 0.3 : 0.1, 0.22, 'triangle'); }

  /** Arrival at the destination: two rising notes. */
  chime() { this.tone(784, 784, 0.5, 0.22, 'sine'); this.tone(1175, 1175, 0.7, 0.2, 'sine', 0.14); }
}

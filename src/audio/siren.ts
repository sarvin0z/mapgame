// Synthesized emergency audio (Web Audio, no assets).
//  Siren: a 100 W electronic siren through a horn speaker, after published
//  specs (Federal Signal / Code 3 / Whelen manuals, California CCR Title 13
//  §1028): wail 675-1700 Hz at about 12 sweeps a minute (5 s each, slow rise,
//  quicker fall), yelp over the same range at about 180 a minute (0.33 s each).
//  It runs the common "auto" program: three wails, then yelp for 6 s. The tone
//  is a square wave, heavily driven into the speaker (clipping) and shaped by
//  the horn's band-pass, with a short slap-back echo off nearby buildings.
//  Horn: a momentary car horn press, about a second: the usual pair of
//  disc horns (about 420 and 510 Hz) as buzzy, clipped tones.
import { audioContext as ctx } from './mix.ts';

/** Where the siren and horn play: the mix's emergency bus (see mix.ts), set once at start-up. */
let output: AudioNode | null = null;
export function setEmergencyOutput(node: AudioNode) { output = node; }

function speakerChain(c: AudioContext, gain: number, drive = 4) {
  const shaper = c.createWaveShaper();
  const n = 2048, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(drive * x) / Math.tanh(drive); }
  shaper.curve = curve;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 450; hp.Q.value = 0.8;
  const peak = c.createBiquadFilter(); peak.type = 'peaking'; peak.frequency.value = 1400; peak.gain.value = 7; peak.Q.value = 0.9;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800; lp.Q.value = 0.5;
  const out = c.createGain(); out.gain.value = gain;
  shaper.connect(hp).connect(peak).connect(lp).connect(out).connect(output ?? c.destination);
  // Slap-back echo off nearby walls.
  const echo = c.createDelay(0.5); echo.delayTime.value = 0.11;
  const eg = c.createGain(); eg.gain.value = 0.22;
  const ef = c.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 2200;
  lp.connect(echo).connect(ef).connect(eg).connect(out);
  return { input: shaper, out };
}

export class Siren {
  private nodes: AudioNode[] = [];
  private osc?: OscillatorNode;
  private out?: GainNode;
  private timer = 0;
  on = false;

  toggle() { if (this.on) this.stop(); else this.start(); }

  private start() {
    const c = ctx();
    void c.resume();
    const chain = speakerChain(c, 0.0);
    this.out = chain.out;
    chain.out.gain.linearRampToValueAtTime(0.13, c.currentTime + 0.3);
    const a = c.createOscillator();
    a.type = 'square';
    a.connect(chain.input);
    const LO = 675, HI = 1700;
    // One program cycle: three wails (5 s: 3.2 s rise, 1.8 s fall), then 6 s of yelp (0.33 s sweeps).
    const sched = (t0: number) => {
      let t = t0;
      for (let k = 0; k < 3; k++) {
        a.frequency.setValueAtTime(LO, t);
        a.frequency.linearRampToValueAtTime(HI, t + 3.2);
        a.frequency.exponentialRampToValueAtTime(LO, t + 5);
        t += 5;
      }
      for (let k = 0; k < 18; k++) {
        a.frequency.setValueAtTime(LO, t);
        a.frequency.linearRampToValueAtTime(HI, t + 0.2);
        a.frequency.linearRampToValueAtTime(LO, t + 0.333);
        t += 0.333;
      }
      return t;
    };
    let next = sched(c.currentTime + 0.02);
    this.timer = window.setInterval(() => { if (next < c.currentTime + 6) next = sched(next); }, 2000);
    a.start();
    this.osc = a;
    this.nodes = [a];
    this.on = true;
  }

  private stop() {
    const c = ctx();
    window.clearInterval(this.timer);
    this.out?.gain.cancelScheduledValues(c.currentTime);
    this.out?.gain.setTargetAtTime(0, c.currentTime, 0.08);
    const nodes = this.nodes;
    setTimeout(() => nodes.forEach(n => { try { (n as OscillatorNode).stop?.(); } catch { /* already stopped */ } n.disconnect(); }), 400);
    this.on = false;
  }
}

export class Horn {
  on = false;
  private until = 0;

  /** A click gives one ~1 s press; clicking again while it sounds restarts it. */
  toggle() { this.press(); }

  press(seconds = 1.0) {
    const c = ctx();
    void c.resume();
    const t = c.currentTime;
    const chain = speakerChain(c, 0, 6);
    chain.out.gain.setValueAtTime(0, t);
    chain.out.gain.linearRampToValueAtTime(0.16, t + 0.02);
    chain.out.gain.setValueAtTime(0.16, t + seconds - 0.05);
    chain.out.gain.linearRampToValueAtTime(0, t + seconds);
    const oscs = [418, 512].map(f => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      // A slight flutter, as the horn diaphragm buzzes.
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 37; lg.gain.value = 3;
      lfo.connect(lg).connect(o.frequency);
      const g = c.createGain(); g.gain.value = 0.5;
      o.connect(g).connect(chain.input);
      o.start(t); lfo.start(t);
      o.stop(t + seconds + 0.05); lfo.stop(t + seconds + 0.05);
      return o;
    });
    void oscs;
    this.on = true;
    this.until = performance.now() + seconds * 1000;
    setTimeout(() => { if (performance.now() >= this.until - 5) this.on = false; }, seconds * 1000);
  }
}

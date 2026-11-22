// Feedback sounds (Web Audio, no assets), all on the sfx bus. Short and soft: they confirm
// what the HUD shows rather than compete with the siren. Each play varies pitch by about a
// third of a semitone and level by ±1 dB, so repeats never sound machine-identical.
import { audio, audioReady, dB } from './mixer.ts';

export type Cue = 'count' | 'go' | 'good' | 'bad' | 'stop' | 'done' | 'tap' | 'toggle';

const vary = () => 1 + (Math.random() - 0.5) * 0.04;
const lvl = (db: number) => dB(db + (Math.random() - 0.5) * 2);

/** One enveloped tone: `type` wave at `f` Hz from `t0` for `len` s, peak `gain`. */
function tone(f: number, t0: number, len: number, gain: number, type: OscillatorType = 'sine', attack = 0.008) {
  const { ctx, sfx } = audio();
  const o = ctx.createOscillator(), e = ctx.createGain();
  o.type = type; o.frequency.value = f;
  e.gain.setValueAtTime(0, t0);
  e.gain.linearRampToValueAtTime(gain, t0 + attack);
  e.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
  o.connect(e).connect(sfx);
  o.start(t0); o.stop(t0 + len + 0.02);
  o.onended = () => e.disconnect();
}

/** Plays a feedback cue (no-op until audio is unlocked by the first gesture). */
export function cue(kind: Cue) {
  if (!audioReady()) return;
  const t = audio().ctx.currentTime + 0.005, v = vary();
  switch (kind) {
    // Countdown: a short radio-style pip per second, then a brighter, longer "go".
    case 'count': tone(880 * v, t, 0.12, lvl(-20), 'triangle'); break;
    case 'go': tone(1320 * v, t, 0.32, lvl(-17), 'triangle'); tone(660 * v, t, 0.32, lvl(-26)); break;
    // Good traffic conduct: a quick rising third. Penalty: two low, buzzy pulses.
    case 'good': tone(988 * v, t, 0.14, lvl(-24)); tone(1245 * v, t + 0.08, 0.2, lvl(-24)); break;
    case 'bad': for (const k of [0, 0.13]) tone(185 * v, t + k, 0.11, lvl(-22), 'square', 0.004); break;
    // A stop of a multi-call reached: three rising notes.
    case 'stop': [784, 988, 1175].forEach((f, i) => tone(f * v, t + i * 0.09, 0.22, lvl(-22))); break;
    // Call complete: a fuller arpeggio that rings out.
    case 'done': [523, 659, 784, 1047].forEach((f, i) => { tone(f * v, t + i * 0.1, 0.9, lvl(-21)); tone(f * 2 * v, t + i * 0.1, 0.5, lvl(-33)); }); break;
    // Menu buttons: a soft, very short tick. Switches: a slightly higher one.
    case 'tap': tone(1600 * v, t, 0.035, lvl(-32), 'sine', 0.002); break;
    case 'toggle': tone(2100 * v, t, 0.04, lvl(-31), 'sine', 0.002); break;
  }
}

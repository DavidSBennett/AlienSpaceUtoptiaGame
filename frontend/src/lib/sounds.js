/**
 * src/lib/sounds.js
 *
 * Synthesized sound effects via the Web Audio API. No assets are
 * hosted — every sound is generated procedurally from oscillator
 * + gain envelopes. This keeps the deploy lean (no audio files to
 * load) and gives us full control over feel.
 *
 * Each public function plays one sound at the current master volume.
 * Calls fail silently if the browser blocks audio (autoplay policy,
 * no user gesture yet, etc.) — sound is enhancement, not core.
 *
 * Usage:
 *   import { playPublishChime, playRejectThud, playYearTick } from '../lib/sounds.js';
 *   playPublishChime();
 *
 * The AudioContext is lazily initialized on first call so it's
 * created in response to a user gesture (clicks, keypresses) and
 * autoplay policies don't bite us.
 */

let _ctx = null;
let _masterGain = null;
let _muted = false;

function ctx() {
  if (_ctx) return _ctx;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    _ctx = new Ctor();
    _masterGain = _ctx.createGain();
    _masterGain.gain.value = 0.18;  // conservative — sound is ambient, not central
    _masterGain.connect(_ctx.destination);
  } catch {
    _ctx = null;
  }
  return _ctx;
}

/**
 * User-level mute. Persisted via localStorage so it survives reloads.
 * Default is unmuted; player can toggle from the game header (Sound
 * button to be added there).
 */
const MUTE_KEY = 'historians.soundMuted';
try { _muted = localStorage.getItem(MUTE_KEY) === '1'; } catch {}

export function isMuted() { return _muted; }
export function setMuted(v) {
  _muted = !!v;
  try { localStorage.setItem(MUTE_KEY, _muted ? '1' : '0'); } catch {}
}
export function toggleMuted() { setMuted(!_muted); return _muted; }

// Generic helper — plays a tone with attack/decay envelope at a
// specific frequency for a specific duration. The envelope avoids
// the audible "click" you get from raw oscillator on/off.
function tone({ freq, dur = 0.2, type = 'sine', volume = 1, when = 0, frequencyEnd = null }) {
  if (_muted) return;
  const c = ctx();
  if (!c) return;
  const start = c.currentTime + when;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (frequencyEnd != null) {
    osc.frequency.linearRampToValueAtTime(frequencyEnd, start + dur);
  }
  // Attack/decay envelope
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
  osc.connect(gain).connect(_masterGain);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}


// ─── Public sound effects ──────────────────────────────────────────

/**
 * playPublishChime — a publication landed (approved + posted to
 * everyone's bookshelf). Two-note rising chime, warm sine tones.
 */
export function playPublishChime() {
  tone({ freq: 659.25, dur: 0.25, type: 'sine', volume: 0.6 });            // E5
  tone({ freq: 987.77, dur: 0.35, type: 'sine', volume: 0.5, when: 0.12 }); // B5
}

/**
 * playRejectThud — a publication was rejected (peer review or auto).
 * Low square-wave thud, brief.
 */
export function playRejectThud() {
  tone({
    freq: 180, frequencyEnd: 80,
    dur: 0.32, type: 'square', volume: 0.4,
  });
}

/**
 * playYearTick — a year resolved, time advances. Short bright triangle
 * tick reminiscent of a clock tick.
 */
export function playYearTick() {
  tone({ freq: 1318.51, dur: 0.08, type: 'triangle', volume: 0.45 });  // E6
}

/**
 * playCommitChirp — someone committed their action for the year.
 * Brief mid-range sine ping.
 */
export function playCommitChirp() {
  tone({ freq: 740, dur: 0.09, type: 'sine', volume: 0.35 });
}

/**
 * playJoinChime — a player joined the lobby. Two-note ascending,
 * softer than publish chime.
 */
export function playJoinChime() {
  tone({ freq: 523.25, dur: 0.18, type: 'sine', volume: 0.4 });            // C5
  tone({ freq: 783.99, dur: 0.22, type: 'sine', volume: 0.35, when: 0.08 }); // G5
}

/**
 * playGameEndFanfare — game ended. Three-note rising arpeggio, warm.
 */
export function playGameEndFanfare() {
  tone({ freq: 523.25, dur: 0.18, type: 'sine', volume: 0.5 });             // C5
  tone({ freq: 659.25, dur: 0.18, type: 'sine', volume: 0.5, when: 0.13 }); // E5
  tone({ freq: 783.99, dur: 0.45, type: 'sine', volume: 0.55, when: 0.26 }); // G5
}

/**
 * playChatPing — incoming chat message. Soft high blip.
 */
export function playChatPing() {
  tone({ freq: 1108.73, dur: 0.06, type: 'sine', volume: 0.3 });  // C#6
}

/**
 * playObjectionWon / playObjectionLost — overturned a rejection or
 * burned a token. Distinct tone profiles so the player knows the
 * outcome by ear.
 */
export function playObjectionWon() {
  tone({ freq: 392, frequencyEnd: 784, dur: 0.4, type: 'sawtooth', volume: 0.35 });
}
export function playObjectionLost() {
  tone({ freq: 196, frequencyEnd: 110, dur: 0.4, type: 'sawtooth', volume: 0.4 });
}

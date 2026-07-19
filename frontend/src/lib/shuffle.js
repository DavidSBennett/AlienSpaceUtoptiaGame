import { nextRandom } from './seededRng.js';

/**
 * Fisher-Yates shuffle — pure, returns a new array.
 *
 * Uses Math.random for now (good enough for shuffling a card deck). If we
 * ever need deterministic/replayable shuffles for testing, we can swap
 * this for a seeded PRNG.
 *
 * @param {Array} arr
 * @returns {Array}  a new shuffled array; original is untouched
 */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Seeded Fisher-Yates for reproducible games (seed mode). Threads a mulberry32
 * generator state so the same seed always yields the same order.
 *
 * @param {Array} arr
 * @param {number} rngState  uint32 generator state
 * @returns {[Array, number]}  [shuffled copy, next generator state]
 */
export function shuffleWith(arr, rngState) {
  const a = [...arr];
  let s = rngState;
  for (let i = a.length - 1; i > 0; i--) {
    let value;
    [value, s] = nextRandom(s);
    const j = Math.floor(value * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return [a, s];
}

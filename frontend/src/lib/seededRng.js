/**
 * Tiny seeded PRNG for reproducible games (seed mode only).
 *
 * The generator is a stateful mulberry32: given a uint32 state it returns the
 * next float in [0, 1) AND the next state, so callers can thread the state
 * through a reducer without any hidden globals. A text seed is folded into a
 * uint32 with an xmur3 hash so admins can type words or numbers.
 *
 * Determinism guarantee: same seed → same sequence, in any browser, forever.
 */

/** Fold an arbitrary seed string/number into a uint32. */
export function hashSeed(seed) {
  const str = String(seed);
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Advance the generator once.
 * @param {number} state  uint32 generator state
 * @returns {[number, number]}  [value in [0,1), nextState]
 */
export function nextRandom(state) {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, s];
}

/** Draw an integer in [0, n) from the generator. */
export function nextInt(state, n) {
  const [value, next] = nextRandom(state);
  return [Math.floor(value * n), next];
}

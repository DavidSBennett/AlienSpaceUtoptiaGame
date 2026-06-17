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

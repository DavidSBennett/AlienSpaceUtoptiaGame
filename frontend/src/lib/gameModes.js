/**
 * Game-length modes for multiplayer.
 *
 * A multiplayer game can be Short, Medium, or Long. The mode only changes
 * how many rounds (years) the game runs; the career gate rounds (article by
 * year 3, book by year 6) stay fixed, so a Short game still reaches both.
 *
 * Keep this in sync with the backend:
 *   - mp_createGame.php       (mode → total_years on create)
 *   - mp_submitFinalScore.php (total_years → game_mode on the score)
 */

export const GAME_MODES = [
  { key: 'short',  label: 'Short',  rounds: 8,  blurb: 'A quick career' },
  { key: 'medium', label: 'Medium', rounds: 12, blurb: 'A fuller career' },
  { key: 'long',   label: 'Long',   rounds: 15, blurb: 'The full career' },
];

export const DEFAULT_MODE = 'long';

/** Rounds for a mode key. Falls back to the full 15. */
export function roundsForMode(key) {
  const m = GAME_MODES.find((x) => x.key === key);
  return m ? m.rounds : 15;
}

/** Mode key for a given round count (≤8→short, ≤12→medium, else long). */
export function modeForRounds(rounds) {
  const n = Number(rounds);
  const exact = GAME_MODES.find((x) => x.rounds === n);
  if (exact) return exact.key;
  if (n <= 8) return 'short';
  if (n <= 12) return 'medium';
  return 'long';
}

/** Human label for a mode key. */
export function labelForMode(key) {
  const m = GAME_MODES.find((x) => x.key === key);
  return m ? m.label : 'Long';
}

/** Human label for a round count, e.g. 10 → "Short". */
export function labelForRounds(rounds) {
  return labelForMode(modeForRounds(rounds));
}

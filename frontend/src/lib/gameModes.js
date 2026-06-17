/**
 * Game-length modes for multiplayer.
 *
 * A multiplayer game can be Short, Medium, or Long. The mode only changes
 * how many rounds (years) the game runs; the career gate rounds (comps at
 * year 5, tenure at year 12) stay fixed, so a Short game ends before the
 * tenure gate.
 *
 * Keep this in sync with the backend:
 *   - mp_createGame.php       (mode → total_years on create)
 *   - mp_submitFinalScore.php (total_years → game_mode on the score)
 */

export const GAME_MODES = [
  { key: 'short',  label: 'Short',  rounds: 10, blurb: 'A quick career' },
  { key: 'medium', label: 'Medium', rounds: 18, blurb: 'A fuller career' },
  { key: 'long',   label: 'Long',   rounds: 25, blurb: 'The full career' },
];

export const DEFAULT_MODE = 'long';

/** Rounds for a mode key. Falls back to the full 25. */
export function roundsForMode(key) {
  const m = GAME_MODES.find((x) => x.key === key);
  return m ? m.rounds : 25;
}

/** Mode key for a given round count (10→short, 18→medium, else long). */
export function modeForRounds(rounds) {
  const n = Number(rounds);
  const exact = GAME_MODES.find((x) => x.rounds === n);
  if (exact) return exact.key;
  if (n <= 10) return 'short';
  if (n <= 18) return 'medium';
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

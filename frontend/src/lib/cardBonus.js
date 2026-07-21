/**
 * cardBonus.js — reading a card's printed bonus, which may be a citation ladder.
 *
 * A conclusion card's `bonus` is a VARCHAR, so it holds either a single number
 * or a pipe-separated ladder keyed to how many works the manuscript cites:
 *
 *   "3"             → 3, whatever the citation count
 *   "3|6|10|15"     → 3 with none, 6 with one, 10 with two, 15 with three or more
 *
 * Hard gates rather than a multiplier, and printed on the card, so a table
 * playing this on cardboard counts its citations and reads the number off. No
 * arithmetic, and nothing to look up on the cited cards themselves.
 *
 * Same pipe convention as context_tags. Every existing deck stores a plain
 * number and keeps working untouched.
 */

/** Parse a bonus field into its ladder. Always at least one entry. */
export function bonusLadder(raw) {
  if (raw === null || raw === undefined) return [0];
  const parts = String(raw)
    .split('|')
    .map((p) => Number(String(p).trim()))
    .filter((n) => Number.isFinite(n));
  return parts.length > 0 ? parts : [0];
}

/**
 * The bonus a card is worth at a given citation count. Counts at or beyond the
 * ladder's length take the last rung, which is what makes the top tier "3+"
 * rather than a cliff.
 */
export function bonusAt(raw, citationCount = 0) {
  const ladder = bonusLadder(raw);
  const n = Math.max(0, Math.floor(Number(citationCount) || 0));
  return ladder[Math.min(n, ladder.length - 1)];
}

/** True when this card's value actually varies with citations. */
export function hasLadder(raw) {
  return bonusLadder(raw).length > 1;
}

/**
 * How the ladder reads on a card face / tooltip: "3 · 6 · 10 · 15", or just
 * "+3" for a flat bonus.
 */
export function formatBonus(raw) {
  const ladder = bonusLadder(raw);
  if (ladder.length === 1) return ladder[0] ? `+${ladder[0]}` : '';
  return ladder.join(' · ');
}

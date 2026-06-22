/**
 * Single source of truth for the regular upgrade cadence.
 *
 * Players receive one stat upgrade at the END of every third year (years 3,
 * 6, 9, …) — see the matching `% 3 === 0` checks in the solo reducer
 * (hooks/useGameState.js) and the multiplayer backend (mp_resolveYear.php).
 * Promotions grant additional bonus upgrades on top of this drip.
 *
 * This module powers the on-screen "next upgrade" counter shown in both
 * game modes. If you change the cadence, update it in all three places.
 */
export const UPGRADE_CADENCE_YEARS = 3;

/**
 * The year whose end grants the next regular upgrade, given the year the
 * player is currently in. Returns null when no further drip falls within
 * the game (i.e. the career ends before the next multiple of the cadence).
 *
 * @param {number} currentYear  the year in progress (1-based)
 * @param {number} totalYears   the career length (25 solo; 10/18/25 MP)
 * @returns {number|null}
 */
export function nextUpgradeYear(currentYear, totalYears) {
  const yr = Math.max(1, Number(currentYear) || 1);
  const next = Math.ceil(yr / UPGRADE_CADENCE_YEARS) * UPGRADE_CADENCE_YEARS;
  if (totalYears && next > Number(totalYears)) return null;
  return next;
}

/**
 * How many years remain until the next regular upgrade lands. 0 means the
 * grant fires at the end of the current year ("this year"). Returns null
 * when no further drip falls within the game.
 */
export function yearsUntilNextUpgrade(currentYear, totalYears) {
  const next = nextUpgradeYear(currentYear, totalYears);
  if (next === null) return null;
  return Math.max(0, next - (Number(currentYear) || 1));
}

/**
 * Short human label for the counter, e.g. "this year", "in 1 year",
 * "in 2 years", or null when there are no more upgrades.
 */
export function upgradeCountdownLabel(currentYear, totalYears) {
  const n = yearsUntilNextUpgrade(currentYear, totalYears);
  if (n === null) return null;
  if (n === 0) return 'this year';
  return `in ${n} year${n === 1 ? '' : 's'}`;
}

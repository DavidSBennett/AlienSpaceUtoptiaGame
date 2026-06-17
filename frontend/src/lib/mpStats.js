/**
 * Multiplayer stat values + helpers.
 *
 * The economy rework changed several curves for multiplayer only — single
 * player keeps its own values in useGameState.js STAT_TABLES. Keep these in
 * sync with the PHP mirrors in backend/mp_resolveYear.php.
 *
 * Upgradable stats: research (draw), hand limit, influence, workspaces,
 * reputation, renown.
 */

export const MP_STAT_TABLES = {
  // Research — cards drawn per Draw action ('capacity' = a full notebook)
  research:         [3, 5, 7, 'capacity'],
  // Hand limit (a.k.a. notebook capacity)
  notebookCapacity: [7, 9, 11, 15],
  // Influence — per-card bonus added to every real evidence card
  influence:        [0, 1, 2, 4],
  // Workspaces — concurrent project slots (L4 also makes publishing free)
  workspaces:       [1, 2, 3, 3],
  // Reputation — conference payoff: citations granted + fresh cards injected
  reputation:       [1, 2, 3, 6],
  // Renown — end-game multiplier on total citation tokens
  renown:           [1, 2, 3, 5],
};

// Fresh cards a conference injects into the pool, by reputation level.
export const MP_CONFERENCE_FRESH = [1, 2, 3, 4];

export const MP_BOOK_MIN = 6;     // >= this many real evidence → a "book"
export const MP_ARTICLE_MIN = 2;  // minimum evidence to publish an article

/** Hand limit for a notebook level (1-4). */
export function mpHandLimit(level) {
  return MP_STAT_TABLES.notebookCapacity[Math.max(0, Math.min(3, (level || 1) - 1))];
}

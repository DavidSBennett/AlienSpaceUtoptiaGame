/**
 * playerColors.js
 *
 * Centralized player-color lookup. The mapping is by seat_index (not
 * player_id) so the player in seat 0 is always "gold" regardless of name.
 *
 * Each color returns a set of Tailwind class strings ready to use:
 *   spine    — for book/manuscript spines
 *   spineText— text color that reads on the spine
 *   accent   — for highlight chips, name labels, and player avatars
 *   border   — for full panels framed in the player's color
 *
 * Color mapping (from our visual palette discussion):
 *   seat 0 — gold      (the player most prominent in their own view)
 *   seat 1 — verdigris (aged copper green)
 *   seat 2 — oxblood   (deep red)
 *   seat 3 — periwinkle (faded blue — newly defined)
 *   seat 4 — sage      (olive green — newly defined)
 *
 * Seats 3 and 4 use plain Tailwind utility colors since they're not in
 * the base palette. Adding them properly to tailwind.config.js is a
 * future polish.
 *
 * Note: "you" — your own seat — is always rendered in gold (seat 0
 * pretends to be your color). Other players keep their seat-based color.
 * Two players with the same color would be confusing, so we map you to
 * gold and shift other seats accordingly… actually no, simpler:
 * each player sees their OWN seat as gold and the OPPONENT seats use
 * their actual color. We use a helper that takes (yourSeat, theirSeat).
 */

const SEAT_COLORS = [
  // seat 0 — gold
  {
    name:      'gold',
    spineBg:   'bg-gold-600',
    spineText: 'text-gold-50',
    spineEdge: 'border-gold-300',
    accent:    'text-gold-400',
    accentBg:  'bg-gold-500/20',
    border:    'border-gold-500',
  },
  // seat 1 — verdigris
  {
    name:      'verdigris',
    spineBg:   'bg-verdigris-500',
    spineText: 'text-cream-50',
    spineEdge: 'border-verdigris-400',
    accent:    'text-verdigris-400',
    accentBg:  'bg-verdigris-500/20',
    border:    'border-verdigris-500',
  },
  // seat 2 — oxblood
  {
    name:      'oxblood',
    spineBg:   'bg-oxblood-500',
    spineText: 'text-cream-50',
    spineEdge: 'border-oxblood-300',
    accent:    'text-oxblood-300',
    accentBg:  'bg-oxblood-700/30',
    border:    'border-oxblood-500',
  },
  // seat 3 — periwinkle (using slate-blue Tailwind colors)
  {
    name:      'periwinkle',
    spineBg:   'bg-indigo-500',
    spineText: 'text-cream-50',
    spineEdge: 'border-indigo-300',
    accent:    'text-indigo-300',
    accentBg:  'bg-indigo-500/20',
    border:    'border-indigo-500',
  },
  // seat 4 — sage / olive
  {
    name:      'sage',
    spineBg:   'bg-lime-700',
    spineText: 'text-cream-50',
    spineEdge: 'border-lime-500',
    accent:    'text-lime-400',
    accentBg:  'bg-lime-700/30',
    border:    'border-lime-600',
  },
];

/**
 * Get color tokens for a player by their seat index (0..4). Returns an
 * object with class strings ready to use in className.
 *
 * @param {number} seatIndex
 * @returns {{ spineBg, spineText, spineEdge, accent, accentBg, border, name }}
 */
export function colorForSeat(seatIndex) {
  const idx = ((seatIndex % 5) + 5) % 5;
  return SEAT_COLORS[idx];
}

/**
 * Convenience: same as colorForSeat but accepts the player object
 * (with seat_index field).
 */
export function colorForPlayer(player) {
  return colorForSeat(player?.seat_index ?? 0);
}

/**
 * End-of-game awards. Each award is a pure function over the current
 * game state, returning a number for each player. The winner is the
 * player with the highest score; ties broken by earlier seat_index for
 * determinism.
 *
 * Awards are computed fully on the frontend from the data already in
 * `state.opponents` + `state.you` + `state.published_works`. No server
 * changes needed.
 *
 * NEW AWARDS GO HERE — keep the function signature
 * `score(player, context) → number` so the standings helpers below
 * keep working without modification.
 *
 * Each award has:
 *   id          — stable identifier (used as map keys)
 *   name        — display name shown in the goal line and results
 *   description — one-line summary of the criterion
 *   score(p, ctx) — returns a numeric score; higher = better
 *   format(n)   — display the raw score for the leaderboard column
 */

export const AWARDS = [
  {
    id: 'most-prestigious',
    name: 'Most Prestigious Career',
    description: 'Highest accumulated prestige.',
    score: (p) => Number(p.prestige ?? 0),
    format: (n) => `${n} prestige`,
  },
  {
    id: 'most-prolific',
    name: 'Most Prolific',
    description: 'Most books published.',
    score: (p) => Number(p.books_published ?? 0),
    format: (n) => `${n} book${n === 1 ? '' : 's'}`,
  },
  {
    id: 'peers-favorite',
    name: "Peer's Favorite",
    description: 'Most citation tokens collected — from being cited by others and from conferences.',
    score: (p) => Number(p.citations_received_count ?? 0),
    format: (n) => `${n} citation${n === 1 ? '' : 's'}`,
  },
  {
    id: 'broadest-scholar',
    name: 'Broadest Scholar',
    description: 'Published works covering the most distinct tags.',
    score: (p, ctx) => {
      const works = (ctx.publishedWorks || []).filter(
        (w) => w.writer_player_id === p.player_id
      );
      const tags = new Set();
      for (const work of works) {
        for (const card of work.evidence_snapshot || []) {
          for (const tag of card.tags || []) {
            if (tag) tags.add(tag);
          }
        }
      }
      return tags.size;
    },
    format: (n) => `${n} tag${n === 1 ? '' : 's'}`,
  },
  {
    id: 'earliest-tenure',
    name: 'Earliest Tenure',
    description: 'Earliest year of first book published. (Lower year wins.)',
    score: (p, ctx) => {
      // Find the player's earliest book publication. We invert the year
      // so HIGHER scores win (matches the other awards' direction).
      // A player with no book gets score -Infinity so they sort last.
      const myBooks = (ctx.publishedWorks || []).filter(
        (w) => w.writer_player_id === p.player_id && w.kind === 'book'
      );
      if (myBooks.length === 0) return -Infinity;
      const earliest = Math.min(...myBooks.map((b) => b.year_published));
      // Invert: year 6 → 19, year 12 → 13, year 25 → 0. The higher the
      // number the earlier the book.
      return 25 - earliest;
    },
    // Display the actual year, not the inverted score
    format: (n) => n === -Infinity ? '—' : `year ${25 - n}`,
  },
];


/**
 * Compute the full standings table for every award. Returns an object
 * { awardId: [ {playerId, playerName, score}, ... ] } sorted by score
 * descending (with seat_index as tiebreaker, lower seat wins).
 *
 * `players` is an array of player objects shaped like state.you and
 * state.opponents entries — must have player_id, player_name,
 * seat_index, and whatever fields the score functions consume.
 *
 * `ctx` provides additional shared data the score functions may need
 * (e.g. publishedWorks list). Currently { publishedWorks }.
 */
export function computeAwardStandings(players, ctx) {
  const standings = {};
  for (const award of AWARDS) {
    const scored = players.map((p) => ({
      playerId: p.player_id,
      playerName: p.player_name,
      seatIndex: p.seat_index,
      score: award.score(p, ctx),
    }));
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.seatIndex - b.seatIndex;
    });
    standings[award.id] = scored;
  }
  return standings;
}


/**
 * For one player (typically "you"), return an array of award status
 * objects ranked by how close the player is to winning.
 *
 * "Close" means either:
 *   - the player is currently leading (gap = 0, isLeading = true)
 *   - the player has a small gap to the leader
 *
 * The returned array is sorted: leading awards first, then small-gap
 * awards, then large-gap. Awards where the player has a score of 0
 * AND isn't leading get sorted last — they're not really "close."
 */
export function awardsForPlayer(players, ctx, myPlayerId) {
  const standings = computeAwardStandings(players, ctx);
  const results = AWARDS.map((award) => {
    const ranked = standings[award.id];
    const myEntry = ranked.find((r) => r.playerId === myPlayerId);
    const leader = ranked[0];
    const myScore = myEntry?.score ?? 0;
    const leaderScore = leader?.score ?? 0;
    const isLeading = myEntry && myEntry.playerId === leader?.playerId;
    const gap = isLeading ? 0 : Math.max(0, leaderScore - myScore);
    return {
      award,
      myScore,
      leaderScore,
      isLeading,
      gap,
      leaderName: leader?.playerName ?? null,
    };
  });

  // Sort: leading first, then by gap ascending, then "no progress" last
  results.sort((a, b) => {
    if (a.isLeading && !b.isLeading) return -1;
    if (b.isLeading && !a.isLeading) return 1;
    // Both leading or both not — non-zero score beats zero score
    const aNonZero = a.myScore > 0 ? 1 : 0;
    const bNonZero = b.myScore > 0 ? 1 : 0;
    if (aNonZero !== bNonZero) return bNonZero - aNonZero;
    return a.gap - b.gap;
  });

  return results;
}

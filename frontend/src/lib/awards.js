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
 *   prestige    — prestige granted to the winner(s) at game end
 *   score(p, ctx) — returns a numeric score; higher = better
 *   format(n)   — display the raw score for the leaderboard column
 */

export const AWARDS = [
  // (No "Most Prestigious Career" award — highest prestige already wins the
  // game, so awarding it again just rewards the leader twice.)
  {
    id: 'francis-perkins',
    name: 'Francis Perkins Award',
    description: 'The single publication built on the most evidence.',
    prestige: 15,
    // A player's score is their BEST publication's evidence count — the
    // award celebrates one heavyweight work, not a body of work.
    score: (p, ctx) => {
      const works = (ctx.publishedWorks || []).filter(
        (w) => w.writer_player_id === p.player_id && w.kind !== 'conference'
      );
      if (works.length === 0) return 0;
      return Math.max(
        ...works.map((w) => Number(w.evidence_count ?? (w.evidence_snapshot?.length ?? 0)))
      );
    },
    format: (n) => `${n} evidence`,
  },
  {
    id: 'lifetime-achievement',
    // The id stays 'lifetime-achievement' — it's an internal map key, and
    // renaming it would buy nothing but a chance to miss a reference.
    name: 'Arnold J. Toynbee Award',
    description: 'The most publications — articles, books and conference papers.',
    prestige: 15,
    // Conference papers count toward a body of work. They live only in
    // published_works (mp_award_conference_paper never touches the
    // articles/books counters), so they have to be counted separately —
    // reading the counters alone silently omitted them.
    score: (p, ctx) => {
      const papers = (ctx.publishedWorks || []).filter(
        (w) => w.writer_player_id === p.player_id && w.kind === 'conference'
      ).length;
      return Number(p.articles_published ?? 0) + Number(p.books_published ?? 0) + papers;
    },
    format: (n) => `${n} publication${n === 1 ? '' : 's'}`,
  },
  {
    id: 'pulitzer',
    name: 'The Pulitzer Award',
    description: 'The most citations — but you must have published at least once.',
    prestige: 10,
    // Citations can come from conferences without ever publishing, so the
    // award requires at least one publication. No publication → can't win.
    score: (p) => {
      const pubs = Number(p.articles_published ?? 0) + Number(p.books_published ?? 0);
      if (pubs <= 0) return -Infinity;
      return Number(p.citations_received_count ?? 0);
    },
    format: (n) => (n === -Infinity ? '—' : `${n} citation${n === 1 ? '' : 's'}`),
  },
  {
    id: 'prodigy',
    name: 'Alice Loxton Award',
    description: 'First to publish a book.',
    prestige: 10,
    score: (p, ctx) => {
      // Earliest book wins. We invert the year so HIGHER scores win (matches
      // the other awards' direction). No book → -Infinity, sorts last.
      const myBooks = (ctx.publishedWorks || []).filter(
        (w) => w.writer_player_id === p.player_id && w.kind === 'book'
      );
      if (myBooks.length === 0) return -Infinity;
      const earliest = Math.min(...myBooks.map((b) => b.year_published));
      // Invert: year 6 → 19, year 12 → 13, year 25 → 0. Higher = earlier.
      return 25 - earliest;
    },
    // Display the actual year, not the inverted score
    format: (n) => (n === -Infinity ? '—' : `year ${25 - n}`),
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
 * Total award prestige each player earned, with a per-award breakdown.
 * A player wins an award (and its prestige) when they hold the top score;
 * everyone TIED at that top score is a co-winner and each gets the full
 * amount. Awards nobody qualified for (top score 0 or -Infinity) pay out
 * nothing.
 *
 * Returns { [playerId]: { total, breakdown: [{ id, name, amount }] } }.
 */
export function awardPrestigeByPlayer(players, ctx) {
  const standings = computeAwardStandings(players, ctx);
  const out = {};
  for (const p of players) {
    out[p.player_id] = { total: 0, breakdown: [] };
  }
  for (const award of AWARDS) {
    const ranked = standings[award.id];
    if (!ranked || ranked.length === 0) continue;
    const leader = ranked[0];
    const noWinner = leader.score <= 0 || leader.score === -Infinity;
    if (noWinner) continue;
    const amount = Number(award.prestige ?? 0);
    if (amount <= 0) continue;
    // ranked is sorted descending, so the tied top group is contiguous.
    for (const r of ranked) {
      if (r.score !== leader.score) break;
      const entry = out[r.playerId];
      if (entry) {
        entry.total += amount;
        entry.breakdown.push({ id: award.id, name: award.name, amount });
      }
    }
  }
  return out;
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

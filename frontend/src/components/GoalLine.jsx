/**
 * GoalLine — the middle line of the new 3-line header strip.
 *
 * Displays the player's current objective: what they need to do to
 * survive the next gate or reach the next rank. Text wraps if it
 * doesn't fit the row width.
 *
 * For top-rank players (Endowed Professor) AND the unknown-stage
 * fallback, the goal switches to showing which end-of-game awards
 * the player is closest to winning — gives them something to play
 * toward when promotions run out.
 */
import { awardsForPlayer } from '../lib/awards.js';

export default function GoalLine({ state, year, stage, articlesPublished, booksPublished, totalYears = 25, className }) {
  const goal = computeGoal({ state, year, stage, articlesPublished, booksPublished, totalYears });

  return (
    <div className={className ?? 'font-serif italic text-cream-200/90 text-xs text-center px-6 leading-snug'}>
      <span className="font-mono not-italic uppercase tracking-widest text-gold-400 text-[10px] mr-2">Goal:</span>
      {goal}
    </div>
  );
}

function computeGoal({ state, year, stage, articlesPublished, booksPublished }) {
  // ──── Game-over states first ───────────────────────────────────────
  if (stage === 'failed-comps') {
    return <>No published article by year 3 — you never got a foot in the door. The game has ended for you.</>;
  }
  if (stage === 'tenure-denied') {
    return <>No book by year 6 meant no permanent post. The game has ended for you.</>;
  }
  if (stage === 'retired' || stage === 'conceded') {
    return <>Your career as a historian has ended.</>;
  }

  const published = articlesPublished + booksPublished;

  // ──── Deadline #1: an article by year 3 (to get hired) ─────────────
  if (published === 0) {
    const yearsLeft = Math.max(0, 3 - year + 1);
    return (
      <>
        Publish <strong className="not-italic text-cream-50">one article</strong> by year 3
        {' '}({yearsLeft} year{yearsLeft === 1 ? '' : 's'} left) to get hired
        {" — otherwise you leave academia and the game ends."}
      </>
    );
  }

  // ──── Deadline #2: a book by year 6 (a tenure-track post) ──────────
  if (booksPublished === 0) {
    const yearsLeft = Math.max(0, 6 - year + 1);
    return (
      <>
        Publish <strong className="not-italic text-cream-50">one book</strong> by year 6
        {' '}({yearsLeft} year{yearsLeft === 1 ? '' : 's'} left) for a tenure-track post
        {" — otherwise you leave academia and the game ends."}
      </>
    );
  }

  // ──── Promotions by book count (Assistant 1 · Associate 2 · Full 4 · Endowed 7) ──
  if (booksPublished < 2) {
    return <>Publish <strong className="not-italic text-cream-50">1 more book</strong> (total 2) to make Associate Professor.</>;
  }
  if (booksPublished < 4) {
    const need = 4 - booksPublished;
    return <>Publish <strong className="not-italic text-cream-50">{need} more book{need === 1 ? '' : 's'}</strong> (total 4) to make Full Professor.</>;
  }
  if (booksPublished < 7) {
    const need = 7 - booksPublished;
    return <>Publish <strong className="not-italic text-cream-50">{need} more book{need === 1 ? '' : 's'}</strong> (total 7) for an Endowed Chair.</>;
  }

  // ──── Top rank — pivot to end-of-game awards as the goal ───────────
  return awardsGoalText(state, 'You have reached the highest rank.');
}


/**
 * Build a goal line that lists 1–2 end-of-game awards the player is
 * closest to winning. Used by the Endowed Professor branch and the
 * unknown-stage fallback. `intro` is a short sentence prepended to the
 * award text so the phrasing reads naturally.
 */
function awardsGoalText(state, intro) {
  if (!state?.you) {
    return <>{intro}</>;
  }
  const players = [state.you, ...(state.opponents || [])];
  const ctx = { publishedWorks: state.published_works || [] };
  const ranked = awardsForPlayer(players, ctx, state.you.player_id);

  // Pick the top 2 awards. Skip awards where everyone scores zero
  // (e.g. nobody has published anything yet) since "you're tied for
  // last with 0 prestige" is not motivating.
  const top = ranked
    .filter((r) => r.leaderScore > 0 || r.isLeading)
    .slice(0, 2);

  if (top.length === 0) {
    return <>{intro} Publish, accumulate citations, and broaden your work to chase the end-of-game awards.</>;
  }

  return (
    <>
      {intro}{' '}
      {top.map((r, i) => (
        <span key={r.award.id}>
          {i > 0 ? ' · ' : ''}
          {r.isLeading ? (
            <>
              <strong className="not-italic text-gold-300">Leading</strong>{' '}
              <strong className="not-italic text-cream-50">{r.award.name}</strong>
              {' '}({r.award.format(r.myScore)})
            </>
          ) : (
            <>
              {r.gap} behind <strong className="not-italic text-cream-50">{r.award.name}</strong>
              {' '}({r.leaderName}: {r.award.format(r.leaderScore)})
            </>
          )}
        </span>
      ))}
    </>
  );
}

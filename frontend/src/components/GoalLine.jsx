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

export default function GoalLine({ state, year, stage, articlesPublished, booksPublished }) {
  const goal = computeGoal({ state, year, stage, articlesPublished, booksPublished });

  return (
    <div className="font-serif italic text-cream-200/90 text-xs text-center px-6 leading-snug">
      <span className="font-mono not-italic uppercase tracking-widest text-gold-400 text-[10px] mr-2">Goal:</span>
      {goal}
    </div>
  );
}

function computeGoal({ state, year, stage, articlesPublished, booksPublished }) {
  // ──── Game-over states first ───────────────────────────────────────
  // The server sets `stage` to a failure value when a hard gate is
  // missed or the player concedes. Show a clear end-of-game line in
  // those cases so the goal text doesn't pretend the game is ongoing.
  if (stage === 'failed-comps') {
    return <>You were kicked out of grad school. The game has ended for you.</>;
  }
  if (stage === 'denied-tenure') {
    return <>You were denied tenure. The game has ended for you.</>;
  }
  if (stage === 'retired' || stage === 'conceded') {
    return <>Your career as a historian has ended.</>;
  }

  // ──── Stage gate #1: publish an article by end of year 5 ───────────
  if (year <= 5 && articlesPublished === 0) {
    const yearsLeft = 5 - year + 1;
    return (
      <>
        Publish at least <strong className="not-italic text-cream-50">one article</strong> by year 5
        {' '}({yearsLeft} year{yearsLeft === 1 ? '' : 's'} left)
        {" — otherwise you'll be kicked out of grad school and the game ends."}
      </>
    );
  }

  // ──── Stage gate #2: publish a book by end of year 12 ──────────────
  if (year <= 12 && booksPublished === 0) {
    const yearsLeft = 12 - year + 1;
    return (
      <>
        Publish at least <strong className="not-italic text-cream-50">one book</strong> by year 12
        {' '}({yearsLeft} year{yearsLeft === 1 ? '' : 's'} left)
        {" — otherwise you'll be denied tenure and the game ends."}
      </>
    );
  }

  // ──── Assistant professor who already has a tenure book ────────────
  // Gate #2 is met. They survive until year 13 to be promoted to
  // Associate Professor automatically (book count carries them).
  if (stage === 'assistant-professor') {
    const yearsLeft = 13 - year;
    return (
      <>
        You have <strong className="not-italic text-cream-50">{booksPublished}</strong>{' '}
        book{booksPublished === 1 ? '' : 's'} published. Survive {yearsLeft} more year{yearsLeft === 1 ? '' : 's'}{' '}
        to tenure review at year 13 — promotion to{' '}
        <strong className="not-italic text-cream-50">Associate Professor</strong> awaits.
      </>
    );
  }

  // ──── Associate Professor → Full Professor (3 books total) ─────────
  if (stage === 'associate-professor') {
    const need = Math.max(0, 3 - booksPublished);
    if (need === 0) {
      // Edge case: 3+ books but still 'associate' (server hasn't
      // re-evaluated yet, or this is the moment between book #3
      // publishing and the rank advancing).
      return <>You've reached the criteria for Full Professor. Promotion pending.</>;
    }
    return (
      <>
        Publish {need} more book{need === 1 ? '' : 's'} (total: 3) to be promoted to{' '}
        <strong className="not-italic text-cream-50">Full Professor</strong>.
      </>
    );
  }

  // ──── Full Professor → Endowed Professor (5 books total) ───────────
  if (stage === 'full-professor') {
    const need = Math.max(0, 5 - booksPublished);
    if (need === 0) {
      return <>You've reached the criteria for Endowed Professor. Promotion pending.</>;
    }
    return (
      <>
        Publish {need} more book{need === 1 ? '' : 's'} (total: 5) to be promoted to{' '}
        <strong className="not-italic text-cream-50">Endowed Professor</strong>.
      </>
    );
  }

  // ──── Endowed Professor — top rank, pivot to awards as the goal ───
  if (stage === 'endowed-professor') {
    return awardsGoalText(state, 'You have reached the highest rank.');
  }

  // ──── Truly unknown stage — also show awards rather than a debug
  //      message, since the player still benefits from playing for
  //      end-of-game recognition. The stage name appears in dev console
  //      logging via the data-tutorial pass-through if needed for debug.
  return awardsGoalText(state, 'Aim for end-of-game recognition:');
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

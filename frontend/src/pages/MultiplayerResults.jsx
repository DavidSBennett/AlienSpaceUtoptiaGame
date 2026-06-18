import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useMultiplayerGame } from '../hooks/useMultiplayerGame.js';
import { mpSubmitFinalScore } from '../api/multiplayer.js';
import { loadSession, clearSession } from '../api/mpSession.js';
import FleuronDivider from '../components/FleuronDivider.jsx';
import CornerOrnament from '../components/CornerOrnament.jsx';
import { AWARDS, computeAwardStandings, awardPrestigeByPlayer } from '../lib/awards.js';
import { buildMultiplayerReport, openPlaytestReport } from '../lib/playtestReport.js';
import { labelForRounds } from '../lib/gameModes.js';

/**
 * MultiplayerResults — final scores page shown when game.status='ended'.
 * Submits final scores to the leaderboard on first mount (idempotent
 * server-side), then renders the final rankings in Victorian frame style.
 */
export default function MultiplayerResults() {
  const { gameId } = useParams();
  const session = loadSession(gameId);
  const playerToken = session?.player_token;

  const { state, error: pollError, isLoading } = useMultiplayerGame(playerToken, {
    intervalMs: 30000,
    enabled: !!playerToken,
  });

  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (!playerToken) return;
    if (submitted) return;
    if (state?.game?.status !== 'ended') return;
    mpSubmitFinalScore({ player_token: playerToken })
      .then(() => setSubmitted(true))
      .catch((e) => setSubmitError(e.message));
  }, [playerToken, state?.game?.status, submitted]);

  if (!playerToken) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 py-12">
        <div className="text-center">
          <p className="font-serif italic text-cream-200/70 mb-4">No session found for this game.</p>
          <Link to="/" className="btn-primary inline-block">Return to Lobby</Link>
        </div>
      </main>
    );
  }
  if (isLoading) {
    return <main className="min-h-screen flex items-center justify-center"><p className="font-serif italic text-cream-200/70">Loading…</p></main>;
  }
  if (pollError) {
    return <main className="min-h-screen flex items-center justify-center"><p className="font-serif italic text-oxblood-300">Lost connection: {pollError}</p></main>;
  }
  if (!state) return null;

  const roster = [state.you, ...state.opponents].filter(Boolean);
  // Award prestige is granted at game end on top of base prestige. Compute it
  // here (awards are a frontend concept) and rank by the combined total.
  const awardBonus = awardPrestigeByPlayer(roster, {
    publishedWorks: state.published_works || [],
  });
  const players = roster
    .map((p) => ({
      ...p,
      award_prestige: awardBonus[p.player_id]?.total ?? 0,
      total_prestige: Number(p.prestige ?? 0) + (awardBonus[p.player_id]?.total ?? 0),
    }))
    .sort((a, b) => b.total_prestige - a.total_prestige);

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="relative max-w-3xl w-full">
        <div className="relative border border-gold-500/40 px-10 py-10 surface-binding">
          <div className="absolute inset-2 border border-gold-500/20 pointer-events-none" />

          <div className="absolute top-3 left-3 text-gold-400 pointer-events-none">
            <CornerOrnament corner="tl" size={32} />
          </div>
          <div className="absolute top-3 right-3 text-gold-400 pointer-events-none">
            <CornerOrnament corner="tr" size={32} />
          </div>
          <div className="absolute bottom-3 left-3 text-gold-400 pointer-events-none">
            <CornerOrnament corner="bl" size={32} />
          </div>
          <div className="absolute bottom-3 right-3 text-gold-400 pointer-events-none">
            <CornerOrnament corner="br" size={32} />
          </div>

          <div className="text-center relative z-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-400 mb-3">
              Curtain Falls
            </p>
            <h1 className="font-display text-5xl text-cream-50">Final Standings</h1>
            {state.game?.total_years && (
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream-200/60 mt-2">
                {labelForRounds(state.game.total_years)} game · {state.game.total_years} rounds
              </p>
            )}
          </div>

          <FleuronDivider className="my-6" />

          <ol className="space-y-2">
            {players.map((p, i) => (
              <li
                key={p.player_id}
                className="surface-well p-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="font-display text-3xl text-gold-400 w-10 text-center">
                    {i + 1}
                  </div>
                  <div>
                    <div className="font-display text-xl text-cream-50">{p.player_name}</div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-cream-200/70 mt-1">
                      {p.articles_published} articles · {p.books_published} books
                      {p.citations_received_count > 0 && (
                        <> · cited {p.citations_received_count}× (renown L{p.stat_levels?.renown ?? 1})</>
                      )}
                      {' · '}{labelForStage(p.stage, p.game_over_reason)}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-3xl text-cream-50">{p.total_prestige}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-cream-200/70">
                    {p.award_prestige > 0
                      ? <>{p.prestige} prestige + {p.award_prestige} awards</>
                      : 'prestige'}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {/* ── End-of-game awards table — one line per award ────────
                Computed purely on the frontend from existing state.
                Winners are shown with their score; ties resolved by
                lower seat_index. */}
          <AwardsSection players={players} publishedWorks={state.published_works || []} />

          {submitError && (
            <div className="mt-4 p-3 bg-oxblood-700/40 border border-oxblood-500 text-oxblood-300 font-serif text-sm">
              Could not save scores: {submitError}
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3 justify-between items-center">
            <div className="flex flex-wrap gap-3 items-center">
              <Link to="/leaderboard" className="btn-ghost">View Hall of Scholars →</Link>
              <button
                type="button"
                onClick={() => openPlaytestReport(buildMultiplayerReport({ state, awards: AWARDS, computeStandings: computeAwardStandings }))}
                className="btn-ghost"
                title="Open a print-ready playtest report (save as PDF) with copyable JSON/CSV"
              >
                ⎙ Playtest Report
              </button>
            </div>
            <Link
              to="/"
              onClick={() => clearSession(gameId)}
              className="btn-primary inline-block"
            >
              Return to Lobby
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

function labelForStage(stage, gameOver) {
  if (gameOver === 'failed-comps')  return 'Failed comps';
  if (gameOver === 'tenure-denied') return 'Tenure denied';
  if (gameOver === 'conceded')      return 'Conceded';
  switch (stage) {
    case 'graduate-student':    return 'Grad student';
    case 'abd':                 return 'ABD';
    case 'assistant-professor': return 'Assistant professor';
    case 'associate-professor': return 'Associate professor';
    case 'full-professor':      return 'Full professor';
    case 'endowed-professor':   return 'Endowed professor';
    case 'retired':             return 'Retired';
    default: return stage;
  }
}


/**
 * AwardsSection — final tally of end-of-game awards. One row per award
 * showing the winner (or co-winners on ties) and their score. Other
 * players' scores are shown smaller below in parentheses so each player
 * sees where they ranked.
 *
 * Empty awards (everyone scored zero, e.g. nobody got any citations)
 * still display so the player sees the award existed and was contested.
 */
function AwardsSection({ players, publishedWorks }) {
  const ctx = { publishedWorks };
  const standings = computeAwardStandings(players, ctx);

  return (
    <section className="mt-8">
      <h2 className="font-display text-2xl text-cream-50 mb-3 text-center">
        Awards
      </h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {AWARDS.map((award) => {
          const ranked = standings[award.id];
          if (!ranked || ranked.length === 0) return null;
          const leader = ranked[0];
          const noWinner = leader.score <= 0 || leader.score === -Infinity;
          // Everyone tied at the top score shares the award.
          const winners = noWinner ? [] : ranked.filter((r) => r.score === leader.score);
          const runnersUp = ranked.filter((r) => r.score < leader.score && r.score > 0);

          return (
            <li key={award.id} className="surface-well p-4 flex flex-col h-full">
              {/* Name + prestige value */}
              <div className="flex items-start gap-2">
                <span className="text-xl leading-tight" aria-hidden="true">🏆</span>
                <h3 className="font-display text-lg text-gold-300 leading-tight">{award.name}</h3>
                {award.prestige > 0 && (
                  <span className="ml-auto flex-shrink-0 font-mono text-[10px] uppercase tracking-wider text-gold-300 border border-gold-500/40 rounded px-1.5 py-0.5">
                    +{award.prestige} pts
                  </span>
                )}
              </div>

              {/* Condition — what it takes to win */}
              <p className="font-serif text-cream-200/80 text-sm mt-1 break-words">
                <span className="font-mono not-italic uppercase tracking-wider text-gold-400 text-[10px] mr-1.5">
                  How to win
                </span>
                {award.description}
              </p>

              {/* Winner(s) */}
              <div className="mt-auto pt-2 border-t border-gold-500/20">
                {noWinner ? (
                  <span className="font-serif italic text-cream-200/60 text-sm">
                    Not awarded — no one qualified.
                  </span>
                ) : (
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-verdigris-400">
                      {winners.length > 1 ? 'Co-winners' : 'Winner'}
                    </span>
                    <span className="font-display text-cream-50 text-lg">
                      {winners.map((w) => w.playerName).join(' & ')}
                    </span>
                    <span className="font-mono text-xs text-gold-300">
                      ({award.format(leader.score)})
                    </span>
                  </div>
                )}

                {runnersUp.length > 0 && (
                  <div className="font-mono text-[10px] uppercase tracking-wider text-cream-200/50 mt-1.5">
                    Also: {runnersUp.map((r) => `${r.playerName} ${award.format(r.score)}`).join(' · ')}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

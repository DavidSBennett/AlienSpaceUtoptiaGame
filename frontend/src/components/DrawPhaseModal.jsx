/**
 * DrawPhaseModal — the synchronous draw interstitial.
 *
 * After a round's actions resolve, every player who chose to draw takes cards
 * ONE AT A TIME from four face-up archive piles, in round-robin seat order
 * (fewest taken first). When the last allowance is spent the phase closes and
 * the round moves on to the conference, then review.
 *
 * The four top cards are public — that's the point of the market — but their
 * argument tags are never sent, matching a card's printed face.
 *
 * Props:
 *   drawPhase — state.draw_phase { piles, current_player_id, current_player_name,
 *               you_are_up, your_draws_remaining, players }
 *   you       — state.you
 *   busy      — bool (a network call is in flight)
 *   onTake    — async (pileIndex) => void
 */
import { useState } from 'react';
import { CardThumbnail } from './Card.jsx';
import FleuronDivider from './FleuronDivider.jsx';
import MinimizedInterstitialBar from './MinimizedInterstitialBar.jsx';

export default function DrawPhaseModal({ drawPhase, you, busy, onTake }) {
  const [error, setError] = useState(null);
  const [taking, setTaking] = useState(false);
  const [minimized, setMinimized] = useState(false);

  if (!drawPhase) return null;

  const piles = drawPhase.piles || [];
  const players = drawPhase.players || [];
  const yourTurn = !!drawPhase.you_are_up;
  const yourLeft = drawPhase.your_draws_remaining || 0;
  const waitingOn = players.filter((p) => p.draws_remaining > 0);

  async function take(pileIndex) {
    if (!yourTurn || busy || taking) return;
    setError(null);
    setTaking(true);
    try {
      await onTake(pileIndex);
    } catch (e) {
      setError(e.message || 'Could not take that card.');
    } finally {
      setTaking(false);
    }
  }

  if (minimized) {
    return (
      <MinimizedInterstitialBar
        label="Drawing Research"
        hint={yourTurn ? 'your pick' : `waiting on ${drawPhase.current_player_name || '…'}`}
        onRestore={() => setMinimized(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[120] bg-teal-950/90 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto animate-fade-in">
      <div
        className="relative surface-paper max-w-4xl w-full my-6 animate-fade-up"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(184, 146, 58, 0.5)' }}
      >
        <div className="absolute inset-2 border border-gold-500/30 pointer-events-none" />

        <button
          type="button"
          onClick={() => setMinimized(true)}
          title="Minimize — check your board"
          className="absolute top-3 right-3 z-30 px-3 py-1 font-mono text-[10px] uppercase tracking-wider bg-cream-50 border border-gold-500 text-ink-900 hover:bg-gold-500 hover:text-teal-950 transition-colors"
        >
          — Minimize
        </button>

        <div className="px-10 py-8">
          {/* Header */}
          <div className="pr-28">
            <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-700 mb-1">
              The Archive
            </p>
            <h2 className="font-display text-3xl font-bold text-ink-900 leading-tight">
              {yourTurn
                ? `Your pick — ${yourLeft} card${yourLeft === 1 ? '' : 's'} left`
                : `Waiting on ${drawPhase.current_player_name || '…'}`}
            </h2>
            <p className="font-serif italic text-ink-700 mt-1">
              {yourTurn
                ? 'Take one card from any pile. Players draw in turn until everyone’s research is spent.'
                : 'Players take one card at a time, in turn order.'}
            </p>
          </div>

          <FleuronDivider className="my-4" />

          {/* The four piles, top card face-up */}
          <div className="flex flex-wrap justify-center gap-3">
            {piles.map((pile) => {
              const top = pile.top;
              const clickable = yourTurn && !!top && !busy && !taking;
              return (
                <div key={pile.index} className="relative">
                  {top ? (
                    <div
                      onClick={() => clickable && take(pile.index)}
                      className={clickable ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}
                    >
                      <CardThumbnail card={top} />
                    </div>
                  ) : (
                    <div className="w-32 h-[12.5rem] border border-dashed border-ink-700/30 flex items-center justify-center">
                      <span className="font-serif italic text-ink-700/60 text-xs">empty</span>
                    </div>
                  )}
                  <span className="absolute bottom-1 right-1 font-mono text-[8px] text-ink-700/70 bg-cream-50/80 px-1">
                    {pile.count}
                  </span>
                </div>
              );
            })}
          </div>

          {error && (
            <p className="font-serif italic text-oxblood-600 text-sm mt-3 text-center">{error}</p>
          )}

          <FleuronDivider className="my-4" />

          {/* Who's still drawing */}
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-900 text-center">
            {waitingOn.length === 0
              ? 'Everyone has finished drawing…'
              : (
                <>
                  Still drawing:{' '}
                  {waitingOn
                    .map((p) => `${p.player_name} (${p.draws_remaining})`)
                    .join(' · ')}
                </>
              )}
          </p>
        </div>
      </div>
    </div>
  );
}

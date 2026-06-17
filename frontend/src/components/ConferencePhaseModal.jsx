/**
 * ConferencePhaseModal — the "Attend a Conference" interstitial.
 *
 * After the review phase, attendees draft cards from a shared pool in priority
 * order (reputation, then renown, then least prestige). On your turn you may
 * take up to as many cards as you contributed; click a card to read it in full
 * (content, tags, significance), and use its pill to select it. Other players
 * wait for their turn. When everyone has drafted, the year advances.
 *
 * Props:
 *   conference — state.conference { attendees, current_picker_id, is_your_turn, you, pool }
 *   you        — state.you
 *   busy       — bool
 *   onTake     — async (poolIds:number[]) => void
 */
import { useEffect, useState } from 'react';
import { CardThumbnail, CardModal } from './Card.jsx';
import { colorForSeat } from '../lib/playerColors.js';
import MinimizedInterstitialBar from './MinimizedInterstitialBar.jsx';

export default function ConferencePhaseModal({ conference, you, busy, onTake }) {
  const attendees = conference?.attendees || [];
  const pool = conference?.pool || [];
  const isYourTurn = !!conference?.is_your_turn;
  const youAttendee = conference?.you || null;
  const takeLimit = youAttendee?.take_limit ?? 0;
  const currentPickerId = conference?.current_picker_id ?? null;
  const currentPicker = attendees.find((a) => a.player_id === currentPickerId) || null;

  const [selected, setSelected] = useState(() => new Set()); // pool_id set
  const [openCard, setOpenCard] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [minimized, setMinimized] = useState(false);

  // Reset selection whenever the turn changes (or the pool shifts under us).
  useEffect(() => {
    setSelected(new Set());
    setError(null);
  }, [currentPickerId]);

  function toggle(poolId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(poolId)) next.delete(poolId);
      else if (next.size < takeLimit) next.add(poolId);
      return next;
    });
  }

  async function handleTake() {
    if (busy || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onTake([...selected]);
    } catch (e) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  // Minimized: collapse to a bar so the player can see their hand below.
  if (minimized) {
    return (
      <MinimizedInterstitialBar
        label="Conference"
        hint={isYourTurn ? 'your turn to draft' : 'waiting for the draft'}
        onRestore={() => setMinimized(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[120] bg-teal-950/90 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto animate-fade-in">
      <div
        className="relative surface-paper max-w-5xl w-full my-6 animate-fade-up"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(184, 146, 58, 0.5)' }}
      >
        <div className="absolute inset-2 border border-gold-500/30 pointer-events-none" />

        {/* Minimize — peek at your hand without losing your place. */}
        <button
          type="button"
          onClick={() => setMinimized(true)}
          title="Minimize — check your hand"
          className="absolute top-3 right-3 z-30 px-3 py-1 font-mono text-[10px] uppercase tracking-wider bg-cream-50 border border-gold-500 text-ink-900 hover:bg-gold-500 hover:text-teal-950 transition-colors"
        >
          — Minimize
        </button>

        <div className="px-10 py-8">
          {/* Header */}
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-700 mb-1">Conference</p>
          <h2 className="font-display text-3xl font-bold text-ink-900 leading-tight">The Conference Floor</h2>

          {/* Pick order */}
          <div className="flex flex-wrap gap-2 mt-3">
            {attendees.map((a) => {
              const col = colorForSeat(a.seat_index);
              const isCur = a.player_id === currentPickerId;
              const me = a.player_id === you?.player_id;
              return (
                <span
                  key={a.player_id}
                  className={`font-mono text-[10px] uppercase tracking-[0.12em] px-2 py-1 border ${
                    isCur ? 'border-gold-500 bg-gold-500/15 text-ink-900'
                          : a.done ? 'border-cream-300 text-ink-500'
                          : 'border-cream-300 text-ink-700'
                  }`}
                >
                  <span className={`inline-block w-2 h-2 mr-1.5 ${col.spineBg}`} aria-hidden="true" />
                  {a.player_name}{me && ' (you)'}
                  {' · '}
                  {a.done ? `took ${a.taken_count}` : isCur ? 'drafting…' : `waiting (${a.take_limit})`}
                </span>
              );
            })}
          </div>

          {/* Status line */}
          <p className="font-serif italic text-ink-700 mt-3">
            {isYourTurn
              ? <>Your turn — take up to <strong className="not-italic">{takeLimit}</strong> card{takeLimit === 1 ? '' : 's'}. Click a card to read it in full.</>
              : youAttendee
                ? <>Waiting for <strong className="not-italic">{currentPicker?.player_name || 'the next scholar'}</strong> to draft…</>
                : <>A conference is underway. Waiting for it to finish…</>}
          </p>

          {/* Pool */}
          <div className="mt-4 flex flex-wrap gap-3 justify-center min-h-[8rem]">
            {pool.length === 0 ? (
              <p className="font-serif italic text-ink-600 self-center">The pool is empty.</p>
            ) : (
              pool.map((card) => {
                const isSel = selected.has(card.pool_id);
                const atLimit = selected.size >= takeLimit && !isSel;
                return (
                  <div key={card.pool_id} className="flex flex-col items-center gap-1">
                    <div className={`relative ${isSel ? 'ring-2 ring-gold-500 ring-offset-2 ring-offset-cream-50' : ''}`}>
                      <CardThumbnail
                        card={card}
                        onClick={() => setOpenCard(card)}
                        showTags
                        showSignificance
                      />
                    </div>
                    {isYourTurn && (
                      <button
                        type="button"
                        onClick={() => toggle(card.pool_id)}
                        disabled={atLimit}
                        className={`font-mono text-[10px] uppercase tracking-wider px-3 py-1 border transition-colors ${
                          isSel
                            ? 'bg-gold-500 text-teal-950 border-gold-700'
                            : atLimit
                              ? 'border-cream-300 text-ink-400 cursor-not-allowed'
                              : 'bg-cream-50 text-ink-900 border-cream-300 hover:border-gold-500'
                        }`}
                      >
                        {isSel ? '✓ Selected' : 'Select'}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {error && <p className="font-serif italic text-oxblood-600 text-sm mt-3">{error}</p>}

          {/* Action */}
          {isYourTurn && (
            <div className="flex items-center justify-between gap-4 mt-5 pt-4 border-t border-gold-500/20">
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-700">
                Selected {selected.size} / {takeLimit}
              </p>
              <button
                type="button"
                onClick={handleTake}
                disabled={busy || submitting}
                className="px-6 py-3 font-mono text-sm uppercase tracking-wider bg-gold-500 hover:bg-gold-400 text-teal-950 border border-gold-700 disabled:opacity-50"
              >
                {submitting ? 'Taking…' : selected.size > 0 ? `Take ${selected.size} & end my turn` : 'Take nothing & end my turn'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Full card detail */}
      {openCard && (
        <CardModal
          card={openCard}
          onClose={() => setOpenCard(null)}
          showTags
          showSignificance
        />
      )}
    </div>
  );
}

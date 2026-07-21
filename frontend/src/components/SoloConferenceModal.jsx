/**
 * SoloConferenceModal — the single-player "Attend a Conference" flow.
 *
 * Two steps, matching the table version (ConferencePhaseModal):
 *
 *   1. STOCK THE FLOOR. The evidence you staged is already on it; you add two
 *      more, chosen off the face-up archive piles. They were dealt blind until
 *      now, which made the archive's half of the pool a lottery. Choosing is a
 *      real decision because a card's worth here is relational — what suits the
 *      rest of your hand is not what suits anyone else's.
 *   2. DRAFT. Keep up to as many as you staged, capped by notebook room, and
 *      bank citation tokens (worth renown × each at game end). Resolving costs
 *      the year.
 *
 * Props:
 *   conference     — { pool, keepLimit, stagedCount, contributeLeft, citationGrant }
 *   archivePiles   — the live archive piles, for the stocking step
 *   capacity       — notebook capacity (hand limit)
 *   handCount      — current hand size (limits how many you can take home)
 *   showTags, showSignificance — passthrough display toggles
 *   onContribute   — (pileIndex: number) => void   add one card to the floor
 *   onConfirm      — (keepIds: string[]) => void   resolve the draft
 */
import { useState } from 'react';
import { CardThumbnail, CardModal } from './Card.jsx';
import ArchiveMarket from './ArchiveMarket.jsx';
import FleuronDivider from './FleuronDivider.jsx';

export default function SoloConferenceModal({
  conference,
  archivePiles = [],
  capacity,
  handCount,
  showTags,
  showSignificance,
  onContribute,
  onConfirm,
}) {
  const pool = conference?.pool || [];
  const keepLimit = conference?.keepLimit ?? 0;
  const stagedCount = conference?.stagedCount ?? keepLimit;
  const citationGrant = conference?.citationGrant ?? 0;
  const contributeLeft = conference?.contributeLeft ?? 0;

  // You can never take more than your notebook has room for.
  const room = Math.max(0, (capacity ?? 0) - (handCount ?? 0));
  const maxKeep = Math.min(keepLimit, room);

  const [selected, setSelected] = useState(() => new Set()); // card.id set
  const [openCard, setOpenCard] = useState(null);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < maxKeep) next.add(id);
      return next;
    });
  }

  // ── Step 1: stock the floor from the face-up piles ──────────────────
  if (contributeLeft > 0) {
    return (
      <div className="fixed inset-0 z-[70] bg-teal-950/90 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto animate-fade-in">
        <div
          className="relative surface-paper max-w-3xl w-full my-6 animate-fade-up"
          style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(184, 146, 58, 0.5)' }}
        >
          <div className="absolute inset-2 border border-gold-500/30 pointer-events-none" />

          <div className="px-10 py-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-700 mb-1">Conference</p>
            <h2 className="font-display text-3xl font-bold text-ink-900 leading-tight">
              Add to the floor — {contributeLeft} card{contributeLeft === 1 ? '' : 's'} to go
            </h2>
            <p className="font-serif italic text-ink-700 mt-1">
              Your {stagedCount} card{stagedCount === 1 ? ' is' : 's are'} already on the floor.
              Take {contributeLeft === 1 ? 'one more' : 'two'} from the archive — you'll draft from
              the whole pool, so anything you add is yours to take back.
            </p>

            <FleuronDivider className="my-4" />

            <div className="flex justify-center">
              <ArchiveMarket
                piles={(archivePiles || []).map((p) => ({ top: p[0] || null, count: p.length }))}
                canTake
                onTake={(pileIndex) => onContribute?.(pileIndex)}
                caption={`On the floor: ${pool.length}`}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] bg-teal-950/90 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto animate-fade-in">
      <div
        className="relative surface-paper max-w-5xl w-full my-6 animate-fade-up"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(184, 146, 58, 0.5)' }}
      >
        <div className="absolute inset-2 border border-gold-500/30 pointer-events-none" />

        <div className="px-10 py-8">
          {/* Header */}
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-700 mb-1">Conference</p>
          <h2 className="font-display text-3xl font-bold text-ink-900 leading-tight">The Conference Floor</h2>

          <p className="font-serif italic text-ink-700 mt-3">
            You brought <strong className="not-italic">{stagedCount}</strong> card{stagedCount === 1 ? '' : 's'}
            {' '}and chose the rest of the floor yourself. Draft up to{' '}
            <strong className="not-italic">{maxKeep}</strong> from the pool below to bring home,
            and bank{' '}
            <strong className="not-italic">{citationGrant}</strong> citation token{citationGrant === 1 ? '' : 's'}.
            Click a card to read it in full.
          </p>
          {maxKeep < keepLimit && (
            <p className="font-serif italic text-oxblood-600 text-sm mt-1">
              Your notebook only has room for {maxKeep} more — the rest stay at the conference.
            </p>
          )}

          {/* Pool */}
          <div className="mt-4 flex flex-wrap gap-3 justify-center min-h-[8rem]">
            {pool.length === 0 ? (
              <p className="font-serif italic text-ink-600 self-center">The pool is empty.</p>
            ) : (
              pool.map((card) => {
                const isSel = selected.has(card.id);
                const atLimit = selected.size >= maxKeep && !isSel;
                return (
                  <div key={card.id} className="flex flex-col items-center gap-1">
                    <div className={`relative ${isSel ? 'ring-2 ring-gold-500 ring-offset-2 ring-offset-cream-50' : ''}`}>
                      <CardThumbnail
                        card={card}
                        onClick={() => setOpenCard(card)}
                        showTags={showTags}
                        showSignificance={showSignificance}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle(card.id)}
                      disabled={atLimit}
                      className={`font-mono text-[10px] uppercase tracking-wider px-3 py-1 border transition-colors ${
                        isSel
                          ? 'bg-gold-500 text-teal-950 border-gold-700'
                          : atLimit
                            ? 'border-cream-300 text-ink-400 cursor-not-allowed'
                            : 'bg-cream-50 text-ink-900 border-cream-300 hover:border-gold-500'
                      }`}
                    >
                      {isSel ? '✓ Keep' : 'Keep'}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Action */}
          <div className="flex items-center justify-between gap-4 mt-5 pt-4 border-t border-gold-500/20">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-700">
              Keeping {selected.size} / {maxKeep}
            </p>
            <button
              type="button"
              onClick={() => {
                if (selected.size < maxKeep) {
                  const more = maxKeep - selected.size;
                  const ok = window.confirm(
                    `You can still keep ${more} more card${more === 1 ? '' : 's'} from the conference. Bring home just ${selected.size}?`
                  );
                  if (!ok) return;
                }
                onConfirm([...selected]);
              }}
              className="px-6 py-3 font-mono text-sm uppercase tracking-wider bg-gold-500 hover:bg-gold-400 text-teal-950 border border-gold-700"
            >
              {selected.size > 0
                ? `Bring home ${selected.size} (+ 1 year)`
                : 'Keep nothing (+ 1 year)'}
            </button>
          </div>
        </div>
      </div>

      {/* Full card detail */}
      {openCard && (
        <CardModal
          card={openCard}
          onClose={() => setOpenCard(null)}
          showTags={showTags}
          showSignificance={showSignificance}
        />
      )}
    </div>
  );
}

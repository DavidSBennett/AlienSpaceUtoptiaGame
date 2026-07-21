/**
 * SoloConferenceModal — the single-player "Attend a Conference" draft.
 *
 * Mirrors the multiplayer solo-attendee branch: the evidence you staged has
 * been sent to the conference, and in exchange you draft from a fresh pool of
 * (staged + reputation bonus) cards, keeping up to as many as you staged. You
 * also bank citation tokens (worth renown × each at game end). Resolving costs
 * the year.
 *
 * Props:
 *   conference     — { pool: [cards], keepLimit, citationGrant }
 *   capacity       — notebook capacity (hand limit)
 *   handCount      — current hand size (limits how many you can take home)
 *   showTags, showSignificance — passthrough display toggles
 *   onConfirm      — (keepIds: string[]) => void   resolve the draft
 */
import { useState } from 'react';
import { CardThumbnail, CardModal } from './Card.jsx';

export default function SoloConferenceModal({
  conference,
  capacity,
  handCount,
  showTags,
  showSignificance,
  onConfirm,
}) {
  const pool = conference?.pool || [];
  const keepLimit = conference?.keepLimit ?? 0;
  const stagedCount = conference?.stagedCount ?? keepLimit;
  const keepBonus = conference?.keepBonus ?? 0;
  const citationGrant = conference?.citationGrant ?? 0;

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
            You brought <strong className="not-italic">{stagedCount}</strong> card{stagedCount === 1 ? '' : 's'};
            the archive matched {stagedCount === 1 ? 'it' : 'them'}. Draft up to{' '}
            <strong className="not-italic">{maxKeep}</strong> from the pool below to bring home
            {keepBonus > 0 && (
              <> — your {stagedCount} plus <strong className="not-italic">{keepBonus}</strong> from your memberships</>
            )}
            , and bank{' '}
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

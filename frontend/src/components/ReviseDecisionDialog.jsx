import { useEffect } from 'react';

import CornerOrnament from './CornerOrnament.jsx';
import FleuronDivider from './FleuronDivider.jsx';

/**
 * ReviseDecisionDialog — the WRITER's year-end decision on a reviewer's
 * Revise & Resubmit proposal. Summarizes the cards the reviewer wants to
 * drop and the cards they're contributing, then offers three choices:
 *
 *   Accept   — publish the revised manuscript; you get full prestige, the
 *              reviewer earns a third as a contributor.
 *   Object   — costs 1 objection token (spent regardless); your ORIGINAL
 *              manuscript is judged by the tag algorithm alone.
 *   Rebuild  — decline; reclaim your own cards and rebuild for review next
 *              year (treated as a rejection).
 *
 * Props:
 *   decision         — a revise_decisions_for_you entry
 *   tokensRemaining  — int, the writer's objection tokens
 *   onAccept/onObject/onRebuild — async () => void
 *   onClose          — () => void  ("decide later")
 *   busy, error
 */
export default function ReviseDecisionDialog({
  decision,
  tokensRemaining = 0,
  onAccept,
  onObject,
  onRebuild,
  onClose,
  busy,
  error,
}) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && onClose) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const removed = decision.removed_cards || [];
  const added = decision.added_cards || [];
  const kept = decision.kept_cards || [];
  const canObject = tokensRemaining >= 1;

  const CardRow = ({ card, tone }) => (
    <li className={`border p-2 ${
      tone === 'remove' ? 'border-oxblood-500 bg-oxblood-500/10'
      : tone === 'add'  ? 'border-verdigris-500 bg-verdigris-500/10'
      : 'border-cream-300 bg-cream-50'
    }`}>
      <div className="font-display font-semibold text-ink-900 text-sm">{card.title}</div>
      {card.author && <div className="font-serif italic text-ink-700 text-xs">by {card.author}</div>}
    </li>
  );

  return (
    <div
      className="fixed inset-0 z-[70] bg-teal-950/80 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in overflow-y-auto"
      onClick={onClose}
    >
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="absolute top-4 right-4 z-30 px-4 py-2 bg-cream-50 border border-gold-500 text-ink-900 hover:bg-oxblood-500 hover:text-cream-50 hover:border-oxblood-500 transition-colors font-mono text-sm uppercase tracking-wider shadow-md"
          aria-label="Decide later"
        >
          Decide later
        </button>

        <article
          className="relative surface-paper max-w-3xl w-full max-h-[95vh] overflow-y-auto animate-fade-up"
          style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(184, 146, 58, 0.5)' }}
        >
          <div className="absolute inset-2 border border-gold-500/30 pointer-events-none" />
          <div className="absolute top-3 left-3 text-gold-500 pointer-events-none"><CornerOrnament corner="tl" size={24} /></div>
          <div className="absolute top-3 right-3 text-gold-500 pointer-events-none"><CornerOrnament corner="tr" size={24} /></div>
          <div className="absolute bottom-3 left-3 text-gold-500 pointer-events-none"><CornerOrnament corner="bl" size={24} /></div>
          <div className="absolute bottom-3 right-3 text-gold-500 pointer-events-none"><CornerOrnament corner="br" size={24} /></div>

          <div className="px-10 py-9">
            <div className="mb-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-700 mb-1">
                Revise and Resubmit
              </p>
              <h2 className="font-display text-2xl font-bold text-ink-900">
                {decision.reviewer_name} proposed changes to your {decision.kind}
              </h2>
              {decision.conclusion?.title && (
                <p className="font-serif italic text-ink-700 text-sm mt-1">
                  Conclusion: {decision.conclusion.title}
                </p>
              )}
              {decision.reviewer_comment && (
                <p className="font-serif text-ink-800 text-sm mt-2 border-l-2 border-gold-500/40 pl-3">
                  “{decision.reviewer_comment}”
                </p>
              )}
            </div>

            <FleuronDivider className="my-4" />

            <div className="grid grid-cols-2 gap-5 mb-5">
              <section>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-oxblood-700 mb-2">
                  Cards to remove ({removed.length})
                </div>
                {removed.length === 0
                  ? <p className="font-serif italic text-ink-700 text-sm">None.</p>
                  : <ul className="space-y-1.5">{removed.map((c) => <CardRow key={c.idCard} card={c} tone="remove" />)}</ul>}
              </section>
              <section>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-verdigris-600 mb-2">
                  Cards to add ({added.length})
                </div>
                {added.length === 0
                  ? <p className="font-serif italic text-ink-700 text-sm">None.</p>
                  : <ul className="space-y-1.5">{added.map((c) => <CardRow key={c.idCard} card={c} tone="add" />)}</ul>}
              </section>
            </div>

            {kept.length > 0 && (
              <section className="mb-5">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-700 mb-2">
                  Kept from your manuscript ({kept.length})
                </div>
                <ul className="grid grid-cols-2 gap-1.5">{kept.map((c) => <CardRow key={c.idCard} card={c} tone="keep" />)}</ul>
              </section>
            )}

            {error && (
              <p className="font-serif italic text-oxblood-700 text-sm mb-3">{error}</p>
            )}

            <FleuronDivider className="my-4" />

            <div className="space-y-2">
              <button
                type="button"
                onClick={onAccept}
                disabled={busy}
                className="w-full px-4 py-3 font-mono text-xs uppercase tracking-wider bg-verdigris-600 hover:bg-verdigris-500 text-cream-50 border border-verdigris-500 disabled:opacity-50 text-left"
              >
                Accept the changes
                <span className="block font-serif italic normal-case tracking-normal text-cream-100/80 text-xs mt-0.5">
                  Publish the revised manuscript. You earn full prestige; {decision.reviewer_name} earns a third as a contributor.
                </span>
              </button>

              <button
                type="button"
                onClick={onObject}
                disabled={busy || !canObject}
                title={canObject
                  ? 'Costs 1 objection token (spent whether you win or lose). Your original manuscript is judged by tags alone.'
                  : 'You have no objection tokens remaining.'}
                className="w-full px-4 py-3 font-mono text-xs uppercase tracking-wider bg-ink-900/5 hover:bg-ink-900/10 text-ink-900 border border-ink-700/40 disabled:opacity-50 text-left"
              >
                Object to the changes — costs 1 objection token ({tokensRemaining} left)
                <span className="block font-serif italic normal-case tracking-normal text-ink-700 text-xs mt-0.5">
                  Your ORIGINAL manuscript is judged by the tag algorithm alone — approved or rejected, no reviewer share. Token is spent either way.
                </span>
              </button>

              <button
                type="button"
                onClick={onRebuild}
                disabled={busy}
                className="w-full px-4 py-3 font-mono text-xs uppercase tracking-wider bg-cream-50 hover:bg-oxblood-500/10 text-ink-900 border border-ink-700/40 disabled:opacity-50 text-left"
              >
                Accept the rejection & rebuild
                <span className="block font-serif italic normal-case tracking-normal text-ink-700 text-xs mt-0.5">
                  Reclaim your own cards and rebuild the argument. It returns to peer review next year.
                </span>
              </button>
            </div>

            <div className="mt-5 border border-gold-500/30 bg-ink-900/[0.03] px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700 mb-2">
                How these choices work
              </div>
              <ul className="space-y-2 font-serif text-ink-700 text-xs leading-relaxed">
                <li>
                  <strong className="text-verdigris-700 not-italic">Accept</strong> — you take the reviewer's
                  edits. The revised manuscript publishes right away and you earn full prestige; the reviewer
                  takes a one-third contributor share and the cards they added are spent into your work.
                </li>
                <li>
                  <strong className="text-ink-900 not-italic">Object</strong> — you stand on your original
                  manuscript and reject the edits. It's judged by the tag algorithm alone: if every piece of
                  evidence and the conclusion share a common tag it's approved, otherwise it's rejected. This
                  costs 1 objection token whether you win or lose, and the reviewer's added cards go back to them.
                </li>
                <li>
                  <strong className="text-oxblood-700 not-italic">Rebuild</strong> — you accept that the
                  manuscript is rejected. You reclaim your own cards (and draw a consolation card), the
                  reviewer's added cards return to them, and you can rework the argument for peer review next year.
                </li>
              </ul>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}

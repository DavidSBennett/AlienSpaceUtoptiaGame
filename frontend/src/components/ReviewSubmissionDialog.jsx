import { useState, useEffect, useMemo } from 'react';

import CornerOrnament from './CornerOrnament.jsx';
import FleuronDivider from './FleuronDivider.jsx';
import { getCardTags } from '../lib/tags.js';
import { colorForSeat } from '../lib/playerColors.js';

/**
 * ReviewSubmissionDialog — peer review modal (shared by multiplayer and the
 * guided walkthrough).
 *
 * Layout:
 *   - The author's written conclusion (prose), if any, at the top.
 *   - A fanned-card visualization: the conclusion card on top, the evidence
 *     cards fanned behind it, each showing its tags. Tags that match the
 *     conclusion's theme are highlighted; cards with no matching tag are
 *     marked as mismatches.
 *   - A constructed statement of which cards do NOT match the conclusion.
 *   - Verdict options (Approve / Revise & Resubmit / Reject) + a comment.
 *
 * Mismatched cards are pre-flagged; Reject/Revise send those flags (you can
 * click a card to toggle its flag). onSubmit keeps the same contract:
 *   ({ verdict, flaggedCardIds, addedCardIds, comment }).
 *
 * Props: submission, onSubmit, onClose, busy, error.
 */
export default function ReviewSubmissionDialog({
  submission,
  onSubmit,
  onClose,
  busy,
  error,
}) {
  const conclusionTags = useMemo(
    () => getCardTags(submission?.conclusion || {}),
    [submission?.conclusion]
  );

  // Which evidence cards share a tag with the conclusion.
  const evidence = submission?.evidence || [];
  const matchInfo = useMemo(() => {
    return evidence.map((card) => {
      const tags = Array.from(getCardTags(card));
      const matches = tags.some((t) => conclusionTags.has(t));
      return { card, tags, matches };
    });
  }, [evidence, conclusionTags]);
  const mismatched = matchInfo.filter((m) => !m.matches);

  const [verdict, setVerdict] = useState('approve');
  // Pre-flag the mismatched cards.
  const [flagged, setFlagged] = useState(() => new Set(mismatched.map((m) => m.card.idCard)));
  const [comment, setComment] = useState('');

  // Reset when a different submission opens.
  useEffect(() => {
    setVerdict('approve');
    setFlagged(new Set(mismatched.map((m) => m.card.idCard)));
    setComment('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission?.submission_id]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && onClose) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function toggleFlag(cardId) {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId); else next.add(cardId);
      return next;
    });
  }

  const canSubmit = !busy && (
    verdict === 'approve' ||
    (verdict === 'revise' && flagged.size > 0)
  );

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({
      verdict,
      flaggedCardIds: verdict === 'revise' ? Array.from(flagged) : [],
      addedCardIds: [],
      comment: comment.trim() || null,
    });
  }

  if (!submission) return null;
  const writerCol = colorForSeat(submission.writer_seat ?? 0);

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
          aria-label="Close"
        >
          ✕ Close
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

          <div className="px-10 py-5">
            {/* Header */}
            <div className="mb-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-700 mb-1">Peer Review</p>
              <div className="flex items-baseline gap-3">
                <span className={`w-3 h-6 ${writerCol.spineBg}`} aria-hidden="true" />
                <h2 className="font-display text-2xl font-bold text-ink-900">
                  {submission.writer_name}'s {submission.kind}
                </h2>
              </div>
            </div>

            {/* Author's written conclusion (prose) */}
            <section className="mb-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700 mb-1">
                The author's conclusion
              </div>
              {submission.argument_text && submission.argument_text.trim() ? (
                <p className="font-serif text-ink-900 whitespace-pre-wrap leading-relaxed">
                  {submission.argument_text}
                </p>
              ) : (
                <p className="font-serif italic text-ink-700 leading-relaxed">
                  The author is explaining their argument aloud — listen before you decide.
                </p>
              )}
              {submission.conclusion?.title && (
                <p className="font-display text-lg text-ink-900 mt-1">
                  “{submission.conclusion.title}”
                </p>
              )}
            </section>

            <FleuronDivider className="my-1" />

            {/* Fanned card visualization */}
            <FannedCards
              matchInfo={matchInfo}
              conclusion={submission.conclusion}
              conclusionTags={conclusionTags}
              flagged={flagged}
              onToggleFlag={toggleFlag}
            />

            {/* Constructed mismatch statement */}
            <section className="mt-1 mb-2 text-center">
              {mismatched.length === 0 ? (
                <p className="font-serif text-verdigris-700">
                  Every card shares the conclusion's theme — the evidence fits the thesis.
                </p>
              ) : (
                <p className="font-serif text-oxblood-700">
                  {mismatched.length} card{mismatched.length === 1 ? '' : 's'} do
                  {mismatched.length === 1 ? 'es' : ''} not share the conclusion's theme:{' '}
                  <strong className="font-display">
                    {mismatched.map((m) => m.card.title).join(', ')}
                  </strong>.
                </p>
              )}
              <p className="font-serif italic text-ink-700/70 text-xs mt-1">
                Tip: click a card to flag or unflag it.
              </p>
            </section>

            <FleuronDivider className="my-1" />

            {/* Verdict picker */}
            <section className="mb-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700 mb-2">Your verdict</div>
              <div className="grid grid-cols-2 gap-3">
                <VerdictOption
                  value="approve" verdict={verdict} setVerdict={setVerdict} accent="gold"
                  label="Approve" desc="The evidence supports the conclusion — publish it."
                />
                <VerdictOption
                  value="revise" verdict={verdict} setVerdict={setVerdict} accent="verdigris"
                  label="Revise & Resubmit" desc="Send it back — the flagged cards should be reconsidered."
                />
              </div>
              {verdict === 'revise' && flagged.size === 0 && (
                <p className="font-serif italic text-oxblood-700 text-sm mt-2">
                  Flag at least one card (click it above) to send it back for revision.
                </p>
              )}
            </section>

            {/* Comment */}
            <section className="mb-4">
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700">Comment (optional)</span>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Short note to the author"
                  className="w-full p-2 mt-1 border border-ink-700/30 bg-cream-50 text-ink-900 font-serif text-sm"
                />
                <div className="font-mono text-[10px] text-ink-700 text-right">{comment.length}/500</div>
              </label>
            </section>

            {error && (
              <div className="mb-4 p-3 border border-oxblood-500 bg-oxblood-500/10 text-oxblood-700 font-serif text-sm">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 border border-ink-700 text-ink-900 font-mono text-sm uppercase tracking-wider hover:bg-ink-900/5"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={`px-4 py-2 font-mono text-sm uppercase tracking-wider border ${
                  canSubmit
                    ? 'bg-ink-900 text-cream-50 border-ink-900 hover:bg-oxblood-700 hover:border-oxblood-700'
                    : 'bg-cream-200 text-ink-700/40 border-cream-300 cursor-not-allowed'
                }`}
              >
                {busy ? 'Submitting…' : 'Submit verdict'}
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}


/**
 * The fanned cards — a left-to-right spread. Each card overlaps the one to its
 * LEFT (higher z as you go right), so every card's left edge — where the tags
 * live — stays exposed. The conclusion is the rightmost card, on top.
 */
function FannedCards({ matchInfo, conclusion, conclusionTags, flagged, onToggleFlag }) {
  const cards = [
    ...matchInfo.map((m) => ({ ...m, isConclusion: false })),
    { card: conclusion, tags: Array.from(conclusionTags), matches: true, isConclusion: true },
  ];
  const total = cards.length;
  const OFFSET = 62;   // horizontal step; leaves ~62px of each card's left showing
  const CARD_W = 112;
  const mid = (total - 1) / 2;
  const width = (total - 1) * OFFSET + CARD_W;

  return (
    <div className="flex justify-center">
      <div className="relative" style={{ height: 178, width }}>
        {cards.map((c, k) => {
          const angle = (k - mid) * 4; // gentle fan
          const isFlagged = !c.isConclusion && flagged.has(c.card.idCard);
          return (
            <button
              key={c.isConclusion ? 'conclusion' : c.card.idCard}
              type="button"
              onClick={c.isConclusion ? undefined : () => onToggleFlag(c.card.idCard)}
              disabled={c.isConclusion}
              className="absolute bottom-0 transition-transform hover:-translate-y-1 hover:z-[200]"
              style={{ left: k * OFFSET, transformOrigin: 'bottom center', transform: `rotate(${angle}deg)`, zIndex: k + 1 }}
              title={c.isConclusion ? undefined : 'Click to flag / unflag'}
            >
              <MiniCard
                card={c.card}
                tags={c.tags}
                matches={c.matches}
                flagged={isFlagged}
                isConclusion={c.isConclusion}
                conclusionTags={conclusionTags}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}


/** A small card. Tags stack in a column at the top-left (the exposed strip). */
function MiniCard({ card, tags, matches, flagged, isConclusion, conclusionTags }) {
  const border = isConclusion
    ? 'border-gold-500 bg-cream-50'
    : matches
    ? 'border-verdigris-500 bg-cream-100'
    : 'border-oxblood-500 bg-cream-100';
  return (
    <div
      className={`relative w-[112px] h-[168px] rounded-md border-2 shadow-lg p-2 flex flex-col text-left ${border} ${
        flagged ? 'ring-2 ring-oxblood-500 ring-offset-1' : ''
      }`}
    >
      {/* Top-left strip: match badge + tags stacked, so they stay visible. */}
      <div className="flex flex-col items-start gap-1">
        <span className={`font-mono text-[8px] uppercase tracking-wide px-1 py-0.5 rounded ${
          isConclusion ? 'bg-gold-500 text-ink-900' : matches ? 'bg-verdigris-500 text-cream-50' : 'bg-oxblood-500 text-cream-50'
        }`}>
          {isConclusion ? 'Thesis' : matches ? '✓ match' : '✕ no match'}
        </span>
        {(tags || []).map((t) => {
          const isMatchTag = isConclusion || conclusionTags?.has(t);
          return (
            <span
              key={t}
              className={`font-mono text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                isConclusion
                  ? 'bg-gold-500 text-ink-900 border-gold-700'
                  : isMatchTag
                  ? 'bg-verdigris-500 text-cream-50 border-verdigris-700'
                  : 'bg-cream-300 text-ink-700 border-cream-400'
              }`}
            >
              {t}
            </span>
          );
        })}
        {(!tags || tags.length === 0) && (
          <span className="font-mono text-[9px] uppercase text-ink-700/60">no tag</span>
        )}
      </div>

      <div className="flex-1 flex items-end pb-0.5">
        <span className="font-display text-[10px] text-ink-900 leading-tight">{card?.title}</span>
      </div>
    </div>
  );
}


function VerdictOption({ value, verdict, setVerdict, label, desc, accent }) {
  const active = verdict === value;
  const border = active
    ? (accent === 'oxblood' ? 'border-oxblood-500' : accent === 'verdigris' ? 'border-verdigris-500' : 'border-gold-500')
    : 'border-cream-300';
  return (
    <label className={`border p-3 cursor-pointer ${border} ${active ? 'bg-cream-50' : ''}`}>
      <input type="radio" name="verdict" value={value} checked={active} onChange={() => setVerdict(value)} className="mr-2" />
      <span className="font-display font-semibold text-ink-900">{label}</span>
      <p className="font-serif italic text-ink-700 text-sm mt-1">{desc}</p>
    </label>
  );
}

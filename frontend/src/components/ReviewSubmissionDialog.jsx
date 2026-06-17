import { useState, useEffect } from 'react';

import CornerOrnament from './CornerOrnament.jsx';
import FleuronDivider from './FleuronDivider.jsx';
import { parseTagField } from '../lib/tags.js';
import { colorForSeat } from '../lib/playerColors.js';

/**
 * ReviewSubmissionDialog — peer review modal, rendered in the cream
 * "scholarly paper" style matching the CardModal aesthetic.
 *
 * Reviewer sees:
 *   - Conclusion tile (from public shelf)
 *   - Author's prose argument
 *   - Each evidence card: title + author + tags only (NO content)
 *
 * Verdict options:
 *   - Approve (no flag required)
 *   - Reject (must flag ≥ 1 evidence card)
 *   - Optional comment
 *
 * Props:
 *   submission — the submission from state.pending_submissions
 *   onSubmit   — async ({ verdict, flaggedCardIds, comment }) => void
 *   onClose    — () => void
 *   busy       — bool
 *   error      — string|null
 */
export default function ReviewSubmissionDialog({
  submission,
  onSubmit,
  onClose,
  busy,
  error,
  yourHand = [],
}) {
  const [verdict, setVerdict] = useState('approve');
  const [flagged, setFlagged] = useState(new Set());
  const [added, setAdded] = useState(new Set());
  const [comment, setComment] = useState('');

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && onClose) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function toggleFlag(cardId) {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function toggleAdd(cardId) {
    setAdded((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function handleSubmit() {
    if (verdict === 'reject' && flagged.size === 0) return;
    if (verdict === 'revise' && flagged.size === 0 && added.size === 0) return;
    onSubmit({
      verdict,
      flaggedCardIds: (verdict === 'reject' || verdict === 'revise') ? Array.from(flagged) : [],
      addedCardIds: verdict === 'revise' ? Array.from(added) : [],
      comment: comment.trim() || null,
    });
  }

  const canSubmit = !busy && (
    verdict === 'approve' ||
    (verdict === 'reject' && flagged.size > 0) ||
    (verdict === 'revise' && (flagged.size > 0 || added.size > 0))
  );
  const writerCol = colorForSeat(submission.writer_seat ?? 0);
  const handAddable = (Array.isArray(yourHand) ? yourHand : [])
    .filter((c) => c && c.type !== 'conclusion');

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
          className="relative surface-paper max-w-4xl w-full max-h-[95vh] overflow-y-auto animate-fade-up"
          style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(184, 146, 58, 0.5)' }}
        >
          <div className="absolute inset-2 border border-gold-500/30 pointer-events-none" />
          <div className="absolute top-3 left-3 text-gold-500 pointer-events-none"><CornerOrnament corner="tl" size={24} /></div>
          <div className="absolute top-3 right-3 text-gold-500 pointer-events-none"><CornerOrnament corner="tr" size={24} /></div>
          <div className="absolute bottom-3 left-3 text-gold-500 pointer-events-none"><CornerOrnament corner="bl" size={24} /></div>
          <div className="absolute bottom-3 right-3 text-gold-500 pointer-events-none"><CornerOrnament corner="br" size={24} /></div>

          <div className="px-12 py-10">
            {/* Header */}
            <div className="mb-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-700 mb-1">
                Peer Review
              </p>
              <div className="flex items-baseline gap-3">
                <span className={`w-3 h-6 ${writerCol.spineBg}`} aria-hidden="true" />
                <h2 className="font-display text-2xl font-bold text-ink-900">
                  {submission.writer_name}'s {submission.kind}
                </h2>
              </div>
              <p className="font-serif italic text-ink-900 text-sm mt-1">
                Submitted year {submission.year_submitted} · {submission.evidence.length} evidence card{submission.evidence.length === 1 ? '' : 's'}
              </p>
            </div>

            <FleuronDivider className="my-5" />

            {/* Conclusion */}
            <section className="mb-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700 mb-1">
                Conclusion
              </div>
              <div className="font-display text-xl text-ink-900">
                {submission.conclusion?.title}
              </div>
              {submission.conclusion?.description && (
                <p className="font-serif italic text-ink-700 mt-1">
                  {submission.conclusion.description}
                </p>
              )}
            </section>

            {/* Argument */}
            <section className="mb-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700 mb-1">
                Argument
              </div>
              {submission.argument_text && submission.argument_text.trim() ? (
                <p className="font-serif text-ink-900 whitespace-pre-wrap leading-relaxed">
                  {submission.argument_text}
                </p>
              ) : (
                <p className="font-serif italic text-ink-700 leading-relaxed">
                  The author is explaining their argument by voice (Discord, Zoom,
                  or in person). Listen to their explanation before deciding.
                </p>
              )}
            </section>

            {/* Evidence */}
            <section className="mb-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700 mb-2">
                Evidence ({submission.evidence.length})
              </div>
              <ul className="space-y-2">
                {submission.evidence.map((card) => {
                  const tags = Array.from(new Set([
                    ...parseTagField(card.argument),
                    ...parseTagField(card.sub_argument),
                  ]));
                  const isFlagged = flagged.has(card.idCard);
                  return (
                    <li
                      key={card.idCard}
                      className={`border p-3 ${
                        isFlagged ? 'border-oxblood-500 bg-oxblood-500/10' : 'border-cream-300 bg-cream-50'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-display font-semibold text-ink-900">
                            {card.title}
                          </div>
                          {card.author && (
                            <div className="font-serif italic text-ink-700 text-sm">
                              by {card.author}
                            </div>
                          )}
                          {tags.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {tags.map((t) => (
                                <span
                                  key={t}
                                  className="font-mono text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 border border-cream-300 text-ink-700 bg-cream-50"
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {(verdict === 'reject' || verdict === 'revise') && (
                          <button
                            onClick={() => toggleFlag(card.idCard)}
                            className={`flex-shrink-0 text-xs px-2 py-1 border font-mono uppercase tracking-wider ${
                              isFlagged
                                ? 'border-oxblood-500 bg-oxblood-500 text-cream-50'
                                : 'border-ink-700 text-ink-700 hover:bg-ink-900/5'
                            }`}
                          >
                            {isFlagged ? 'flagged' : 'flag'}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="font-serif italic text-ink-700 text-xs mt-2">
                Card contents are hidden from reviewers. You judge by titles, authors, tags, and the writer's argument.
              </p>
            </section>

            {/* Revise & Resubmit — contribute cards from your own hand */}
            {verdict === 'revise' && (
              <section className="mb-5">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700 mb-2">
                  Add from your hand ({added.size} selected)
                </div>
                {handAddable.length === 0 ? (
                  <p className="font-serif italic text-ink-700 text-sm">
                    You have no cards in hand to contribute.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {handAddable.map((card) => {
                      const isAdded = added.has(card.idCard);
                      return (
                        <li
                          key={card.idCard}
                          className={`border p-3 ${
                            isAdded ? 'border-verdigris-500 bg-verdigris-500/10' : 'border-cream-300 bg-cream-50'
                          }`}
                        >
                          <div className="flex justify-between items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="font-display font-semibold text-ink-900">{card.title}</div>
                              {card.author && (
                                <div className="font-serif italic text-ink-700 text-sm">by {card.author}</div>
                              )}
                            </div>
                            <button
                              onClick={() => toggleAdd(card.idCard)}
                              className={`flex-shrink-0 text-xs px-2 py-1 border font-mono uppercase tracking-wider ${
                                isAdded
                                  ? 'border-verdigris-500 bg-verdigris-500 text-cream-50'
                                  : 'border-ink-700 text-ink-700 hover:bg-ink-900/5'
                              }`}
                            >
                              {isAdded ? 'added' : 'add'}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="font-serif italic text-ink-700 text-xs mt-2">
                  Flag cards above to remove them; add cards here to contribute. If the writer accepts, your added cards leave your hand and you earn a third of the manuscript's prestige.
                </p>
              </section>
            )}

            {/* Citations — works the writer is citing from the library.
                Reviewers see these alongside evidence so they can judge
                whether the citation tags fit the conclusion. Note: the
                tag-validity check is also enforced automatically at
                resolve time; mismatched citations auto-reject the
                submission regardless of approve votes. */}
            {submission.citations && submission.citations.length > 0 && (
              <section className="mb-5">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700 mb-2">
                  Citations ({submission.citations.length})
                </div>
                <ul className="space-y-2">
                  {submission.citations.map((c) => {
                    const tagMatches = !submission.conclusion?.argument
                      ? null
                      : String(submission.conclusion.argument)
                          .split(',')
                          .map((s) => s.trim())
                          .includes(c.conclusion_tag);
                    return (
                      <li
                        key={c.work_id}
                        className={`border p-3 ${
                          tagMatches === false
                            ? 'border-oxblood-500 bg-oxblood-500/10'
                            : 'border-verdigris-500 bg-verdigris-500/10'
                        }`}
                      >
                        <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-verdigris-600 mb-0.5">
                          {c.kind === 'book' ? 'Cited book' : 'Cited article'} · y{c.year_published} · {c.writer_name}
                        </div>
                        <div className="font-display font-semibold text-ink-900">
                          {c.publication_title}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="font-mono text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 border border-cream-300 text-ink-700 bg-cream-50">
                            {c.conclusion_tag}
                          </span>
                          {tagMatches === false && (
                            <span className="font-serif italic text-oxblood-700 text-xs">
                              tag mismatch — system will auto-reject
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <FleuronDivider className="my-5" />

            {/* Verdict picker */}
            <section className="mb-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700 mb-2">
                Your verdict
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className={`border p-3 cursor-pointer ${
                  verdict === 'approve' ? 'border-gold-500 bg-cream-50' : 'border-cream-300'
                }`}>
                  <input
                    type="radio" name="verdict" value="approve"
                    checked={verdict === 'approve'}
                    onChange={() => setVerdict('approve')}
                    className="mr-2"
                  />
                  <span className="font-display font-semibold text-ink-900">Approve</span>
                  <p className="font-serif italic text-ink-700 text-sm mt-1">
                    You believe the evidence supports the conclusion.
                  </p>
                </label>
                <label className={`border p-3 cursor-pointer ${
                  verdict === 'revise' ? 'border-verdigris-500 bg-cream-50' : 'border-cream-300'
                }`}>
                  <input
                    type="radio" name="verdict" value="revise"
                    checked={verdict === 'revise'}
                    onChange={() => setVerdict('revise')}
                    className="mr-2"
                  />
                  <span className="font-display font-semibold text-ink-900">Revise &amp; Resubmit</span>
                  <p className="font-serif italic text-ink-700 text-sm mt-1">
                    Flag cards to drop and/or add cards from your hand. The writer decides at year-end.
                  </p>
                </label>
                <label className={`border p-3 cursor-pointer ${
                  verdict === 'reject' ? 'border-oxblood-500 bg-cream-50' : 'border-cream-300'
                }`}>
                  <input
                    type="radio" name="verdict" value="reject"
                    checked={verdict === 'reject'}
                    onChange={() => setVerdict('reject')}
                    className="mr-2"
                  />
                  <span className="font-display font-semibold text-ink-900">Reject</span>
                  <p className="font-serif italic text-ink-700 text-sm mt-1">
                    Flag at least one card that doesn't fit. Other reviewers may still approve.
                  </p>
                </label>
              </div>
              {verdict === 'reject' && flagged.size === 0 && (
                <p className="font-serif italic text-oxblood-700 text-sm mt-2">
                  Flag at least one evidence card to reject.
                </p>
              )}
              {verdict === 'revise' && flagged.size === 0 && added.size === 0 && (
                <p className="font-serif italic text-oxblood-700 text-sm mt-2">
                  Flag a card to drop or add a card from your hand to propose a revision.
                </p>
              )}
            </section>

            {/* Comment */}
            <section className="mb-4">
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700">
                  Comment (optional)
                </span>
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

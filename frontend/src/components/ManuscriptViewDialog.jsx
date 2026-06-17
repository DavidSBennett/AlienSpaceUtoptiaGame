import { useEffect } from 'react';

import CornerOrnament from './CornerOrnament.jsx';
import FleuronDivider from './FleuronDivider.jsx';

/**
 * ManuscriptViewDialog — read-only view of the WRITER's own submitted
 * manuscript. Shows the conclusion at the top, then an organized table of
 * every evidence card (title + source details + content), so the writer can
 * answer reviewers' questions about their work during discussion.
 *
 * Props:
 *   submission — a your_submissions entry, enriched with:
 *       { kind, year_submitted, status,
 *         conclusion: { title, description },
 *         evidence: [{ idCard, title, content, author, date,
 *                      source_type, significance }] }
 *   onClose    — () => void
 */
export default function ManuscriptViewDialog({ submission, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && onClose) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const evidence = Array.isArray(submission.evidence) ? submission.evidence : [];
  const conclusion = submission.conclusion || { title: submission.conclusion_title };
  const statusLabel =
    submission.status && submission.status !== 'pending'
      ? submission.status
      : 'awaiting review';

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
                Your Manuscript
              </p>
              <h2 className="font-display text-2xl font-bold text-ink-900 capitalize">
                {submission.kind || 'Manuscript'}
              </h2>
              <p className="font-serif italic text-ink-700 text-sm mt-1">
                Submitted year {submission.year_submitted} · {evidence.length} evidence card{evidence.length === 1 ? '' : 's'} · {statusLabel}
              </p>
            </div>

            <FleuronDivider className="my-5" />

            {/* Conclusion */}
            <section className="mb-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700 mb-1">
                Conclusion
              </div>
              <div className="font-display text-xl text-ink-900">
                {conclusion?.title || 'Untitled'}
              </div>
              {conclusion?.description && (
                <p className="font-serif italic text-ink-700 mt-1">
                  {conclusion.description}
                </p>
              )}
            </section>

            {/* Evidence table */}
            <section>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700 mb-2">
                Evidence ({evidence.length})
              </div>

              {evidence.length === 0 ? (
                <p className="font-serif italic text-ink-700">
                  No evidence cards on this manuscript.
                </p>
              ) : (
                <div className="border border-cream-300 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-cream-100 border-b border-gold-500/30">
                        <th className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-700 px-3 py-2 w-8">#</th>
                        <th className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-700 px-3 py-2 w-1/3">Title &amp; Source</th>
                        <th className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-700 px-3 py-2">Content</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evidence.map((card, i) => (
                        <tr
                          key={card.idCard ?? i}
                          className={i % 2 === 0 ? 'bg-cream-50' : 'bg-cream-100'}
                        >
                          <td className="align-top px-3 py-3 font-mono text-xs text-ink-700 border-b border-cream-300">
                            {i + 1}
                          </td>
                          <td className="align-top px-3 py-3 border-b border-cream-300">
                            <div className="font-display font-semibold text-ink-900 leading-snug">
                              {card.title}
                            </div>
                            {card.author && (
                              <div className="font-serif italic text-ink-700 text-sm">
                                by {card.author}
                              </div>
                            )}
                            {(card.source_type || card.date) && (
                              <div className="font-mono text-[10px] uppercase tracking-wider text-ink-700/70 mt-1">
                                {[card.source_type, card.date].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </td>
                          <td className="align-top px-3 py-3 border-b border-cream-300 font-serif text-ink-900 text-sm leading-relaxed whitespace-pre-wrap">
                            {card.content
                              ? card.content
                              : <span className="italic text-ink-700/60">—</span>}
                            {card.significance && (
                              <div className="mt-2 text-ink-700 text-xs italic border-l-2 border-gold-500/40 pl-2">
                                {card.significance}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </article>
      </div>
    </div>
  );
}

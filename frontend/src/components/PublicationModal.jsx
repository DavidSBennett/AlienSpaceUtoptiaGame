/**
 * PublicationModal — opens when a player left-clicks a spine in the
 * MultiplayerBookshelf. Shows everything a player needs to decide
 * whether to cite this book in their own argument, EXCEPT the
 * conclusion's argument tag code (the bureaucratic letter like 'a' or
 * 's'). The user has to gamble on the thesis text, evidence titles,
 * author, year, and prestige to judge whether the book's topic
 * actually fits their own conclusion.
 *
 * Shown:
 *   - Publication title + kind (book / article)
 *   - Writer name + year + prestige granted
 *   - Conclusion title (the book's thesis — its actual argument)
 *   - Evidence cards used (title + author only, no per-card tags)
 *   - Citations the book itself referenced (title + author + year)
 *
 * Hidden:
 *   - conclusion_tag code
 *   - per-evidence tag codes
 *
 * Props:
 *   work     — a published_works entry (must include conclusion_title)
 *   onClose  — () => void
 */
import { colorForSeat } from '../lib/playerColors.js';

export default function PublicationModal({ work, onClose }) {
  if (!work) return null;

  const col = colorForSeat(work.writer_seat);
  const isBook = work.kind === 'book';
  const snapshot = work.evidence_snapshot || [];
  const evidenceCards = snapshot.filter((s) => (s.kind ?? 'card') === 'card');
  const citations = snapshot.filter((s) => s.kind === 'citation');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/85 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto surface-paper border-2 border-gold-500 shadow-card-hover"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header bar — colored by the writer's seat color */}
        <div className={`px-6 py-3 ${col.spineBg} border-b border-gold-500/40`}>
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <div className={`font-mono text-[10px] uppercase tracking-[0.25em] ${col.accent} mb-1`}>
                {isBook ? 'Book' : 'Article'} · Year {work.year_published}
              </div>
              <h2 className="font-display text-2xl text-cream-50 leading-tight">
                {work.publication_title}
              </h2>
              <div className={`font-serif italic text-sm ${col.accent} mt-1`}>
                by {work.writer_name}
              </div>
            </div>
            <button
              onClick={onClose}
              className="font-mono text-xs uppercase tracking-wider text-cream-200/70 hover:text-cream-50"
              aria-label="Close"
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">

          {/* Thesis — the conclusion's title, what the book argues. The
              tag code itself is deliberately omitted. */}
          {work.conclusion_title && (
            <section>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700 mb-1">
                Thesis
              </div>
              <p className="font-display text-lg text-ink-900 leading-snug">
                {work.conclusion_title}
              </p>
            </section>
          )}

          {/* Stats */}
          <section className="flex gap-6 py-3 border-y border-cream-300">
            <Stat label="Prestige" value={`+${work.prestige_granted}`} />
            <Stat label="Evidence" value={`${work.evidence_count} card${work.evidence_count === 1 ? '' : 's'}`} />
            {citations.length > 0 && (
              <Stat label="Cites" value={`${citations.length} work${citations.length === 1 ? '' : 's'}`} />
            )}
          </section>

          {/* Evidence — titles and authors only, no tag codes */}
          {evidenceCards.length > 0 && (
            <section>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700 mb-2">
                Evidence used
              </div>
              <ul className="space-y-1.5">
                {evidenceCards.map((ev, i) => (
                  <li key={`ev-${i}`} className="flex items-start gap-2 text-sm">
                    <span className="font-mono text-gold-700/60 mt-0.5">›</span>
                    <span>
                      <span className="font-display text-ink-900">{ev.title}</span>
                      {ev.author && (
                        <span className="font-serif italic text-ink-700"> — {ev.author}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Citations the book itself made — these chain through. */}
          {citations.length > 0 && (
            <section>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700 mb-2">
                Citations
              </div>
              <ul className="space-y-1.5">
                {citations.map((c, i) => (
                  <li key={`cite-${i}`} className="flex items-start gap-2 text-sm">
                    <span className="font-mono text-verdigris-600 mt-0.5">🔗</span>
                    <span>
                      <span className="font-display text-ink-900">{c.title}</span>
                      {c.author && (
                        <span className="font-serif italic text-ink-700"> — {c.author}</span>
                      )}
                      {c.cited_year && (
                        <span className="font-mono text-ink-700/60 text-xs"> (y{c.cited_year})</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Footer hint */}
          <p className="font-serif italic text-xs text-ink-700 border-t border-cream-300 pt-3">
            Drag the spine onto one of your projects to cite this work. Whether the citation
            holds up is up to you — read the thesis, the evidence, and the author. There is
            no shortcut.
          </p>
        </div>
      </div>
    </div>
  );
}


function Stat({ label, value }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-700/70">
        {label}
      </div>
      <div className="font-display text-xl text-ink-900 leading-none mt-0.5">
        {value}
      </div>
    </div>
  );
}

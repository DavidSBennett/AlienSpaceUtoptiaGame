/**
 * CitationThumbnail — a compact card-like tile representing a citation
 * to a published work.
 *
 * Renders smaller and styled by the cited author's color, with a "🔗 cite"
 * tag instead of the usual source-type tag.
 *
 * Used in project rows alongside evidence cards.
 *
 * Props:
 *   citation  — { citation_id, cited_work_id, title, year_published, work_kind,
 *                 writer_name, writer_seat, conclusion_tag }
 *   isInvalid — bool, true when the citation's conclusion_tag doesn't match
 *               the project's conclusion. Visual mismatch indicators
 *               (oxblood border + ⚠ ribbon + ⚠ in tooltip) are ONLY
 *               shown when `showTags` is also true. By default the
 *               player can't see whether a citation is a mismatch —
 *               they're gambling on context clues, and the auto-reject
 *               at publish time is the consequence. Turning the header
 *               tags toggle on reveals all the underlying tag logic.
 *   showTags  — bool, when true reveal tag-coded UI (mismatch ribbons
 *               on citations, tier labels on the conclusion rail, etc.)
 *   onClick   — optional click handler
 */
import { colorForSeat } from '../lib/playerColors.js';

export default function CitationThumbnail({ citation, isInvalid = false, showTags = false, onClick, dragHandleProps }) {
  const col = colorForSeat(citation.writer_seat);
  const isBook = citation.work_kind === 'book';
  const showMismatch = isInvalid && showTags;
  // Avoid suggesting interactivity the parent didn't wire up. Without
  // onClick we render as a non-interactive button (no cursor change,
  // no focus halo) — still a button for a11y consistency with the
  // clickable variants.
  const interactive = typeof onClick === 'function';

  return (
    <button
      type="button"
      onClick={onClick}
      title={showMismatch
        ? `Citation: "${citation.title}" — TAG MISMATCH. Submitting will auto-reject. Right-click to remove.`
        : `Citation: "${citation.title}" by ${citation.writer_name}, year ${citation.year_published}`}
      className={`
        relative w-32 h-44 flex-shrink-0
        border-2 ${showMismatch ? 'border-oxblood-500' : col.spineEdge} ${col.accentBg}
        ${interactive ? 'hover:shadow-card-hover transition-all duration-200 ease-desk cursor-pointer' : 'cursor-default'}
        text-left
      `}
      {...dragHandleProps}
    >
      {/* Inner gilt border */}
      <span className="absolute inset-1 border border-gold-500/30 pointer-events-none" />

      {/* Color spine on the left edge */}
      <span className={`absolute top-1 bottom-1 left-1 w-1.5 ${col.spineBg}`} aria-hidden="true" />

      {/* Warning corner ribbon for invalid citations — only visible
          with showTags on. Without it, the player doesn't know they've
          added a mismatched cite. They find out at publish time. */}
      {showMismatch && (
        <span
          className="absolute top-1 right-1 font-mono text-[8px] uppercase tracking-wider bg-oxblood-700 text-cream-50 px-1 py-0.5"
          aria-label="Citation tag mismatch — submission will auto-reject"
        >
          ⚠ mismatch
        </span>
      )}

      <div className="absolute inset-0 px-3 py-2 pl-5 flex flex-col">
        {/* Cite tag at top */}
        <div className="flex items-center gap-1 mb-1">
          <span className={`font-mono text-[8px] uppercase tracking-[0.15em] px-1 py-0.5 border ${col.spineEdge} ${col.accent}`}>
            🔗 cite
          </span>
          <span className={`font-mono text-[8px] uppercase tracking-wider ${col.accent}`}>
            {isBook ? 'book' : 'article'}
          </span>
        </div>

        {/* Title */}
        <div className="font-display text-xs leading-tight text-cream-50 line-clamp-4 mt-1">
          {citation.title}
        </div>

        {/* Author + year at bottom */}
        <div className="mt-auto">
          <div className={`font-serif italic text-[10px] ${col.accent} truncate`}>
            {citation.writer_name}
          </div>
          <div className={`font-mono text-[9px] ${showMismatch ? 'text-oxblood-300' : 'text-cream-200/70'}`}>
            y{citation.year_published}
            {showTags && citation.conclusion_tag && ` · ${citation.conclusion_tag}`}
          </div>
        </div>
      </div>
    </button>
  );
}

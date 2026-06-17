/**
 * Project-slot spine treatments for evidence cards and conclusions.
 *
 * When a card is placed in a project slot, we render it as a thin
 * vertical book-spine instead of a full card. The title rotates 90°
 * and reads bottom-to-top, multi-line if needed.
 *
 * Design choice (Option A): fixed-width spines. Titles wrap onto
 * multiple vertical lines for long titles. This keeps the project
 * row layout predictable as you add and remove cards.
 *
 * Two variants:
 *   - EvidenceSpine: 28px wide, parchment-cream, gold-edged.
 *   - ConclusionProjectSpine: 36px wide, slightly taller, deeper
 *     border-color so it reads as the "anchor" of the project.
 *
 * Both: left click = open modal, right click = caller-provided
 * handler (return to hand / shelf). Wrapped externally in a
 * DraggableCard for drag-out.
 */

export function EvidenceSpine({ card, onClick, dragHandleProps }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={card.title}
      {...dragHandleProps}
      className="
        relative w-7 h-44 flex-shrink-0
        bg-cream-100 border-2 border-gold-700
        hover:bg-cream-50 hover:border-gold-500
        transition-colors duration-200 ease-desk
        cursor-grab active:cursor-grabbing
        overflow-hidden
      "
    >
      {/* Inner gilt border to evoke a tooled-leather book spine */}
      <span className="absolute inset-0.5 border border-gold-500/40 pointer-events-none" />
      <span
        className="
          absolute inset-0 flex items-center justify-center
          font-display text-[10px] leading-tight text-ink-900
          px-0.5
        "
        style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          lineHeight: '1.1',
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
          textAlign: 'center',
        }}
      >
        {card.title}
      </span>
    </button>
  );
}


export function ConclusionProjectSpine({ card, onClick, dragHandleProps }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={card.title}
      {...dragHandleProps}
      className="
        relative w-9 h-44 flex-shrink-0
        bg-cream-50 border-2 border-oxblood-700
        hover:bg-cream-100 hover:border-oxblood-500
        transition-colors duration-200 ease-desk
        cursor-grab active:cursor-grabbing
        overflow-hidden
      "
    >
      {/* Double border — outer oxblood, inner gold — to mark the conclusion
          as visually heavier than evidence spines */}
      <span className="absolute inset-0.5 border border-gold-500/60 pointer-events-none" />
      <span
        className="
          absolute inset-0 flex items-center justify-center
          font-display text-[11px] leading-tight text-ink-900 font-medium
          px-0.5
        "
        style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          lineHeight: '1.15',
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
          textAlign: 'center',
        }}
      >
        {card.title}
      </span>
    </button>
  );
}

// Default export = EvidenceSpine (most common use)
export default EvidenceSpine;

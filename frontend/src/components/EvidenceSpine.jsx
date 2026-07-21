/**
 * Project-slot treatments for evidence cards and conclusions.
 *
 * A card placed in a project renders as a small sticky-tag rectangle: a
 * label with a coloured edge and HORIZONTAL text, sized to sit several to a
 * row without driving the project's height.
 *
 * These were vertical book-spines with rotated text. Spines read well at
 * 11rem, but the project rows now cap at the height of the conclusion shelf,
 * and rotated text in a 3.5rem-tall sliver was unreadable — a few characters
 * turned on their side. Horizontal text in a wider, shorter tag fits the same
 * height and can actually be skimmed.
 *
 * Two variants:
 *   - EvidenceSpine: cream tag, gold edge.
 *   - ConclusionProjectSpine: brighter tag, oxblood edge, so it reads as the
 *     anchor of the project.
 *
 * Both: left click = open modal, right click = caller-provided handler (return
 * to hand / shelf). Wrapped externally in a DraggableCard for drag-out.
 *
 * Both carry the same rich hover tooltip the cards use. A tag shows a
 * truncated title, so the tooltip is how you identify one — and the native
 * `title` attribute doesn't survive here, because dnd-kit's pointer handling
 * on the drag handle suppresses it.
 */
import Tooltip from './Tooltip.jsx';
import { cardFaceTooltip } from './Card.jsx';

export function EvidenceSpine({ card, onClick, dragHandleProps }) {
  return (
    <Tooltip content={cardFaceTooltip(card)} side="top" width="w-72" delay={200} className="shrink-0">
      <button
        type="button"
        onClick={onClick}
        {...dragHandleProps}
        className="
          relative w-28 h-14 flex-shrink-0
          bg-cream-100 border border-gold-700
          hover:bg-cream-50 hover:border-gold-500
          transition-colors duration-200 ease-desk
          cursor-grab active:cursor-grabbing
          overflow-hidden
        "
      >
        {/* Coloured edge down the left, like the tab of a filed card */}
        <span className="absolute top-0 bottom-0 left-0 w-1 bg-gold-700" aria-hidden="true" />
        <span className="absolute inset-0 pl-2 pr-1.5 py-1 flex items-center justify-center">
          <span className="font-display text-[10px] leading-tight text-center text-ink-900 line-clamp-3">
            {card.title}
          </span>
        </span>
      </button>
    </Tooltip>
  );
}


export function ConclusionProjectSpine({ card, onClick, dragHandleProps }) {
  return (
    <Tooltip content={cardFaceTooltip(card)} side="top" width="w-72" delay={200} className="shrink-0">
      <button
        type="button"
        onClick={onClick}
        {...dragHandleProps}
        className="
          relative w-28 h-14 flex-shrink-0
          bg-cream-50 border-2 border-oxblood-700
          hover:bg-cream-100 hover:border-oxblood-500
          transition-colors duration-200 ease-desk
          cursor-grab active:cursor-grabbing
          overflow-hidden text-left
        "
      >
        <span className="absolute top-0 bottom-0 left-0 w-1.5 bg-oxblood-700" aria-hidden="true" />
        <span className="absolute inset-0 pl-2.5 pr-1.5 py-1 flex items-center">
          <span className="font-display text-[10px] leading-tight font-medium text-ink-900 line-clamp-3">
            {card.title}
          </span>
        </span>
      </button>
    </Tooltip>
  );
}

// Default export = EvidenceSpine (most common use)
export default EvidenceSpine;

/**
 * HandSlot — a drop target wrapping one hand card, enabling drag-to-reorder
 * within the Research Notebook. Dropping a hand card onto another card's slot
 * places it just before that card (handled in each board's handleDragEnd).
 * Highlights while a card hovers over it.
 *
 * Shared by solo and multiplayer. The two boards each had their own copy; they
 * had drifted apart on the ring offset colour, so the same drag read slightly
 * differently depending on which game you were in. The notebook surface is
 * wood in both, so the offset matches it.
 */
import { useDroppable } from '@dnd-kit/core';

export default function HandSlot({ index, cardId, children }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `handslot-${cardId}`,
    data: { to: { kind: 'handReorder', index, cardId } },
  });
  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 rounded-sm transition-shadow ${
        isOver ? 'ring-2 ring-gold-400 ring-offset-2 ring-offset-wood-900' : ''
      }`}
    >
      {children}
    </div>
  );
}

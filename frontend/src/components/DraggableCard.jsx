import { useDraggable } from '@dnd-kit/core';

/**
 * DraggableCard — wraps a card-rendering child to make it draggable.
 *
 * Uses @dnd-kit's useDraggable hook. The `id` is a unique drag identifier;
 * the `data` payload travels with the drag event so the drop handler knows
 * which card came from where.
 *
 * The wrapper does NOT render the card itself — it expects a render-prop
 * function as its child, called with { dragHandleProps, isDragging }.
 * That keeps the card rendering separate from drag concerns.
 *
 * Example:
 *   <DraggableCard id="card-123" data={{ cardId: 123, from: { kind: 'hand' }}}>
 *     {({ dragHandleProps, isDragging }) => (
 *       <div {...dragHandleProps}>
 *         <CardThumbnail card={card} isDragging={isDragging} />
 *       </div>
 *     )}
 *   </DraggableCard>
 *
 * @param {string} id        unique drag identifier (typically `card-${cardId}-${zone}`)
 * @param {object} data      payload that travels with the drag event
 * @param {function} children  render-prop receiving drag state
 */
export default function DraggableCard({ id, data, children, disabled = false }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data,
    disabled,
  });

  // Note: we deliberately do NOT apply the transform to the original element.
  // The Game page renders a <DragOverlay> at the top level that shows the
  // moving preview portaled to body. The original element stays in place
  // (typically with reduced opacity via the consumer's `isDragging` styling)
  // so that drag previews are never clipped by ancestor overflow.
  const dragHandleProps = disabled
    ? { ref: setNodeRef }
    : { ref: setNodeRef, ...listeners, ...attributes };

  return children({ dragHandleProps, isDragging, disabled });
}

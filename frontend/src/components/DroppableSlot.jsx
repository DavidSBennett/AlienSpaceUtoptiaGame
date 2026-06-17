import { useDroppable } from '@dnd-kit/core';

/**
 * DroppableSlot — wraps a card-shaped impression to make it a drop target.
 *
 * Renders the slot impression itself (the wooden recess) and shows a gold
 * highlight when a draggable hovers over it. The `data` payload is passed
 * to the drag-end handler so it knows where the card was dropped.
 *
 * @param {string} id        unique drop identifier
 * @param {object} data      payload describing this drop zone
 * @param {string} className extra Tailwind classes for the slot
 * @param {object} style     inline styles (height, etc.)
 * @param {ReactNode} children  optional content rendered inside the slot
 *                              (e.g., placeholder label)
 */
export default function DroppableSlot({
  id,
  data,
  className = '',
  style,
  children,
}) {
  const { isOver, setNodeRef } = useDroppable({ id, data });

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        ${isOver ? 'slot-impression-active' : 'slot-impression'}
        transition-all duration-150 ease-desk
        ${className}
      `}
    >
      {children}
    </div>
  );
}

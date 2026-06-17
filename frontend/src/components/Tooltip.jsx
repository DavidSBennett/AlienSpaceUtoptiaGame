/**
 * src/components/Tooltip.jsx
 *
 * Lightweight tooltip wrapper. Wraps any element and shows a styled
 * tooltip on hover/focus. Supports rich content (not just text) for
 * multi-line explanations.
 *
 * Implementation: pure CSS via group-hover + opacity transition. No
 * positioning engine, no portal — keeps the bundle small. The
 * trade-off is that tooltips render inside the parent's stacking
 * context, so they can be clipped by `overflow: hidden` ancestors.
 * If we hit that, we can swap to a portal-based positioner later.
 *
 * Props:
 *   content  — string or ReactNode (the tooltip body)
 *   children — the element to attach the tooltip to
 *   side     — 'top' | 'bottom' | 'left' | 'right'  (default 'top')
 *   align    — 'start' | 'center' | 'end'           (default 'center')
 *   width    — Tailwind w-* class (default 'w-64')
 *   delay    — Hover-show delay class (default 'delay-300')
 *
 * Usage:
 *   <Tooltip content="Influence boosts every publication's prestige.">
 *     <button>Influence</button>
 *   </Tooltip>
 */
const SIDE_CLASSES = {
  top:    'bottom-full mb-2',
  bottom: 'top-full mt-2',
  left:   'right-full mr-2 top-1/2 -translate-y-1/2',
  right:  'left-full ml-2 top-1/2 -translate-y-1/2',
};

const ALIGN_CLASSES = {
  top: {
    start:  'left-0',
    center: 'left-1/2 -translate-x-1/2',
    end:    'right-0',
  },
  bottom: {
    start:  'left-0',
    center: 'left-1/2 -translate-x-1/2',
    end:    'right-0',
  },
  left:   { start: '', center: '', end: '' },
  right:  { start: '', center: '', end: '' },
};

export default function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  width = 'w-64',
  delay = 'delay-200',
}) {
  if (!content) return children;
  const sideClass = SIDE_CLASSES[side] || SIDE_CLASSES.top;
  const alignClass = (ALIGN_CLASSES[side] || ALIGN_CLASSES.top)[align] || '';

  return (
    <span className="relative inline-flex group">
      {children}
      <span
        role="tooltip"
        className={`
          absolute z-50 ${sideClass} ${alignClass} ${width}
          pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100
          transition-opacity duration-150 ${delay}
          border border-gold-500/50 bg-ink-900/95 backdrop-blur-sm
          px-3 py-2 text-cream-50
          font-serif text-xs leading-snug
          shadow-card-hover
        `}
      >
        {content}
      </span>
    </span>
  );
}

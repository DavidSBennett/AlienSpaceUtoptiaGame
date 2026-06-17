/**
 * src/components/Tooltip.jsx
 *
 * Lightweight tooltip wrapper. Wraps any element and shows a styled
 * tooltip on hover/focus. Supports rich content (not just text) for
 * multi-line explanations.
 *
 * Implementation: the tooltip body is rendered through a PORTAL to
 * document.body with `position: fixed`, positioned from the trigger's
 * bounding rect. This deliberately escapes the parent's stacking and
 * `overflow` context, so the tooltip is never clipped by an
 * `overflow-x-auto` / `overflow: hidden` ancestor (e.g. the horizontally
 * scrolling "Library of Publications" rail) and always lays on top.
 *
 * Props:
 *   content  — string or ReactNode (the tooltip body)
 *   children — the element to attach the tooltip to
 *   side     — 'top' | 'bottom' | 'left' | 'right'  (default 'top')
 *   align    — 'start' | 'center' | 'end'           (default 'center')
 *   width    — Tailwind w-* class (default 'w-64')
 *   delay    — hover-show delay; accepts a number (ms) or the legacy
 *              Tailwind class string like 'delay-200' (default 200ms)
 *
 * Usage:
 *   <Tooltip content="Influence boosts every publication's prestige.">
 *     <button>Influence</button>
 *   </Tooltip>
 */
import { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

const GAP = 8; // px gap between the trigger and the tooltip

/**
 * Compute a fixed-position style for the tooltip from the trigger's
 * bounding rect. We position by an anchor point + a CSS transform so we
 * don't need to know the tooltip's own size ahead of time.
 */
function positionFor(side, align, r) {
  let top;
  let left;
  let tx = '0';
  let ty = '0';

  if (side === 'left' || side === 'right') {
    ty = '-50%';
    top = r.top + r.height / 2;
    if (side === 'left') { left = r.left - GAP; tx = '-100%'; }
    else { left = r.right + GAP; tx = '0'; }
  } else {
    // top / bottom
    if (side === 'bottom') { top = r.bottom + GAP; ty = '0'; }
    else { top = r.top - GAP; ty = '-100%'; }

    if (align === 'start') { left = r.left; tx = '0'; }
    else if (align === 'end') { left = r.right; tx = '-100%'; }
    else { left = r.left + r.width / 2; tx = '-50%'; }
  }

  return { top: `${top}px`, left: `${left}px`, transform: `translate(${tx}, ${ty})` };
}

/** Accept a number (ms) or a Tailwind 'delay-200'-style class. */
function parseDelayMs(delay) {
  if (typeof delay === 'number') return delay;
  const m = /(\d+)/.exec(String(delay ?? ''));
  return m ? parseInt(m[1], 10) : 200;
}

export default function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  width = 'w-64',
  delay = 200,
}) {
  const triggerRef = useRef(null);
  const timerRef = useRef(null);
  const [show, setShow] = useState(false);
  const [coords, setCoords] = useState(null);

  const delayMs = parseDelayMs(delay);

  // Recompute position whenever the tooltip becomes visible, and keep it
  // pinned to the trigger while scrolling/resizing.
  useLayoutEffect(() => {
    if (!show || !triggerRef.current) return undefined;
    const measure = () => {
      const el = triggerRef.current;
      if (!el) return;
      setCoords(positionFor(side, align, el.getBoundingClientRect()));
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [show, side, align]);

  // Early-out AFTER hooks so hook order stays stable across renders.
  if (!content) return children;

  const open = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShow(true), delayMs);
  };
  const close = () => {
    clearTimeout(timerRef.current);
    setShow(false);
  };

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
    >
      {children}
      {show && coords && createPortal(
        <span
          role="tooltip"
          style={{ position: 'fixed', top: coords.top, left: coords.left, transform: coords.transform }}
          className={`
            ${width} z-[9999] pointer-events-none
            border border-gold-500/50 bg-ink-900/95 backdrop-blur-sm
            px-3 py-2 text-cream-50
            font-serif text-xs leading-snug
            shadow-card-hover
          `}
        >
          {content}
        </span>,
        document.body,
      )}
    </span>
  );
}

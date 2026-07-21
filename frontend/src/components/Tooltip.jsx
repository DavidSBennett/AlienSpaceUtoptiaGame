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
 * Positioning measures the rendered tooltip's own box and CLAMPS it to the
 * viewport, so a wide tooltip anchored to an element near a screen edge
 * (e.g. the first/leftmost book spine) stays fully on screen instead of
 * running off the edge.
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

const GAP = 8;    // px gap between the trigger and the tooltip
const MARGIN = 8; // px minimum distance the tooltip keeps from the viewport edge

/**
 * Compute a fixed-position {top,left} for the tooltip from the trigger's
 * rect and the tooltip's measured size, then clamp it to the viewport so
 * it never runs off screen. Returns pixel values (no CSS transform, so the
 * clamp is exact).
 */
function positionFor(side, align, r, tipW, tipH, vw, vh) {
  let top;
  let left;

  if (side === 'left' || side === 'right') {
    top = r.top + r.height / 2 - tipH / 2;
    left = side === 'left' ? r.left - GAP - tipW : r.right + GAP;
  } else {
    // top / bottom
    top = side === 'bottom' ? r.bottom + GAP : r.top - GAP - tipH;
    if (align === 'start') left = r.left;
    else if (align === 'end') left = r.right - tipW;
    else left = r.left + r.width / 2 - tipW / 2;
  }

  // Keep the whole box inside the viewport (edges win over the anchor).
  left = Math.max(MARGIN, Math.min(left, vw - tipW - MARGIN));
  top = Math.max(MARGIN, Math.min(top, vh - tipH - MARGIN));

  return { top: `${top}px`, left: `${left}px` };
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
  // Extra classes for the wrapper span. The wrapper becomes the flex item in
  // place of whatever it wraps, so a trigger that relied on its own flex
  // classes (shrink-0 in a scrolling rail, say) needs them passed through here.
  className = '',
}) {
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const timerRef = useRef(null);
  const [show, setShow] = useState(false);
  const [coords, setCoords] = useState(null);

  const delayMs = parseDelayMs(delay);

  // Once visible, measure the trigger AND the tooltip's own size so we can
  // place it and clamp it to the viewport. Re-run while scrolling/resizing.
  useLayoutEffect(() => {
    if (!show) return undefined;
    const measure = () => {
      const trigger = triggerRef.current;
      const tip = tooltipRef.current;
      if (!trigger || !tip) return;
      const r = trigger.getBoundingClientRect();
      setCoords(
        positionFor(side, align, r, tip.offsetWidth, tip.offsetHeight, window.innerWidth, window.innerHeight),
      );
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [show, side, align, content]);

  // Early-out AFTER hooks so hook order stays stable across renders.
  if (!content) return children;

  const open = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShow(true), delayMs);
  };
  const close = () => {
    clearTimeout(timerRef.current);
    setShow(false);
    setCoords(null);
  };

  return (
    <span
      ref={triggerRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
    >
      {children}
      {show && createPortal(
        <span
          ref={tooltipRef}
          role="tooltip"
          style={{
            position: 'fixed',
            top: coords ? coords.top : 0,
            left: coords ? coords.left : 0,
            // Hide for the first measuring pass so it can't flash off-edge.
            visibility: coords ? 'visible' : 'hidden',
          }}
          className={`
            ${width} max-w-[calc(100vw-16px)] z-[9999] pointer-events-none
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

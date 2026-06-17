/**
 * TutorialModal — the in-game modal that shows one tutorial entry.
 *
 * If the entry has a `targetAttr` AND the DOM contains an element with
 * `[data-tutorial="<targetAttr>"]`, the modal positions itself near that
 * element with a small arrow pointing to it AND draws a spotlight
 * highlight around the target. Otherwise the modal floats in the
 * center of the screen with text only.
 *
 * Modals are non-blocking: a translucent backdrop dims the rest of the
 * page but the player can still click around. A "Got it" button
 * dismisses the tutorial permanently (writes to localStorage via
 * markDismissed); a small "× close" button dismisses just for now
 * (won't persist, will re-fire on next eligible state).
 *
 * Props:
 *   tutorial    — the registry entry to show
 *   onDismiss   — () => void, dismiss permanently
 *   onClose     — () => void, dismiss just for now
 */
import { useEffect, useLayoutEffect, useState } from 'react';

const PADDING = 12;       // gap between target and modal
const VIEWPORT_MARGIN = 8; // keep modal off the viewport edges

export default function TutorialModal({ tutorial, onDismiss, onClose }) {
  // Position of the target element (if any). We re-measure on resize.
  const [targetRect, setTargetRect] = useState(null);

  useLayoutEffect(() => {
    if (!tutorial.targetAttr) {
      setTargetRect(null);
      return;
    }
    function measure() {
      const el = document.querySelector(`[data-tutorial="${tutorial.targetAttr}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        setTargetRect({
          top: r.top,
          left: r.left,
          width: r.width,
          height: r.height,
          right: r.right,
          bottom: r.bottom,
        });
      } else {
        setTargetRect(null);
      }
    }
    measure();
    // Re-measure on resize and on any layout-affecting event
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    // Repeat measurements in case the target mounts a tick late
    const t = setTimeout(measure, 100);
    const t2 = setTimeout(measure, 500);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [tutorial.id, tutorial.targetAttr]);

  // Compute modal position. If we have a target, place the modal near
  // it (preferring below; flip to above if there's no room). Otherwise
  // center it.
  const modalStyle = computeModalPosition(targetRect);

  return (
    <>
      {/* Backdrop — covers everything but is light enough that the
          target stays visible. Clicking the backdrop closes (temporary). */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-[100] bg-black/35 pointer-events-auto"
        aria-hidden="true"
      />

      {/* Spotlight halo around the target */}
      {targetRect && <Spotlight rect={targetRect} />}

      {/* The modal itself */}
      <div
        role="dialog"
        aria-labelledby="tutorial-title"
        className="
          fixed z-[101] max-w-sm
          surface-paper border-2 border-gold-500
          shadow-2xl p-4
        "
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3
            id="tutorial-title"
            className="font-display text-lg text-ink-900 leading-tight"
          >
            {tutorial.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tutorial (won't dismiss permanently)"
            className="font-mono text-lg text-ink-700 hover:text-ink-900 leading-none -mt-1"
          >
            ×
          </button>
        </div>

        <div className="font-serif text-sm text-ink-900 leading-snug mb-4">
          {tutorial.body}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="
              px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider
              bg-gold-500 hover:bg-gold-400 text-teal-950
              border border-gold-700
            "
          >
            Got it
          </button>
        </div>
      </div>
    </>
  );
}


/**
 * Decide where to draw the modal based on the target's bounding rect.
 * Returns a CSS-style object with `top`, `left`, and optional `transform`.
 */
function computeModalPosition(rect) {
  // Centered (no target)
  if (!rect) {
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const modalW = 320; // approximate; CSS max-width caps it
  const modalH = 220; // approximate

  // Try: below the target, horizontally centered on it
  let top = rect.bottom + PADDING;
  let left = rect.left + rect.width / 2 - modalW / 2;

  // Flip above if there's no room below
  if (top + modalH + VIEWPORT_MARGIN > vh) {
    top = rect.top - PADDING - modalH;
    // If above also won't fit (rare), push to bottom of viewport
    if (top < VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, vh - modalH - VIEWPORT_MARGIN);
    }
  }

  // Clamp horizontally
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - modalW - VIEWPORT_MARGIN));

  return { top: `${top}px`, left: `${left}px` };
}


/**
 * Spotlight — draws four overlay rectangles around the target so the
 * target itself is left visually un-dimmed, with a glowing border.
 *
 * Using four absolutely-positioned divs (one per side) gives us a
 * "cutout" effect without relying on CSS mix-blend-mode or SVG masks,
 * both of which have quirks across browsers.
 */
function Spotlight({ rect }) {
  const pad = 6;
  const r = {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
  return (
    <>
      {/* Glow ring */}
      <div
        className="fixed z-[100] pointer-events-none border-2 border-gold-400 shadow-[0_0_30px_8px_rgba(245,200,80,0.5)]"
        style={{
          top: r.top,
          left: r.left,
          width: r.width,
          height: r.height,
        }}
      />
    </>
  );
}

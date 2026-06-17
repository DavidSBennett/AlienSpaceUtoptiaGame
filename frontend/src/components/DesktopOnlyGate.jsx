import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import CornerOrnament from './CornerOrnament.jsx';
import FleuronDivider from './FleuronDivider.jsx';

/**
 * DesktopOnlyGate — short-circuits rendering on narrow viewports.
 *
 * The game UI assumes a desktop layout: a hand row, a multi-column
 * project rail, a bookshelf sidebar, a stats strip. None of it was
 * designed to reflow under 768px, and squishing it down produces
 * unplayably overlapping elements rather than something cramped-but-
 * usable.
 *
 * Rather than ship a half-broken mobile layout, we detect small
 * viewports and show a "please use a desktop" message with a link
 * back to home. The threshold (768px) is the Tailwind `md` breakpoint
 * — anything below that gets the gate, anything at or above goes
 * through.
 *
 * The detection uses matchMedia so it updates live if the user
 * rotates a tablet or resizes a window. SSR safety isn't a concern
 * (this is a Vite SPA), but the initial-render fallback (`true` for
 * "wide enough") matches what most desktop clients will see, so we
 * avoid a flash of the gate on slow first paints.
 *
 * Usage:
 *   <Route path="/game" element={
 *     <DesktopOnlyGate><Game /></DesktopOnlyGate>
 *   } />
 */
export default function DesktopOnlyGate({ children }) {
  const [wideEnough, setWideEnough] = useState(() => {
    // Initial check — assume desktop until proven otherwise. On the
    // server (or in a non-DOM environment) this stays true; useEffect
    // below corrects it on mount.
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia('(min-width: 768px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e) => setWideEnough(e.matches);
    setWideEnough(mq.matches);
    // Modern API
    if (mq.addEventListener) {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    // Safari < 14 fallback
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  if (wideEnough) return children;

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="relative max-w-md w-full">
        <div className="relative border border-gold-500/40 px-6 py-10 surface-binding">
          <div className="absolute inset-2 border border-gold-500/20 pointer-events-none" />
          <div className="absolute top-3 left-3 text-gold-400 pointer-events-none">
            <CornerOrnament corner="tl" size={24} />
          </div>
          <div className="absolute top-3 right-3 text-gold-400 pointer-events-none">
            <CornerOrnament corner="tr" size={24} />
          </div>
          <div className="absolute bottom-3 left-3 text-gold-400 pointer-events-none">
            <CornerOrnament corner="bl" size={24} />
          </div>
          <div className="absolute bottom-3 right-3 text-gold-400 pointer-events-none">
            <CornerOrnament corner="br" size={24} />
          </div>

          <div className="relative z-10 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-400 mb-3">
              The Historians
            </p>
            <h1 className="font-display text-3xl font-medium text-cream-50 leading-tight tracking-tight mb-2">
              Desktop only
            </h1>

            <FleuronDivider className="my-5" />

            <p className="font-serif italic text-cream-200/80 text-sm mb-6">
              The game's table, hand, and bookshelf need a wider workspace than
              a phone can comfortably provide. Please return on a laptop or
              desktop browser.
            </p>

            <Link to="/" className="btn-ghost inline-block">
              Return home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

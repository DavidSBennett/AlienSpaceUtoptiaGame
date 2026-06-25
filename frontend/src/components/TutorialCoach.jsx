import { useLayoutEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * TutorialCoach — the guidance layer for the in-game Guided Walkthrough.
 *
 * Per step, `step.mask` controls how interaction is restricted:
 *   'backdrop' — full dim that blocks everything; a CENTERED modal sits on top
 *                (used for the welcome / finish info steps).
 *   'hole'     — dim everything EXCEPT the spotlighted control, so only that
 *                one thing can be clicked (draw / publish / attend conference).
 *   'none'     — no blocking (drag-to-build steps, or when a game modal like
 *                the upgrade chooser / conference draft is already focused);
 *                a glow + instruction panel still guide the player.
 *
 * Props: step, index, total, onAdvance().
 */
export default function TutorialCoach({ step, index, total, onAdvance }) {
  const navigate = useNavigate();
  const [rect, setRect] = useState(null);

  useLayoutEffect(() => {
    if (!step?.target) { setRect(null); return; }
    function measure() {
      const el = document.querySelector(`[data-tutorial="${step.target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height, right: r.right, bottom: r.bottom });
          return;
        }
      }
      setRect(null);
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const t1 = setTimeout(measure, 120);
    const t2 = setTimeout(measure, 500);
    const iv = setInterval(measure, 600);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      clearTimeout(t1); clearTimeout(t2); clearInterval(iv);
    };
  }, [step?.id, step?.target]);

  if (!step) return null;
  const isOutro = index === total - 1;
  const mask = step.info ? 'backdrop' : (step.mask || 'none');

  return (
    <>
      {/* Full blocking backdrop for info steps. */}
      {mask === 'backdrop' && (
        <div className="fixed inset-0 z-[100] bg-ink-900/75 backdrop-blur-[2px] pointer-events-auto" />
      )}

      {/* Cutout mask: four dim strips around the target leave a clickable hole.
          If the target can't be found (e.g. it vanished after the action), we
          render NO mask — failing open so the player is never trapped. */}
      {mask === 'hole' && rect && <HoleMask rect={rect} />}

      {/* Spotlight glow around the target (hole/none steps). */}
      {mask !== 'backdrop' && rect && (
        <div
          className="fixed z-[103] pointer-events-none border-2 border-gold-400 rounded animate-pulse"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: '0 0 24px 6px rgba(245,200,80,0.7)' }}
        />
      )}

      {/* Centered modal for info steps. */}
      {step.info ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
          <div className="surface-paper border-2 border-gold-500 shadow-2xl max-w-md w-full px-7 py-6 pointer-events-auto text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-700 mb-2">
              Guided Walkthrough · step {Math.min(index + 1, total)} / {total}
            </p>
            <h3 className="font-display text-2xl text-ink-900 leading-tight">{step.title}</h3>
            <p className="font-serif text-sm text-ink-900 leading-snug mt-3">{step.body}</p>
            <div className="mt-5 flex justify-center">
              {isOutro ? (
                <button type="button" onClick={() => navigate('/')} className="btn-primary">Finish — back to home ✓</button>
              ) : (
                <button type="button" onClick={onAdvance} className="btn-primary">{step.cta || 'Next'}</button>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Compact instruction panel, bottom-right, for action/build steps. */
        <div className="fixed bottom-4 right-4 z-[110] w-[min(94vw,360px)] pointer-events-auto">
          <div className="surface-paper border-2 border-gold-500 shadow-2xl px-5 py-4">
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-gold-700">
                Guided Walkthrough · {Math.min(index + 1, total)} / {total}
              </span>
              <button type="button" onClick={() => navigate('/')} className="font-mono text-[10px] uppercase tracking-wider text-ink-700 hover:text-oxblood-600">Exit ✕</button>
            </div>
            <h3 className="font-display text-lg text-ink-900 leading-tight">{step.title}</h3>
            <p className="font-serif text-sm text-ink-900 leading-snug mt-1">{step.body}</p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="font-serif italic text-xs text-ink-700">Do the highlighted step to continue.</span>
              <button type="button" onClick={onAdvance} title="Skip this step if you’re stuck"
                className="font-mono text-[10px] uppercase tracking-wider text-ink-700/60 hover:text-ink-900">Skip ▸</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Four dim strips around `rect`, leaving the target itself clickable. */
function HoleMask({ rect }) {
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const top = Math.max(0, rect.top - pad);
  const left = Math.max(0, rect.left - pad);
  const right = Math.min(vw, rect.right + pad);
  const bottom = Math.min(vh, rect.bottom + pad);
  const cls = 'fixed z-[100] bg-ink-900/55 pointer-events-auto';
  return (
    <>
      <div className={cls} style={{ top: 0, left: 0, width: vw, height: top }} />
      <div className={cls} style={{ top: bottom, left: 0, width: vw, height: Math.max(0, vh - bottom) }} />
      <div className={cls} style={{ top, left: 0, width: left, height: bottom - top }} />
      <div className={cls} style={{ top, left: right, width: Math.max(0, vw - right), height: bottom - top }} />
    </>
  );
}

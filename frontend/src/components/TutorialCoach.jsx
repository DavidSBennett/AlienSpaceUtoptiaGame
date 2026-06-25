import { useLayoutEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * TutorialCoach — the guidance layer for in-game Tutorial mode.
 *
 * Non-blocking by design: gating is done by disabling the wrong turn buttons
 * (so drag-and-drop stays fully usable). The coach only (a) spotlights the
 * relevant control and (b) shows a fixed instruction panel at the bottom.
 *
 * Props:
 *   step      — the current script step
 *   index     — 0-based step index
 *   total     — total steps
 *   onAdvance — () => void, for info steps' button
 *   onExit    — () => void, leave the tutorial
 */
export default function TutorialCoach({ step, index, total, onAdvance, onExit }) {
  const navigate = useNavigate();
  const [rect, setRect] = useState(null);

  useLayoutEffect(() => {
    if (!step?.target) { setRect(null); return; }
    function measure() {
      const el = document.querySelector(`[data-tutorial="${step.target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      } else {
        setRect(null);
      }
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const t1 = setTimeout(measure, 120);
    const t2 = setTimeout(measure, 500);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      clearTimeout(t1); clearTimeout(t2);
    };
  }, [step?.id, step?.target]);

  if (!step) return null;
  const isOutro = index === total - 1;

  return (
    <>
      {/* Spotlight glow (no click blocking) */}
      {rect && (
        <div
          className="fixed z-[95] pointer-events-none border-2 border-gold-400 rounded animate-pulse"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: '0 0 24px 6px rgba(245,200,80,0.65)',
          }}
        />
      )}

      {/* Instruction panel — fixed bottom-center, narrow so it never covers
          the whole board. */}
      <div className="fixed bottom-4 right-4 z-[110] w-[min(94vw,360px)] pointer-events-auto">
        <div className="surface-paper border-2 border-gold-500 shadow-2xl px-5 py-4">
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-700">
              Tutorial · step {Math.min(index + 1, total)} / {total}
            </span>
            <button
              type="button"
              onClick={onExit || (() => navigate('/'))}
              className="font-mono text-[10px] uppercase tracking-wider text-ink-700 hover:text-oxblood-600"
            >
              Exit ✕
            </button>
          </div>
          <h3 className="font-display text-lg text-ink-900 leading-tight">{step.title}</h3>
          <p className="font-serif text-sm text-ink-900 leading-snug mt-1">{step.body}</p>

          <div className="mt-3 flex items-center justify-between gap-3">
            {step.info ? (
              isOutro ? (
                <div className="flex gap-2">
                  <button type="button" onClick={() => navigate('/')} className="btn-primary">Finish</button>
                  <button type="button" onClick={() => navigate('/game')} className="btn-ghost">Play a real game →</button>
                </div>
              ) : (
                <button type="button" onClick={onAdvance} className="btn-primary">{step.cta || 'Next'}</button>
              )
            ) : (
              <span className="font-serif italic text-xs text-ink-700">
                Do the highlighted step to continue.
              </span>
            )}
            {!step.info && (
              <button
                type="button"
                onClick={onAdvance}
                title="Skip this step if you’re stuck"
                className="font-mono text-[10px] uppercase tracking-wider text-ink-700/60 hover:text-ink-900"
              >
                Skip ▸
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

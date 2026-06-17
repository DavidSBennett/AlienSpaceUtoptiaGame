import { useEffect } from 'react';

/**
 * StageAdvancementToast — celebrates a career stage change.
 *
 * Slides in from the top of the screen, displays a brief congratulatory
 * message tailored to the advancement, then auto-dismisses after 5 seconds
 * (or on click). Non-blocking: the player can keep playing while it's up.
 *
 * Two display variants:
 *   - 'comps' kind: special celebratory message for passing comprehensive exams
 *   - default: generic stage-advancement message
 *
 * @param {Object}   advancement  { from, to, year, kind? }
 * @param {Function} onDismiss
 */
export default function StageAdvancementToast({ advancement, onDismiss }) {
  // Auto-dismiss after 5 seconds. The cleanup ensures we don't dismiss
  // a NEW advancement that comes in while the timer is still running for
  // the previous one — every change to `advancement` resets the timer.
  useEffect(() => {
    if (!advancement) return;
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [advancement, onDismiss]);

  if (!advancement) return null;

  const { headline, body } = copyForAdvancement(advancement);

  return (
    <button
      type="button"
      onClick={onDismiss}
      className="
        fixed top-4 left-1/2 -translate-x-1/2 z-[70]
        max-w-md w-full px-6
        animate-fade-up
      "
    >
      <div
        className="
          relative surface-paper px-6 py-4
          border border-gold-500/60
          flex items-center gap-4
          text-left cursor-pointer
          hover:shadow-card-hover transition-shadow
        "
        style={{
          boxShadow: '0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(184, 146, 58, 0.4)',
        }}
      >
        {/* Inner gilt rule */}
        <div className="absolute inset-1 border border-gold-500/30 pointer-events-none" />

        {/* Brass medallion icon */}
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gold-500 border-2 border-gold-600 flex items-center justify-center text-teal-950 font-display font-bold text-base">
          ★
        </div>

        <div className="flex-1 min-w-0 relative">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-700 mb-0.5">
            {headline}
          </p>
          <p className="font-display text-base font-bold text-ink-900 leading-tight">
            {body}
          </p>
        </div>
      </div>
    </button>
  );
}

/**
 * Generate the toast copy for a given advancement.
 *
 * The `kind: 'comps'` variant gets a more narrative-flavored message;
 * other transitions use a clean "promoted to X" line.
 */
function copyForAdvancement({ to, kind }) {
  if (kind === 'comps') {
    return {
      headline: 'Comprehensive Exams · Passed',
      body: 'The committee has approved your candidacy. You are now ABD.',
    };
  }

  const stageNames = {
    'graduate-student': 'Graduate Student',
    'abd': 'ABD',
    'assistant-professor': 'Assistant Professor',
    'associate-professor': 'Associate Professor',
    'full-professor': 'Full Professor',
    'endowed-professor': 'Endowed Professor',
  };

  const flavor = {
    'abd': 'Your committee has cleared you to begin dissertation research.',
    'assistant-professor': 'A tenure-track position has been offered. Welcome to the faculty.',
    'associate-professor': 'Tenure granted. Your position is secure.',
    'full-professor': 'You have been promoted to Full Professor.',
    'endowed-professor': 'You have been awarded an endowed chair — the highest honor of the academy.',
  };

  return {
    headline: 'Career Advancement',
    body: flavor[to] || `Promoted to ${stageNames[to] || to}.`,
  };
}

/**
 * src/components/Toast.jsx
 *
 * Toast notifications, styled to match the single-player StageAdvancementToast:
 * a top-center stack of parchment cards with a gilt rule and a brass medallion.
 * Driven by the useToasts() hook (lib/toasts.js).
 *
 * Each toast auto-dismisses after its duration (default 5s, matching solo) or
 * on click. Toasts stack vertically, newest at the bottom.
 *
 * Variants: 'default' (gold ★), 'success' (verdigris ✓), 'warning' (oxblood ✕).
 */
import { useEffect } from 'react';
import { useToasts } from '../lib/toasts.js';

const VARIANT = {
  default: {
    border: 'border-gold-500/60',
    medallion: 'bg-gold-500 border-gold-600 text-teal-950',
    icon: '★',
  },
  success: {
    border: 'border-verdigris-500/60',
    medallion: 'bg-verdigris-500 border-verdigris-600 text-cream-50',
    icon: '✓',
  },
  warning: {
    border: 'border-oxblood-500/60',
    medallion: 'bg-oxblood-500 border-oxblood-600 text-cream-50',
    icon: '✕',
  },
};

export default function ToastStack() {
  const { toasts, dismiss } = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] w-full max-w-md px-4
                 flex flex-col items-center gap-2 pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  // Each toast manages its own auto-dismiss lifecycle.
  useEffect(() => {
    if (toast.duration === Infinity) return;
    const handle = setTimeout(onDismiss, toast.duration);
    return () => clearTimeout(handle);
  }, [toast.id, toast.duration, onDismiss]);

  const v = VARIANT[toast.variant] || VARIANT.default;

  return (
    <button
      type="button"
      onClick={onDismiss}
      className="pointer-events-auto block w-full text-left animate-fade-up cursor-pointer"
      aria-label={`${toast.title}. Click to dismiss.`}
    >
      <div
        className={`relative surface-paper px-5 py-3 border ${v.border}
                    flex items-center gap-4 hover:shadow-card-hover transition-shadow`}
        style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(184, 146, 58, 0.4)' }}
      >
        {/* Inner gilt rule */}
        <div className="absolute inset-1 border border-gold-500/30 pointer-events-none" />

        {/* Brass medallion */}
        <div className={`flex-shrink-0 w-9 h-9 rounded-full border-2 flex items-center justify-center font-display font-bold text-sm ${v.medallion}`}>
          {v.icon}
        </div>

        <div className="flex-1 min-w-0 relative">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-700 mb-0.5">
            {toast.eyebrow || 'Update'}
          </p>
          <p className="font-display text-base font-bold text-ink-900 leading-tight">
            {toast.title}
          </p>
          {toast.body && (
            <p className="font-serif italic text-ink-700 text-xs mt-0.5 leading-snug">
              {toast.body}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

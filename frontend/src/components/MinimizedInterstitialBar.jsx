/**
 * MinimizedInterstitialBar — the compact bar an interstitial modal (review /
 * conference) collapses to. With no full-screen backdrop, the board and the
 * player's hand show through, so they can check what they're holding before
 * restoring the modal.
 *
 * Props:
 *   label     — short phase label, e.g. "Peer Review · 2 of 3"
 *   hint      — optional secondary text (e.g. "your turn to draft")
 *   onRestore — () => void
 */
export default function MinimizedInterstitialBar({ label, hint, onRestore }) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[120] flex items-center gap-3 surface-binding border border-gold-500/60 px-4 py-2 shadow-card-hover animate-fade-up">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-300">{label}</span>
      {hint && <span className="font-serif italic text-cream-200/80 text-xs">{hint}</span>}
      <button
        type="button"
        onClick={onRestore}
        className="font-mono text-[10px] uppercase tracking-wider px-3 py-1 bg-gold-500 hover:bg-gold-400 text-teal-950 border border-gold-700"
      >
        Restore ▴
      </button>
    </div>
  );
}

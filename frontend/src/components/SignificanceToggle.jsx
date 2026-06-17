/**
 * SignificanceToggle — plain "Significance · On/Off" button that reveals the
 * historical-significance notes on cards. No password gate: clicking it flips
 * visibility directly, mirroring TagsToggle.
 *
 * @param {boolean}  showSignificance  current visibility from the page
 * @param {Function} onToggle          callback to flip it
 */
export default function SignificanceToggle({ showSignificance, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`
        font-mono text-xs uppercase tracking-wider px-3 py-1 border transition-colors
        ${showSignificance
          ? 'bg-gold-500 text-teal-950 border-gold-400'
          : 'border-gold-500/40 text-cream-200 hover:border-gold-400 hover:text-cream-50'
        }
      `}
      title={showSignificance ? 'Significance notes are visible' : 'Significance notes are hidden'}
    >
      {showSignificance ? 'Significance · On' : 'Significance · Off'}
    </button>
  );
}

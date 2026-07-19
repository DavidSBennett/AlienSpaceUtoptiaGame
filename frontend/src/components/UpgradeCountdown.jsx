/**
 * UpgradeCountdown — a small "you have funding to invest" nudge for the top of
 * the game screen. Upgrades are now earned by publishing and by attending
 * conferences (no regular every-third-year drip), so this only appears when an
 * upgrade is waiting to be spent.
 *
 * Props:
 *   pending     — number/bool of upgrades waiting to be spent
 *   variant     — 'strip' (compact mono, for the solo header strip) or
 *                 'panel' (serif, right-aligned, for the multiplayer header)
 */
export default function UpgradeCountdown({ pending = 0, variant = 'strip' }) {
  const hasPending = Number(pending) > 0;

  // Nothing to show unless an upgrade is waiting.
  if (!hasPending) return null;

  const value = 'Ready — choose now';
  const ready = true;

  if (variant === 'panel') {
    return (
      <div className="font-serif italic text-lg text-right mt-1">
        <span className="font-mono not-italic uppercase tracking-widest text-gold-400 text-[10px] mr-2">
          Next Upgrade
        </span>
        <span className={ready ? 'text-verdigris-300 not-italic font-mono text-sm' : 'text-cream-200/80'}>
          {value}
        </span>
      </div>
    );
  }

  // 'strip' — matches the solo header's other mono stat readouts.
  return (
    <span className="font-mono text-cream-200 flex-shrink-0">
      <span className="text-gold-400 mr-2">Next Upgrade</span>
      <span className={ready ? 'text-verdigris-300' : undefined}>{value}</span>
    </span>
  );
}

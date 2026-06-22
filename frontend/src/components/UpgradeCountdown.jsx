/**
 * UpgradeCountdown — a small "time until your next funding/upgrade" readout
 * for the top of the game screen. Players receive a regular upgrade every
 * third year (see lib/upgradeCadence.js); promotions add bonus upgrades.
 *
 * When an upgrade is already waiting to be spent, it nudges the player to
 * choose it now instead of counting down.
 *
 * Props:
 *   year        — the year currently in progress
 *   totalYears  — career length
 *   pending     — number/bool of upgrades waiting to be spent (optional)
 *   variant     — 'strip' (compact mono, for the solo header strip) or
 *                 'panel' (serif, right-aligned, for the multiplayer header)
 */
import { upgradeCountdownLabel } from '../lib/upgradeCadence.js';

export default function UpgradeCountdown({ year, totalYears, pending = 0, variant = 'strip' }) {
  const hasPending = Number(pending) > 0;
  const label = upgradeCountdownLabel(year, totalYears);

  // Nothing to show: no pending upgrade and no further drip this game.
  if (!hasPending && !label) return null;

  const value = hasPending ? 'Ready — choose now' : label;
  const ready = hasPending;

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

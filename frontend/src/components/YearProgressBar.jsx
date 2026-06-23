/**
 * YearProgressBar — a horizontal bar showing year N / total.
 *
 * The total length depends on the game's mode (short=8, medium=12,
 * long=15). There are no career deadlines, so the bar carries no gate
 * markers — it just tracks progress toward retirement.
 *
 * The filled portion uses gold; the un-filled is dark teal.
 */
const GATE_YEARS = [];

export default function YearProgressBar({ currentYear, totalYears = 15 }) {
  const total = totalYears > 0 ? totalYears : 15;
  const progress = Math.min(Math.max((currentYear - 1) / total, 0), 1);

  return (
    <div className="relative h-2 bg-teal-950 border-y border-gold-500/20 overflow-hidden">
      {/* Filled portion */}
      <div
        className="absolute inset-y-0 left-0 bg-gold-500/70 transition-all duration-300 ease-desk"
        style={{ width: `${progress * 100}%` }}
      />
      {/* Gate markers — only those that fall within this game's length */}
      {GATE_YEARS.filter((y) => y < total).map((y) => (
        <div
          key={y}
          className="absolute inset-y-0 w-px bg-oxblood-500"
          style={{ left: `${(y / total) * 100}%` }}
          aria-label={`Year ${y} gate`}
          title={`Year ${y} gate`}
        />
      ))}
    </div>
  );
}

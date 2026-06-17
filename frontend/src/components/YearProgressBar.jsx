/**
 * YearProgressBar — a horizontal bar showing year N / 25 with markers
 * at the two hard gates (year 5: comps; year 12: tenure).
 *
 * The filled portion uses gold; the un-filled is dark teal. Two small
 * tick marks indicate the gates so the player can see them approaching.
 */
const TOTAL_YEARS = 25;
const GATE_YEARS = [5, 12];

export default function YearProgressBar({ currentYear }) {
  const progress = Math.min(Math.max((currentYear - 1) / TOTAL_YEARS, 0), 1);

  return (
    <div className="relative h-2 bg-teal-950 border-y border-gold-500/20 overflow-hidden">
      {/* Filled portion */}
      <div
        className="absolute inset-y-0 left-0 bg-gold-500/70 transition-all duration-300 ease-desk"
        style={{ width: `${progress * 100}%` }}
      />
      {/* Gate markers */}
      {GATE_YEARS.map((y) => (
        <div
          key={y}
          className="absolute inset-y-0 w-px bg-oxblood-500"
          style={{ left: `${(y / TOTAL_YEARS) * 100}%` }}
          aria-label={`Year ${y} gate`}
          title={`Year ${y} gate`}
        />
      ))}
    </div>
  );
}

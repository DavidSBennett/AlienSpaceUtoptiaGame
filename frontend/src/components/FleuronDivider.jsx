/**
 * FleuronDivider — a centered ornament with gold rules extending left and right.
 *
 * The classic 19th-century section break. The fleuron itself is a small
 * SVG diamond with foliate accents. Used between major sections — landing
 * page hero subtitle, modal sections, etc.
 */
export default function FleuronDivider({ className = '' }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Left rule */}
      <span className="flex-1 h-px bg-gold-500/40" />

      {/* The fleuron itself */}
      <svg
        width="24"
        height="12"
        viewBox="0 0 24 12"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="text-gold-400"
        aria-hidden="true"
      >
        {/* Center diamond */}
        <path
          d="M 12 1 L 15 6 L 12 11 L 9 6 Z"
          stroke="currentColor"
          strokeWidth="0.6"
          fill="currentColor"
          fillOpacity="0.3"
        />
        {/* Side leaves */}
        <ellipse cx="3" cy="6" rx="2.5" ry="1" fill="currentColor" opacity="0.5" />
        <ellipse cx="21" cy="6" rx="2.5" ry="1" fill="currentColor" opacity="0.5" />
        {/* Connecting dots */}
        <circle cx="6.5" cy="6" r="0.5" fill="currentColor" opacity="0.6" />
        <circle cx="17.5" cy="6" r="0.5" fill="currentColor" opacity="0.6" />
      </svg>

      {/* Right rule */}
      <span className="flex-1 h-px bg-gold-500/40" />
    </div>
  );
}

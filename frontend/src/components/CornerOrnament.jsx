/**
 * CornerOrnament — a small Victorian-style flourish for frame corners.
 *
 * Inspired by the corner cartouches on 19th-century gilt-stamped book covers
 * (see the "Juvenile Sketches" reference image). Drawn as inline SVG so it
 * scales cleanly and inherits color via `currentColor`.
 *
 * Use four of these in the corners of any frame element, rotated to match
 * each corner. The `corner` prop handles the rotation automatically.
 */
export default function CornerOrnament({
  corner = 'tl',     // 'tl' | 'tr' | 'bl' | 'br'
  size = 32,         // pixel size — square
  className = '',
}) {
  // Rotation map: each corner orients the same drawing differently
  const rotation = {
    tl: 0,
    tr: 90,
    br: 180,
    bl: 270,
  }[corner];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ transform: `rotate(${rotation}deg)` }}
      aria-hidden="true"
    >
      {/* The L-shape outer rule */}
      <path
        d="M 1 11 L 1 1 L 11 1"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.7"
      />
      {/* Inner echo rule */}
      <path
        d="M 4 9 L 4 4 L 9 4"
        stroke="currentColor"
        strokeWidth="0.5"
        opacity="0.5"
      />
      {/* A small foliate flourish — three connected curves */}
      <path
        d="M 11 1 Q 14 3 16 6 Q 18 9 22 10"
        stroke="currentColor"
        strokeWidth="0.6"
        opacity="0.55"
        fill="none"
      />
      <path
        d="M 1 11 Q 3 14 6 16 Q 9 18 10 22"
        stroke="currentColor"
        strokeWidth="0.6"
        opacity="0.55"
        fill="none"
      />
      {/* A single gilt dot at the joint — "rivet" detail */}
      <circle cx="2.5" cy="2.5" r="0.8" fill="currentColor" opacity="0.7" />
      {/* Small foliate teardrops — Victorian fleuron motif */}
      <ellipse
        cx="13" cy="4" rx="0.8" ry="2"
        fill="currentColor"
        opacity="0.4"
        transform="rotate(35 13 4)"
      />
      <ellipse
        cx="4" cy="13" rx="2" ry="0.8"
        fill="currentColor"
        opacity="0.4"
        transform="rotate(35 4 13)"
      />
    </svg>
  );
}

/**
 * OrnamentedFrame — wraps any content in a gilt frame with corner ornaments.
 * The four CornerOrnaments are positioned absolutely; the frame itself is
 * a thin gold border on the parent.
 */
export function OrnamentedFrame({ children, className = '', cornerSize = 28 }) {
  return (
    <div className={`relative border border-gold-500/40 ${className}`}>
      <div
        className="absolute top-1 left-1 text-gold-400 pointer-events-none"
        style={{ width: cornerSize, height: cornerSize }}
      >
        <CornerOrnament corner="tl" size={cornerSize} />
      </div>
      <div
        className="absolute top-1 right-1 text-gold-400 pointer-events-none"
        style={{ width: cornerSize, height: cornerSize }}
      >
        <CornerOrnament corner="tr" size={cornerSize} />
      </div>
      <div
        className="absolute bottom-1 left-1 text-gold-400 pointer-events-none"
        style={{ width: cornerSize, height: cornerSize }}
      >
        <CornerOrnament corner="bl" size={cornerSize} />
      </div>
      <div
        className="absolute bottom-1 right-1 text-gold-400 pointer-events-none"
        style={{ width: cornerSize, height: cornerSize }}
      >
        <CornerOrnament corner="br" size={cornerSize} />
      </div>
      {children}
    </div>
  );
}

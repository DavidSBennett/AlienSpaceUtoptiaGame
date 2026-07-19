import { upgradeReasonText } from '../lib/career.js';

/**
 * UpgradeBoard — the "invest your funding" screen, styled as the historian's
 * desk. Each of the six practice areas is a paper panel with a four-cell track;
 * the cells you already own are filled, the next cell is a lit, clickable slot,
 * and the cells beyond it are locked. Clicking the next open cell spends the
 * pending upgrade on that track.
 *
 * The board is presentation only — the caller supplies the stat CONTENT (solo
 * and multiplayer use different value tables) and the buy handler:
 *
 * Props:
 *   stats      — [{ key, title, subtitle, cells: [l1,l2,l3,l4], lead }]
 *                `cells` are short display labels for each level (e.g. 3/5/7/Full).
 *   statLevels — { [key]: 1..4 }
 *   reason     — upgrade reason string (drives the flavor line)
 *   stage      — career stage (for promotion flavor)
 *   onChoose   — (statKey) => void | Promise, spends the upgrade on that track
 *   onClose    — optional; when every track is maxed, shows a Continue button
 *   busy       — disables interaction while a choice is in flight
 *   error      — optional error string
 */
export default function UpgradeBoard({
  stats,
  statLevels,
  reason = 'publish',
  stage = 'recent-graduate',
  onChoose,
  onClose,
  busy = false,
  error = null,
}) {
  const allMaxed = stats.every((s) => (statLevels[s.key] || 1) >= 4);
  const flavor = upgradeReasonText(reason, stage);

  // Wood-desk backdrop — a warm plank gradient with faint grain striping, so
  // the board reads as the physical desk without needing an image asset.
  const deskStyle = {
    backgroundColor: '#5b3a21',
    backgroundImage:
      'repeating-linear-gradient(90deg, rgba(0,0,0,0.14) 0px, rgba(0,0,0,0.14) 2px, transparent 2px, transparent 7px), ' +
      'linear-gradient(180deg, #6d4527 0%, #563a24 55%, #4a2f1a 100%)',
    boxShadow: 'inset 0 0 120px rgba(0,0,0,0.55)',
  };

  return (
    // Required choice — NOT click-to-dismiss.
    <div className="fixed inset-0 z-[70] bg-teal-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-fade-in">
      <div
        className="relative w-full max-w-5xl max-h-[94vh] overflow-y-auto rounded-lg border-4 border-[#3a2413] animate-fade-up"
        style={deskStyle}
      >
        <div className="p-4 sm:p-6">
          {/* Header banner — a slip of paper pinned to the desk */}
          <div className="mx-auto max-w-2xl surface-paper border border-gold-600/40 shadow-lg px-6 py-4 text-center relative">
            <div className="absolute inset-1 border border-gold-500/20 pointer-events-none" />
            <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-700 mb-1">
              Career Development
            </p>
            <h2 className="font-display text-2xl font-bold text-ink-900 leading-tight">
              Invest Your Funding
            </h2>
            <p className="font-serif italic text-ink-700 text-sm mt-1 leading-snug">
              {flavor}
            </p>
          </div>

          {allMaxed ? (
            <div className="text-center mt-6">
              <p className="font-serif italic text-cream-100 text-base mb-5">
                Every area of your practice is already at its peak. There is
                nothing further to refine.
              </p>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="px-8 py-3 bg-cream-50 border-2 border-gold-500/50 text-ink-900 hover:border-gold-500 hover:-translate-y-0.5 transition-all duration-200 ease-desk font-mono text-xs uppercase tracking-widest disabled:opacity-50"
                >
                  Continue
                </button>
              )}
            </div>
          ) : (
            <>
              <p className="text-center font-serif text-cream-100/90 text-sm mt-4 mb-3">
                Click the next open slot in any track to invest your funding.
              </p>

              {/* Six practice-area panels arranged across the desk. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {stats.map((stat) => (
                  <StatTrack
                    key={stat.key}
                    stat={stat}
                    level={statLevels[stat.key] || 1}
                    busy={busy}
                    onChoose={onChoose}
                  />
                ))}
              </div>

              {error && (
                <p className="font-serif italic text-oxblood-300 text-sm text-center mt-4">
                  {error}
                </p>
              )}

              <p className="font-serif italic text-cream-100/70 text-xs text-center mt-3">
                Investments are permanent — they cannot be undone.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * StatTrack — one practice-area panel: a titled slip of paper with a
 * four-cell level track underneath.
 */
function StatTrack({ stat, level, busy, onChoose }) {
  const isMaxed = level >= 4;

  return (
    <div className="surface-paper border border-gold-600/40 shadow-lg rounded-sm px-3 pt-3 pb-2 relative">
      <div className="absolute inset-1 border border-gold-500/15 pointer-events-none" />

      <h3 className="font-display text-base font-bold text-ink-900 text-center leading-tight">
        {stat.title}
      </h3>

      {/* Level track */}
      <div className="flex items-stretch justify-center gap-1 my-2">
        {[1, 2, 3, 4].map((lv) => {
          const owned = lv <= level;
          const isNext = lv === level + 1 && !isMaxed;
          const locked = lv > level + 1;
          return (
            <TrackCell
              key={lv}
              label={stat.cells[lv - 1]}
              owned={owned}
              isNext={isNext}
              locked={locked}
              busy={busy}
              onClick={isNext && !busy ? () => onChoose(stat.key) : undefined}
            />
          );
        })}
      </div>

      <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-gold-700 text-center">
        {stat.subtitle}
      </p>
      <p className="font-serif text-[11px] text-ink-700 leading-snug text-center mt-1">
        {stat.lead}
      </p>
    </div>
  );
}

/**
 * TrackCell — a single level slot.
 *   owned  → filled gold with its value
 *   next   → lit, clickable, gently pulsing invitation
 *   locked → greyed with a padlock over a faint value
 */
function TrackCell({ label, owned, isNext, locked, busy, onClick }) {
  const base =
    'flex-1 min-w-0 h-12 rounded flex flex-col items-center justify-center border-2 px-1 transition-all duration-200 ease-desk';

  if (isNext) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        title="Invest your funding here"
        className={`${base} border-gold-500 bg-cream-50 text-ink-900 cursor-pointer
          hover:bg-gold-100 hover:-translate-y-0.5 hover:shadow-card-hover
          ring-2 ring-gold-400/70 ring-offset-1 ring-offset-cream-100
          ${busy ? 'opacity-60 cursor-wait' : ''}`}
      >
        <span className="font-display font-bold text-sm leading-none">{label}</span>
        <span className="font-mono text-[7px] uppercase tracking-wide text-gold-700 mt-0.5">
          invest
        </span>
      </button>
    );
  }

  if (owned) {
    return (
      <div className={`${base} border-gold-700 bg-gold-500 text-ink-900`}>
        <span className="font-display font-bold text-sm leading-none">{label}</span>
      </div>
    );
  }

  // locked
  return (
    <div className={`${base} border-cream-300 bg-cream-200/70 text-ink-700/50`} title="Unlock the earlier level first">
      <span className="text-ink-700/70 text-sm leading-none" aria-hidden="true">🔒</span>
      <span className="font-display text-[11px] leading-none mt-0.5 opacity-60">{label}</span>
    </div>
  );
}

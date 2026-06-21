import CornerOrnament from './CornerOrnament.jsx';
import FleuronDivider from './FleuronDivider.jsx';

/**
 * MultiplayerUpgradeChooser — modal that opens whenever the player has
 * pending_upgrade=1. Visually mirrors the single-player UpgradeChooserDialog
 * (the gilt "manuscript" treatment) but keeps the multiplayer stat set and
 * talks to mp_upgradeStat.php instead of dispatching to a reducer.
 *
 * The reason for the upgrade is passed through so the dialog can show
 * appropriate flavor text:
 *   'publish'         — your publication was approved
 *   'review-approve'  — your review approved an accepted publication
 *   'review-reject'   — your rejection verdict stood
 *   'review-revise'   — your revise-and-resubmit proposal counts as a review
 *   'reject-writer'   — your manuscript was rejected, but you learn from it
 *
 * Stats already at L4 are shown but not selectable.
 *
 * Props:
 *   statLevels — { research, notebookCapacity, influence, workspaces, reputation, renown }
 *   reason     — see above
 *   onChoose   — async (statKey) => void
 *   onClose    — () => void (used when no stats are upgradable, just acknowledge)
 *   busy       — bool
 *   error      — string | null
 */
export default function MultiplayerUpgradeChooser({
  statLevels,
  reason,
  onChoose,
  onClose,
  busy,
  error,
}) {
  // Each stat's `table` holds the four per-level display labels. The chooser
  // shows table[level-1] as the current effect and table[level] as the next.
  const STATS = [
    {
      key: 'research',
      title: 'Research Funding',
      lead: 'How many archive cards you draw at a time. The final upgrade draws a full notebook.',
      table: ['Draw 3 cards', 'Draw 5 cards', 'Draw 7 cards', 'Draw a full notebook'],
    },
    {
      key: 'notebookCapacity',
      title: 'Personal Archive',
      lead: 'Your hand limit — how many cards you can keep in your Research Notebook.',
      table: ['Hold 7 cards', 'Hold 9 cards', 'Hold 11 cards', 'Hold 15 cards'],
    },
    {
      key: 'influence',
      title: 'Literary Agent',
      lead: 'A prestige bonus added to every evidence card in a publication, so it grows with article size.',
      table: ['No bonus', '+1 prestige per card', '+2 prestige per card', '+4 prestige per card'],
    },
    {
      key: 'workspaces',
      title: 'Workspaces',
      lead: 'How many concurrent research projects you can manage. The final upgrade makes publishing free of year cost.',
      table: ['1 project', '2 projects', '3 projects', '3 projects · free publishing'],
    },
    {
      key: 'reputation',
      title: 'Association Memberships',
      lead: 'Your payoff at a conference: citation tokens earned and fresh cards added to the pool.',
      table: ['1 citation · 1 fresh card', '2 citations · 2 fresh', '3 citations · 3 fresh', '6 citations · 4 fresh'],
    },
    {
      // The Publicist rewards the holder of citation tokens. At end of game your
      // total citation tokens (earned by being cited and by attending
      // conferences) pay out × this multiplier into your final prestige.
      key: 'renown',
      title: 'Publicist',
      lead: 'At game end, your total citation tokens pay out at this multiplier.',
      table: ['×1 per citation', '×2 per citation', '×3 per citation', '×5 per citation'],
    },
  ];

  const flavor = {
    'biennial': "New money has come your way — a raise (once you're tenure-track), a bonus, or a grant. How you invest it shapes the research you'll be able to do.",
  }[reason] || "New money has come your way — a raise, a bonus, or a grant. How you invest it shapes the research you'll be able to do.";

  const allMaxed = STATS.every((s) => (statLevels[s.key] || 1) >= 4);

  return (
    // Note: NOT click-to-dismiss. This is a required choice; the player must
    // select one to continue (or acknowledge, if every stat is maxed).
    <div className="fixed inset-0 z-[70] bg-teal-950/80 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in">
      <article
        className="relative surface-paper max-w-3xl w-full max-h-[90vh] overflow-y-auto animate-fade-up"
        style={{
          boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(184, 146, 58, 0.5)',
        }}
      >
        {/* Inner gilt frame and corner ornaments */}
        <div className="absolute inset-2 border border-gold-500/30 pointer-events-none" />
        <div className="absolute top-3 left-3 text-gold-500 pointer-events-none">
          <CornerOrnament corner="tl" size={24} />
        </div>
        <div className="absolute top-3 right-3 text-gold-500 pointer-events-none">
          <CornerOrnament corner="tr" size={24} />
        </div>
        <div className="absolute bottom-3 left-3 text-gold-500 pointer-events-none">
          <CornerOrnament corner="bl" size={24} />
        </div>
        <div className="absolute bottom-3 right-3 text-gold-500 pointer-events-none">
          <CornerOrnament corner="br" size={24} />
        </div>

        <div className="px-12 py-10">

          {/* Header */}
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-700 mb-3 text-center">
            Career Development
          </p>
          <h2 className="font-display text-3xl font-bold text-ink-900 text-center leading-tight">
            Refine Your Practice
          </h2>
          <p className="font-serif italic text-ink-700 text-center text-base mt-2 leading-relaxed">
            {flavor}
          </p>

          <FleuronDivider className="my-6" />

          {allMaxed ? (
            <div className="text-center">
              <p className="font-serif italic text-ink-700 text-base mb-6">
                Every area of your practice is already at its peak. There is
                nothing further to refine.
              </p>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-8 py-3 bg-cream-50 border-2 border-gold-500/40 text-ink-900 hover:border-gold-500 hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 ease-desk font-mono text-xs uppercase tracking-widest disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          ) : (
            <>
              {/* Six stat options in a 2-column grid (three rows). */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {STATS.map((stat) => (
                  <StatOption
                    key={stat.key}
                    stat={stat}
                    level={statLevels[stat.key] || 1}
                    busy={busy}
                    onChoose={onChoose}
                  />
                ))}
              </div>

              {error && (
                <p className="font-serif italic text-oxblood-700 text-sm text-center mt-5">
                  {error}
                </p>
              )}

              <p className="font-serif italic text-ink-700 text-xs text-center mt-6">
                Selecting an option is permanent — investments cannot be undone.
              </p>
            </>
          )}
        </div>
      </article>
    </div>
  );
}


/**
 * StatOption — one selectable upgrade tile, ink-on-parchment.
 *
 * Shows the stat's name, a level pip-strip, the current effect, the arrow →
 * next effect, and (if at max) a disabled "Maxed" state.
 */
function StatOption({ stat, level, busy, onChoose }) {
  const isMaxed = level >= 4;
  const currentLabel = stat.table[level - 1];
  const nextLabel = isMaxed ? null : stat.table[level];

  return (
    <button
      type="button"
      disabled={isMaxed || busy}
      onClick={() => !isMaxed && !busy && onChoose(stat.key)}
      className={`
        text-left p-4 border-2 transition-all duration-200 ease-desk
        ${isMaxed
          ? 'border-cream-300 bg-cream-200/40 cursor-not-allowed opacity-60'
          : 'border-gold-500/40 bg-cream-50 hover:border-gold-500 hover:shadow-card-hover hover:-translate-y-0.5 cursor-pointer'
        }
        ${busy && !isMaxed ? 'opacity-60 cursor-wait' : ''}
      `}
    >
      {/* Title + level pips */}
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-display text-lg font-bold text-ink-900">
          {stat.title}
        </h3>
        <LevelPips level={level} />
      </div>

      {/* Description */}
      <p className="font-serif text-sm text-ink-700 leading-snug mb-3">
        {stat.lead}
      </p>

      {/* Current → Next progression */}
      <div className="font-mono text-xs flex items-center gap-2 text-ink-900">
        <span className="text-ink-700">{currentLabel}</span>
        {!isMaxed && (
          <>
            <span className="text-gold-700">→</span>
            <span className="font-bold">{nextLabel}</span>
          </>
        )}
        {isMaxed && (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-ink-700">
            Maxed
          </span>
        )}
      </div>
    </button>
  );
}


/**
 * LevelPips — four small gilt squares, filled to indicate current level.
 *   ■■□□  for level 2     ■■■■  for level 4 (maxed)
 */
function LevelPips({ level }) {
  return (
    <span className="flex gap-1">
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`
            w-2 h-2 border border-gold-600
            ${i <= level ? 'bg-gold-500' : 'bg-cream-100'}
          `}
        />
      ))}
    </span>
  );
}

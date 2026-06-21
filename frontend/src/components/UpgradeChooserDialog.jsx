import CornerOrnament from './CornerOrnament.jsx';
import FleuronDivider from './FleuronDivider.jsx';
import { STAT_TABLES, CONFERENCE_FRESH } from '../hooks/useGameState.js';
import { upgradeReasonText } from '../lib/career.js';

/**
 * UpgradeChooserDialog — appears after a successful publication.
 *
 * The player's body of work has earned them an advancement in one area of
 * scholarly practice. They choose: more research output, a deeper notebook,
 * more influence, or a wider scope of projects.
 *
 * Pedagogically: this turns each successful publication into a strategic
 * decision. Players develop different "styles" — a scholar who maxes
 * research draws fast and publishes often; one who maxes workspaces juggles
 * multiple arguments at once.
 *
 * Maxed stats are shown but not selectable. If all four are maxed, this
 * dialog never appears (the publish reducer skips setting pendingUpgrade).
 *
 * @param {Object}   props.statLevels  current state.statLevels
 * @param {Function} props.onUpgrade   (statName) => void
 */
export default function UpgradeChooserDialog({ statLevels, onUpgrade, reason = 'biennial', stage = 'recent-graduate' }) {
  const stats = [
    {
      key: 'research',
      title: 'Research Funding',
      lead: 'How many archive cards you draw at a time. The final upgrade draws a full notebook.',
      values: STAT_TABLES.research,
      // Research L4 is dynamic — it draws cards equal to the player's
      // current notebook capacity. The chooser shows that intent rather
      // than the sentinel value.
      unit: (v, level) =>
        level === 4 ? 'Draw a full notebook' : `Draw ${v} cards`,
    },
    {
      key: 'notebookCapacity',
      title: 'Personal Archive',
      lead: 'How many cards you can keep in your Research Notebook at once.',
      values: STAT_TABLES.notebookCapacity,
      unit: (v) => `Hold ${v} cards`,
    },
    {
      key: 'influence',
      title: 'Literary Agent',
      lead: 'Bonus prestige added to every successful publication. The final upgrade is per-card.',
      values: STAT_TABLES.influence,
      // L1: 0 (no bonus); L2-L3: flat +N; L4: +3 PER CARD in the argument.
      unit: (v, level) => {
        if (v === 0) return 'No bonus';
        if (level === 4) return `+${v} prestige per card in argument`;
        return `+${v} prestige per publish`;
      },
    },
    {
      key: 'workspaces',
      title: 'Workspaces',
      lead: 'How many concurrent research projects you can manage. The final upgrade makes publishing free of year cost.',
      values: STAT_TABLES.workspaces,
      // Level-aware label. L1-L3 just describe the project count.
      // L4 has the same project count (3) but adds the free-publishing
      // perk — describe it as the L4 effect.
      unit: (v, level) =>
        level === 4
          ? '3 projects · free publishing'
          : `${v} project${v === 1 ? '' : 's'}`,
    },
    {
      key: 'reputation',
      title: 'Association Memberships',
      lead: 'Powers the "Attend a Conference" action: a bigger pool to draft from and more citation tokens earned.',
      // The values array holds the citation grant per level (1/2/3/6); the
      // fresh-card pool bonus comes from CONFERENCE_FRESH.
      values: STAT_TABLES.reputation,
      unit: (v, level) => {
        const fresh = CONFERENCE_FRESH[level - 1];
        return `+${fresh} fresh cards · ${v} citation${v === 1 ? '' : 's'}`;
      },
    },
    {
      key: 'renown',
      title: 'Publicist',
      lead: 'How much each banked citation token is worth in prestige when you retire.',
      values: STAT_TABLES.renown,
      unit: (v) => `Each citation = +${v} prestige`,
    },
  ];

  return (
    // Note: NOT click-to-dismiss. This is a required choice; the player
    // must select one to continue. The publish/critique dialog dismissed
    // before this; once you accept that, you commit to picking an upgrade.
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
            Money to Invest
          </h2>
          <p className="font-serif italic text-ink-700 text-center text-base mt-2 leading-relaxed">
            {upgradeReasonText(reason, stage)}
          </p>

          <FleuronDivider className="my-6" />

          {/* The stat options — 6 total, in a 2-column grid (3 rows). */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {stats.map((stat) => (
              <StatOption
                key={stat.key}
                stat={stat}
                level={statLevels[stat.key]}
                onUpgrade={onUpgrade}
              />
            ))}
          </div>

          <p className="font-serif italic text-ink-700 text-xs text-center mt-6">
            Selecting an option is permanent — investments cannot be undone.
          </p>
        </div>
      </article>
    </div>
  );
}


/**
 * StatOption — one of the four selectable upgrade tiles.
 *
 * Shows the stat's name, current level pip-strip, the current value, the
 * arrow → next value, and (if at max) a "Maxed" disabled state.
 */
function StatOption({ stat, level, onUpgrade }) {
  const isMaxed = level >= 4;
  const currentValue = stat.values[level - 1];
  const nextValue = isMaxed ? null : stat.values[level];

  return (
    <button
      type="button"
      disabled={isMaxed}
      onClick={() => !isMaxed && onUpgrade(stat.key)}
      className={`
        text-left p-4 border-2 transition-all duration-200 ease-desk
        ${isMaxed
          ? 'border-cream-300 bg-cream-200/40 cursor-not-allowed opacity-60'
          : 'border-gold-500/40 bg-cream-50 hover:border-gold-500 hover:shadow-card-hover hover:-translate-y-0.5 cursor-pointer'
        }
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
        <span className="text-ink-700">{stat.unit(currentValue, level)}</span>
        {!isMaxed && (
          <>
            <span className="text-gold-700">→</span>
            <span className="font-bold">{stat.unit(nextValue, level + 1)}</span>
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
 *
 *   ■■□□  for level 2
 *   ■■■■  for level 4 (maxed)
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

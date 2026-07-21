/**
 * StatsStrip — a strip of stat tiles between the bookshelf and the hand.
 * Each tile shows the stat name and current level, with a rich tooltip.
 *
 * Renown tile surfaces the live citation count and the pending end-of-game
 * payout (total citation tokens × renown multiplier).
 *
 * Tiles at their maximum level (4) are dimmed.
 */
import { MP_STAT_TABLES } from '../lib/mpStats.js';
import Tooltip from './Tooltip.jsx';

const STAT_LABELS = {
  research:         'Research Funding',
  notebookCapacity: 'Personal Archive',
  influence:        'Literary Agent',
  workspaces:       'Workspaces',
  reputation:       'Association Memberships',
  renown:           'Publicist',
};

const STAT_ORDER = ['research', 'notebookCapacity', 'influence', 'workspaces', 'reputation', 'renown'];

// Tooltip body builders.
const STAT_TOOLTIPS = {
  research: (level) => (
    <>
      <strong className="block font-display text-sm text-gold-300 mb-1">Research Funding</strong>
      <span>How many cards you draw per Draw action.</span>
      <span className="block mt-1 text-cream-200/70">
        Levels: 3 → 5 → 7 → full notebook. Currently L{level}.
      </span>
    </>
  ),
  notebookCapacity: (level) => (
    <>
      <strong className="block font-display text-sm text-gold-300 mb-1">Personal Archive</strong>
      <span>Your hand limit — how many cards you can hold at once.</span>
      <span className="block mt-1 text-cream-200/70">
        Levels: 7 → 9 → 11 → 15. Currently L{level}.
      </span>
    </>
  ),
  influence: (level) => (
    <>
      <strong className="block font-display text-sm text-gold-300 mb-1">Literary Agent</strong>
      <span>A prestige bonus added to <em>every</em> evidence card in a publication, so it grows with article size.</span>
      <span className="block mt-1 text-cream-200/70">
        Levels: +0 → +1 → +2 → +4 per card. Currently L{level}.
      </span>
    </>
  ),
  workspaces: (level) => (
    <>
      <strong className="block font-display text-sm text-gold-300 mb-1">Workspaces</strong>
      <span>How many project slots you can have open at once. L4 also removes the year cost from publishing.</span>
      <span className="block mt-1 text-cream-200/70">
        Levels: 1 → 2 → 3 → free publishing. Currently L{level}.
      </span>
    </>
  ),
  reputation: (level) => (
    <>
      <strong className="block font-display text-sm text-gold-300 mb-1">Association Memberships</strong>
      <span>Your payoff at a conference: citation tokens earned and fresh cards added to the pool.</span>
      <span className="block mt-1 text-cream-200/70">
        Citations: 1 → 2 → 3 → 6 · Fresh cards: 1 → 2 → 3 → 4. Currently L{level}.
      </span>
    </>
  ),
  renown: (level, citationsReceived = 0) => {
    const table = MP_STAT_TABLES.renown;
    const mult = table[level - 1] ?? 1;
    const pending = citationsReceived * mult;
    return (
      <>
        <strong className="block font-display text-sm text-gold-300 mb-1">Publicist</strong>
        <span>At end of game, your total citation tokens pay out × this multiplier.</span>
        <span className="block mt-1 text-cream-200/70">
          Levels: ×1 → ×2 → ×3 → ×5. Currently L{level} (×{mult}).
        </span>
        <span className="block mt-2 text-verdigris-400 font-mono text-[10px]">
          You hold {citationsReceived} citation {citationsReceived === 1 ? 'token' : 'tokens'}.
          {' '}Pending payout: +{pending} prestige.
        </span>
      </>
    );
  },
};

export default function StatsStrip({ statLevels, citationsReceived = 0, pendingUpgrade = 0 }) {
  const hasPending = Number(pendingUpgrade) > 0;
  return (
    <div className="flex items-stretch justify-center gap-2 px-6 py-2 border-y border-gold-500/20 bg-teal-950/40">
      {/* The upgrade nudge rides with the stats it applies to, rather than up
          in the header away from them. Only present when one is unspent. */}
      {hasPending && (
        <Tooltip
          content="You've earned a stat upgrade. Pick one to raise a level — it applies immediately."
          side="top"
          width="w-64"
        >
          <div className="flex flex-col items-center justify-center min-w-[5.5rem] px-2 py-1 border-2 border-verdigris-400 bg-verdigris-500/20 cursor-default animate-fade-in">
            <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-verdigris-300 leading-tight">
              Upgrade
            </span>
            <span className="font-display text-lg text-cream-50 leading-tight">
              {Number(pendingUpgrade) > 1 ? `${pendingUpgrade} ready` : 'Ready'}
            </span>
          </div>
        </Tooltip>
      )}
      {STAT_ORDER.map((key) => {
        const level = statLevels?.[key] ?? 1;
        const table = MP_STAT_TABLES[key];
        const isMax = Array.isArray(table) && level >= table.length;
        const showRenownFooter = key === 'renown';
        const tooltip = key === 'renown'
          ? STAT_TOOLTIPS.renown(level, citationsReceived)
          : STAT_TOOLTIPS[key](level);
        return (
          <Tooltip key={key} content={tooltip} side="bottom" width="w-72">
            <StatTile
              label={STAT_LABELS[key]}
              level={level}
              isMax={isMax}
              footer={
                showRenownFooter && citationsReceived > 0
                  ? `${citationsReceived} cite${citationsReceived === 1 ? '' : 's'}`
                  : null
              }
            />
          </Tooltip>
        );
      })}
    </div>
  );
}


function StatTile({ label, level, isMax, footer }) {
  return (
    <div
      className={`
        flex flex-col items-center justify-center min-w-[5.5rem] px-2 py-1
        border border-gold-500/30 cursor-default
        ${isMax ? 'opacity-50 bg-teal-900/30' : 'bg-teal-900/60'}
      `}
    >
      <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-gold-400 leading-tight">
        {label}
      </span>
      <span className="font-display text-lg text-cream-50 leading-tight">
        {level}
      </span>
      {footer && (
        <span className="font-mono text-[8px] text-verdigris-400/90 leading-none mt-0.5">
          {footer}
        </span>
      )}
    </div>
  );
}

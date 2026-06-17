/**
 * StatsStrip — a strip of six stat tiles to sit between the bookshelf
 * and the hand. Each tile shows the full stat name on the top line and
 * the current level on the bottom line, and hovers a rich tooltip
 * explaining what the stat does.
 *
 * Renown tile also surfaces the live "you've been cited X times" count
 * and the pending end-of-game payout — both fed from the player's
 * citations_received_count.
 *
 * Stats are read-only here. The actual upgrade flow remains the modal
 * (MultiplayerUpgradeChooser), which pops when the server marks the
 * player with pending_upgrade after a publication.
 *
 * Tiles at their maximum level (4) are dimmed so the player can see at
 * a glance which stats can still be improved.
 */
import { STAT_TABLES } from '../hooks/useGameState.js';
import Tooltip from './Tooltip.jsx';

const STAT_LABELS = {
  research:         'Research',
  notebookCapacity: 'Notebook',
  influence:        'Influence',
  workspaces:       'Workspaces',
  reputation:       'Reputation',
  renown:           'Renown',
};

const STAT_ORDER = [
  'research',
  'notebookCapacity',
  'influence',
  'workspaces',
  'reputation',
  'renown',
];

// Tooltip body builders. Each gets the current level so it can show
// the player's effect AND the next-level effect, anchoring strategy.
const STAT_TOOLTIPS = {
  research: (level) => (
    <>
      <strong className="block font-display text-sm text-gold-300 mb-1">Research</strong>
      <span>How many cards you draw per Draw action.</span>
      <span className="block mt-1 text-cream-200/70">
        Levels: 3 → 5 → 7 → full notebook. Currently L{level}.
      </span>
    </>
  ),
  notebookCapacity: (level) => (
    <>
      <strong className="block font-display text-sm text-gold-300 mb-1">Notebook</strong>
      <span>How many cards you can hold at once.</span>
      <span className="block mt-1 text-cream-200/70">
        Levels: 7 → 11 → 15 → 25. Currently L{level}.
      </span>
    </>
  ),
  influence: (level) => (
    <>
      <strong className="block font-display text-sm text-gold-300 mb-1">Influence</strong>
      <span>Prestige bonus added to each publication's base score.</span>
      <span className="block mt-1 text-cream-200/70">
        Levels: +0 → +1 → +2 → +3 per evidence card (incl. citations). Currently L{level}.
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
      <strong className="block font-display text-sm text-gold-300 mb-1">Reputation</strong>
      <span>Lowers the minimum evidence needed to publish an article or book.</span>
      <span className="block mt-1 text-cream-200/70">
        L1: article ≥3, book ≥6 · L2: article ≥2 · L3: book ≥5 · L4: article ≥1, book ≥3. Currently L{level}.
      </span>
    </>
  ),
  renown: (level, citationsReceived = 0) => {
    const table = STAT_TABLES.renown;
    const mult = table[level - 1] ?? 1;
    const pending = citationsReceived * mult;
    return (
      <>
        <strong className="block font-display text-sm text-gold-300 mb-1">Renown</strong>
        <span>At end of game, each time your work was cited pays out × this multiplier.</span>
        <span className="block mt-1 text-cream-200/70">
          Levels: ×1 → ×2 → ×3 → ×6. Currently L{level} (×{mult}).
        </span>
        <span className="block mt-2 text-verdigris-400 font-mono text-[10px]">
          You've been cited {citationsReceived} {citationsReceived === 1 ? 'time' : 'times'}.
          {' '}Pending payout: +{pending} prestige.
        </span>
      </>
    );
  },
};

export default function StatsStrip({ statLevels, citationsReceived = 0 }) {
  return (
    <div className="flex items-stretch justify-center gap-2 px-6 py-2 border-y border-gold-500/20 bg-teal-950/40">
      {STAT_ORDER.map((key) => {
        const level = statLevels?.[key] ?? 1;
        const table = STAT_TABLES[key];
        const isMax = Array.isArray(table) && level >= table.length;
        // Renown tile is special: it shows the citation count + pending payout
        // both in its tooltip AND as a small footer line under the level number.
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
                  ? `cited ${citationsReceived}×`
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

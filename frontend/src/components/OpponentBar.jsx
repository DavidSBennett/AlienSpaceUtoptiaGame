/**
 * OpponentBar — compact horizontal opponent status (multi-row).
 *
 * Shows each opponent's name, color, prestige, year, and committed flag
 * in a tight strip suitable for a sidebar above the manuscript inbox.
 *
 * No more buried details — for full opponent state we use a hover-tip
 * with stat levels, books, articles.
 *
 * Props:
 *   opponents — state.opponents
 *   currentYear — number (game year)
 */
import { colorForPlayer } from '../lib/playerColors.js';
import { MP_STAT_TABLES, renownMultiplier, projectedScore } from '../lib/mpStats.js';

export default function OpponentBar({ opponents, currentYear }) {
  if (!opponents || opponents.length === 0) {
    return (
      <div className="p-2 font-mono text-[10px] uppercase tracking-[0.2em] text-cream-200/60 italic">
        No other historians.
      </div>
    );
  }

  return (
    <ul className="space-y-1.5">
      {opponents.map((op) => {
        const col = colorForPlayer(op);
        const capacity = MP_STAT_TABLES.notebookCapacity[(op.stat_levels.notebookCapacity || 1) - 1];
        const ghost = op.is_ghost;
        const gameOver = op.game_over_reason;

        const citations = op.citations_received_count ?? 0;
        const renownMult = renownMultiplier(op.stat_levels.renown);
        const projected = projectedScore(op.prestige, citations, op.stat_levels.renown);

        const tooltip = [
          `${op.player_name} — seat ${op.seat_index + 1}`,
          `Prestige ${op.prestige} · ${citations} citations · projected ${projected} (×${renownMult})`,
          `${op.articles_published} articles · ${op.books_published} books`,
          `Hand ${op.hand_size} / ${capacity}`,
          `Stats: R${op.stat_levels.research} N${op.stat_levels.notebookCapacity} I${op.stat_levels.influence} W${op.stat_levels.workspaces} P${op.stat_levels.reputation}`,
        ].join('\n');

        return (
          <li
            key={op.player_id}
            title={tooltip}
            className={`flex items-center gap-2 px-2 py-1.5 border ${col.border} ${col.accentBg} ${
              ghost || gameOver ? 'opacity-50' : ''
            }`}
          >
            {/* Color chip */}
            <span className={`w-2 h-6 ${col.spineBg}`} aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div className="font-display text-sm text-cream-50 truncate leading-tight">
                {op.player_name}
                {gameOver && (
                  <span className="ml-1 font-mono text-[9px] uppercase tracking-wider text-oxblood-300">
                    {gameOver === 'failed-comps' ? 'withdrew' : 'denied'}
                  </span>
                )}
              </div>
              <div className="font-mono text-[10px] text-cream-200/70 truncate leading-tight">
                {op.articles_published}a · {op.books_published}b
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="text-right leading-none">
                <span
                  className="font-display font-bold text-xl text-gold-300 tabular-nums"
                  title={`Prestige ${op.prestige}`}
                >
                  {op.prestige}
                </span>
                <div
                  className="font-mono text-[9px] text-cream-200/70 mt-0.5"
                  title={`Citations ${citations} · projected ${projected} (×${renownMult})`}
                >
                  {citations}c · <span className="text-verdigris-300">{projected} (×{renownMult})</span>
                </div>
              </div>
              <span className="text-sm font-mono w-3 text-center">
                {op.has_committed ? (
                  <span className="text-verdigris-400" title="Has ended their turn">✓</span>
                ) : (
                  <span className="text-cream-200/40" title="Still deciding">…</span>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

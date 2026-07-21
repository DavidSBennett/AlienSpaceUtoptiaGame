/**
 * StatsStrip — the upgrade bar under the notebook. Shared by solo, the seed
 * build and multiplayer, so all three read identically.
 *
 * Every tile is the same fixed width — wide enough for a two-word title on two
 * lines above the level number — and the title cell is a fixed two-line box
 * with its text centred both ways. One-word labels (Workspaces, Publicist)
 * therefore sit centred against the two-line ones rather than riding high.
 *
 * Tooltips share one structure: name, what the stat does, one row per upgrade
 * track, then the current level on its own row in a different face so it reads
 * as status rather than as another track.
 *
 * Tiles at their maximum level are dimmed.
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

/**
 * Render a stat's level ladder from the table actually in force, e.g.
 * "7 → 9 → 11 → 15". A hardcoded ladder would misinform whichever version
 * doesn't match it, so every ladder is built from the passed-in tables.
 */
function ladder(values, format = (v) => v) {
  return (values || []).map(format).join(' → ');
}

/**
 * Tooltip content, as data rather than markup, so every stat is guaranteed the
 * same shape: a lead sentence, then one row per upgrade track.
 */
const STAT_TOOLTIPS = {
  research: (tables) => ({
    lead: 'How many cards you draw per Draw action.',
    rows: [ladder(tables.research, (v) => (v === 'capacity' ? 'full notebook' : v))],
  }),
  notebookCapacity: (tables) => ({
    lead: 'Your hand limit — how many cards you can hold at once.',
    rows: [ladder(tables.notebookCapacity)],
  }),
  influence: (tables) => ({
    lead: 'A prestige bonus added to every evidence card in a publication, so it grows with article size.',
    rows: [`${ladder(tables.influence, (v) => `+${v}`)} per card`],
  }),
  workspaces: (tables) => ({
    lead: 'How many project slots you can have open at once. The final level also removes the year cost from publishing.',
    rows: [`${ladder((tables.workspaces || []).slice(0, 3))} → free publishing`],
  }),
  reputation: (tables) => ({
    lead: 'How many citation tokens you earn each time you attend a conference.',
    // One track now. The conference pool is a flat two cards per attendee and
    // no longer moves with this rank, so listing a fresh-card ladder here would
    // promise something the conference doesn't do.
    rows: [`Citations: ${ladder(tables.reputation)}`],
  }),
  renown: (tables) => ({
    lead: 'At end of game, your total citation tokens pay out × this multiplier.',
    rows: [ladder(tables.renown, (v) => `×${v}`)],
  }),
};

/**
 * One tooltip body. The current-level line is deliberately a different face
 * from the track rows above it — mono and spaced, under a rule — so the eye
 * separates "where you are" from "what the ladder is".
 */
function StatTooltip({ title, lead, rows, level, note }) {
  return (
    <div className="text-center">
      <strong className="block font-display text-sm text-gold-300 mb-1">{title}</strong>
      <p className="text-cream-50">{lead}</p>
      {rows.map((row) => (
        <p key={row} className="text-cream-200/70 mt-1">{row}</p>
      ))}
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-verdigris-300 border-t border-gold-500/25 mt-2 pt-1.5">
        Current level {level}
      </p>
      {note && (
        <p className="font-serif italic text-verdigris-400 text-xs mt-1.5">{note}</p>
      )}
    </div>
  );
}

export default function StatsStrip({
  statLevels,
  citationsReceived = 0,
  pendingUpgrade = 0,
  // The stat tables in force, so the ladders shown match the version played.
  tables = MP_STAT_TABLES,
}) {
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
          <StatTile
            label="Upgrade"
            value={Number(pendingUpgrade) > 1 ? `${pendingUpgrade} ready` : 'Ready'}
            highlight
          />
        </Tooltip>
      )}

      {STAT_ORDER.map((key) => {
        const level = statLevels?.[key] ?? 1;
        const table = tables[key];
        const isMax = Array.isArray(table) && level >= table.length;
        const { lead, rows } = STAT_TOOLTIPS[key](tables);

        // Renown alone carries a live figure: what the citations you already
        // hold are currently worth.
        const note = key === 'renown'
          ? `You hold ${citationsReceived} citation ${citationsReceived === 1 ? 'token' : 'tokens'} — pending payout +${citationsReceived * ((tables.renown || [])[level - 1] ?? 1)} prestige.`
          : null;

        return (
          <Tooltip
            key={key}
            content={(
              <StatTooltip title={STAT_LABELS[key]} lead={lead} rows={rows} level={level} note={note} />
            )}
            side="top"
            width="w-72"
          >
            <StatTile
              label={STAT_LABELS[key]}
              value={level}
              isMax={isMax}
              footer={
                key === 'renown' && citationsReceived > 0
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


/**
 * One tile. Fixed width across the whole bar, and a fixed two-line title box so
 * every tile's number sits on the same baseline no matter how long its name is.
 */
function StatTile({ label, value, isMax, footer, highlight = false }) {
  // One word per line, always. Left to wrap naturally, "Research Funding" fits
  // on a single line at this width while "Association Memberships" takes two,
  // and the bar loses the uniform word-over-word shape.
  const words = String(label).split(' ');

  return (
    <div
      className={`
        w-[5.75rem] flex flex-col items-center px-1.5 py-1 cursor-default
        ${highlight
          ? 'border-2 border-verdigris-400 bg-verdigris-500/20'
          : `border border-gold-500/30 ${isMax ? 'opacity-50 bg-teal-900/30' : 'bg-teal-900/60'}`}
      `}
    >
      {/* A fixed two-line box with its contents centred, so a one-word label
          (Workspaces, Publicist) sits level with the two-word ones instead of
          riding high, and every tile's number lands on the same baseline. */}
      <span
        className={`h-7 flex flex-col items-center justify-center text-center
          font-mono text-[9px] uppercase tracking-[0.1em] leading-tight
          ${highlight ? 'text-verdigris-300' : 'text-gold-400'}`}
      >
        {words.map((word) => <span key={word} className="block">{word}</span>)}
      </span>
      <span className="font-display text-lg text-cream-50 leading-tight">
        {value}
      </span>
      {footer && (
        <span className="font-mono text-[8px] text-verdigris-400/90 leading-none mt-0.5">
          {footer}
        </span>
      )}
    </div>
  );
}

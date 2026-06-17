/**
 * DrawZone — a tall clickable deck-stack visual that sits to the left
 * of the player's hand. Visually mirrors the single-player NotebookArea
 * deck stack so the multiplayer interface feels familiar.
 *
 * Clicking the deck sets the player's pending action to 'draw'. The
 * actual draw happens at year-end resolution, not on click. This
 * matches the multiplayer flow where actions are committed separately
 * from end-year.
 *
 * Visual states:
 *   - Idle / actionable: normal deck stack with "Draw N cards" overlay
 *   - Already-selected: highlighted with gold border to show selection
 *   - Disabled (hand full, no archive left, ghosted, etc.): dimmed
 *
 * Props:
 *   archiveRemaining — int, cards still undrawn in archive
 *   drawCount        — int, how many cards this player would draw
 *   handSize         — int, current hand size
 *   handCapacity     — int, max hand size given Notebook stat
 *   selected         — bool, true if pending_action === 'draw'
 *   committed        — bool, true if action_committed=1
 *   disabled         — bool, true if action picker is locked (busy or game over)
 *   onSelect         — () => void, set the player's pending action to draw
 */
export default function DrawZone({
  archiveRemaining,
  drawCount,
  handSize,
  handCapacity,
  selected,
  committed,
  disabled,
  onSelect,
}) {
  const room = Math.max(0, handCapacity - handSize);
  const wouldDraw = Math.min(drawCount, room, archiveRemaining);

  const handFull = handSize >= handCapacity;
  const archiveEmpty = archiveRemaining === 0;
  const canClick = !disabled && !committed && !handFull && !archiveEmpty;

  const title = handFull
    ? 'Notebook is full — discard or publish first'
    : archiveEmpty
    ? 'Archive is empty for now (will reshuffle from discards)'
    : committed
    ? 'Draw selected — uncommit to change'
    : `Click to draw ${wouldDraw} card${wouldDraw === 1 ? '' : 's'} when year ends`;

  return (
    <div className="flex-shrink-0 w-32 flex flex-col items-center" data-tutorial="draw-zone">
      <button
        type="button"
        onClick={onSelect}
        disabled={!canClick}
        title={title}
        className={`
          relative h-[12.5rem] w-28 group
          transition-transform duration-200 ease-desk
          ${canClick ? 'hover:-translate-y-1 cursor-pointer' : 'cursor-not-allowed opacity-50'}
          ${selected ? 'ring-2 ring-gold-400 ring-offset-2 ring-offset-teal-950' : ''}
        `}
      >
        <DeckStack count={archiveRemaining} />

        {canClick && (
          <div className="absolute inset-x-0 top-3 flex items-center justify-center pointer-events-none">
            <div className={`
              border px-2.5 py-1.5 shadow-lg transition-colors
              ${selected
                ? 'bg-gold-500 border-gold-300 text-teal-950'
                : 'bg-teal-900/85 border-gold-500 text-gold-300 group-hover:bg-teal-800/95'}
            `}>
              <p className="font-mono text-[10px] uppercase tracking-widest leading-none">
                Draw {wouldDraw > 0 ? wouldDraw : drawCount}
              </p>
            </div>
          </div>
        )}
      </button>

      <p className="font-mono text-[9px] uppercase tracking-wider text-cream-200 mt-2 text-center leading-tight">
        Draw cards
        <br />
        <span className="text-cream-200/60">at year-end</span>
      </p>
    </div>
  );
}


function DeckStack({ count }) {
  const layers = count === 0 ? 0 : count < 5 ? 1 : count < 15 ? 2 : 3;

  if (layers === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-cream-200 italic font-serif">
        empty
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {layers >= 3 && (
        <div
          className="absolute w-28 h-[12.5rem] border border-gold-500/30 surface-paper"
          style={{ transform: 'translate(6px, 4px)' }}
        />
      )}
      {layers >= 2 && (
        <div
          className="absolute w-28 h-[12.5rem] border border-gold-500/40 surface-paper"
          style={{ transform: 'translate(3px, 2px)' }}
        />
      )}
      <div className="absolute w-28 h-[12.5rem] border border-gold-500/60 surface-paper flex flex-col items-center justify-center">
        <p className="font-mono text-[9px] uppercase tracking-widest text-ink-700 mb-1">
          Archive
        </p>
        <p className="font-display text-3xl text-ink-900 leading-none">
          {count}
        </p>
        <p className="font-mono text-[9px] uppercase tracking-widest text-ink-700 mt-1">
          {count === 1 ? 'card' : 'cards'}
        </p>
      </div>
    </div>
  );
}

/**
 * ArchiveMarket — the four archive piles with their top card face-up.
 *
 * Shared by the solo board and the multiplayer board so the two read the same.
 * Cards render at the SAME size as every other card in play (CardThumbnail),
 * because the market is meant to look like real cards you're choosing between,
 * not like miniature decks.
 *
 * In multiplayer the market is on the board in EVERY phase, not just the draw
 * phase: seeing a card you want in the middle is exactly the information that
 * should push you to choose "draw" as your action for the year. Outside your
 * turn it's a face-up display (canTake=false) and clicks do nothing.
 *
 * Props:
 *   piles     — [{ top: card|null, count: number }], already normalized by the
 *               caller. Solo holds full arrays; MP gets tops from the server.
 *   canTake   — may the viewer take a card right now?
 *   onTake    — (pileIndex) => void
 *   caption   — line under the grid (allowance, whose turn, etc.)
 *   draggable — wrap tops in DraggableCard (solo only; MP draws server-side)
 *   focused   — lift above the draw focus mask
 *   footer    — extra control under the caption. Multiplayer puts the "spend
 *               the year drawing" action here, so the choice is made at the
 *               cards rather than at a separate deck elsewhere on the board.
 */
import { CardThumbnail } from './Card.jsx';
import DraggableCard from './DraggableCard.jsx';
import FleuronDivider from './FleuronDivider.jsx';

export default function ArchiveMarket({
  piles = [],
  canTake = false,
  onTake,
  caption = null,
  draggable = false,
  focused = false,
  footer = null,
}) {
  return (
    <aside
      data-tutorial="draw-zone"
      className={`shrink-0 flex flex-col overflow-y-auto ${focused ? 'relative z-50' : ''}`}
    >
      <div className="text-center">
        <span className="font-display text-sm uppercase tracking-[0.3em] text-gold-300">
          ❧ Archive ❧
        </span>
        <FleuronDivider className="my-1" />
      </div>

      {/* 2x2 of full-size cards. */}
      <div className="grid grid-cols-2 gap-1.5">
        {piles.map((pile, i) => {
          const top = pile?.top || null;
          const count = pile?.count || 0;
          const clickable = canTake && !!top;

          /* The thumbnail deliberately gets no onClick — the click bubbles up
             from here — and pointer events stay ON so the hover tooltip still
             works even when the card can't be taken. */
          const face = (
            <div
              onClick={() => clickable && onTake && onTake(i)}
              className={clickable ? 'cursor-pointer' : 'cursor-default'}
            >
              <CardThumbnail card={top} />
            </div>
          );

          return (
            <div key={i} className="relative">
              {top ? (
                draggable ? (
                  <DraggableCard
                    id={`archive-${i}-${top.id}`}
                    data={{ cardId: top.id, from: { kind: 'archive', pileIndex: i } }}
                    disabled={!clickable}
                  >
                    {({ dragHandleProps, isDragging }) => (
                      /* Click takes the card; dragging it out does the same (and
                         drops straight into a project if you aim there). The drag
                         sensor needs 6px of travel, so a plain click still fires. */
                      <div
                        {...dragHandleProps}
                        onClick={() => clickable && onTake && onTake(i)}
                        className={clickable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}
                      >
                        <CardThumbnail card={top} isDragging={isDragging} />
                      </div>
                    )}
                  </DraggableCard>
                ) : (
                  face
                )
              ) : (
                <div className="w-32 h-[12.5rem] border border-dashed border-gold-500/30 flex items-center justify-center">
                  <span className="font-serif italic text-cream-200/50 text-xs">empty</span>
                </div>
              )}
              {top && (
                <span className="absolute bottom-1 right-1 font-mono text-[8px] text-ink-700/70 bg-cream-50/80 px-1">
                  {count}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Fixed caption — any live pick counter belongs in the draw overlay, so
          this column's height never changes mid-draw (which used to push the
          notebook down). */}
      {caption && (
        <p className="font-mono text-[9px] uppercase tracking-wider text-cream-200 mt-2 text-center leading-snug">
          {caption}
        </p>
      )}

      {footer && <div className="mt-2">{footer}</div>}
    </aside>
  );
}

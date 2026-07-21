/**
 * NotebookArea — the player's hand at the bottom of the board.
 *
 * Shared by solo, the seed build and multiplayer so the notebook is literally
 * the same component in all three, rather than two implementations that drift.
 * Solo used to have its own: a taller footer with the count printed BELOW the
 * hand and no collapse at all.
 *
 * Collapsed, it becomes a single thin bar — but the bar is still a drop target,
 * so a card can be returned to the notebook without expanding first. The state
 * persists in user_settings (notebook_collapsed), so it survives reloads and
 * follows the player between devices.
 *
 * Props:
 *   hand, capacity            — the cards and the hand limit
 *   showTags, showSignificance
 *   onCardClick               — (card) => void
 *   dragGate                  — optional (card) => bool; the guided walkthrough
 *                               uses it to freeze cards outside the current step
 *   deckSlot                  — optional node rendered left of the hand. The
 *                               walkthrough puts its single deck + Draw button
 *                               here; a normal game draws from the archive
 *                               market instead and passes nothing.
 *   emptyMessage              — what to say when the hand is empty
 *   focused                   — lift above the draw focus mask
 *   pendingAction, pendingCommitted, drawCount
 *                             — multiplayer only, for the collapsed bar's
 *                               "draw N pending" note
 */
import { CardThumbnail } from './Card.jsx';
import DraggableCard from './DraggableCard.jsx';
import DroppableSlot from './DroppableSlot.jsx';
import HandSlot from './HandSlot.jsx';
import useUserSetting from '../auth/useUserSetting.js';

export default function NotebookArea({
  hand = [],
  capacity = 0,
  showTags,
  showSignificance,
  onCardClick,
  dragGate,
  deckSlot = null,
  emptyMessage = 'Notebook empty. Take cards from the archive beside the conclusions.',
  focused = false,
  pendingAction,
  pendingCommitted,
  drawCount,
}) {
  const [collapsed, setCollapsed] = useUserSetting('notebook_collapsed', false);
  function toggleCollapsed() {
    setCollapsed(!collapsed);
  }

  return (
    <section
      className={`surface-wood border-y border-wood-900 px-6 ${
        collapsed ? 'py-1.5' : 'py-3 min-h-[14rem]'
      } ${focused ? 'relative z-50' : ''}`}
    >
      {collapsed ? (
        /* Collapsed: a single thin bar, giving back the vertical real estate.
           The drop target moves onto the bar so cards can still be returned
           here without expanding first. */
        <DroppableSlot id="hand-drop" data={{ to: { kind: 'hand' } }}>
          <button
            onClick={toggleCollapsed}
            className="
              w-full flex items-center gap-3
              font-mono text-[10px] uppercase tracking-[0.3em] text-cream-50/90
              hover:text-cream-50 transition-colors
            "
            title="Expand notebook"
            aria-expanded="false"
          >
            <span aria-hidden="true" className="inline-block w-3 text-center">▸</span>
            <span>Research Notebook · {hand.length} / {capacity}</span>
            {pendingAction === 'draw' && (
              <span className="text-verdigris-400 font-serif italic normal-case tracking-normal">
                · draw {drawCount} pending{pendingCommitted ? ' (committed)' : ''}
              </span>
            )}
            <span className="ml-auto text-cream-200/40 font-serif italic normal-case tracking-normal text-[10px]">
              click to expand
            </span>
          </button>
        </DroppableSlot>
      ) : (
        <div className="flex gap-6">
          {deckSlot}

          {/* The hand. Header shows count + a chevron toggle. */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={toggleCollapsed}
                className="
                  flex items-center gap-2
                  font-mono text-[10px] uppercase tracking-[0.3em] text-cream-50/90
                  hover:text-cream-50 transition-colors
                "
                title="Collapse notebook"
                aria-expanded="true"
              >
                <span aria-hidden="true" className="inline-block w-3 text-center">▾</span>
                Research Notebook · {hand.length} / {capacity}
              </button>
            </div>

            <DroppableSlot id="hand-drop" data={{ to: { kind: 'hand' } }}>
              {/* justify-center centres each ROW independently, so a wrapped
                  second line stays centred too; content-start keeps the rows
                  stacked from the top rather than spread down the notebook. */}
              <div className="flex flex-wrap justify-center content-start gap-2 min-h-[100px]">
                {hand.length === 0 ? (
                  <p className="font-serif italic text-cream-200/60 self-center mx-auto">
                    {emptyMessage}
                  </p>
                ) : (
                  hand.map((card, i) => (
                    <HandSlot key={`hand-${card.id}`} index={i} cardId={card.id}>
                      <DraggableCard
                        id={`hand-${card.id}`}
                        data={{ cardId: card.id, from: { kind: 'hand' } }}
                        disabled={dragGate ? !dragGate(card) : false}
                      >
                        {({ dragHandleProps, isDragging, disabled: dragDisabled }) => (
                          <div
                            {...dragHandleProps}
                            className={`${isDragging ? 'opacity-50' : ''} ${dragDisabled ? 'opacity-30' : ''}`}
                          >
                            <CardThumbnail
                              card={card}
                              onClick={() => onCardClick?.(card)}
                              showTags={showTags}
                              showSignificance={showSignificance}
                              isDragging={isDragging}
                            />
                          </div>
                        )}
                      </DraggableCard>
                    </HandSlot>
                  ))
                )}
              </div>
            </DroppableSlot>
          </div>
        </div>
      )}
    </section>
  );
}

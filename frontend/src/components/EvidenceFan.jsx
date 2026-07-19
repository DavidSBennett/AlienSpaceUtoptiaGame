import { useMemo } from 'react';
import { getCardTags } from '../lib/tags.js';

/**
 * EvidenceFan — a fanned-card visualization of an argument.
 *
 * The conclusion card sits on the right (on top); the evidence cards fan out to
 * its left, each card's left strip staying exposed. Every evidence card is
 * marked as either supporting the conclusion (it shares a tag with the thesis)
 * or not.
 *
 * Read-only by default (the solo publish-result modal). Pass `flaggable` with a
 * `flagged` Set and `onToggleFlag` to let a reviewer click cards to flag the
 * evidence that doesn't fit (the multiplayer peer-review phase).
 *
 * Props:
 *   evidence     — array of full evidence card objects (argument/sub_argument)
 *   conclusion   — the full conclusion card object
 *   flaggable    — when true, evidence cards are clickable to toggle a flag
 *   flagged      — Set of flagged idCards (only used when flaggable)
 *   onToggleFlag — (idCard) => void (only used when flaggable)
 */
export default function EvidenceFan({
  evidence = [],
  conclusion,
  flaggable = false,
  flagged,
  onToggleFlag,
}) {
  const conclusionTags = useMemo(() => getCardTags(conclusion || {}), [conclusion]);

  const matchInfo = useMemo(
    () =>
      (evidence || []).map((card) => {
        const tags = Array.from(getCardTags(card));
        const matches = tags.some((t) => conclusionTags.has(t));
        return { card, tags, matches };
      }),
    [evidence, conclusionTags]
  );

  if (!conclusion) return null;

  const cards = [
    ...matchInfo.map((m) => ({ ...m, isConclusion: false })),
    { card: conclusion, tags: Array.from(conclusionTags), matches: true, isConclusion: true },
  ];
  const total = cards.length;
  const CARD_W = 112;
  // Compress the horizontal step when there are many cards so the whole fan
  // stays within the modal without a scrollbar (a book can carry many cards).
  const OFFSET = Math.max(34, Math.min(62, Math.floor((600 - CARD_W) / Math.max(1, total - 1))));
  const mid = (total - 1) / 2;
  const width = (total - 1) * OFFSET + CARD_W;

  return (
    <div className="flex justify-center">
      <div className="relative" style={{ height: 150, width }}>
        {cards.map((c, k) => {
          const angle = (k - mid) * 4; // gentle fan
          const cardId = c.card?.idCard ?? c.card?.id;
          const isFlagged = flaggable && !c.isConclusion && !!flagged?.has(cardId);
          const clickable = flaggable && !c.isConclusion;
          const commonStyle = {
            left: k * OFFSET,
            transformOrigin: 'bottom center',
            transform: `rotate(${angle}deg)`,
            zIndex: k + 1,
          };
          const commonClass =
            'absolute bottom-0 transition-transform hover:-translate-y-1 hover:z-[200]';
          const inner = (
            <MiniCard
              card={c.card}
              tags={c.tags}
              matches={c.matches}
              isConclusion={c.isConclusion}
              conclusionTags={conclusionTags}
              flaggable={clickable}
              flagged={isFlagged}
            />
          );

          if (clickable) {
            return (
              <button
                key={cardId ?? k}
                type="button"
                onClick={() => onToggleFlag(cardId)}
                className={`${commonClass} cursor-pointer`}
                style={commonStyle}
                title="Click to flag / unflag this evidence"
              >
                {inner}
              </button>
            );
          }
          return (
            <div
              key={c.isConclusion ? 'conclusion' : (cardId ?? k)}
              className={commonClass}
              style={commonStyle}
              title={c.card?.title}
            >
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A small card. Tags stack in a column at the top-left (the exposed strip). */
function MiniCard({ card, tags, matches, isConclusion, conclusionTags, flaggable, flagged }) {
  const border = isConclusion
    ? 'border-gold-500 bg-cream-50'
    : matches
    ? 'border-verdigris-500 bg-cream-100'
    : 'border-oxblood-500 bg-cream-100';
  return (
    <div
      className={`relative w-[112px] h-[140px] rounded-md border-2 shadow-lg p-1.5 flex flex-col text-left ${border} ${
        flagged ? 'ring-2 ring-oxblood-500 ring-offset-1' : ''
      }`}
    >
      {/* Top-left strip: support badge + tags stacked, so they stay visible. */}
      <div className="flex flex-col items-start gap-1">
        <span
          className={`font-mono text-[8px] uppercase tracking-wide px-1 py-0.5 rounded ${
            isConclusion
              ? 'bg-gold-500 text-ink-900'
              : matches
              ? 'bg-verdigris-500 text-cream-50'
              : 'bg-oxblood-500 text-cream-50'
          }`}
        >
          {isConclusion ? 'Thesis' : matches ? '✓ supports' : '✕ off-topic'}
        </span>
        {(tags || []).map((t) => {
          const isMatchTag = isConclusion || conclusionTags?.has(t);
          return (
            <span
              key={t}
              className={`font-mono text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                isConclusion
                  ? 'bg-gold-500 text-ink-900 border-gold-700'
                  : isMatchTag
                  ? 'bg-verdigris-500 text-cream-50 border-verdigris-700'
                  : 'bg-cream-300 text-ink-700 border-cream-400'
              }`}
            >
              {t}
            </span>
          );
        })}
        {(!tags || tags.length === 0) && (
          <span className="font-mono text-[9px] uppercase text-ink-700/60">no tag</span>
        )}
      </div>

      <div className="flex-1 flex items-end pb-0.5">
        <span className="font-display text-[10px] text-ink-900 leading-tight">{card?.title}</span>
      </div>

      {/* Flag affordance for reviewers */}
      {flaggable && (
        <span
          className={`absolute bottom-1 right-1 font-mono text-[8px] uppercase tracking-wide px-1 rounded ${
            flagged ? 'bg-oxblood-500 text-cream-50' : 'bg-cream-300 text-ink-700'
          }`}
        >
          {flagged ? '⚑ flagged' : 'flag'}
        </span>
      )}
    </div>
  );
}

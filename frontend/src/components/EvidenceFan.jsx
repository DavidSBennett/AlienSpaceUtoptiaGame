import { useMemo } from 'react';
import { getCardTags } from '../lib/tags.js';

/**
 * EvidenceFan — a read-only fanned-card visualization of a published argument.
 *
 * The conclusion card sits on the right (on top); the evidence cards fan out to
 * its left, each card's left strip staying exposed. Every evidence card is
 * marked as either supporting the conclusion (it shares a tag with the thesis)
 * or not. Used in the solo publish-result modal; mirrors the peer-review
 * visualizer's look, minus the interactive flagging.
 *
 * Props:
 *   evidence   — array of full evidence card objects (with argument/sub_argument)
 *   conclusion — the full conclusion card object
 */
export default function EvidenceFan({ evidence = [], conclusion }) {
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
      <div className="relative" style={{ height: 178, width }}>
        {cards.map((c, k) => {
          const angle = (k - mid) * 4; // gentle fan
          return (
            <div
              key={c.isConclusion ? 'conclusion' : (c.card?.idCard ?? c.card?.id ?? k)}
              className="absolute bottom-0 transition-transform hover:-translate-y-1 hover:z-[200]"
              style={{
                left: k * OFFSET,
                transformOrigin: 'bottom center',
                transform: `rotate(${angle}deg)`,
                zIndex: k + 1,
              }}
              title={c.card?.title}
            >
              <MiniCard
                card={c.card}
                tags={c.tags}
                matches={c.matches}
                isConclusion={c.isConclusion}
                conclusionTags={conclusionTags}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A small card. Tags stack in a column at the top-left (the exposed strip). */
function MiniCard({ card, tags, matches, isConclusion, conclusionTags }) {
  const border = isConclusion
    ? 'border-gold-500 bg-cream-50'
    : matches
    ? 'border-verdigris-500 bg-cream-100'
    : 'border-oxblood-500 bg-cream-100';
  return (
    <div
      className={`relative w-[112px] h-[168px] rounded-md border-2 shadow-lg p-2 flex flex-col text-left ${border}`}
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
    </div>
  );
}

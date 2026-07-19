import { useMemo } from 'react';
import { getCardTags } from '../lib/tags.js';

/**
 * EvidenceFan — a fanned-card visualization of an argument.
 *
 * The conclusion card sits on the right (on top); the evidence cards — and any
 * cited works, which are just cards from earlier publications — fan out to its
 * left. Every card is marked as supporting the conclusion (it shares a tag with
 * the thesis) or off-topic.
 *
 * Read-only by default (the solo publish-result modal). Pass the flagging props
 * to let a reviewer click cards to flag what doesn't fit (the multiplayer
 * peer-review phase). Evidence cards and citations flag independently:
 *   - evidence: flaggable + flagged (Set of idCard) + onToggleFlag(idCard)
 *   - citations: worksFlaggable + flaggedWorks (Set of work_id) + onToggleFlagWork(work_id)
 *
 * Props:
 *   evidence     — full evidence card objects (argument/sub_argument)
 *   citations    — cited works [{ work_id, publication_title, conclusion_tag, kind, writer_name }]
 *   conclusion   — the full conclusion card object
 */
export default function EvidenceFan({
  evidence = [],
  citations = [],
  conclusion,
  flaggable = false,
  flagged,
  onToggleFlag,
  worksFlaggable = false,
  flaggedWorks,
  onToggleFlagWork,
}) {
  const conclusionTags = useMemo(() => getCardTags(conclusion || {}), [conclusion]);

  const evItems = useMemo(
    () =>
      (evidence || []).map((card) => {
        const tags = Array.from(getCardTags(card));
        return {
          type: 'card',
          id: card?.idCard ?? card?.id,
          title: card?.title,
          tags,
          matches: tags.some((t) => conclusionTags.has(t)),
        };
      }),
    [evidence, conclusionTags]
  );

  const citeItems = useMemo(
    () =>
      (citations || []).map((w) => {
        const tag = (w?.conclusion_tag ?? '').toString().trim();
        const tags = tag ? [tag] : [];
        return {
          type: 'citation',
          id: w?.work_id,
          title: w?.publication_title,
          kind: w?.kind,
          tags,
          matches: tags.some((t) => conclusionTags.has(t)),
        };
      }),
    [citations, conclusionTags]
  );

  if (!conclusion) return null;

  const items = [
    ...evItems.map((m) => ({ ...m, isConclusion: false })),
    ...citeItems.map((m) => ({ ...m, isConclusion: false })),
    { type: 'conclusion', title: conclusion?.title, tags: Array.from(conclusionTags), matches: true, isConclusion: true },
  ];
  const total = items.length;
  const CARD_W = 112;
  // Compress the horizontal step when there are many cards so the whole fan
  // stays within the modal without a scrollbar.
  const OFFSET = Math.max(34, Math.min(62, Math.floor((600 - CARD_W) / Math.max(1, total - 1))));
  const mid = (total - 1) / 2;
  const width = (total - 1) * OFFSET + CARD_W;

  const kindLabel = (k) => (k === 'book' ? 'Book' : k === 'conference' ? 'Conf. paper' : 'Article');

  return (
    <div className="flex justify-center">
      <div className="relative" style={{ height: 150, width }}>
        {items.map((it, k) => {
          const angle = (k - mid) * 4; // gentle fan

          let clickable = false;
          let isFlagged = false;
          let onClick;
          if (it.type === 'card' && flaggable) {
            clickable = true;
            isFlagged = !!flagged?.has(it.id);
            onClick = () => onToggleFlag(it.id);
          } else if (it.type === 'citation' && worksFlaggable) {
            clickable = true;
            isFlagged = !!flaggedWorks?.has(it.id);
            onClick = () => onToggleFlagWork(it.id);
          }

          const style = {
            left: k * OFFSET,
            transformOrigin: 'bottom center',
            transform: `rotate(${angle}deg)`,
            zIndex: k + 1,
          };
          const cls = 'absolute bottom-0 transition-transform hover:-translate-y-1 hover:z-[200]';
          const inner = (
            <MiniCard
              title={it.title}
              tags={it.tags}
              matches={it.matches}
              isConclusion={it.isConclusion}
              conclusionTags={conclusionTags}
              flaggable={clickable}
              flagged={isFlagged}
              citationKind={it.type === 'citation' ? kindLabel(it.kind) : null}
            />
          );

          if (clickable) {
            return (
              <button
                key={`${it.type}-${it.id ?? k}`}
                type="button"
                onClick={onClick}
                className={`${cls} cursor-pointer`}
                style={style}
                title="Click to flag / unflag"
              >
                {inner}
              </button>
            );
          }
          return (
            <div
              key={it.isConclusion ? 'conclusion' : `${it.type}-${it.id ?? k}`}
              className={cls}
              style={style}
              title={it.title}
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
function MiniCard({ title, tags, matches, isConclusion, conclusionTags, flaggable, flagged, citationKind }) {
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
      {/* Top-left strip: support badge + optional citation marker + tags. */}
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
        {citationKind && (
          <span className="font-mono text-[7px] uppercase tracking-wide px-1 py-0.5 rounded bg-teal-800 text-cream-50">
            cited · {citationKind}
          </span>
        )}
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
        <span className="font-display text-[10px] text-ink-900 leading-tight">{title}</span>
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

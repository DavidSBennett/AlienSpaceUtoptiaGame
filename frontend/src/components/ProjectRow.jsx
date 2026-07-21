import { CardThumbnail, ConclusionTile } from './Card.jsx';
import DraggableCard from './DraggableCard.jsx';
import DroppableSlot from './DroppableSlot.jsx';
import CitationThumbnail from './CitationThumbnail.jsx';
import { EvidenceSpine, ConclusionProjectSpine } from './EvidenceSpine.jsx';
import Tooltip from './Tooltip.jsx';
import { computePrestigeMpPreview } from '../lib/validation.js';

/**
 * ProjectRow — a single research project workspace, laid out horizontally.
 *
 *   Expanded:
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ ▾ PROJECT 1                              [4 evidence · with concl] │
 *   ├──────────┬──────────────────────────────────────────────┬──────────┤
 *   │          │ ┌────┐ ┌────┐ ┌────┐ ┌──────┐                │  PUBLISH │
 *   │  Conc    │ │ ev │ │ ev │ │ ev │ │empty │   (scrolls →)  │   ────   │
 *   │          │ └────┘ └────┘ └────┘ └──────┘                │          │
 *   └──────────┴──────────────────────────────────────────────┴──────────┘
 *
 *   Collapsed (just the bar):
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ ▸ PROJECT 1                              [4 evidence · with concl] │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Clicking anywhere on the top bar toggles between expanded and collapsed.
 * When collapsed, the work area is hidden and drag-and-drop is NOT accepted —
 * the player must expand the project first to add cards.
 *
 * Locked projects render a similar single bar but can't be expanded; they
 * show a "Requires workspace upgrade" message instead of a badge.
 *
 * Interactions on placed cards (expanded only):
 *  - Click: opens the card modal (via onCardClick)
 *  - Drag: moves the card to another zone (via DndContext in Game.jsx)
 *  - Right-click (context menu): returns the card to its origin
 *
 * @param {boolean}  collapsed         render only the header bar
 * @param {Function} onToggleCollapse  () => void
 * @param {Function} onReturnToHand    (cardId, from) => void
 */
export default function ProjectRow({
  project,
  locked = false,
  collapsed = false,
  onToggleCollapse,
  showTags,
  showSignificance,
  onCardClick,
  onPublish,
  onAttendConference,
  onReturnToHand,
  onRemoveCitation,
  useSpines = false,
  articleMin = 2,
  freePublishing = false,
  statLevels = {},
  lockPublish = false,
  lockConference = false,
}) {
  if (locked) {
    return <LockedRow projectId={project.id} />;
  }

  const projectNumber = project.id + 1;

  // Build the badge string shown on the right of the header bar:
  // "4 evidence · with conclusion" or "0 evidence · no conclusion" etc.
  // For multiplayer projects that have citations, include the count.
  const evidenceCount = project.evidence?.length || 0;
  const citationCount = project.citations?.length || 0;
  const hasConclusion = !!project.conclusion;
  const badgeText = (
    `${evidenceCount} evidence${citationCount > 0 ? ` · ${citationCount} cite` : ''} · ${hasConclusion ? 'with conclusion' : 'no conclusion'}`
  );

  // Header bar — always rendered, identical whether expanded or collapsed.
  // The chevron rotates to indicate state; clicking anywhere on the bar
  // toggles via onToggleCollapse.
  const headerBar = (
    <button
      type="button"
      onClick={onToggleCollapse}
      className="w-full border-b border-wood-900 bg-wood-800 hover:bg-wood-700 transition-colors px-3 py-1 flex items-center justify-between gap-3 flex-shrink-0 text-left"
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? 'Expand' : 'Collapse'} Project ${projectNumber}`}
    >
      <span className="flex items-center gap-2 flex-shrink-0">
        <span
          className="font-mono text-xs text-gold-400 transition-transform inline-block"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)' }}
        >
          ▾
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream-100/80">
          Project {projectNumber}
        </span>
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-cream-100">
        {badgeText}
      </span>
    </button>
  );

  // Collapsed: just the header bar, nothing below.
  if (collapsed) {
    return (
      <div className="surface-wood relative w-full flex flex-col rounded-sm shadow-card overflow-hidden">
        {headerBar}
      </div>
    );
  }

  // Expanded: header bar + the work area.
  return (
    <div className="surface-wood relative w-full flex flex-col rounded-sm shadow-card overflow-hidden">

      {headerBar}

      {/* The horizontal work area: conclusion on the left, evidence flowing right,
          publish button anchored at the right end. */}
      <div className="flex">

        {/* === Conclusion column — fixed left, always visible.
              In MP context (useSpines=true), renders as a vertical
              spine to save horizontal space. In SP, full tile. === */}
        <div className={`flex-shrink-0 ${useSpines ? 'px-3' : 'px-4'} py-2 border-r border-gold-500/30 flex items-center`}>
          {project.conclusion ? (
            <DraggableCard
              id={`conclusion-project-${project.id}`}
              data={{
                cardId: project.conclusion.id,
                from: { kind: 'projectConclusion', projectId: project.id },
              }}
            >
              {({ dragHandleProps, isDragging }) => (
                <div
                  {...(useSpines ? {} : dragHandleProps)}
                  className={isDragging ? 'opacity-50' : ''}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onReturnToHand?.(project.conclusion.id, {
                      kind: 'projectConclusion',
                      projectId: project.id,
                    });
                  }}
                >
                  {useSpines ? (
                    <ConclusionProjectSpine
                      card={project.conclusion}
                      onClick={() => onCardClick?.(project.conclusion)}
                      dragHandleProps={dragHandleProps}
                    />
                  ) : (
                    <ConclusionTile
                      card={project.conclusion}
                      onClick={() => onCardClick?.(project.conclusion)}
                      showTags={showTags}
                      showSignificance={showSignificance}
                    />
                  )}
                </div>
              )}
            </DraggableCard>
          ) : (
            <DroppableSlot
              id={`drop-conclusion-${project.id}`}
              data={{ to: { kind: 'projectConclusion', projectId: project.id } }}
              className={`${useSpines ? 'w-24' : 'w-32'} flex items-center justify-center`}
              /* In spine mode this empty slot was 7rem — twice the height of a
                 placed spine — so an empty project was the tallest row on the
                 board. Match the spine it will be replaced by. */
              style={{ height: useSpines ? '3.5rem' : '7rem' }}
            >
              {/* The accepting slot keeps the boxy look even in spine mode —
                  only the PLACED card turns into a spine. */}
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream-100 text-center">
                Conclusion
                <br />
                tile
              </p>
            </DroppableSlot>
          )}
        </div>

        {/* === Evidence rail — flows right, scrolls horizontally if it overflows === */}
        <div className="flex-1 min-w-0 overflow-x-auto">
          <div className="flex gap-3 px-4 py-2 items-center">

            {project.evidence.map((card) => (
              <DraggableCard
                key={`evidence-${card.id}-p${project.id}`}
                id={`evidence-${card.id}-p${project.id}`}
                data={{
                  cardId: card.id,
                  from: { kind: 'projectEvidence', projectId: project.id },
                }}
              >
                {({ dragHandleProps, isDragging }) => (
                  <div
                    {...(useSpines ? {} : dragHandleProps)}
                    className={`flex-shrink-0 ${isDragging ? 'opacity-50' : ''}`}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onReturnToHand?.(card.id, {
                        kind: 'projectEvidence',
                        projectId: project.id,
                      });
                    }}
                  >
                    {useSpines ? (
                      <EvidenceSpine
                        card={card}
                        onClick={() => onCardClick?.(card)}
                        dragHandleProps={dragHandleProps}
                      />
                    ) : (
                      <CardThumbnail
                        card={card}
                        size="md"
                        onClick={() => onCardClick?.(card)}
                        showTags={showTags}
                        showSignificance={showSignificance}
                      />
                    )}
                  </div>
                )}
              </DraggableCard>
            ))}

            {/* Citation cards — rendered after evidence, in author-color.
                Citations whose conclusion_tag doesn't match this project's
                conclusion are visually flagged; submitting with mismatched
                citations will auto-reject the manuscript at resolve time. */}
            {(project.citations || []).map((citation) => {
              const concTags = project.conclusion?.argument
                ? String(project.conclusion.argument).split(',').map((s) => s.trim()).filter(Boolean)
                : [];
              const isInvalid = concTags.length > 0
                && !concTags.includes(citation.conclusion_tag);
              return (
                <div
                  key={`citation-${citation.citation_id}`}
                  className="flex-shrink-0"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onRemoveCitation?.(citation);
                  }}
                >
                  <CitationThumbnail
                    citation={citation}
                    isInvalid={isInvalid}
                    showTags={showTags}
                  />
                </div>
              );
            })}

            {/* Always-present empty slot — invites the next drop.
                Sized to match either the spine treatment (thin vertical)
                or the card treatment (wider rectangle). */}
            <DroppableSlot
              id={`drop-evidence-${project.id}`}
              data={{ to: { kind: 'projectEvidence', projectId: project.id } }}
              className="w-40 flex items-center justify-center flex-shrink-0"
              style={{ height: '8rem' }}
            >
              {/* The accepting slot keeps the boxy look even in spine mode —
                  only the PLACED card turns into a spine. */}
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream-100 text-center">
                Evidence
                <br />
                card
              </p>
            </DroppableSlot>

          </div>
        </div>

        {/* === Publish column — fixed right, always reachable === */}
        <PublishColumn project={project} onPublish={onPublish} onAttendConference={onAttendConference} articleMin={articleMin} freePublishing={freePublishing} statLevels={statLevels} lockPublish={lockPublish} lockConference={lockConference} />

      </div>
    </div>
  );
}


/**
 * PublishColumn — the right-anchored "Submit for Publication" button.
 *
 * Disabled until the project has a conclusion + at least articleMin
 * evidence cards (default 2, lowered to 1 by Reputation L2+).
 *
 * The button uses an oxblood color so it stands out from the gold accents
 * elsewhere — it's a momentous action, not a routine one.
 */
function PublishColumn({ project, onPublish, onAttendConference, articleMin = 2, freePublishing = false, statLevels = {}, lockPublish = false, lockConference = false }) {
  const hasConclusion = project.conclusion !== null;
  const evidenceCount = project.evidence.length;
  // `lock*` come from Tutorial mode — they keep the button visibly disabled
  // until the guided step says it's time, without changing the real rules.
  const canPublish = hasConclusion && evidenceCount >= articleMin && !lockPublish;
  // A conference needs at least one staged evidence card (no conclusion).
  const canConference = evidenceCount >= 1 && !lockConference;

  // Helpful tooltip text when disabled
  const needed = articleMin - evidenceCount;
  const reason = !hasConclusion
    ? 'Add a conclusion tile'
    : evidenceCount < articleMin
    ? `Add at least ${needed} more piece${needed === 1 ? '' : 's'} of evidence`
    : null;

  // Live estimated-prestige preview, assuming tags will line up. Mirrors
  // mp_compute_prestige server-side. The actual result depends on
  // citation-tag validity AND on whether reviewers (or auto-rejection)
  // change the outcome — so this is an upper bound under the
  // "everything works" assumption.
  const preview = canPublish
    ? computePrestigeMpPreview(project.evidence, project.citations || [], statLevels.influence || 1, project.conclusion?.bonus || 0)
    : null;

  const richTooltip = preview ? (
    <>
      <strong className="block font-display text-sm text-gold-300 mb-1">
        Estimated prestige: +{preview.total}
      </strong>
      <span className="block text-cream-200/80">
        Assumes peer reviewers approve and all citation tags match your conclusion.
      </span>
      <div className="mt-2 pt-2 border-t border-gold-500/20 font-mono text-[10px] text-cream-200/70 space-y-0.5">
        <div>Real evidence: {preview.realEvidenceCount}</div>
        {preview.citationBonus > 0 && (
          <div>Citations: +{preview.citationBonus} prestige</div>
        )}
        {preview.bonusSum > 0 && (
          <div>Card bonuses: +{preview.bonusSum}</div>
        )}
        {preview.conclusionBonus > 0 && (
          <div>Conclusion bonus: +{preview.conclusionBonus}</div>
        )}
        {preview.influenceBonus > 0 && (
          <div>Influence: +{preview.influenceBonus}</div>
        )}
        <div className="text-cream-50">Base: {preview.base}</div>
        {preview.doubled && (
          <div className="text-verdigris-400">
            Doubled (all evidence shares {preview.contextField})!
          </div>
        )}
      </div>
      <span className="block mt-2 text-cream-200/60 text-[11px] italic">
        {freePublishing ? 'Free publish (no year cost)' : 'Costs 1 year'}
      </span>
    </>
  ) : reason;

  return (
    /* Side by side rather than stacked: two buttons in a column were the
       tallest thing in the row and set its height on their own. */
    <div className="flex-shrink-0 px-3 py-2 border-l border-gold-500/30 flex items-center justify-center gap-2">
      <div className="flex flex-col items-center gap-0.5">
        <Tooltip content={richTooltip} side="left" width="w-72">
          <button
            type="button"
            onClick={() => canPublish && onPublish?.(project.id)}
            disabled={!canPublish}
            data-tutorial={canPublish ? 'publish-button' : undefined}
            className={`
              font-display font-bold uppercase tracking-[0.12em] text-xs leading-tight
              px-3 py-2 border-2 transition-all duration-200 ease-desk
              ${canPublish
                ? 'bg-oxblood-500 hover:bg-oxblood-600 text-cream-50 border-oxblood-600 hover:shadow-card-hover hover:-translate-y-0.5 cursor-pointer'
                : 'bg-wood-900 text-cream-100/70 border-wood-800 cursor-not-allowed'
              }
            `}
          >
            Submit
            <br />
            for Review
          </button>
        </Tooltip>
        <p className={`font-mono text-[8px] uppercase tracking-wider text-center ${canPublish ? 'text-cream-100' : 'text-cream-100/70'}`}>
          {freePublishing ? 'free' : '+ 1 year'}
        </p>
      </div>

      {/* Attend a Conference — stage cards here and swap them at a conference.
          Needs at least one staged card; no conclusion required. */}
      <Tooltip
        content="Send the staged cards to a conference to swap them for others (and earn citation tokens by your reputation). No conclusion needed."
        side="left"
        width="w-64"
      >
        <button
          type="button"
          onClick={() => canConference && onAttendConference?.(project.id)}
          disabled={!canConference}
          data-tutorial={canConference ? 'conference-button' : undefined}
          className={`
            font-mono text-[9px] uppercase tracking-[0.1em] leading-tight
            px-2 py-2 border transition-all duration-200 ease-desk
            ${canConference
              ? 'bg-teal-800 hover:bg-teal-700 text-cream-50 border-gold-500/60 hover:border-gold-400 cursor-pointer'
              : 'bg-wood-900 text-cream-100/60 border-wood-800 cursor-not-allowed'
            }
          `}
        >
          Attend
          <br />
          Conference
        </button>
      </Tooltip>
    </div>
  );
}


/**
 * LockedRow — dimmed project bar for slots not yet unlocked
 * by the workspaces stat. Visually similar to a collapsed project bar
 * (so the layout stays uniform), but non-interactive and shows a
 * "locked" indicator instead of evidence/conclusion counts.
 */
function LockedRow({ projectId }) {
  const projectNumber = projectId + 1;
  // Note: this row is intentionally "dimmed" to read as locked/inactive,
  // but we achieve that with muted-yet-compliant solid colors rather than
  // a parent opacity, since opacity would drag every child's text below
  // the WCAG contrast minimum.
  return (
    <div className="surface-wood relative w-full flex flex-col rounded-sm overflow-hidden">
      <div className="border-b border-wood-900 bg-wood-800 px-3 py-2 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 flex-shrink-0">
          <span className="font-mono text-xs text-gold-400">🔒</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream-200">
            Project {projectNumber}
          </span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-cream-200 italic">
          Locked · upgrade workspaces
        </span>
      </div>
    </div>
  );
}

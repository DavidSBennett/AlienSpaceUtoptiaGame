import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core';

import { fetchCards, submitScore } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { CardThumbnail, CardModal, ConclusionTile, ConclusionSpine } from '../components/Card.jsx';
import DraggableCard from '../components/DraggableCard.jsx';
import ProjectRow from '../components/ProjectRow.jsx';
import PublishResultDialog from '../components/PublishResultDialog.jsx';
import NarrativeModal from '../components/NarrativeModal.jsx';
import NarrativeToggle from '../components/NarrativeToggle.jsx';
import TutorialManager from '../components/TutorialManager.jsx';
import { SOLO_TUTORIALS } from '../lib/soloTutorials.jsx';
import useUserSetting from '../auth/useUserSetting.js';
import UpgradeChooserDialog from '../components/UpgradeChooserDialog.jsx';
import SoloConferenceModal from '../components/SoloConferenceModal.jsx';
import Leaderboard from '../components/Leaderboard.jsx';
import TagsToggle from '../components/TagsToggle.jsx';
import SignificanceToggle from '../components/SignificanceToggle.jsx';
import Bookshelf from '../components/Bookshelf.jsx';
import Tooltip from '../components/Tooltip.jsx';
import FleuronDivider from '../components/FleuronDivider.jsx';
import ActionsGuideModal from '../components/ActionsGuideModal.jsx';
import UpgradeCountdown from '../components/UpgradeCountdown.jsx';
import SkipLink from '../components/SkipLink.jsx';
import { isConclusionCard } from '../lib/cardIdentifier.js';
import { TUTORIAL_DECK, TUTORIAL_CARDS } from '../lib/tutorialDeck.js';
import { TUTORIAL_SCRIPT, snapshot, TUTORIAL_REVIEW_SUBMISSION } from '../lib/tutorialScript.jsx';
import TutorialCoach from '../components/TutorialCoach.jsx';
import ReviewSubmissionDialog from '../components/ReviewSubmissionDialog.jsx';
import { exportPublicationsToPDF } from '../lib/publicationsPDF.js';
import { buildSoloReport, openPlaytestReport } from '../lib/playtestReport.js';
import { stageLabel } from '../lib/career.js';
import { useNarrativeEnabled } from '../lib/narrativeSetting.js';
import {
  useGameState,
  TOTAL_YEARS,
  STAT_TABLES,
  CONFERENCE_FRESH,
  conferenceCitations,
  renownMultiplier,
} from '../hooks/useGameState.js';
import { buildTagToConclusionMap } from '../lib/tags.js';

/**
 * Game — the main game board.
 *
 * Phase 4 scope:
 *   - DndContext wraps the entire board, owning drag-and-drop event flow
 *   - Notebook cards & conclusion shelf cards are DraggableCard sources
 *   - Notebook is a drop target (return cards to hand)
 *   - Project columns render in the projects area, each with its own slots
 *   - All movement is FREE (no year tick); only DRAW_CARDS ticks the year
 */
export default function Game({ tutorial = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Player name comes from the signed-in user (RequireAuth gates this
  // route so user is always present here, but be defensive). The
  // nav state only carries the deck choice from Home.jsx.
  const playerName = user?.username;
  // Tutorial mode uses its own fixed deck and a generous length (it ends via
  // the guided script, not retirement); a normal game reads the nav state.
  const deck = tutorial ? TUTORIAL_DECK : location.state?.deck;
  const totalYears = tutorial ? 12 : location.state?.totalYears;

  useEffect(() => {
    if (!tutorial && (!playerName || !deck)) {
      navigate('/', { replace: true });
    }
  }, [tutorial, playerName, deck, navigate]);

  const [allCards, setAllCards] = useState(tutorial ? TUTORIAL_CARDS : null);
  const [loadStatus, setLoadStatus] = useState(tutorial ? 'ok' : 'loading');
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (tutorial || !deck) return;
    let cancelled = false;
    setLoadStatus('loading');

    fetchCards(deck.idDeck)
      .then((data) => {
        if (cancelled) return;
        setAllCards(Array.isArray(data) ? data : []);
        setLoadStatus('ok');
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err.message);
        setLoadStatus('error');
      });

    return () => { cancelled = true; };
  }, [tutorial, deck]);

  if (!tutorial && (!playerName || !deck)) return null;

  if (loadStatus === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="font-serif italic text-cream-200/70">Loading the archive…</p>
      </div>
    );
  }
  if (loadStatus === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6">
        <p className="font-serif italic text-oxblood-300">The archive is unreachable.</p>
        <p className="font-mono text-xs text-cream-200">{loadError}</p>
        <Link to="/" className="btn-primary inline-block">Return to Lobby</Link>
      </div>
    );
  }

  return (
    <GameBoard playerName={playerName || 'Student'} deck={deck} allCards={allCards} totalYears={totalYears} tutorial={tutorial} />
  );
}


/**
 * GameBoard — actual board, mounted only once cards are loaded.
 */
function GameBoard({ playerName, deck, allCards, totalYears, tutorial = false }) {
  const {
    state,
    drawCards,
    toggleTags,
    toggleSignificance,
    moveCard,
    removeFromProject,
    reorderHand,
    publishArgument,
    dismissPublishResult,
    dismissStageAdvancement,
    upgradeStat,
    attendConference,
    conferenceKeep,
    derived,
  } = useGameState({
    playerName,
    deck,
    allCards,
    totalYears,
    tutorial,
  });

  // ── Tutorial mode: a strict step script gates the turn buttons. ──────────
  const [tutStep, setTutStep] = useState(0);
  const tutStartRef = useRef(null);        // snapshot taken when a step begins
  const tutAdvancedRef = useRef(-1);       // last step we already advanced past
  const tutorialStep = tutorial ? TUTORIAL_SCRIPT[tutStep] : null;

  // Capture the start snapshot whenever the step changes (runs before the
  // advance effect below, which is defined after it).
  useEffect(() => {
    if (!tutorial) return;
    tutStartRef.current = snapshot(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutStep, tutorial]);

  // Advance exactly once per step when its goal is met. The advancedRef guard
  // means rapid state updates after an action can't cancel or double-fire it.
  useEffect(() => {
    if (!tutorial || !tutorialStep || tutorialStep.info) return;
    if (tutAdvancedRef.current === tutStep) return;
    const start = tutStartRef.current || snapshot(state);
    if (tutorialStep.done && tutorialStep.done(state, start)) {
      tutAdvancedRef.current = tutStep;
      setTutStep((i) => Math.min(i + 1, TUTORIAL_SCRIPT.length - 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, tutorial, tutStep, tutorialStep]);

  function advanceTutorial() {
    tutAdvancedRef.current = tutStep;
    setTutStep((i) => Math.min(i + 1, TUTORIAL_SCRIPT.length - 1));
  }

  const tutAllow = tutorialStep?.allow || {};
  const tutLockDraw       = tutorial && !tutAllow.draw;
  const tutLockPublish    = tutorial && !tutAllow.publish;
  const tutLockConference = tutorial && !tutAllow.conference;
  // During gated build steps, only cards/conclusions in the step's group can be
  // dragged (e.g. only the economic sources for the economic article).
  const tutDragGroup = tutorial ? tutorialStep?.dragGroup : null;
  const tutorialDragAllowed = (card) =>
    !tutorial || !tutDragGroup || (card?.tutorialGroup || '') === tutDragGroup;

  // Currently-open card modal. Shape: null | { card, source }
  //   source: 'hand'             — card from the notebook (placeable)
  //         | 'conclusionShelf'  — card from the conclusion library (placeable)
  //         | 'project'          — card already placed in a project (not placeable)
  // The source determines whether the modal shows "Place in Project N" buttons.
  const [openCard, setOpenCard] = useState(null);

  // Which projects are collapsed to their header bar. Per design choice
  // (Phase 10.1), Project 1 starts expanded and the rest start collapsed,
  // so a fresh game focuses the player on a single workspace. Players
  // expand additional projects as they unlock and want to use them.
  // Stored as a Set<projectId> for cheap has/add/delete operations.
  const [collapsedProjects, setCollapsedProjects] = useState(() => {
    // Build the initial set: every project EXCEPT project 0 starts collapsed.
    // state.projects has 3 entries (ids 0, 1, 2) — Phase 10.4 removed
    // Project 4. The function form of useState only runs on mount.
    const initial = new Set();
    for (let i = 1; i < 3; i++) initial.add(i);
    return initial;
  });

  function toggleProjectCollapse(projectId) {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  // Whether the top header bar (title, player name, prestige, tags toggle,
  // reset link) is collapsed. Phase 10.7: starts collapsed by default —
  // the timeline strip below remains visible and provides at-a-glance
  // status info. Player can expand to access the Reset link or change
  // tags-visibility.
  const [headerCollapsed, setHeaderCollapsed] = useState(false);

  // "How to Play" actions reference overlay.
  const [guideOpen, setGuideOpen] = useState(false);
  const [narrativeOn, toggleNarrative] = useNarrativeEnabled();
  const [tutorialEnabled, setTutorialEnabledState] = useUserSetting('tutorial_enabled', true);

  /**
   * Handle a "Place in Project N" click from inside the card modal.
   *
   * Behavior (per design):
   *   1. Dispatch the MOVE_CARD action (hand/shelf → the chosen project)
   *   2. Decide which card to show next:
   *        - Card to the LEFT of the placed one in the hand (preferred)
   *        - Otherwise, card to the RIGHT
   *        - Otherwise, close the modal
   *      Conclusion-shelf cards always close the modal — there's no
   *      meaningful "next" because the shelf isn't a sequence the player
   *      is working through.
   *
   * We compute the next card BEFORE dispatching, since after dispatch
   * the state update is queued — we'd be reading stale hand contents.
   */
  function handlePlaceFromModal({ card, source, projectId }) {
    const evidence = source !== 'conclusionShelf';
    const to = {
      kind: evidence ? 'projectEvidence' : 'projectConclusion',
      projectId,
    };
    const from = evidence ? { kind: 'hand' } : { kind: 'conclusionShelf' };

    // Compute the next card to display BEFORE dispatching. We're going
    // to dispatch a MOVE_CARD action which will remove this card from the
    // hand (for evidence cards). We need to base the navigation on the
    // hand as it looks RIGHT NOW.
    let nextCard = null;
    if (source === 'hand') {
      const idx = state.hand.findIndex((c) => c.id === card.id);
      if (idx > 0) {
        // Card to the left
        nextCard = state.hand[idx - 1];
      } else if (idx === 0 && state.hand.length > 1) {
        // No card to the left, but there's one to the right
        nextCard = state.hand[idx + 1];
      } else {
        // Hand is empty after this placement
        nextCard = null;
      }
    }
    // For conclusion-shelf cards, we just close the modal — no nav.

    // Dispatch the move
    moveCard(card.id, from, to);

    // Update the modal state
    if (nextCard) {
      setOpenCard({ card: nextCard, source: 'hand' });
    } else {
      setOpenCard(null);
    }
  }

  // Lookup from argument tag → owning conclusion. Computed once per deck
  // load; the conclusion shelf is essentially read-only after game start
  // (it's a library), so this map is stable for the entire game.
  // Used by the publish-result dialog to translate tag references into
  // conclusion titles, which is the canonical vocabulary players see.
  const tagToConclusion = useMemo(
    () => buildTagToConclusionMap(state.conclusionShelf),
    [state.conclusionShelf]
  );

  // Sensor configuration: require the user to drag at least 8px before
  // the drag starts. This prevents stray micro-drags when the user just
  // wanted to click. The card's onClick fires on simple clicks; only
  // intentional drags trigger DnD.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  // Track which card is currently being dragged so we can render it inside
  // a DragOverlay (portaled to body) instead of in-place. This keeps the
  // drag preview above all stacking contexts (project rows have
  // `relative overflow-hidden` which otherwise clips/hides the drag preview).
  const [activeDragId, setActiveDragId] = useState(null);

  function handleDragStart(event) {
    setActiveDragId(event.active.id);
  }

  /**
   * Collision strategy. Default (rectIntersection) for everything, EXCEPT:
   * when dragging a HAND card and the pointer is inside another hand card's
   * reorder drop-zone, prefer that zone so reordering is precise (otherwise
   * the big notebook container can win and the card just jumps to the end).
   * Scoped to hand-originated drags so cross-zone behavior is untouched.
   */
  function collisionDetection(args) {
    const activeFrom = args.active?.data?.current?.from?.kind;
    if (activeFrom === 'hand') {
      const within = pointerWithin(args);
      const reorderHit = within.find(
        (c) => c?.data?.droppableContainer?.data?.current?.to?.kind === 'handReorder'
      );
      if (reorderHit) return [reorderHit];
    }
    return rectIntersection(args);
  }

  /**
   * Drag end handler — fires when the user releases the mouse after a drag.
   * The active.data.current and over.data.current carry the `from`/`to`
   * descriptors we set on the DraggableCard / DroppableSlot.
   */
  function handleDragEnd(event) {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;  // dropped outside any drop target

    const fromData = active.data.current;
    const toData = over.data.current;
    if (!fromData || !toData) return;

    const cardId = fromData.cardId;
    const from = fromData.from;
    const to = toData.to;
    if (!cardId || !from || !to) return;

    // Dropped onto another hand card's reorder zone.
    if (to.kind === 'handReorder') {
      if (from.kind === 'hand') {
        // Reorder within the hand: place this card before the target.
        if (cardId !== to.cardId) reorderHand(cardId, to.cardId);
      } else {
        // A project/shelf card dropped over the hand → return it to the hand.
        moveCard(cardId, from, { kind: 'hand' });
      }
      return;
    }

    moveCard(cardId, from, to);
  }

  function handleDragCancel() {
    setActiveDragId(null);
  }

  // Resolve the currently-dragged card so we can render its preview in the
  // DragOverlay. Look in hand, project evidence slots, project conclusion
  // slots, and the conclusion shelf.
  const activeCard = useMemo(() => {
    if (!activeDragId) return null;
    const all = [
      ...state.hand,
      ...state.projects.flatMap((p) => [...p.evidence, p.conclusion].filter(Boolean)),
      ...state.conclusionShelf,
    ];
    // activeDragId looks like 'hand-123', 'project-0-evidence-456', 'shelf-789', etc.
    // Each draggable also passes its data, so easier: find by matching ID suffix.
    return all.find((c) => activeDragId.includes(`-${c.id}`) || activeDragId === `shelf-${c.id}`) || null;
  }, [activeDragId, state.hand, state.projects, state.conclusionShelf]);

  const yearProgress = Math.min(state.year / (state.totalYears || TOTAL_YEARS), 1);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <DragOverlay dropAnimation={null} zIndex={9999}>
        {activeCard ? (
          isConclusionCard(activeCard)
            ? <ConclusionTile card={activeCard} showTags={state.showTags} showSignificance={state.showSignificance} />
            : <CardThumbnail card={activeCard} showTags={state.showTags} showSignificance={state.showSignificance} size="sm" />
        ) : null}
      </DragOverlay>
      <div className="min-h-screen flex flex-col">
        <SkipLink />

        {/* ═══════════════════════════════════════════════════
            1. TOP BAR — collapsible (Phase 10.7)
                A thin chevron bar at the very top toggles the
                full header. The timeline strip below stays
                visible regardless.
            ═══════════════════════════════════════════════════ */}
        <button
          type="button"
          onClick={() => setHeaderCollapsed((v) => !v)}
          className="surface-binding border-b border-edge-on-dark px-8 py-1 flex items-center justify-center gap-2 hover:bg-teal-800/40 transition-colors w-full"
          aria-expanded={!headerCollapsed}
          aria-label={headerCollapsed ? 'Expand header' : 'Collapse header'}
          title={headerCollapsed ? 'Expand header' : 'Collapse header'}
        >
          <span
            className="font-mono text-xs text-gold-400 transition-transform inline-block"
            style={{ transform: headerCollapsed ? 'rotate(-90deg)' : 'rotate(0)' }}
          >
            ▾
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-cream-200">
            {headerCollapsed ? 'The Historians' : 'Hide header'}
          </span>
        </button>

        {!headerCollapsed && (
          <header className="relative z-50 surface-binding border-b border-edge-on-dark px-8 py-4 animate-fade-in">
            <div className="flex items-baseline justify-between gap-6">
              <div className="flex items-baseline gap-4">
                <h1 className="font-display text-2xl text-cream-50">The Historians</h1>
                <span className="font-display italic text-cream-200/70 text-sm">
                  · Building Arguments
                </span>
              </div>

              <div className="flex items-center gap-6 text-sm">
                <TagsToggle showTags={state.showTags} onToggle={toggleTags} />
                <span data-tutorial="significance-toggle">
                  <SignificanceToggle showSignificance={state.showSignificance} onToggle={toggleSignificance} />
                </span>

                <NarrativeToggle enabled={narrativeOn} onToggle={toggleNarrative} />

                <button
                  type="button"
                  onClick={() => setTutorialEnabledState(!tutorialEnabled)}
                  className={`font-mono text-xs uppercase tracking-wider transition-colors ${tutorialEnabled ? 'text-gold-300 hover:text-gold-100' : 'text-cream-200/50 hover:text-cream-100'}`}
                  title={tutorialEnabled ? 'Disable tutorial hints' : 'Enable tutorial hints'}
                >
                  Tutorial: {tutorialEnabled ? 'On' : 'Off'}
                </button>

                <Link
                  to="/"
                  className="font-mono text-xs uppercase tracking-wider text-cream-200 hover:text-gold-300 transition-colors"
                  title="Leave this game and return to the main lobby"
                >
                  ⌂ Lobby
                </Link>

                <button
                  type="button"
                  onClick={() => setGuideOpen(true)}
                  className="font-mono text-xs uppercase tracking-wider text-cream-200 hover:text-gold-300 transition-colors"
                  title="Open the How to Play reference"
                >
                  How to Play
                </button>

                <Link
                  to="/"
                  className="font-mono text-xs uppercase tracking-wider text-cream-200/70 hover:text-oxblood-300 transition-colors"
                >
                  Reset
                </Link>
              </div>
            </div>
          </header>
        )}

        {/* ═══════════════════════════════════════════════════
            2. TIMELINE & CAREER BAR
                Order: Name · Prestige · Stats (upgrades)
                       · centered Goal · Stage · Year
            ═══════════════════════════════════════════════════ */}
        <section className="surface-binding border-b border-edge-on-dark px-8 py-2 flex items-center gap-6 text-xs">
          <span className="font-mono text-cream-200 flex-shrink-0">
            <span className="text-gold-400 mr-2">Historian</span>
            {state.playerName}
          </span>

          <span className="font-mono text-cream-200 flex-shrink-0">
            <span className="text-gold-400 mr-2">Prestige</span>
            {state.prestige}
          </span>

          {state.citations > 0 && (
            <span
              className="font-mono text-cream-200 flex-shrink-0 cursor-help"
              title={`${state.citations} citation token${state.citations === 1 ? '' : 's'} from conferences — worth +${derived.renownMultiplier} each (×${derived.renownMultiplier} renown) at game end.\nProjected final prestige: ${derived.projectedPrestige}`}
            >
              <span className="text-gold-400 mr-2">Citations</span>
              {state.citations}
              <span className="text-cream-200/60"> → +{state.citations * derived.renownMultiplier}</span>
            </span>
          )}

          {/* Compact stat strip — current levels visible at a glance.
              Players watch these grow as they publish. */}
          <StatStrip statLevels={state.statLevels} />

          {/* Center: current career goal — what the player needs to do
              before the next gate. Drives the player's near-term decisions. */}
          <span className="font-serif italic text-cream-200/80 text-sm text-center flex-1 truncate">
            {currentGoal(state)}
          </span>

          <span className="font-mono text-cream-200 flex-shrink-0">
            <span className="text-gold-400 mr-2">Stage</span>
            {labelForStage(state.stage)}
          </span>

          <span className="font-mono text-cream-200 flex-shrink-0">
            <span className="text-gold-400 mr-2">Year</span>
            {state.year}
            <span className="text-cream-200">/{state.totalYears || TOTAL_YEARS}</span>
          </span>

          <UpgradeCountdown
            year={state.year}
            totalYears={state.totalYears || TOTAL_YEARS}
            pending={state.pendingUpgrades}
          />
        </section>

        <div className="h-px bg-teal-900 relative overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-gold-500/70 transition-all duration-300 ease-desk"
            style={{ width: `${yearProgress * 100}%` }}
          />
        </div>

        {/* ═══════════════════════════════════════════════════
            3. PUBLICATION SHELF — moved above the play area so the
               player's published work sits over the workspace.
            ═══════════════════════════════════════════════════ */}
        <Bookshelf
          publications={state.publications || []}
          playerName={state.playerName}
          deck={state.deck}
        />

        {/* ═══════════════════════════════════════════════════
            4. PLAY AREA — conclusions (skinny left rail) + project rows
            ═══════════════════════════════════════════════════ */}
        <div className="flex-1 flex gap-4 p-4 min-h-0">
          <ConclusionSidebar
            conclusionShelf={state.conclusionShelf}
            onConclusionClick={(card) => setOpenCard({ card, source: 'conclusionShelf' })}
            showTags={state.showTags} showSignificance={state.showSignificance}
            dragGate={tutorialDragAllowed}
          />

          <main id="main-content" tabIndex={-1} data-tutorial="project-area" className="flex-1 flex flex-col gap-4 min-w-0 overflow-y-auto">
            {state.projects.map((project, i) => (
              <ProjectRow
                key={project.id}
                project={project}
                locked={i >= derived.workspaces}
                collapsed={collapsedProjects.has(project.id)}
                onToggleCollapse={() => toggleProjectCollapse(project.id)}
                showTags={state.showTags} showSignificance={state.showSignificance}
                onCardClick={(card) => setOpenCard({ card, source: 'project' })}
                onPublish={publishArgument}
                onAttendConference={attendConference}
                onReturnToHand={removeFromProject}
                useSpines
                articleMin={derived.articleMin}
                freePublishing={state.statLevels.workspaces >= 4}
                lockPublish={tutLockPublish}
                lockConference={tutLockConference}
              />
            ))}
          </main>
        </div>

        {/* ═══════════════════════════════════════════════════
            5. RESEARCH NOTEBOOK (drop target + draggable cards)
                Also contains the deck stack + Draw button on its left.
            ═══════════════════════════════════════════════════ */}
        <NotebookArea
          hand={state.hand}
          capacity={derived.capacity}
          showTags={state.showTags} showSignificance={state.showSignificance}
          onCardClick={(card) => setOpenCard({ card, source: 'hand' })}
          deckRemaining={state.archiveDeck.length}
          discardRemaining={state.discard.length}
          drawCount={derived.drawCount}
          onDraw={drawCards}
          disabled={!!state.gameOver || tutLockDraw}
          dragGate={tutorialDragAllowed}
        />

        {openCard && (() => {
          // Determine the sequence we're navigating through based on the
          // card's source. Hand cards navigate the hand; shelf cards
          // navigate the conclusion shelf; project cards have no sequence.
          let sequence = null;
          if (openCard.source === 'hand') {
            sequence = state.hand;
          } else if (openCard.source === 'conclusionShelf') {
            sequence = state.conclusionShelf;
          } else if (openCard.source === 'project') {
            // Navigate the project's committed cards left-to-right: the
            // conclusion first, then evidence in order. Find the project that
            // holds the opened card (it may be the conclusion or a piece of
            // evidence).
            const proj = state.projects.find((p) =>
              (p.conclusion && p.conclusion.id === openCard.card.id) ||
              (p.evidence || []).some((c) => c.id === openCard.card.id)
            );
            if (proj) {
              sequence = [proj.conclusion, ...(proj.evidence || [])].filter(Boolean);
            }
          }

          // Find the current card's position in the sequence
          let currentIndex = -1;
          if (sequence) {
            currentIndex = sequence.findIndex((c) => c.id === openCard.card.id);
          }

          // Build prev/next callbacks. Per design, we HIDE arrows at the
          // edges rather than disabling them — so each handler is set
          // to null when the corresponding direction has no card.
          const onPrev = (currentIndex > 0)
            ? () => setOpenCard({ card: sequence[currentIndex - 1], source: openCard.source })
            : null;
          const onNext = (sequence && currentIndex >= 0 && currentIndex < sequence.length - 1)
            ? () => setOpenCard({ card: sequence[currentIndex + 1], source: openCard.source })
            : null;

          // Position indicator — only meaningful when sequence has > 1 card
          const position = (sequence && currentIndex >= 0)
            ? { current: currentIndex + 1, total: sequence.length }
            : null;

          return (
            <CardModal
              card={openCard.card}
              onClose={() => setOpenCard(null)}
              showTags={state.showTags} showSignificance={state.showSignificance}
              onPrev={onPrev}
              onNext={onNext}
              position={position}
              actions={
                // Only show place buttons when card came from hand or shelf.
                // Cards already in a project shouldn't be "re-placed" via modal —
                // they can be right-clicked or dragged out instead.
                (openCard.source === 'hand' || openCard.source === 'conclusionShelf') ? (
                  <PlaceInProjectButtons
                    card={openCard.card}
                    source={openCard.source}
                    projects={state.projects}
                    workspaces={derived.workspaces}
                    onPlace={(projectId) => handlePlaceFromModal({
                      card: openCard.card,
                      source: openCard.source,
                      projectId,
                    })}
                  />
                ) : null
              }
            />
          );
        })()}

        {state.lastPublishResult && (
          <PublishResultDialog
            result={state.lastPublishResult}
            tagToConclusion={tagToConclusion}
            onClose={dismissPublishResult}
          />
        )}

        {/* Upgrade chooser appears after the publish dialog is dismissed,
            and only if a successful publish set pendingUpgrade. We keep
            it from competing with the publish dialog by checking that
            lastPublishResult is null first. We also skip it when the
            game is over — the player can't benefit from upgrades after
            retirement or career failure. */}
        {!state.lastPublishResult && state.pendingUpgrades > 0 && !state.gameOver && (
          <UpgradeChooserDialog
            statLevels={state.statLevels}
            onUpgrade={upgradeStat}
            reason={state.pendingUpgradeReasons?.[0] || 'biennial'}
            stage={state.stage}
          />
        )}

        {/* Attend-a-Conference draft — pick which fresh cards to bring home. */}
        {state.conference && !state.gameOver && (
          <SoloConferenceModal
            conference={state.conference}
            capacity={derived.capacity}
            handCount={state.hand.length}
            showTags={state.showTags}
            showSignificance={state.showSignificance}
            onConfirm={conferenceKeep}
          />
        )}

        {/* Career narrative beat on a promotion — shown unless the player
            has turned story prompts off. Either way it's cleared on dismiss
            (or immediately, if prompts are off). */}
        {state.lastStageAdvancement && narrativeOn && !state.gameOver && (
          <NarrativeModal
            stage={state.lastStageAdvancement.to}
            year={state.lastStageAdvancement.year}
            onClose={dismissStageAdvancement}
          />
        )}

        {state.gameOver && !tutorial && <GameOverOverlay state={state} deck={deck} />}

        {tutorial && tutorialStep && (
          <TutorialCoach
            step={tutorialStep}
            index={tutStep}
            total={TUTORIAL_SCRIPT.length}
            onAdvance={advanceTutorial}
          />
        )}

        {/* Peer-review demo — a dummy opponent manuscript to review. */}
        {tutorial && tutorialStep?.id === 'peer-review' && (
          <ReviewSubmissionDialog
            submission={TUTORIAL_REVIEW_SUBMISSION}
            yourHand={[]}
            onSubmit={() => advanceTutorial()}
            onClose={() => advanceTutorial()}
          />
        )}

        {/* "How to Play" actions reference — summoned from the header. */}
        {guideOpen && (
          <ActionsGuideModal mode="single" onClose={() => setGuideOpen(false)} />
        )}

        {/* First-time tutorial hints — pointed at the relevant controls. */}
        <TutorialManager
          state={state}
          playerToken="solo"
          enabled={tutorialEnabled && !state.gameOver && !tutorial}
          tutorials={SOLO_TUTORIALS}
        />
      </div>
    </DndContext>
  );
}


/**
 * NotebookArea — the player's hand at the bottom of the screen.
 *
 * Wraps each hand card in a DraggableCard so it can be moved to a project.
 * The notebook ITSELF is a drop target — dropping a card here returns it
 * to the hand from wherever it came (a project).
 */
/**
 * ConclusionSidebar — conclusions stacked in one thin vertical column on the
 * LEFT of the project rows, under a single decorated "Conclusions" header.
 * Mirrors the multiplayer sidebar: each tile is a thin spine showing its
 * prestige value on the right, and stays draggable into a conclusion slot.
 *
 * Hidden entirely when no conclusions are available (early game).
 */
function ConclusionSidebar({ conclusionShelf, onConclusionClick, showTags, showSignificance, dragGate }) {
  if (!conclusionShelf || conclusionShelf.length === 0) {
    return null;
  }

  return (
    <aside data-tutorial="conclusion-rail" className="shrink-0 flex flex-col overflow-y-auto">
      {/* Fancy header */}
      <div className="text-center">
        <span className="font-display text-sm uppercase tracking-[0.3em] text-gold-300">
          ❧ Conclusions ❧
        </span>
        <FleuronDivider className="my-1" />
      </div>

      <div className="flex flex-col gap-1.5">
        {conclusionShelf.map((card) => {
          const draggable = dragGate ? dragGate(card) : true;
          return (
            <DraggableCard
              key={`shelf-${card.id}`}
              id={`shelf-${card.id}`}
              data={{ cardId: card.id, from: { kind: 'conclusionShelf' } }}
              disabled={!draggable}
            >
              {({ dragHandleProps, isDragging }) => (
                <div {...dragHandleProps} className={`${isDragging ? 'opacity-50' : ''} ${draggable ? '' : 'opacity-30'}`}>
                  <ConclusionSpine
                    thin
                    card={card}
                    onClick={() => onConclusionClick?.(card)}
                    showTags={showTags} showSignificance={showSignificance}
                  />
                </div>
              )}
            </DraggableCard>
          );
        })}
      </div>
    </aside>
  );
}


/**
 * HandSlot — a drop target wrapping one hand card, enabling drag-to-reorder
 * within the Research Notebook. Dropping a hand card onto another card's slot
 * places it just before that card (handled in handleDragEnd). Highlights while
 * a card hovers over it.
 */
function HandSlot({ index, cardId, children }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `handslot-${cardId}`,
    data: { to: { kind: 'handReorder', index, cardId } },
  });
  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 rounded-sm transition-shadow ${
        isOver ? 'ring-2 ring-gold-400 ring-offset-2 ring-offset-wood-900' : ''
      }`}
    >
      {children}
    </div>
  );
}


/**
 * NotebookArea — bottom bar containing the deck stack + Draw button on the
 * left, and the player's hand (evidence cards) on the right.
 *
 * In Phase 10 the deck stack moved from the old left archive sidebar into
 * this strip. The deck visually retains its labeled "Archive · N · cards"
 * face, which now serves as the only "archive" identifier on the page
 * (the old top-of-sidebar "ARCHIVE" header is gone since the deck card
 * itself carries that information).
 */
function NotebookArea({
  hand,
  capacity,
  showTags,
  showSignificance,
  onCardClick,
  // Phase 10 props — passed through for the embedded deck + draw control
  deckRemaining = 0,
  discardRemaining = 0,
  drawCount = 0,
  onDraw,
  disabled = false,
  dragGate,
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: 'drop-notebook',
    data: { to: { kind: 'hand' } },
  });

  // The "draw pool" is the deck PLUS the discard (which will reshuffle
  // into the deck when the deck runs out — Phase 10.6). So a player can
  // keep drawing as long as ANYTHING is in either pile.
  const totalAvailable = deckRemaining + discardRemaining;
  const canDraw = !disabled && totalAvailable > 0 && hand.length < capacity;
  const wouldDraw = Math.min(drawCount, capacity - hand.length, totalAvailable);

  return (
    <footer
      ref={setNodeRef}
      className={`
        surface-binding border-t-2 px-8 py-5 transition-colors
        ${isOver ? 'border-gold-400' : 'border-gold-500/40'}
      `}
    >
      <div className="flex gap-6">

        {/* Left: clickable deck stack. The deck itself is the draw control —
            clicking it draws the next batch and advances the year. A "Draw N"
            overlay sits on top of the deck face, with a "+1 year" caption
            beneath. When draw isn't possible (empty deck or full notebook)
            the deck dims and the click is disabled. */}
        <div className="flex-shrink-0 w-36 flex flex-col items-center">
          <button
            type="button"
            onClick={onDraw}
            disabled={!canDraw}
            data-tutorial="draw-zone"
            className={`
              relative h-[12.5rem] w-32 group
              transition-transform duration-200 ease-desk
              ${canDraw ? 'hover:-translate-y-1 cursor-pointer' : 'cursor-not-allowed opacity-50'}
            `}
            title={
              !canDraw && totalAvailable === 0
                ? 'No more cards in the archive (deck and discard are both empty)'
                : !canDraw && hand.length >= capacity
                ? 'Notebook is full'
                : `Draws ${wouldDraw} card${wouldDraw === 1 ? '' : 's'} · advances 1 year${deckRemaining === 0 ? ' · reshuffles discard' : ''}`
            }
          >
            <DeckStack count={deckRemaining} />

            {/* "Draw N" overlay — sits above the deck face, only visible
                when draw is actually possible. Positioned in the upper
                third of the deck so it doesn't cover the "Archive · N · cards"
                label on the deck face beneath it. */}
            {canDraw && (
              <div className="absolute inset-x-0 top-3 flex items-center justify-center pointer-events-none">
                <div className="bg-teal-900/85 border border-gold-500 px-3 py-1.5 shadow-lg group-hover:bg-teal-800/95 transition-colors">
                  <p className="font-mono text-xs uppercase tracking-widest text-gold-300 leading-none">
                    Draw {wouldDraw > 0 ? wouldDraw : drawCount}
                  </p>
                </div>
              </div>
            )}
          </button>
          <p className="font-mono text-[9px] uppercase tracking-wider text-cream-200 mt-2 text-center">
            + 1 year
          </p>
        </div>

        {/* Right: the hand */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-3 min-h-[12.5rem]">
            {hand.length === 0 ? (
              <p className="text-cream-200 italic font-serif self-center w-full text-center">
                Empty. Draw cards from the archive to begin researching.
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
                      <div {...dragHandleProps} className={`flex-shrink-0 ${dragDisabled ? 'opacity-30' : ''}`}>
                        <CardThumbnail
                          card={card}
                          onClick={() => onCardClick?.(card)}
                          showTags={showTags} showSignificance={showSignificance}
                          isDragging={isDragging}
                        />
                      </div>
                    )}
                  </DraggableCard>
                </HandSlot>
              ))
            )}
          </div>

          {/* Label below the hand: "Research Notebook: 5 / 11" on one line */}
          <p className="text-center mt-3 font-display text-xl text-cream-50">
            Research Notebook:{' '}
            <span className="font-mono text-xs text-cream-200 align-middle">
              {hand.length} / {capacity}
            </span>
          </p>
        </div>
      </div>
    </footer>
  );
}


/**
 * PlaceInProjectButtons — the action buttons inside CardModal.
 *
 * Renders one button per UNLOCKED, ELIGIBLE project space. Per design:
 *   - Locked projects are HIDDEN entirely (workspaces stat hasn't reached them)
 *   - Projects where this placement would be invalid are HIDDEN (e.g. a
 *     conclusion card whose target project already has a conclusion)
 *
 * Evidence cards: every unlocked project gets a button (evidence rails
 *                 have no per-project cap in the current rules).
 * Conclusion cards: only unlocked projects WITHOUT a conclusion already
 *                   placed get a button. (No "replace" semantic — to
 *                   replace, the player must first right-click the existing
 *                   conclusion to un-place it.)
 *
 * If no buttons are eligible, the component renders a small italic notice
 * so the player isn't left wondering why the action area is empty.
 */
function PlaceInProjectButtons({ card, source, projects, workspaces, onPlace }) {
  const isConclusion = source === 'conclusionShelf';

  // Filter to projects that should get a button:
  // 1. Project is unlocked (project.id < workspaces)
  // 2. For conclusions: the project's conclusion slot is empty
  // 3. For evidence: always eligible if unlocked
  const eligible = projects.filter((project) => {
    if (project.id >= workspaces) return false;
    if (isConclusion && project.conclusion) return false;
    return true;
  });

  // Card meta strings used in the same row as the buttons. We compute these
  // here so the action area can show №seq | [buttons] | +bonus as a single
  // visually unified strip — and we drop CardModal's separate footer row
  // when actions are present (this row already covers it).
  const seq = card.sequence_number ?? '—';
  const bonus = card.bonus ? `+${card.bonus}` : null;

  if (eligible.length === 0) {
    // Even with no eligible projects we still want the meta strip visible,
    // so the player sees the card number and bonus in this lower area.
    return (
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink-900 text-center mb-3">
          Place this card in a project
        </p>
        <p className="font-serif italic text-ink-900 text-sm text-center mb-3">
          {isConclusion
            ? 'No project spaces available for a conclusion (all occupied or locked).'
            : 'No project spaces available (none unlocked yet).'
          }
        </p>
        <div className="flex items-center justify-between gap-4 text-xs font-mono text-ink-900">
          <span title="Sequence number">№ {seq}</span>
          <span className="text-right" title="Bonus points">{bonus || ''}</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink-900 text-center mb-3">
        Place this card in a project
      </p>
      {/* One row: card # (left) · buttons (center) · bonus (right) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          className="font-mono text-xs text-ink-900 flex-shrink-0"
          title="Sequence number"
        >
          № {seq}
        </span>

        <div className="flex flex-wrap gap-2 justify-center">
          {eligible.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => onPlace(project.id)}
              className="px-4 py-2 font-sans text-sm text-cream-50 bg-teal-800 border border-gold-500 hover:bg-teal-700 hover:border-gold-400 transition-colors"
              style={{ letterSpacing: '0.04em' }}
            >
              Project {project.id + 1}
            </button>
          ))}
        </div>

        <span
          className="font-mono text-xs text-ink-900 flex-shrink-0 text-right"
          title="Bonus points"
        >
          {bonus || ''}
        </span>
      </div>
    </div>
  );
}


/**
 * ArchivePanelWithDrag — same as ArchivePanel, but each conclusion tile
 * on the shelf is wrapped in DraggableCard so it can be dragged to a
 * project's conclusion slot.
 *
 * The conclusion shelf is a "library" — picking a conclusion doesn't remove
 * it from the shelf (multiple players might use the same conclusion thread
 * across different arguments). The reducer's `conclusionShelf` location
 * is read-only.
 */
function ArchivePanelWithDrag({
  deckRemaining,
  drawCount,
  capacity,
  handCount,
  conclusionShelf,
  onDraw,
  onConclusionClick,
  showTags,
  showSignificance,
  disabled,
}) {
  const canDraw = !disabled && deckRemaining > 0 && handCount < capacity;
  const wouldDraw = Math.min(drawCount, capacity - handCount, deckRemaining);

  return (
    <aside className="surface-well p-5 flex flex-col gap-5">

      {/* Deck visualization */}
      <div>
        <h2 className="font-display text-xl text-cream-50 mb-1">Archive</h2>
        <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400 mb-4">
          {deckRemaining} cards remaining
        </p>

        <div className="relative h-32 mb-4">
          <DeckStack count={deckRemaining} />
        </div>

        <button
          type="button"
          onClick={onDraw}
          disabled={!canDraw}
          className="btn-primary w-full"
          title={
            !canDraw && deckRemaining === 0
              ? 'No more cards in the archive'
              : !canDraw && handCount >= capacity
              ? 'Notebook is full'
              : `Draws ${wouldDraw} card${wouldDraw === 1 ? '' : 's'} · advances 1 year`
          }
        >
          Draw {wouldDraw > 0 ? wouldDraw : drawCount} Card{wouldDraw === 1 ? '' : 's'}
        </button>

        <p className="font-mono text-[9px] uppercase tracking-wider text-cream-200 mt-2 text-center">
          + 1 year
        </p>
      </div>

      {/* Conclusion shelf — each tile is draggable */}
      {conclusionShelf.length > 0 && (
        <div className="border-t border-gold-500/20 pt-5">
          <h3 className="font-display text-sm uppercase tracking-widest text-gold-400 mb-3">
            Conclusions
          </h3>

          <div
            className="grid gap-2"
            style={{
              gridTemplateRows: 'repeat(3, auto)',
              gridAutoFlow: 'column',
              gridAutoColumns: 'min-content',
            }}
          >
            {conclusionShelf.map((card) => (
              <DraggableCard
                key={`shelf-${card.id}`}
                id={`shelf-${card.id}`}
                data={{ cardId: card.id, from: { kind: 'conclusionShelf' } }}
              >
                {({ dragHandleProps, isDragging }) => (
                  <div {...dragHandleProps} className={isDragging ? 'opacity-50' : ''}>
                    <ConclusionTile
                      card={card}
                      onClick={() => onConclusionClick?.(card)}
                      showTags={showTags} showSignificance={showSignificance}
                    />
                  </div>
                )}
              </DraggableCard>
            ))}
          </div>
        </div>
      )}
    </aside>
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
          className="absolute w-32 h-[12.5rem] border border-gold-500/30 surface-paper"
          style={{ transform: 'translate(6px, 4px)' }}
        />
      )}
      {layers >= 2 && (
        <div
          className="absolute w-32 h-[12.5rem] border border-gold-500/40 surface-paper"
          style={{ transform: 'translate(3px, 2px)' }}
        />
      )}
      <div className="absolute w-32 h-[12.5rem] border border-gold-500/60 surface-paper flex flex-col items-center justify-center">
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


function GameOverOverlay({ state, deck }) {
  const { reason, year } = state.gameOver;
  const ending = endingCopyFor(reason, state);

  // Submit the score on mount. We use a ref to ensure we don't double-submit
  // if React StrictMode or a parent re-render fires the effect twice (which
  // would produce duplicate leaderboard rows).
  const [submitStatus, setSubmitStatus] = useState('loading');  // 'loading' | 'ok' | 'error'
  const [submittedIdScore, setSubmittedIdScore] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const hasSubmittedRef = useRef(false);

  useEffect(() => {
    if (hasSubmittedRef.current) return;
    hasSubmittedRef.current = true;

    // Build the payload from state. The ending stage is what gets recorded
    // as `rank` — including failure stages like 'failed-comps'.
    const payload = {
      player_name: state.playerName,
      idDeck: deck.idDeck,
      rank: state.stage,
      prestige: state.prestige,
      articles_published: state.articlesPublished,
      books_published: state.booksPublished,
      research_level: state.statLevels.research,
      notebook_level: state.statLevels.notebookCapacity,
      influence_level: state.statLevels.influence,
      workspaces_level: state.statLevels.workspaces,
      reputation_level: state.statLevels.reputation || 1,
      renown_level: state.statLevels.renown || 1,
      year_ended: year,
    };

    submitScore(payload)
      .then((result) => {
        setSubmittedIdScore(result?.idScore || null);
        setSubmitStatus('ok');
      })
      .catch((err) => {
        setSubmitError(err.message);
        setSubmitStatus('error');
      });
  }, [state, deck, year]);

  return (
    <div className="fixed inset-0 z-50 bg-teal-950/95 flex items-center justify-center p-6 animate-fade-in overflow-y-auto">
      <div
        className="surface-paper max-w-2xl w-full px-10 py-10 my-6 text-center relative"
        style={{ boxShadow: '0 0 0 1px rgba(184, 146, 58, 0.5), 0 20px 60px rgba(0,0,0,0.8)' }}
      >
        <div className="absolute inset-2 border border-gold-500/30 pointer-events-none" />

        <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-700 mb-3">
          Year {year} of {state.totalYears || TOTAL_YEARS}
        </p>

        <h2
          className={`font-display text-3xl font-bold mb-3 ${
            reason === 'retired' ? 'text-ink-900' : 'text-oxblood-500'
          }`}
        >
          {ending.headline}
        </h2>

        <p className="font-serif italic text-ink-800 mb-6 leading-relaxed">
          {ending.body}
        </p>

        {/* Final prestige + standing */}
        <div className="my-6 border-t border-b border-gold-500/30 py-4">
          <p className="font-display text-5xl font-bold text-ink-900 leading-none">
            {state.prestige}
          </p>
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-700 mt-2">
            Final Prestige
          </p>

          {state.citations > 0 && (() => {
            const mult = renownMultiplier(state.statLevels.renown || 1);
            const bonus = state.citations * mult;
            return (
              <p className="font-mono text-[10px] uppercase tracking-widest text-gold-700 mt-2">
                includes +{bonus} from {state.citations} citation{state.citations === 1 ? '' : 's'} × {mult} renown
              </p>
            );
          })()}

          <p className="font-serif italic text-ink-700 text-sm mt-3">
            {ending.standing}
          </p>
        </div>

        {/* Leaderboard section */}
        <div className="mt-6 mb-6 text-left">
          <h3 className="font-display text-lg font-bold uppercase tracking-widest text-gold-700 text-center mb-2">
            Final Standings
          </h3>
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-700 text-center mb-4">
            {deck.nameDeck}
          </p>

          {submitStatus === 'loading' && (
            <p className="font-serif italic text-ink-700 text-sm text-center py-4">
              Submitting your score…
            </p>
          )}
          {submitStatus === 'error' && (
            <p className="font-serif italic text-oxblood-500 text-sm text-center py-4">
              Could not submit score. {submitError}
            </p>
          )}
          {submitStatus === 'ok' && (
            <Leaderboard fetchParams={{ deck: deck.idDeck }} highlightIdScore={submittedIdScore} />
          )}
        </div>

        {/* Action buttons — download published works (if any) and start anew. */}
        <div className="flex flex-wrap gap-3 justify-center items-center">
          {(state.publications || []).length > 0 && (
            <button
              type="button"
              onClick={() => exportPublicationsToPDF({
                publications: state.publications,
                playerName: state.playerName,
                deck,
              })}
              className="btn-primary inline-block"
              title="Open your collected works in a new tab — print or save as an accessible PDF from there"
            >
              ⎙ View / Print My Works
            </button>
          )}
          <button
            type="button"
            onClick={() => openPlaytestReport(buildSoloReport({ state, deck }))}
            className="btn-primary inline-block"
            title="Open a print-ready playtest report (save as PDF) with copyable JSON/CSV"
          >
            ⎙ Playtest Report
          </button>
          <Link to="/" className="btn-primary inline-block">
            Begin a new career
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Generate end-game copy for a given reason.
 *
 * Returns { headline, body, standing }.  The `standing` line summarizes
 * the player's accomplishments at game end — different content for
 * failures vs natural retirement.
 */
function endingCopyFor(reason, state) {
  const articleCount = state.articlesPublished;
  const bookCount = state.booksPublished;

  switch (reason) {
    case 'failed-comps':
      return {
        headline: 'Left Academia',
        body:
          'Three years out of your doctoral program and still nothing in ' +
          'print. With no published article to your name, the doors of the ' +
          'profession quietly closed, and you left academia behind.',
        standing: 'Never published; left academia by year three.',
      };

    case 'tenure-denied':
      return {
        headline: 'No Permanent Post',
        body:
          'Six years on, and no book to show for it. Without one, no ' +
          'university would offer you a permanent, tenure-track appointment, ' +
          'and your time in the field came to an end.',
        standing:
          articleCount > 0
            ? `Left with ${articleCount} article${articleCount === 1 ? '' : 's'} published, but no book.`
            : 'Left without a book to your name.',
      };

    case 'retired':
    default:
      return {
        headline: 'Retirement',
        body:
          'You have reached the end of your career. The students you trained, ' +
          'the manuscripts you authored, and the questions you raised will ' +
          'echo in the discipline for years to come.',
        standing: standingSummary(articleCount, bookCount),
      };
  }
}

/** Summarize a retired historian's body of work. */
function standingSummary(articles, books) {
  const parts = [];
  if (articles > 0) parts.push(`${articles} article${articles === 1 ? '' : 's'}`);
  if (books > 0) parts.push(`${books} book${books === 1 ? '' : 's'}`);
  if (parts.length === 0) return 'A long, contemplative career.';
  if (parts.length === 1) return `Published ${parts[0]} over a long career.`;
  return `Published ${parts[0]} and ${parts[1]} over a long career.`;
}


function labelForStage(stage) {
  return stageLabel(stage);
}


/**
 * StatStrip — compact display of current stat levels in the timeline bar.
 *
 * Each stat shows as a single-letter abbreviation followed by a 4-pip gauge.
 * Tooltip on hover gives the full stat name and current value.
 *
 *   R ◆◆◇◇   N ◆◇◇◇   I ◆◇◇◇   W ◆◇◇◇
 *
 * Compact enough to live in the timeline bar without crowding stage/goal/year.
 */
function StatStrip({ statLevels }) {
  // Stats with single-letter abbreviation, full label, value lookup, and a
  // level-aware describe(level) that explains what THIS level means.
  // The tooltip combines describe(currentLevel) + " → " + describe(nextLevel)
  // so the player sees both their current ability and what's coming next.
  const stats = [
    {
      key: 'research',         abbr: 'R', label: 'Research Funding',
      describe: (lvl) => {
        const v = STAT_TABLES.research[lvl - 1];
        if (v === 'capacity') return 'Draw a full notebook (cards = your notebook capacity)';
        return v ? `Draw ${v} cards per action` : '';
      },
    },
    {
      key: 'notebookCapacity', abbr: 'A', label: 'Personal Archive',
      describe: (lvl) => {
        const v = STAT_TABLES.notebookCapacity[lvl - 1];
        return v ? `Hold up to ${v} cards in hand` : '';
      },
    },
    {
      key: 'influence',        abbr: 'L', label: 'Literary Agent',
      describe: (lvl) => {
        const v = STAT_TABLES.influence[lvl - 1];
        if (v === undefined) return '';
        if (v === 0) return 'No prestige bonus per publish';
        if (lvl === 4) return `+${v} prestige per card in argument`;
        return `+${v} prestige per publish`;
      },
    },
    {
      key: 'workspaces',       abbr: 'W', label: 'Workspaces',
      describe: (lvl) => {
        const v = STAT_TABLES.workspaces[lvl - 1];
        if (lvl === 4) return '3 concurrent projects · publishing is free (no year cost)';
        return v ? `${v} concurrent project${v === 1 ? '' : 's'}` : '';
      },
    },
    {
      key: 'reputation',       abbr: 'M', label: 'Association Memberships',
      describe: (lvl) => {
        const fresh = CONFERENCE_FRESH[lvl - 1];
        const cites = conferenceCitations(lvl);
        return `Conference: +${fresh} fresh cards to draft · earn ${cites} citation${cites === 1 ? '' : 's'}`;
      },
    },
    {
      key: 'renown',           abbr: 'P', label: 'Publicist',
      describe: (lvl) => {
        const m = renownMultiplier(lvl);
        return `Each banked citation is worth +${m} prestige at game end`;
      },
    },
  ];

  return (
    <div className="flex items-center gap-3">
      {stats.map((stat) => {
        const level = statLevels[stat.key] || 1;
        const current = stat.describe(level);
        const next = level < 4 ? stat.describe(level + 1) : null;

        const content = (
          <div className="text-left">
            <p className="font-mono text-[10px] uppercase tracking-wider text-gold-300">
              {stat.label} · L{level}{level >= 4 ? ' · maxed' : ''}
            </p>
            <p className="text-cream-50 mt-1">{current}</p>
            {next && (
              <p className="text-cream-200/70 mt-1">→ L{level + 1}: {next}</p>
            )}
          </div>
        );

        return (
          <Tooltip key={stat.key} content={content} side="bottom" width="w-60">
            <span className="flex items-center gap-1.5 font-mono text-cream-200 cursor-help">
              <span className="text-gold-400 text-[11px]">{stat.abbr}</span>
              <SmallPips level={level} />
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** Smaller version of LevelPips used in the timeline strip. */
function SmallPips({ level }) {
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`
            w-1.5 h-1.5 border border-gold-500/60
            ${i <= level ? 'bg-gold-500' : 'bg-transparent'}
          `}
        />
      ))}
    </span>
  );
}


/**
 * Compute the current career objective shown in the timeline bar.
 *
 * The objective is what the player needs to do BEFORE the next stage gate
 * fires. Pure function of state — no side effects.
 *
 * Returns null-ish text when there's nothing pressing (e.g. post-tenure
 * with all advancement triggers gated only on book counts the player can
 * pursue at their leisure).
 */
function currentGoal(state) {
  const { booksPublished } = state;
  const published = state.articlesPublished + state.booksPublished;

  // First article → a tenure-track post (Assistant Professor).
  if (published === 0) {
    return 'Goal: Publish your first article for a tenure-track post (Assistant Professor)';
  }

  // First book → tenure (Associate Professor).
  if (booksPublished === 0) {
    return 'Goal: Publish your first book to earn tenure (Associate Professor)';
  }

  // Promotions by book count: Full at 4, Endowed at 7.
  if (booksPublished < 4) return `Goal: ${4 - booksPublished} more book${4 - booksPublished === 1 ? '' : 's'} for Full Professor`;
  if (booksPublished < 7) return `Goal: ${7 - booksPublished} more book${7 - booksPublished === 1 ? '' : 's'} for an Endowed Chair`;
  return 'Continue building your legacy until retirement';
}

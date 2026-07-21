import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core';

import { useMultiplayerGame } from '../hooks/useMultiplayerGame.js';
import { loadSession } from '../api/mpSession.js';
import { fetchCards } from '../api/client.js';
import {
  mpCommitAction,
  mpMoveCard,
  mpSubmitReview,
  mpUpgradeStat,
  mpClaimResultRewards,
  mpDrawConsolation,
  mpReclaimManuscript,
  mpAddCitation,
  mpRemoveCitation,
  mpConcede,
  mpSpendObjection,
  mpResolveRevise,
  mpDrawTake,
  mpReviewContinue,
  mpConferenceTake,
  mpAftermathReady,
} from '../api/multiplayer.js';

// Reuse single-player primitives where possible — these are the proven,
// styled components we want to render with.
import { CardThumbnail, CardModal, ConclusionTile, ConclusionSpine } from '../components/Card.jsx';
import DraggableCard from '../components/DraggableCard.jsx';
import DroppableSlot from '../components/DroppableSlot.jsx';
import ProjectRow from '../components/ProjectRow.jsx';
import SkipLink from '../components/SkipLink.jsx';
import TagsToggle from '../components/TagsToggle.jsx';
import SignificanceToggle from '../components/SignificanceToggle.jsx';
import { TOTAL_YEARS } from '../hooks/useGameState.js';
import { MP_STAT_TABLES, MP_ARTICLE_MIN, renownMultiplier, projectedScore } from '../lib/mpStats.js';

// Multiplayer-specific components
import ReviewSubmissionDialog from '../components/ReviewSubmissionDialog.jsx';
import ManuscriptViewDialog from '../components/ManuscriptViewDialog.jsx';
import ReviseDecisionDialog from '../components/ReviseDecisionDialog.jsx';
import MultiplayerUpgradeChooser from '../components/MultiplayerUpgradeChooser.jsx';
import MultiplayerResultDialog from '../components/MultiplayerResultDialog.jsx';
// Only the per-player shelf is needed: the library bar renders one section per
// player cell rather than the whole bookshelf in a row.
import { PlayerSection } from '../components/MultiplayerBookshelf.jsx';
import PublicationModal from '../components/PublicationModal.jsx';
import ActionCommitBar from '../components/ActionCommitBar.jsx';
import ActionHistoryModal from '../components/ActionHistoryModal.jsx';
import TutorialManager from '../components/TutorialManager.jsx';
import ActionsGuideModal from '../components/ActionsGuideModal.jsx';
import ArchiveMarket from '../components/ArchiveMarket.jsx';
import NotebookArea from '../components/NotebookArea.jsx';
import ReviewPhaseModal from '../components/ReviewPhaseModal.jsx';
import ConferencePhaseModal from '../components/ConferencePhaseModal.jsx';
import AftermathPhaseModal from '../components/AftermathPhaseModal.jsx';
import { isTutorialEnabled, setTutorialEnabled as persistTutorialEnabled } from '../lib/tutorialStorage.js';
import useUserSetting from '../auth/useUserSetting.js';
import useLocalToggle from '../lib/useLocalToggle.js';
import GoalLine from '../components/GoalLine.jsx';
import NarrativeModal from '../components/NarrativeModal.jsx';
import NarrativeToggle from '../components/NarrativeToggle.jsx';
import { stageLabel, rankIndex } from '../lib/career.js';
import { useNarrativeEnabled } from '../lib/narrativeSetting.js';
import YearProgressBar from '../components/YearProgressBar.jsx';
import StatsStrip from '../components/StatsStrip.jsx';
import { isConclusionCard } from '../lib/cardIdentifier.js';
import Tooltip from '../components/Tooltip.jsx';
import FleuronDivider from '../components/FleuronDivider.jsx';

import { colorForSeat } from '../lib/playerColors.js';
import ToastStack from '../components/Toast.jsx';
import { toastFromEvents } from '../lib/toasts.js';
import { playChatPing, isMuted, toggleMuted } from '../lib/sounds.js';
import { useRef } from 'react';
import ChatPanel from '../components/ChatPanel.jsx';
import { mpSendChatMessage } from '../api/multiplayer.js';
import { mpRevealSignificance } from '../api/multiplayer.js';

/**
 * MultiplayerGame — the main multiplayer board.
 *
 * Layout (top-to-bottom):
 *   1. Collapsible header bar (mirrors Game.jsx)
 *   2. Timeline strip — name, prestige, stats, goal, year
 *   3. Year progress bar
 *   4. Conclusion rail
 *   5. Main grid:
 *      - LEFT: opponents + "Out for Review" (yours) + "Manuscript Inbox" (others')
 *      - CENTER: 3 project rows (reusing single-player ProjectRow)
 *      - RIGHT: published library (book spines are draggable citation sources)
 *   6. Action commit bar — directly above the notebook
 *   7. Notebook (single-player NotebookArea pattern)
 *   8. MultiplayerBookshelf — bottom, split by player
 *
 * The action picker is IMPLICIT — the player's most recent
 * intent-bearing action click (Draw / Publish on a project /
 * Read & Review on an inbox manuscript) sets pending_action.
 * The commit bar shows the current pick and the "End Year" button.
 */
export default function MultiplayerGame() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const session = loadSession(gameId);
  const playerToken = session?.player_token;

  const { state, error: pollError, isLoading, refresh, lastPollAt } = useMultiplayerGame(playerToken, {
    intervalMs: 1500,
    enabled: !!playerToken,
  });

  // Local UI state (NOT server state)
  const [openCard, setOpenCard] = useState(null);              // null | { card, source }
  const [headerCollapsed, setHeaderCollapsed] = useState(true);
  const [showTags, setShowTags] = useUserSetting('show_tags', false);
  // The library band grows all game; let players fold it away for board room.
  // Local rather than server-backed: user_settings has no column for it, and a
  // key with no column reverts on the next server response (see useLocalToggle).
  const [libraryCollapsed, setLibraryCollapsed] = useLocalToggle('mp_library_collapsed', false);
  const [showSignificance, setShowSignificance] = useState(false);

  // Per-session significance reveal (re-locks on refresh). When turned ON,
  // notify the other players via an event-log toast.
  function handleToggleSignificance() {
    const next = !showSignificance;
    setShowSignificance(next);
    if (next) mpRevealSignificance(playerToken).catch(() => {});
  }

  // Effective visibility = the player's own toggle OR the host's table-wide
  // force setting. The host's waiting-room toggles flip these on for everyone.
  const forceTags = !!(state?.game?.force_show_tags);
  const forceSignificance = !!(state?.game?.force_show_significance);
  const effTags = showTags || forceTags;
  const effSignificance = showSignificance || forceSignificance;

  // Action / publish flow
  const [reviewingSub, setReviewing] = useState(null);
  const [viewingManuscript, setViewingManuscript] = useState(null);
  const [publishingProject, setPublishingProject] = useState(null);  // { id, ... } awaiting argument prose
  const [publishArgument, setPublishArgument] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Result modal
  const [openResult, setOpenResult] = useState(null);
  // Locally-tracked submissions the user has dismissed this session.
  // Belts-and-suspenders: prevents the modal re-popping if a poll arrives
  // before the server's writer_seen_result=1 write has propagated.
  const [locallyDismissed, setLocallyDismissed] = useState(() => new Set());
  const [reviseDecision, setReviseDecision] = useState(null);
  const [locallyDismissedRevise, setLocallyDismissedRevise] = useState(() => new Set());
  // Whether the manuscript re-entry tray is expanded.
  const [manuscriptTrayOpen, setManuscriptTrayOpen] = useState(false);

  // Track what's currently being dragged so DragOverlay can render a
  // floating preview that follows the cursor. Without this, drags happen
  // silently (the source card just turns translucent in place).
  const [activeDragId, setActiveDragId] = useState(null);

  // Client-side hand ordering — a preferred order of card ids the player set by
  // drag-to-reorder. The server hand is re-polled constantly and has no order
  // of its own, so we re-apply this locally each render (new draws append,
  // played cards drop out). Never sent to the server — purely cosmetic.
  const [handOrder, setHandOrder] = useState([]);

  // Action history drawer
  const [historyOpen, setHistoryOpen] = useState(false);
  // Chat panel — slides from the right. lastSeenChatId tracks the
  // highest message_id we've ALREADY shown the user, so we can badge
  // the toggle button when new messages arrive while closed.
  const [chatOpen, setChatOpen] = useState(false);
  const [lastSeenChatId, setLastSeenChatId] = useState(0);
  // Mute toggle — seeded from the persisted localStorage flag in
  // lib/sounds.js. The actual mute state lives at module level there;
  // local React state mirrors it so the button re-renders on toggle.
  const [muted, setMutedState] = useState(() => isMuted());
  function handleToggleMute() {
    const next = toggleMuted();
    setMutedState(next);
  }

  // Concede confirmation modal
  const [concedeOpen, setConcedeOpen] = useState(false);

  // "How to Play" actions reference overlay
  const [guideOpen, setGuideOpen] = useState(false);

  // Career narrative modal — show a story beat when YOUR rank rises. The hand
  // is server-polled, so we detect promotions by watching your stage change.
  const [narrativeOn, toggleNarrative] = useNarrativeEnabled();
  const [narrativeStage, setNarrativeStage] = useState(null);
  const prevStageRef = useRef(null);

  // Transient state for showing the outcome banner after a player spends
  // an objection token. Cleared when the result dialog is dismissed.
  const [objectionOutcome, setObjectionOutcome] = useState(null);

  // Currently-open publication modal — set when a player left-clicks a
  // spine in the MultiplayerBookshelf. Shows the book's contents
  // (title, thesis, evidence, author, etc.) but deliberately hides the
  // conclusion tag code.
  const [openWork, setOpenWork] = useState(null);

  // Tutorial system: global toggle, persisted to user_settings via
  // useUserSetting (was localStorage in the unlocked codebase; locked
  // version centralizes settings on the server so they sync across
  // devices). The TutorialManager re-evaluates on each read.
  const [tutorialEnabled, setTutorialEnabledState] = useUserSetting('tutorial_enabled', true);
  function toggleTutorial() {
    setTutorialEnabledState(!tutorialEnabled);
  }

  // Conclusion shelf — loaded once
  const [conclusionShelf, setConclusionShelf] = useState([]);

  // Bounce away if session lost
  useEffect(() => {
    if (!playerToken) navigate('/multiplayer');
  }, [playerToken, navigate]);

  // Bounce to results when game ends
  useEffect(() => {
    if (state?.game?.status === 'ended') {
      navigate(`/multiplayer/end/${gameId}`);
    } else if (state?.game?.status === 'lobby') {
      navigate(`/multiplayer/lobby/${gameId}`);
    }
  }, [state?.game?.status, gameId, navigate]);

  // Detect YOUR promotions across polls and pop the narrative beat. We seed the
  // ref on first load so a refresh mid-game doesn't replay the last promotion.
  useEffect(() => {
    const stage = state?.you?.stage;
    if (!stage) return;
    if (prevStageRef.current === null) {
      prevStageRef.current = stage;
      return;
    }
    if (stage !== prevStageRef.current) {
      const wentUp = rankIndex(stage) > rankIndex(prevStageRef.current);
      prevStageRef.current = stage;
      if (wentUp && narrativeOn) setNarrativeStage(stage);
    }
  }, [state?.you?.stage, narrativeOn]);

  // Toast watcher — react to NEW events from each poll. The seenRef
  // bootstraps on first call (suppresses toasts for already-existing
  // events so the player isn't bombarded on page load), then toasts
  // any events with IDs not yet in the seen set. Sounds fire too,
  // configured in lib/toasts.js → _eventToSound.
  const toastSeenRef = useRef(new Set());
  useEffect(() => {
    if (!state?.recent_events) return;
    // recent_events comes newest-first from the server; reverse so we
    // process oldest-first and any sound effects fire in causal order.
    const ordered = [...state.recent_events].reverse();
    toastFromEvents(ordered, toastSeenRef, state.you?.player_id);
  }, [state?.recent_events, state?.you?.player_id]);

  // Fetch conclusion shelf
  useEffect(() => {
    if (!state?.game?.idDeck) return;
    let cancelled = false;
    fetchCards(state.game.idDeck)
      .then((rows) => {
        if (!cancelled) setConclusionShelf(rows.filter((c) => isConclusionCard(c)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [state?.game?.idDeck]);

  // Auto-pop result dialog when there's an unresolved rejection or unseen approval
  useEffect(() => {
    if (!state) return;
    if (openResult) return; // already showing one
    const candidate = state.resolved_submissions_for_you.find(
      (r) => r.auto_pop && !locallyDismissed.has(r.submission_id)
    );
    if (candidate) setOpenResult(candidate);
  }, [state?.resolved_submissions_for_you, openResult, locallyDismissed]);

  // Auto-pop the writer's Revise & Resubmit decision modal for any proposal
  // they haven't acted on (or temporarily dismissed this session).
  useEffect(() => {
    if (!state) return;
    if (reviseDecision) return;
    const list = state.revise_decisions_for_you || [];
    const candidate = list.find(
      (d) => d.auto_pop && !locallyDismissedRevise.has(d.submission_id)
    );
    if (candidate) setReviseDecision(candidate);
  }, [state?.revise_decisions_for_you, reviseDecision, locallyDismissedRevise]);

  // DnD sensors
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Resolve the currently-dragged card so DragOverlay can render a floating
  // preview that follows the cursor. We search:
  //   - hand (regular cards)
  //   - projects (evidence cards + conclusion tiles)
  //   - conclusionShelf (conclusion tiles)
  //   - published library (citation drag preview — synthesized below)
  //
  // CRITICAL: this useMemo must live ABOVE the early returns below.
  // Hooks must run in the same order on every render; if state is null
  // (first render) and we return early before this hook is called, then
  // when state populates and we reach this hook on the next render,
  // React sees a "new" hook and crashes ("Rendered more hooks than
  // during the previous render"). So we guard on state internally.
  const activeCard = useMemo(() => {
    if (!activeDragId || !state) return null;
    const you = state.you;
    const all = [
      ...(you.hand || []),
      ...(you.projects || []).flatMap((p) => [...(p.evidence || []), p.conclusion].filter(Boolean)),
      ...conclusionShelf,
    ];
    const match = all.find(
      (c) => activeDragId.includes(`-${c.id}`) || activeDragId === `shelf-${c.id}`
    );
    if (match) return match;
    // Library spine being dragged for a citation — synthesize a minimal
    // preview shape (the drag overlay just shows the publication title).
    if (activeDragId.startsWith('library-')) {
      const workId = parseInt(activeDragId.slice('library-'.length), 10);
      const work = (state.published_works || []).find((w) => w.work_id === workId);
      if (work) {
        return {
          id: `lib-${work.work_id}`,
          title: work.publication_title,
          author: work.writer_name,
          type: 'library',
          source_type: work.kind,
        };
      }
    }
    return null;
  }, [activeDragId, state, conclusionShelf]);

  // The hand, reordered by the player's local preference. Cards in handOrder
  // come first (in that order); any new cards the server added (draws) follow
  // in server order. Stale ids in handOrder are simply ignored.
  const orderedHand = useMemo(() => {
    const hand = state?.you?.hand || [];
    const byId = new Map(hand.map((c) => [c.id, c]));
    const seen = new Set();
    const out = [];
    for (const id of handOrder) {
      const c = byId.get(id);
      if (c && !seen.has(id)) { out.push(c); seen.add(id); }
    }
    for (const c of hand) {
      if (!seen.has(c.id)) { out.push(c); seen.add(c.id); }
    }
    return out;
  }, [state?.you?.hand, handOrder]);

  if (!playerToken) return null;
  if (isLoading) {
    return <main className="min-h-screen flex items-center justify-center"><p className="font-serif italic text-cream-200/70">Loading the archive…</p></main>;
  }
  if (pollError) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center">
          <p className="font-serif italic text-oxblood-300 mb-4">Lost connection: {pollError}</p>
          <button onClick={refresh} className="btn-ghost mr-2">Try again</button>
          <Link to="/" className="btn-primary inline-block">Return to Lobby</Link>
        </div>
      </main>
    );
  }
  if (!state) return null;

  const you = state.you;
  const game = state.game;

  // Derived values from stat levels (mirror backend/mp_resolveYear.php).
  const capacity = MP_STAT_TABLES.notebookCapacity[Math.max(0, Math.min(3, (you.stat_levels.notebookCapacity || 1) - 1))];
  const workspaces = MP_STAT_TABLES.workspaces[Math.max(0, Math.min(3, (you.stat_levels.workspaces || 1) - 1))];
  const rawDraw = MP_STAT_TABLES.research[Math.max(0, Math.min(3, (you.stat_levels.research || 1) - 1))];
  const drawCount = rawDraw === 'capacity' ? capacity : rawDraw;
  const articleMin = MP_ARTICLE_MIN;
  const freePublishing = (you.stat_levels.workspaces || 1) >= 4;

  // ── Archive market ────────────────────────────────────────────
  // On the board in every phase so you can see what's on offer while deciding
  // your action; only takeable on your turn during the draw phase.
  const isDrawPhase = game.phase === 'draw';
  const drawPhase = state.draw_phase;
  const archivePiles = state.archive_piles || drawPhase?.piles || [];
  const totalInArchive = archivePiles.reduce((n, p) => n + (p?.count || 0), 0);
  const yourDrawsLeft = drawPhase?.your_draws_remaining || 0;
  const canTakeArchive =
    isDrawPhase && !!drawPhase?.you_are_up && yourDrawsLeft > 0 && !busy
    && !you.game_over_reason && !you.is_ghost;
  const drawSelected = you.pending_action === 'draw';
  const handFull = (you.hand || []).length >= capacity;
  // What you'd actually get: your research rating, capped by notebook room —
  // promising 4 cards to a player with 2 free slots would be a lie.
  const drawAllowance = Math.max(0, Math.min(drawCount, capacity - (you.hand || []).length));
  const archiveCaption = isDrawPhase
    ? (drawPhase?.you_are_up
        ? `Your pick · ${yourDrawsLeft} left`
        : `${drawPhase?.current_player_name || '…'} is drawing`)
    : `${totalInArchive} left in the archive`;
  // Game length depends on the mode (short=10, medium=18, long=25).
  const totalYears = game.total_years || TOTAL_YEARS;
  const yearProgress = (game.current_year - 1) / totalYears;

  // Project shape adapter — multiplayer state uses slot_index, ProjectRow
  // expects id. Map evidence cards & conclusion through their existing
  // shape (server returns id and idCard already). Citations are passed
  // straight through.
  const projects = you.projects.map((p) => ({
    id: p.slot_index,
    conclusion: p.conclusion,
    evidence: p.evidence,
    citations: p.citations || [],
  }));


  // ─────────────────────────────────────────────────────────
  // HANDLERS
  // ─────────────────────────────────────────────────────────

  // Drag start — capture which draggable is active so DragOverlay can
  // render its floating preview.
  function handleDragStart(evt) {
    setActiveDragId(evt.active?.id ?? null);
  }

  function handleDragCancel() {
    setActiveDragId(null);
  }

  // Reorder within the hand (local-only): place cardId just before beforeCardId.
  function reorderHand(cardId, beforeCardId) {
    if (cardId === beforeCardId) return;
    const ids = orderedHand.map((c) => c.id);
    const fromIdx = ids.indexOf(cardId);
    if (fromIdx === -1) return;
    ids.splice(fromIdx, 1);
    let toIdx = ids.indexOf(beforeCardId);
    if (toIdx === -1) toIdx = ids.length;
    ids.splice(toIdx, 0, cardId);
    setHandOrder(ids);
  }

  // Collision strategy — default everywhere, except prefer an in-hand reorder
  // zone when dragging a HAND card so reordering is precise. Scoped to
  // hand-originated drags so all cross-zone behavior is untouched.
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

  // Drag end — same shape as single-player. cardId comes from active.data, from/to from the data payloads.
  // Citation drops are a special case: when active.data.isCitation is true,
  // we route to mpAddCitation instead of moveCard.
  function handleDragEnd(evt) {
    setActiveDragId(null);  // always clear, even if the drop missed
    const { active, over } = evt;
    if (!over) return;
    const fromData = active.data?.current;
    const toData = over.data?.current;
    if (!fromData || !toData) return;

    // Citation drop: library spine → project evidence area
    if (fromData.isCitation && toData.to?.kind === 'projectEvidence') {
      addCitation(toData.to.projectId, fromData.citedWorkId);
      return;
    }

    // Regular card move
    const cardId = fromData.cardId;
    const from = fromData.from;
    const to = toData.to;
    if (!cardId || !from || !to) return;

    // Dropped onto another hand card's reorder zone.
    if (to.kind === 'handReorder') {
      if (from.kind === 'hand') {
        if (cardId !== to.cardId) reorderHand(cardId, to.cardId);
      } else {
        // A project/shelf card dropped over the hand → return it to the hand.
        moveCard(cardId, from, { kind: 'hand' });
      }
      return;
    }

    // Hand → empty hand area: nothing to do (avoid a needless server move).
    if (from.kind === 'hand' && to.kind === 'hand') return;

    moveCard(cardId, from, to);
  }

  async function addCitation(slotIndex, citedWorkId) {
    setError(null);
    try {
      await mpAddCitation({
        player_token: playerToken,
        slot_index: slotIndex,
        cited_work_id: citedWorkId,
      });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function removeCitation(citation) {
    setError(null);
    try {
      await mpRemoveCitation({
        player_token: playerToken,
        citation_id: citation.citation_id,
      });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function moveCard(cardId, from, to) {
    try {
      await mpMoveCard({ player_token: playerToken, card_id: cardId, from, to });
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function returnFromProject(cardId, from) {
    // Send conclusions back to the shelf (no-op destination — the shelf
    // is the static library of all conclusions). Send evidence back to
    // hand. Mirrors single-player REMOVE_FROM_PROJECT which only adds
    // to hand when the source was projectEvidence.
    const to = from.kind === 'projectConclusion'
      ? { kind: 'conclusionShelf' }
      : { kind: 'hand' };
    await moveCard(cardId, from, to);
  }

  async function commitAction(action, data, commit) {
    setBusy(true);
    setError(null);
    try {
      await mpCommitAction({
        player_token: playerToken,
        action,
        action_data: data,
        commit,
      });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Action buttons set the player's intent but DO NOT commit yet — that's
  // a separate "End Year" click. This matches the user's preference for
  // implicit action selection.
  function selectDraw() {
    commitAction('draw', null, false);
  }

  // Attend a Conference — stage the project's cards and commit the action.
  function selectConference(projectSlotIndex) {
    commitAction('attend_conference', { projectId: projectSlotIndex }, false);
  }

  // Publish flow — when user clicks the Publish button on a ProjectRow,
  // we open a small modal asking for argument text, then commit publish.
  function startPublishFlow(projectSlotIndex) {
    const project = you.projects.find((p) => p.slot_index === projectSlotIndex);
    if (!project) return;
    if (!project.conclusion || project.evidence.length === 0) return;
    setPublishingProject({ slot_index: projectSlotIndex, project });
    setPublishArgument('');
  }

  async function confirmPublish() {
    if (!publishingProject) return;
    const text = publishArgument.trim();
    // Empty argument is allowed — the writer is explaining via voice
    // (Discord/Zoom/in-person). The reviewer dialog handles the empty
    // case with a "via voice" placeholder.
    await commitAction('publish', {
      projectId: publishingProject.slot_index,
      argumentText: text,
    }, false);
    setPublishingProject(null);
  }

  // Review flow — open the dialog when an inbox spine is clicked.
  function openReview(submission) {
    setReviewing(submission);
  }

  async function handleReviseDecision(decision) {
    if (!reviseDecision) return;
    const sid = reviseDecision.submission_id;
    setBusy(true);
    setError(null);
    try {
      await mpResolveRevise({
        player_token: playerToken,
        submission_id: sid,
        decision,
      });
      // Guard against the auto-pop effect re-opening this proposal off the
      // pre-refresh (stale) state, which still lists it. Mirrors how the
      // result dialog uses locallyDismissed.
      setLocallyDismissedRevise((prev) => new Set(prev).add(sid));
      setReviseDecision(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitReviewVerdict({ verdict, flaggedCardIds, addedCardIds, comment }) {
    setBusy(true);
    setError(null);
    try {
      // Reviewing is a free action — it does NOT consume the player's year
      // action. We just record the verdict; the player still selects and
      // commits a real action (draw / publish / pass) separately.
      await mpSubmitReview({
        player_token: playerToken,
        submission_id: reviewingSub.submission_id,
        verdict,
        flagged_card_ids: flaggedCardIds,
        added_card_ids: addedCardIds || [],
        comment,
      });
      setReviewing(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCommitYear() {
    // End-year — explicitly commits whatever pending_action is set on the
    // server. If nothing is set, we default to 'pass'.
    setBusy(true);
    setError(null);
    try {
      const action = you.pending_action || 'pass';
      await mpCommitAction({
        player_token: playerToken,
        action,
        action_data: you.pending_action_data || null,
        commit: true,
      });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUncommit() {
    // Server side: re-set pending_action_committed = 0 by re-sending the
    // current action with commit:false. The server treats this as updating
    // the pending state.
    setBusy(true);
    setError(null);
    try {
      await mpCommitAction({
        player_token: playerToken,
        action: you.pending_action || 'pass',
        action_data: you.pending_action_data || null,
        commit: false,
      });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // ── Review phase ──────────────────────────────────────────────
  // Record a verdict on the manuscript currently under review. Throws on
  // error so ReviewPhaseModal can surface it inline before continuing.
  async function handleReviewPhaseVerdict({ submission_id, verdict, flagged_card_ids, flagged_work_ids, comment }) {
    await mpSubmitReview({
      player_token: playerToken,
      submission_id,
      verdict,
      flagged_card_ids: flagged_card_ids || [],
      flagged_work_ids: flagged_work_ids || [],
      comment,
    });
    await refresh();
  }

  // ── Draw phase ────────────────────────────────────────────────
  // Take the face-up top card of a pile on your turn. The market is part of the
  // board rather than a dialog, so errors go to the board's own error bar —
  // most often "someone else claimed that card first", which is a normal race
  // when two players reach for the same top card.
  async function handleDrawTake(pile) {
    if (busy) return;
    setError(null);
    try {
      await mpDrawTake({ player_token: playerToken, pile });
      await refresh();
    } catch (e) {
      setError(e.message || 'Could not take that card.');
    }
  }

  // Mark yourself ready for the current manuscript (the barrier).
  async function handleReviewContinue() {
    await mpReviewContinue(playerToken);
    await refresh();
  }

  // Conference: draft the selected pool cards on your turn.
  async function handleConferenceTake(poolIds) {
    await mpConferenceTake(playerToken, poolIds);
    await refresh();
  }

  // Aftermath: open the right dialog for one outstanding manuscript. Revise
  // proposals pop the decision dialog; rejections pop the result dialog (whose
  // Object button lets the writer contest with tokens) — reusing the existing
  // flows rather than rebuilding them inside the aftermath modal.
  function handleAftermathResolve(item) {
    if (item.resp_type === 'revise') {
      const d = (state.revise_decisions_for_you || []).find(
        (x) => x.submission_id === item.submission_id
      );
      if (d) setReviseDecision(d);
    } else {
      const r = (state.resolved_submissions_for_you || []).find(
        (x) => x.submission_id === item.submission_id
      );
      if (r) setOpenResult(r);
    }
  }

  // Re-open a post-review window the writer set aside or minimized. The old
  // "Out for Review" basket was removed, so this is how a writer gets back to a
  // Revise & Resubmit decision (to accept / object / rebuild) or a resolved
  // result (to reclaim cards, draw consolation, or object).
  function reopenManuscript(item) {
    const sid = item.sub.submission_id;
    if (item.kind === 'revise') {
      setLocallyDismissedRevise((prev) => {
        const next = new Set(prev);
        next.delete(sid);
        return next;
      });
      setReviseDecision(item.sub);
    } else {
      setLocallyDismissed((prev) => {
        const next = new Set(prev);
        next.delete(sid);
        return next;
      });
      setOpenResult(item.sub);
    }
    setManuscriptTrayOpen(false);
  }

  // Aftermath: sign off ("end the game"). The game finalizes once every live
  // writer with an outstanding response has resolved it or signed off.
  async function handleAftermathFinish() {
    setBusy(true);
    setError(null);
    try {
      await mpAftermathReady(playerToken);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Upgrade flow
  async function handleUpgrade(stat) {
    setBusy(true);
    setError(null);
    try {
      await mpUpgradeStat({ player_token: playerToken, stat });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConcede() {
    setBusy(true);
    setError(null);
    try {
      await mpConcede(playerToken);
      setConcedeOpen(false);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Result-modal action handlers
  async function handleDismissResult() {
    if (!openResult) return;
    const sid = openResult.submission_id;
    setBusy(true);
    try {
      // Mark dismissed locally FIRST so the auto-pop effect can't re-fire
      // even if the server's update hasn't propagated yet.
      setLocallyDismissed((prev) => new Set(prev).add(sid));
      await mpClaimResultRewards({
        player_token: playerToken,
        submission_id: sid,
      });
      setOpenResult(null);
      setObjectionOutcome(null);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDrawConsolationFromResult() {
    if (!openResult) return;
    setBusy(true);
    try {
      await mpDrawConsolation({
        player_token: playerToken,
        submission_id: openResult.submission_id,
      });
      await refresh();
      // We DON'T close the modal — let the user see the updated state
      // (button now disabled). Refresh updates openResult on next render
      // because state.resolved_submissions_for_you changes.
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReclaimFromResult() {
    if (!openResult) return;
    setBusy(true);
    try {
      const res = await mpReclaimManuscript({
        player_token: playerToken,
        submission_id: openResult.submission_id,
      });
      if (res.manuscript_fully_reclaimed) {
        setOpenResult(null);
      }
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleObjectFromResult() {
    if (!openResult) return;
    setBusy(true);
    setError(null);
    try {
      const res = await mpSpendObjection({
        player_token: playerToken,
        submission_id: openResult.submission_id,
      });
      // Don't close the modal — let the player see the outcome.
      // The state poll will surface the new status ('objection-won' or
      // 'objection-lost') and the modal will update accordingly.
      await refresh();
      // Stash the outcome so the dialog can show a transient banner.
      setObjectionOutcome({
        outcome: res.outcome,
        matched_tag: res.matched_tag,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // When state updates, re-read the result we're displaying so its values
  // (consolation_drawn, bound_evidence) refresh.
  const liveResult = openResult
    ? state.resolved_submissions_for_you.find(
        (r) => r.submission_id === openResult.submission_id
      ) || null
    : null;

  // ─────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────

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
            ? <ConclusionTile card={activeCard} showTags={effTags} showSignificance={effSignificance} />
            : <CardThumbnail card={activeCard} showTags={effTags} showSignificance={effSignificance} size="sm" />
        ) : null}
      </DragOverlay>
      <div className="min-h-screen flex flex-col">
        <SkipLink />

        {/* ── 1. Collapsible header bar ── */}
        <button
          type="button"
          onClick={() => setHeaderCollapsed((v) => !v)}
          className="surface-binding border-b border-edge-on-dark px-8 py-1 flex items-center justify-center gap-2 hover:bg-teal-800/40 transition-colors w-full"
        >
          <span className="font-mono text-xs text-gold-400 transition-transform inline-block" style={{ transform: headerCollapsed ? 'rotate(-90deg)' : 'rotate(0)' }}>▾</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-cream-200">
            {headerCollapsed ? 'The Historians · Peer Review' : 'Hide header'}
          </span>
        </button>

        {!headerCollapsed && (
          <header className="relative z-50 surface-binding border-b border-edge-on-dark px-8 py-4">
            <div className="flex items-baseline justify-between gap-6">
              <div className="flex items-baseline gap-4">
                <h1 className="font-display text-2xl text-cream-50">The Historians</h1>
                <span className="font-display italic text-cream-200/70 text-sm">· Peer Review</span>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <TagsToggle showTags={showTags} onToggle={() => setShowTags((v) => !v)} />
                <SignificanceToggle showSignificance={showSignificance} onToggle={handleToggleSignificance} />
                <NarrativeToggle enabled={narrativeOn} onToggle={toggleNarrative} />
                <button
                  onClick={() => setGuideOpen(true)}
                  className="font-mono text-xs uppercase tracking-wider text-cream-200 hover:text-gold-300"
                  title="Open the How to Play reference"
                >
                  How to Play
                </button>
                <button
                  onClick={toggleTutorial}
                  className={`font-mono text-xs uppercase tracking-wider ${tutorialEnabled ? 'text-gold-300 hover:text-gold-100' : 'text-cream-200/50 hover:text-cream-100'}`}
                  title={tutorialEnabled ? 'Disable tutorial hints' : 'Enable tutorial hints'}
                >
                  Tutorial: {tutorialEnabled ? 'On' : 'Off'}
                </button>
                <button
                  onClick={() => setConcedeOpen(true)}
                  disabled={!!you.game_over_reason}
                  className="font-mono text-xs uppercase tracking-wider text-oxblood-300 hover:text-oxblood-100 disabled:opacity-50"
                  title="Concede the game"
                >
                  Concede
                </button>
                <Link to="/multiplayer" className="font-mono text-xs uppercase tracking-wider text-cream-200/70 hover:text-oxblood-300">Leave</Link>
              </div>
            </div>
          </header>
        )}

        {/* ── 2. Status strip ─────────────────────────────────────────────
              Top: controls (live pill sits next to chat).
              Below: a row of player columns (you, then opponents) — each with
              name, rank, and Prestige / Citations / Anticipated boxes — and on
              the right the main player's goal (large) with the year beneath it.
            ─────────────────────────────────────────────────────────── */}
        <section className="surface-binding border-b border-edge-on-dark px-6 py-2">
          {/* One row: goal (left), year (centred), controls (right). The player
              score cards used to sit under this and the goal was pinned right,
              which left a wide empty band across the middle. Scores now live on
              the library bar with each player's publications. Equal flex on the
              outer two keeps the year optically centred. */}
          <div className="flex items-center gap-6">
            <div className="flex-1 min-w-0">
              <GoalLine
                state={state}
                year={game.current_year}
                stage={you.stage}
                articlesPublished={you.articles_published}
                booksPublished={you.books_published}
                totalYears={totalYears}
                className="font-serif italic text-cream-50 text-lg leading-snug"
              />
              {/* (The upgrade nudge moved down into the stats strip, beside the
                  stats it actually spends on.) */}
            </div>

            <div className="shrink-0 text-center">
              <div className="font-display text-2xl text-cream-50 leading-none tabular-nums">
                Year {game.current_year}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream-200/70 mt-1">
                of {totalYears}
              </div>
            </div>

            <div className="flex-1 flex items-center justify-end gap-3">
            <ConnectionPill lastPollAt={lastPollAt} onRefresh={refresh} />
            <ChatToggleButton
              open={chatOpen}
              unreadCount={
                Math.max(0,
                  (state.chat_messages || [])
                    .filter((m) => m.message_id > lastSeenChatId
                      && m.player_id !== you.player_id).length
                )
              }
              onClick={() => {
                setChatOpen(true);
                const last = state.chat_messages?.[state.chat_messages.length - 1];
                if (last) setLastSeenChatId(last.message_id);
              }}
            />
            <SoundToggleButton muted={muted} onClick={handleToggleMute} />
            <button
              onClick={() => setHistoryOpen(true)}
              data-tutorial="history-button"
              className="font-mono text-[10px] uppercase tracking-wider text-cream-200 hover:text-gold-300 underline-offset-2 hover:underline"
              title="View action history"
            >
              📜 History
            </button>
            </div>
          </div>
        </section>

        {/* Year progress bar — thin, visible, with gate markers at y5 and y12 */}
        <YearProgressBar currentYear={game.current_year} totalYears={totalYears} />

        {/* ── 3. Library band — full width (compact published-works shelf).
            Collapsible: it grows all game as the table publishes, and by the
            late game it eats the vertical space the board needs. Persisted per
            user like the notebook, so it stays how you left it. */}
        <div className="surface-binding border-b border-edge-on-dark px-6 pt-2 pb-0.5">
          {/* Five fixed slots so a player's position on the bar never shifts as
              others join, drop, or publish. Empty seats simply stay blank. */}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
            {[you, ...[...state.opponents].sort((a, b) => a.seat_index - b.seat_index)]
              .slice(0, 5)
              .map((p) => (
                <PlayerLibraryCell
                  key={p.player_id}
                  player={p}
                  isYou={p.player_id === you.player_id}
                  publishedWorks={state.published_works}
                  showWorks={!libraryCollapsed}
                  onSpineClick={(work) => setOpenWork(work)}
                />
              ))}
          </div>

          {/* Centred under the bar it controls, and big enough to hit. */}
          <button
            type="button"
            onClick={() => setLibraryCollapsed(!libraryCollapsed)}
            className="w-full flex items-center justify-center gap-2 pt-1 pb-0.5
                       text-gold-400/70 hover:text-gold-300 transition-colors"
            title={libraryCollapsed ? 'Show the published works' : 'Hide the published works'}
            aria-expanded={!libraryCollapsed}
          >
            <span aria-hidden="true" className="text-lg leading-none">
              {libraryCollapsed ? '▾' : '▴'}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.3em]">
              Library · {(state.published_works || []).length}
            </span>
          </button>
        </div>

        {/* ── 4. Play row: conclusions (left) + project rows (right) ──
            Conclusions are split into Main (a/b) and Sub (s/p/e), each stacked
            three to a column. We hide any conclusion currently placed in one of
            YOUR projects (right-click a project's conclusion to return it). */}
        {(() => {
          const inUse = new Set(
            you.projects.map((p) => p.conclusion?.id).filter(Boolean)
          );
          const visibleShelf = conclusionShelf.filter((c) => !inUse.has(c.idCard));
          return (
            /* shrink-0, not flex-1: the row is exactly as tall as the archive
               and conclusion columns need, which pulls the commit bar and the
               notebook up to meet it instead of leaving a band of empty desk. */
            <div className="shrink-0 flex gap-4 p-4">
              {/* The archive market sits to the LEFT of the conclusions and is
                  present in every phase — seeing a card you want is what should
                  push you to spend the year drawing. It only becomes takeable
                  on your turn during the draw phase. */}
              <ArchiveMarket
                piles={archivePiles}
                focused={isDrawPhase}
                canTake={canTakeArchive}
                caption={archiveCaption}
                onTake={handleDrawTake}
                footer={
                  /* Only while choosing this year's action — during the draw
                     phase the choice is already made and the caption shows
                     whose turn it is instead. */
                  !isDrawPhase && !you.game_over_reason && !you.is_ghost ? (
                    <button
                      type="button"
                      onClick={selectDraw}
                      disabled={busy || you.pending_action_committed || handFull}
                      title={
                        handFull
                          ? 'Your notebook is full — publish or discard first.'
                          : 'Spend this year drawing from the archive'
                      }
                      className={`w-full font-display font-bold uppercase tracking-[0.12em] text-[11px]
                                  px-2 py-2 border-2 transition-colors
                                  ${drawSelected
                                    ? 'bg-gold-500 border-gold-500 text-teal-950'
                                    : 'border-gold-500 text-gold-300 hover:bg-gold-500 hover:text-teal-950'}
                                  disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent
                                  disabled:hover:text-gold-300`}
                    >
                      {drawSelected
                        ? (you.pending_action_committed ? 'Drawing — committed' : `Drawing up to ${drawAllowance} ✓`)
                        : `Draw up to ${drawAllowance} card${drawAllowance === 1 ? '' : 's'}`}
                    </button>
                  ) : null
                }
              />
              <ConclusionSidebar
                shelf={visibleShelf}
                onConclusionClick={(card) => setOpenCard({ card, source: 'conclusionShelf' })}
                showTags={effTags} showSignificance={effSignificance}
              />
              {/* The project column: projects on top, commit bar tucked under
                  them. Living here rather than spanning the board is what puts
                  the bar's left edge against the conclusions' right wall.
                  The projects are absolutely positioned inside their own
                  wrapper so their content can't drive the row's height — the
                  row is sized by the archive and conclusion columns, and the
                  projects fill what's left above the bar, scrolling if they
                  overrun. */}
              <div className="flex-1 flex flex-col min-w-0 self-stretch">
              <div className="flex-1 relative min-w-0">
              <main id="main-content" tabIndex={-1} className="absolute inset-0 flex flex-col gap-4 overflow-y-auto">
                {/* All three slots share the column equally, locked ones
                    included. Every slot is always present at the same size now,
                    so an even split fills the space without the rank-1 problem
                    that stretching only the OPEN rows caused — one unlocked
                    slot used to swell to the whole column. */}
                {projects.map((project, i) => (
                  <div key={project.id} className="flex-1 min-h-0 flex">
                  <ProjectRow
                    project={project}
                    locked={i >= workspaces}
                    showTags={effTags} showSignificance={effSignificance}
                    onCardClick={(card) => setOpenCard({ card, source: 'project' })}
                    onPublish={(projectId) => startPublishFlow(projectId)}
                    onAttendConference={(projectId) => selectConference(projectId)}
                    onReturnToHand={returnFromProject}
                    onRemoveCitation={removeCitation}
                    useSpines
                    articleMin={articleMin}
                    freePublishing={freePublishing}
                    statLevels={you.stat_levels || {}}
                  />
                  </div>
                ))}
              </main>
              </div>

              <div className="shrink-0 mt-3">
                <ActionCommitBar
                  pendingAction={you.pending_action}
                  pendingActionData={you.pending_action_data}
                  pendingActionCommitted={you.pending_action_committed}
                  timerSecondsRemaining={game.timer_seconds_remaining}
                  opponents={state.opponents}
                  busy={busy}
                  onCommit={handleCommitYear}
                  onUncommit={handleUncommit}
                  drawCount={drawCount}
                  activeOnly={!you.game_over_reason && !you.is_ghost}
                />
              </div>
              </div>
            </div>
          );
        })()}

        {error && (
          <div className="mx-4 mb-2 p-3 bg-oxblood-700/40 border border-oxblood-500 text-oxblood-300 font-serif text-sm">
            {error}
          </div>
        )}

        {/* (5. The action commit bar moved up into the project column, so it
            sits under the projects rather than spanning the whole board.) */}

        {/* ── 6. Notebook — lifted above the draw mask so your hand stays
            fully visible and readable while you're choosing cards for it. */}
        <NotebookArea
          hand={orderedHand}
          capacity={capacity}
          showTags={effTags} showSignificance={effSignificance}
          onCardClick={(card) => setOpenCard({ card, source: 'hand' })}
          focused={isDrawPhase}
          drawCount={drawCount}
          pendingAction={you.pending_action}
          pendingCommitted={you.pending_action_committed}
        />

        {/* The draw mask. Everything not explicitly lifted above it (the archive
            market and the notebook) dims, so the eye goes to the cards you're
            choosing between without ever hiding the hand you're adding to. */}
        {isDrawPhase && (
          <div className="fixed inset-0 bg-ink-900/75 z-40" aria-hidden="true" />
        )}

        {/* ── Stats strip — sits directly below the notebook ── */}
        <StatsStrip
          statLevels={you.stat_levels}
          citationsReceived={you.citations_received_count ?? 0}
          pendingUpgrade={you.pending_upgrade}
        />

        {/* (The published-works library moved up beside the conclusion shelf.) */}

        {/* ── DIALOGS ── */}

        {/* Card modal — reuses single-player. Now with arrow-key
            navigation through the hand or conclusion shelf (whichever
            sequence the open card came from). Cards opened from a
            project have no sequence and no arrows. */}
        {openCard && (() => {
          // Determine the sequence to navigate. Mirrors single-player.
          let sequence = null;
          if (openCard.source === 'hand') {
            sequence = you.hand;
          } else if (openCard.source === 'conclusionShelf') {
            sequence = conclusionShelf;
          } else if (openCard.source === 'project') {
            // Navigate the project's committed cards left-to-right: conclusion
            // first, then evidence in order. Find the project holding the card.
            const proj = (you.projects || []).find((p) =>
              ((p.conclusion?.id ?? p.conclusion?.idCard) === openCard.card.id) ||
              (p.evidence || []).some((c) => (c.id ?? c.idCard) === openCard.card.id)
            );
            if (proj) {
              sequence = [proj.conclusion, ...(proj.evidence || [])].filter(Boolean);
            }
          }

          let currentIndex = -1;
          if (sequence) {
            currentIndex = sequence.findIndex((c) => (c.id ?? c.idCard) === openCard.card.id);
          }

          // Per design, we HIDE arrows at the edges rather than disable
          // them — pass null when there's no card in that direction.
          const onPrev = (currentIndex > 0)
            ? () => setOpenCard({
                card: { ...sequence[currentIndex - 1], id: sequence[currentIndex - 1].id ?? sequence[currentIndex - 1].idCard },
                source: openCard.source,
              })
            : null;
          const onNext = (sequence && currentIndex >= 0 && currentIndex < sequence.length - 1)
            ? () => setOpenCard({
                card: { ...sequence[currentIndex + 1], id: sequence[currentIndex + 1].id ?? sequence[currentIndex + 1].idCard },
                source: openCard.source,
              })
            : null;

          const position = (sequence && currentIndex >= 0)
            ? { current: currentIndex + 1, total: sequence.length }
            : null;

          return (
            <CardModal
              card={openCard.card}
              onClose={() => setOpenCard(null)}
              showTags={effTags} showSignificance={effSignificance}
              onPrev={onPrev}
              onNext={onNext}
              position={position}
              actions={
              (openCard.source === 'hand' || openCard.source === 'conclusionShelf') ? (
                <PlaceInProjectButtons
                  card={openCard.card}
                  source={openCard.source}
                  projects={projects}
                  workspaces={workspaces}
                  onPlace={async ({ projectId }) => {
                    const isEvidence = openCard.source !== 'conclusionShelf';
                    await moveCard(
                      openCard.card.id,
                      isEvidence ? { kind: 'hand' } : { kind: 'conclusionShelf' },
                      { kind: isEvidence ? 'projectEvidence' : 'projectConclusion', projectId }
                    );
                    setOpenCard(null);
                  }}
                />
              ) : null
            }
          />
          );
        })()}

        {/* Review dialog */}
        {reviewingSub && (
          <ReviewSubmissionDialog
            submission={reviewingSub}
            onSubmit={submitReviewVerdict}
            onClose={() => setReviewing(null)}
            busy={busy}
            error={error}
            yourHand={you.hand}
          />
        )}

        {/* Writer's own manuscript view (read-only) */}
        {viewingManuscript && (
          <ManuscriptViewDialog
            submission={viewingManuscript}
            onClose={() => setViewingManuscript(null)}
          />
        )}

        {/* Writer's Revise & Resubmit decision */}
        {reviseDecision && (
          <ReviseDecisionDialog
            decision={reviseDecision}
            tokensRemaining={you.objection_tokens_remaining ?? 0}
            onAccept={() => handleReviseDecision('accept')}
            onObject={() => handleReviseDecision('object')}
            onRebuild={() => handleReviseDecision('rebuild')}
            onClose={() => {
              setLocallyDismissedRevise((prev) => new Set(prev).add(reviseDecision.submission_id));
              setReviseDecision(null);
            }}
            busy={busy}
            error={error}
          />
        )}

        {/* Result dialog (auto-pops for unresolved rejections + approvals) */}
        {liveResult && (
          <MultiplayerResultDialog
            submission={liveResult}
            you={you}
            onDismiss={handleDismissResult}
            onDrawConsolation={handleDrawConsolationFromResult}
            onReclaim={handleReclaimFromResult}
            onObject={handleObjectFromResult}
            tokensRemaining={you.objection_tokens_remaining ?? 0}
            objectionOutcome={objectionOutcome}
            busy={busy}
            error={error}
          />
        )}

        {/* Publication modal — opens when player left-clicks a spine in
            the bookshelf. Shows book contents but hides the conclusion
            tag code so players judge fit by thesis + evidence + author. */}
        {openWork && (
          <PublicationModal
            work={openWork}
            onClose={() => setOpenWork(null)}
          />
        )}

        {/* Action history drawer — slides in from the left, scrollable. */}
        <ActionHistoryModal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          playerToken={playerToken}
          opponents={state.opponents}
          you={you}
        />

        {/* Toast stack — top-right, fires from recent_events on every
            poll via the watcher effect above. */}
        <ToastStack />

        {/* Chat — slides in from the right (opposite the history modal
            which is left). Sends fire-and-forget; new messages appear
            on the next poll tick. */}
        <ChatPanel
          open={chatOpen}
          onClose={() => {
            // Closing also marks anything visible as read.
            const last = state.chat_messages?.[state.chat_messages.length - 1];
            if (last) setLastSeenChatId(last.message_id);
            setChatOpen(false);
          }}
          messages={state.chat_messages || []}
          youPlayerId={you.player_id}
          onSend={(content) => mpSendChatMessage({ player_token: playerToken, content })}
          playPing={playChatPing}
        />

        {/* Concede confirmation modal */}
        {concedeOpen && (
          <ConcedeConfirmModal
            onConfirm={handleConcede}
            onCancel={() => setConcedeOpen(false)}
            busy={busy}
          />
        )}

        {/* Tutorial overlay — only renders when there's an eligible
            tutorial AND the global toggle is enabled. */}
        <TutorialManager
          state={state}
          playerToken={playerToken}
          enabled={tutorialEnabled}
        />

        {/* "How to Play" actions reference — summoned from the header. */}
        {guideOpen && (
          <ActionsGuideModal mode="multiplayer" onClose={() => setGuideOpen(false)} />
        )}

        {/* Upgrade chooser (suppressed while result dialog is open) */}
        {you.pending_upgrade && !liveResult && (
          <MultiplayerUpgradeChooser
            statLevels={you.stat_levels}
            reason={you.pending_upgrade_reason || 'biennial'}
            stage={you.stage}
            onChoose={handleUpgrade}
            onClose={() => handleUpgrade('research')}
            busy={busy}
            error={error}
          />
        )}

        {/* Publish argument dialog */}
        {publishingProject && (
          <PublishArgumentDialog
            project={publishingProject.project}
            argument={publishArgument}
            onArgumentChange={setPublishArgument}
            onCancel={() => setPublishingProject(null)}
            onConfirm={confirmPublish}
            busy={busy}
          />
        )}

        {/* Synchronous draw phase. Deliberately NOT a modal: the archive market
            lives on the board, and a floating dialog dimmed the hand — you
            couldn't see what you already held while choosing what to add to it.
            Instead everything EXCEPT the archive and the notebook is masked,
            and those two are lifted above it (see drawFocus below). */}
        {isDrawPhase && state.draw_phase && (
          <DrawFocusPanel drawPhase={state.draw_phase} />
        )}

        {/* Synchronous review phase — overlays and blocks the board while the
            table reviews each new manuscript behind a per-player barrier. */}
        {game.phase === 'review' && state.review_phase && (
          <ReviewPhaseModal
            reviewPhase={state.review_phase}
            you={you}
            busy={busy}
            onSubmitReview={handleReviewPhaseVerdict}
            onContinue={handleReviewContinue}
            showSignificance={effSignificance}
          />
        )}

        {/* Conference interstitial — the card-swap draft. */}
        {game.phase === 'conference' && state.conference && (
          <ConferencePhaseModal
            conference={state.conference}
            you={you}
            busy={busy}
            onTake={handleConferenceTake}
          />
        )}

        {/* Career narrative beat — pops when your rank rises (unless story
            prompts are off). */}
        {narrativeStage && narrativeOn && (
          <NarrativeModal
            stage={narrativeStage}
            year={game.current_year}
            onClose={() => setNarrativeStage(null)}
          />
        )}

        {/* Aftermath interstitial — final-year writer-response window. Sits at
            z-30 so the Revise & Resubmit / result dialogs (z-70) pop above it
            when the writer opens an outstanding manuscript. */}
        {game.phase === 'aftermath' && state.aftermath && (
          <AftermathPhaseModal
            aftermath={state.aftermath}
            busy={busy}
            onResolve={handleAftermathResolve}
            onFinish={handleAftermathFinish}
          />
        )}

        {/* Manuscript re-entry tray — reopen a Revise & Resubmit decision or a
            resolved result the writer set aside/minimized. Replaces the removed
            "Out for Review" basket so a writer is never stranded. */}
        {(() => {
          const reviseItems = (state.revise_decisions_for_you || []).map((d) => ({ kind: 'revise', sub: d }));
          const resultItems = (state.resolved_submissions_for_you || [])
            .filter((r) =>
              !r.writer_seen_result ||
              (r.is_rejection && (((r.bound_evidence?.length || 0) > 0) || !r.consolation_drawn))
            )
            .map((r) => ({ kind: 'result', sub: r }));
          const items = [...reviseItems, ...resultItems];
          if (items.length === 0) return null;

          const approvedStatuses = ['approved', 'auto-approved', 'objection-won'];
          return (
            <div className="fixed bottom-4 left-4 z-[60]">
              {manuscriptTrayOpen && (
                <div className="mb-2 w-72 max-h-[50vh] overflow-y-auto surface-paper border border-gold-500/40 shadow-xl p-2 animate-fade-up">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-700 px-1 mb-1">
                    Your manuscripts
                  </p>
                  <ul className="space-y-1">
                    {items.map((it) => {
                      const s = it.sub;
                      const title = s.publication_title || s.conclusion?.title || s.conclusion_title || s.kind || 'Manuscript';
                      const badge = it.kind === 'revise'
                        ? 'Revise & Resubmit — decide'
                        : (approvedStatuses.includes(s.status) ? 'Approved' : 'Rejected — action needed');
                      const tone = it.kind === 'revise'
                        ? 'text-gold-700'
                        : (approvedStatuses.includes(s.status) ? 'text-verdigris-700' : 'text-oxblood-700');
                      return (
                        <li key={`${it.kind}-${s.submission_id}`}>
                          <button
                            type="button"
                            onClick={() => reopenManuscript(it)}
                            className="w-full text-left px-2 py-1.5 border border-cream-300 bg-cream-50 hover:border-gold-500 transition-colors"
                          >
                            <div className="font-display text-sm text-ink-900 truncate">{title}</div>
                            <div className={`font-mono text-[10px] uppercase tracking-wider ${tone}`}>{badge}</div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <button
                type="button"
                onClick={() => setManuscriptTrayOpen((v) => !v)}
                title="Your manuscripts awaiting a decision or action"
                className="px-3 py-2 bg-gold-500 hover:bg-gold-400 text-teal-950 border border-gold-700 font-mono text-xs uppercase tracking-wider shadow-lg"
              >
                Your manuscripts ({items.length})
              </button>
            </div>
          );
        })()}
      </div>
    </DndContext>
  );
}


// ════════════════════════════════════════════════════════════
// Inline subcomponents (kept here for cohesion with the page)
// ════════════════════════════════════════════════════════════

/**
 * ConclusionRail — the horizontal strip of conclusion spines at the top
 * of the play area. Each spine is draggable.
 *
 * Two-tier layout (per design): conclusions whose argument code is a
 * top-level letter ('a' or 'b') sit on the top row; conclusions whose
 * argument is a sub-code ('s', 'p', or 'e') sit on the bottom. Empty
 * tiers are hidden so the rail collapses gracefully when the player has
 * placed every conclusion of one tier into projects.
 *
 * A small mono label on the left edge of each row tells the player
 * which codes live in that tier — understated, matching the rest of
 * the chrome.
 *
 * Multi-tag conclusions (e.g. argument "a,s") are placed in the top
 * tier if they contain ANY top-level code, since the broader code is
 * the more salient categorization. Conclusions whose argument matches
 * neither set fall back to the top tier.
 */
const CONCLUSION_TOP_CODES = new Set(['a', 'b']);
const CONCLUSION_SUB_CODES = new Set(['s', 'p', 'e']);

function conclusionTier(card) {
  const tags = String(card.argument || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tags.some((t) => CONCLUSION_TOP_CODES.has(t))) return 'top';
  if (tags.some((t) => CONCLUSION_SUB_CODES.has(t))) return 'sub';
  return 'top';
}

function ConclusionRail({ shelf, onConclusionClick, showTags, showSignificance, align = 'center' }) {
  const topTier = shelf.filter((c) => conclusionTier(c) === 'top');
  const subTier = shelf.filter((c) => conclusionTier(c) === 'sub');
  const rightAligned = align === 'right';

  const renderRow = (cards, label) => (
    <div className={`flex items-stretch gap-2 min-w-max ${rightAligned ? 'justify-end' : 'justify-center'}`}>
      {/* Tier label — only visible when the player has the tags toggle
          on. The tier itself still functions as a partition; the label
          just names which codes live here (a/b vs s/p/e). When tags are
          off, we render a narrow spacer instead so both rows stay
          horizontally aligned. */}
      {showTags ? (
        <div className="flex items-center justify-center w-6 flex-shrink-0">
          <span
            className="font-mono text-[8px] uppercase tracking-[0.3em] text-cream-100/60"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
            title={label === 'a · b' ? 'Top-level conclusions (a, b)' : 'Sub-argument conclusions (s, p, e)'}
          >
            {label}
          </span>
        </div>
      ) : (
        <div className="w-1 flex-shrink-0" aria-hidden="true" />
      )}
      <div className="flex gap-2">
        {cards.map((c) => (
          <DraggableCard
            key={`shelf-${c.idCard}`}
            id={`shelf-${c.idCard}`}
            data={{ cardId: c.idCard, from: { kind: 'conclusionShelf' } }}
          >
            {({ dragHandleProps, isDragging }) => (
              <div {...dragHandleProps} className={isDragging ? 'opacity-50' : ''}>
                <ConclusionSpine
                  card={{ ...c, id: c.idCard }}
                  onClick={() => onConclusionClick(c)}
                  showTags={showTags} showSignificance={showSignificance}
                />
              </div>
            )}
          </DraggableCard>
        ))}
      </div>
    </div>
  );

  const inner = (
    <div className="overflow-x-auto w-full">
      <div className={`flex flex-col gap-1.5 w-max ${rightAligned ? 'ml-auto' : 'mx-auto'}`}>
        {topTier.length > 0 && renderRow(topTier, 'a · b')}
        {topTier.length > 0 && subTier.length > 0 && (
          <div className="border-t border-edge-on-dark/40" aria-hidden="true" />
        )}
        {subTier.length > 0 && renderRow(subTier, 's · p · e')}
      </div>
    </div>
  );

  // Right-aligned mode is used inside the shared library/conclusion band, which
  // already provides the surface + padding, so render bare there.
  if (rightAligned) {
    return <div data-tutorial="conclusion-rail" className="w-full">{inner}</div>;
  }
  return (
    <section data-tutorial="conclusion-rail" className="surface-binding border-b border-edge-on-dark px-6 py-2">
      {inner}
    </section>
  );
}


/**
 * DrawFocusPanel — the draw phase's status readout.
 *
 * Deliberately a small floating panel rather than a dialog. The archive market
 * and the notebook stay live and readable underneath; this only says whose turn
 * it is and who the table is still waiting on. It sits above the draw mask but
 * takes no pointer events, so it can never intercept a click meant for a card.
 */
function DrawFocusPanel({ drawPhase }) {
  const yourTurn = !!drawPhase.you_are_up;
  const left = drawPhase.your_draws_remaining || 0;
  const waiting = (drawPhase.players || []).filter((p) => p.draws_remaining > 0);

  return (
    <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[60] pointer-events-none
                    surface-paper border-2 border-gold-500 shadow-2xl px-6 py-3 text-center animate-fade-in">
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-700">
        The Archive
      </p>
      <p className="font-display text-2xl font-bold text-ink-900 leading-none mt-1">
        {yourTurn
          ? `Your pick — ${left} card${left === 1 ? '' : 's'} left`
          : `Waiting on ${drawPhase.current_player_name || '…'}`}
      </p>
      <p className="font-serif italic text-ink-700 text-sm mt-1">
        {yourTurn
          ? 'Take a card from any pile.'
          : 'Players take one card at a time, in turn order.'}
      </p>
      {waiting.length > 0 && (
        <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-ink-700/80 mt-2">
          Still drawing: {waiting.map((p) => `${p.player_name} (${p.draws_remaining})`).join(' · ')}
        </p>
      )}
    </div>
  );
}


/**
 * A full conclusion shelf holds seven. Decks with fewer show the remaining
 * slots as unused, so the column keeps its height (and lines up with the
 * archive market beside it). Matches solo.
 */
const CONCLUSION_SLOTS = 7;

/**
 * ConclusionSidebar — conclusions to the LEFT of the project rows, stacked in
 * one column under a single decorated "Conclusions" header. Each tile shows its
 * prestige value on the right. Same treatment as solo: full-size spines rather
 * than thin ones, padded out to a full seven-slot shelf.
 */
function ConclusionSidebar({ shelf, onConclusionClick, showTags, showSignificance }) {
  // Main (a/b) conclusions first, then sub (s/p/e) — but no separate labels.
  const ordered = [
    ...shelf.filter((c) => conclusionTier(c) === 'top'),
    ...shelf.filter((c) => conclusionTier(c) === 'sub'),
  ];

  return (
    /* self-stretch + a flexing slot list: the shelf takes the full height of
       the play row and its seven slots divide it, so the rail ends level with
       the archive's draw button beside it instead of stopping short. The tiles
       grow to fill their share rather than sitting at a fixed height. */
    <aside data-tutorial="conclusion-rail" className="shrink-0 self-stretch flex flex-col min-h-0">
      {/* Fancy header */}
      <div className="text-center shrink-0">
        <span className="font-display text-sm uppercase tracking-[0.3em] text-gold-300">
          ❧ Conclusions ❧
        </span>
        <FleuronDivider className="my-1" />
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-1.5">
        {ordered.map((c) => (
          <DraggableCard
            key={`shelf-${c.idCard}`}
            id={`shelf-${c.idCard}`}
            data={{ cardId: c.idCard, from: { kind: 'conclusionShelf' } }}
          >
            {({ dragHandleProps, isDragging }) => (
              <div {...dragHandleProps} className={`flex-1 min-h-0 ${isDragging ? 'opacity-50' : ''}`}>
                <ConclusionSpine
                  fill
                  card={{ ...c, id: c.idCard }}
                  widthClass="w-72"
                  onClick={() => onConclusionClick(c)}
                  showTags={showTags} showSignificance={showSignificance}
                />
              </div>
            )}
          </DraggableCard>
        ))}

        {/* Pad out to a full shelf. A deck with fewer conclusions — or one
            whose conclusions are currently placed in projects — shows the
            remaining slots as unused rather than leaving the column short. */}
        {Array.from({ length: Math.max(0, CONCLUSION_SLOTS - ordered.length) }).map((_, i) => (
          <div
            key={`empty-slot-${i}`}
            className="w-72 flex-1 min-h-0 border border-dashed border-cream-50/20 flex items-center justify-center"
          >
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream-200/40">
              not used
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}



/**
 * PlaceInProjectButtons — buttons inside the CardModal that let the
 * player place a hand/shelf card into one of their projects.
 */
function PlaceInProjectButtons({ card, source, projects, workspaces, onPlace }) {
  const isConclusion = source === 'conclusionShelf';
  // Filter to UNLOCKED projects only (workspaces=N → projects[0..N-1] unlocked).
  const usable = projects.slice(0, workspaces);
  return (
    <div className="flex flex-wrap gap-2 justify-end">
      {usable.map((p) => {
        // For conclusions: always allowed — placing onto a project that
        // already has a conclusion REPLACES the existing one (server
        // handles this in mp_moveCard: projectConclusion destination
        // overwrites conclusion_card_id). The old conclusion goes back
        // to the shelf (which is static, so it always shows it anyway).
        // For evidence: always allowed.
        const allowed = true;
        const isReplace = isConclusion && p.conclusion;
        const label = isConclusion
          ? (isReplace ? `Replace conclusion of Project ${p.id + 1}` : `Set conclusion of Project ${p.id + 1}`)
          : `Add to Project ${p.id + 1}`;
        return (
          <button
            key={p.id}
            onClick={() => allowed && onPlace({ projectId: p.id })}
            disabled={!allowed}
            className={`px-3 py-2 border font-mono text-sm uppercase tracking-wider ${
              allowed
                ? (isReplace
                    ? 'bg-ink-900 text-cream-50 border-oxblood-500 hover:bg-oxblood-700 hover:border-oxblood-700'
                    : 'bg-ink-900 text-cream-50 border-ink-900 hover:bg-oxblood-700 hover:border-oxblood-700')
                : 'bg-cream-200 text-ink-700/40 border-cream-300 cursor-not-allowed'
            }`}
            title={isReplace ? `Replaces "${p.conclusion.title}"` : undefined}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}


/**
 * PublishArgumentDialog — when the player clicks Publish on a project,
 * we open this to collect the prose argument before committing the
 * publish action.
 *
 * VOIP mode: a checkbox at the top lets the player declare they're
 * explaining via voice (Discord/Zoom/in-person) instead of typing.
 * When enabled, the argument textbox becomes optional — reviewers see
 * either whatever notes the player did type, OR a "via voice"
 * placeholder if the field is left empty.
 *
 * The VOIP preference persists in localStorage across games (key:
 * 'historians.voipMode'). When account-based logins arrive, this should
 * migrate to a user-level setting.
 */
function PublishArgumentDialog({ project, argument, onArgumentChange, onCancel, onConfirm, busy }) {
  // VOIP toggle — persisted in user_settings via useUserSetting, so
  // it syncs across the player's devices. Default false (textbox
  // required) so first-time users see no behavior change.
  const [voipMode, setVoipMode] = useUserSetting('voip_enabled', false);

  function toggleVoip() {
    setVoipMode(!voipMode);
  }

  // Submit is allowed when either VOIP mode is on (text optional) or
  // some argument has been typed (text required).
  const hasText = argument.trim().length > 0;
  const canSubmit = !busy && (voipMode || hasText);

  const evidence = project.evidence || [];

  return (
    <div className="fixed inset-0 bg-black/70 z-[80] flex items-center justify-center p-4">
      <div className="surface-binding border border-gold-500/40 text-cream-100 max-w-6xl w-full max-h-[92vh] flex flex-col font-serif">

        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b border-gold-500/25 flex-shrink-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-400 mb-1">
            Submit for Peer Review
          </p>
          <h2 className="font-display text-2xl text-cream-50">
            {project.conclusion?.title}
          </h2>
          {project.conclusion?.description && (
            <p className="font-serif italic text-cream-200/80 text-sm mt-1">
              {project.conclusion.description}
            </p>
          )}
          <p className="text-sm text-cream-200/70 mt-1">
            {evidence.length} evidence card{evidence.length === 1 ? '' : 's'} ·
            Reviewers will see titles, authors, and tags only — your argument is what they read.
          </p>
        </div>

        {/* Body — evidence on the left so it stays in view while you write. */}
        <div className="flex-1 min-h-0 grid lg:grid-cols-[1.3fr_1fr] gap-5 px-6 py-4 overflow-hidden">

          <section className="min-h-0 flex flex-col">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-2 flex-shrink-0">
              Your evidence
            </p>
            <div className="min-h-0 overflow-y-auto pr-1">
              {evidence.length === 0 ? (
                <p className="font-serif italic text-cream-200/60 text-sm">
                  No evidence staged in this project.
                </p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2">
                  {evidence.map((c, i) => (
                    <article
                      key={c.idCard ?? c.id ?? i}
                      className="surface-paper border border-gold-500/40 p-3 text-ink-900"
                    >
                      <h4 className="font-display font-bold text-sm leading-tight">
                        {c.title || 'Untitled'}
                      </h4>
                      {(c.author || c.date || c.location || c.source_type) && (
                        <p className="font-mono text-[9px] uppercase tracking-wider text-ink-700 mt-1">
                          {[c.author, c.date, c.location, c.source_type].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {c.content && (
                        <p className="font-serif text-xs leading-snug mt-2">{c.content}</p>
                      )}
                      {c.significance && (
                        <p className="font-serif italic text-xs text-ink-700 leading-snug mt-2">
                          {c.significance}
                        </p>
                      )}
                      {c.citation && (
                        <p className="font-mono text-[9px] text-ink-700/70 mt-2 break-words">
                          {c.citation}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Composer */}
          <section className="min-h-0 flex flex-col">
            {/* VOIP toggle — when enabled the textbox is optional and reviewers
                see a "via voice" placeholder if it's left empty. */}
            <label className="flex items-start gap-2 mb-3 cursor-pointer select-none flex-shrink-0">
              <input
                type="checkbox"
                checked={voipMode}
                onChange={toggleVoip}
                className="mt-1 accent-gold-500"
              />
              <span className="text-sm text-cream-100 leading-snug">
                <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400 block">
                  Explaining via voice
                </span>
                I'll explain my argument out loud (Discord, Zoom, in person, etc).
                The textbox becomes optional.
              </span>
            </label>

            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 flex-shrink-0">
              {voipMode ? 'Notes (optional)' : 'Your argument'}
            </span>
            <textarea
              value={argument}
              onChange={(e) => onArgumentChange(e.target.value)}
              maxLength={2000}
              placeholder={voipMode
                ? 'Optional. Jot down anything you want the reviewer to see in writing — or leave blank and explain by voice.'
                : 'Explain in your own words how the evidence supports the conclusion.'
              }
              className="input-dark w-full mt-1 text-sm flex-1 min-h-[8rem] resize-none"
              autoFocus
            />
            <div className="font-mono text-[10px] text-cream-200/50 text-right flex-shrink-0">
              {argument.length}/2000
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gold-500/25 flex justify-end gap-2 flex-shrink-0">
          <button onClick={onCancel} className="btn-ghost">Cancel</button>
          <button onClick={onConfirm} disabled={!canSubmit} className="btn-primary">
            {busy ? 'Submitting…' : 'Submit manuscript'}
          </button>
        </div>
      </div>
    </div>
  );
}


/**
 * StatStrip — compact rendering of stat levels for the timeline bar.
 * Same shape as single-player's StatStrip.
 */
/**
 * ConnectionPill — small live/stale indicator. Shows green when polling
 * has completed a fetch in the last 5 seconds, amber when it's been
 * 5–15 seconds, red when longer than 15 seconds. Click → forces a poll.
 *
 * Useful for diagnosing polling problems: if it stays green but the
 * other player's moves aren't showing, the server is returning
 * "unchanged" wrongly. If it goes red, polling itself has died.
 */
function ConnectionPill({ lastPollAt, onRefresh }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!lastPollAt) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-wider text-cream-200/60">
        connecting…
      </span>
    );
  }
  const age = Math.floor((now - lastPollAt) / 1000);
  let color = 'text-verdigris-400';
  let label = 'live';
  if (age > 15) { color = 'text-oxblood-300'; label = `stalled (${age}s)`; }
  else if (age > 5) { color = 'text-gold-400'; label = `${age}s`; }
  return (
    <button
      onClick={onRefresh}
      title={`Last poll ${age}s ago. Click to force-refresh.`}
      className={`font-mono text-[10px] uppercase tracking-wider ${color} hover:underline flex-shrink-0`}
    >
      ● {label}
    </button>
  );
}


/**
 * ConcedeConfirmModal — confirmation dialog before conceding the game.
 * Conceding is irreversible: the player is marked game-over with reason
 * 'conceded' and other players continue without them.
 */
function ConcedeConfirmModal({ onConfirm, onCancel, busy }) {
  return (
    <>
      <div
        onClick={onCancel}
        className="fixed inset-0 z-40 bg-black/50"
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-label="Confirm concede"
        className="
          fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
          surface-paper border-2 border-oxblood-700 px-6 py-5 max-w-md w-[90vw]
        "
      >
        <h2 className="font-display text-xl text-ink-900 mb-2">Concede the game?</h2>
        <p className="font-serif text-sm text-ink-800 mb-4 leading-snug">
          Your career as a historian will end. The other players will continue
          without you. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="
              px-4 py-2 font-sans text-ink-800
              border border-ink-700/40 hover:bg-ink-900/5
              transition-colors disabled:opacity-50
            "
          >
            Stay
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="
              px-4 py-2 font-mono text-xs uppercase tracking-wider
              bg-oxblood-700 hover:bg-oxblood-500 text-cream-50
              border border-oxblood-300 disabled:opacity-50
            "
          >
            {busy ? 'Conceding…' : 'Concede'}
          </button>
        </div>
      </div>
    </>
  );
}


function labelForStage(stage) {
  return stageLabel(stage);
}


/**
 * PlayerLibraryCell — one of five slots on the library bar: a player's name,
 * rank, running score, and their published works side by side.
 *
 * Score and publications belong together — a player's score IS mostly their
 * publications — so they share a cell instead of sitting in two separate bands
 * with empty space between. The score stays visible when the library is
 * collapsed; only the spines fold away, since reclaiming board room shouldn't
 * cost you the scoreboard.
 */
function PlayerLibraryCell({ player, isYou = false, publishedWorks = [], showWorks = true, onSpineClick }) {
  const col = colorForSeat(player.seat_index);
  const citations = player.citations_received_count ?? 0;
  const mult = renownMultiplier(player.stat_levels?.renown);
  const prestige = player.prestige ?? 0;
  const total = prestige + citations * mult;
  const dim = player.is_ghost || player.game_over_reason;
  const works = publishedWorks.filter((w) => w.writer_player_id === player.player_id);

  return (
    <div className={`min-w-0 ${dim ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`w-1.5 h-3.5 shrink-0 ${col.spineBg}`} aria-hidden="true" />
        <span className="font-display text-sm text-cream-50 leading-none truncate">
          {player.player_name}
        </span>
        {isYou && <span className="text-gold-400 text-[10px] shrink-0">(you)</span>}
        <Tooltip content={scoreBreakdown(player, publishedWorks)} side="bottom" width="w-72">
          <span className="ml-auto shrink-0 font-display font-bold tabular-nums text-gold-200 text-xl leading-none cursor-help">
            {total}
          </span>
        </Tooltip>
      </div>
      <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-gold-400/80 truncate mt-0.5">
        {labelForStage(player.stage)}
      </div>

      {showWorks && (
        <div className="mt-1">
          <PlayerSection
            fill
            compact
            label={null}
            seat={player.seat_index}
            works={works}
            onSpineClick={onSpineClick}
          />
        </div>
      )}
    </div>
  );
}


/**
 * Itemizes a player's score: each publication's prestige, then the citation
 * payout. Shown on hover over the running total.
 */
function scoreBreakdown(player, publishedWorks) {
  const citations = player.citations_received_count ?? 0;
  const mult = renownMultiplier(player.stat_levels?.renown);
  const prestige = player.prestige ?? 0;
  const citationPayout = citations * mult;
  const total = prestige + citationPayout;
  const works = publishedWorks.filter((w) => w.writer_player_id === player.player_id);
  const pubSum = works.reduce((s, w) => s + (w.prestige_granted || 0), 0);
  const otherPrestige = prestige - pubSum;

  return (
    <div className="space-y-0.5">
      <strong className="block font-display text-sm text-gold-300 mb-1">Score breakdown</strong>
      <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-cream-200/70">Publications</div>
      {works.length === 0 ? (
        <div className="italic text-cream-200/50">none yet</div>
      ) : (
        works.map((w) => (
          <div key={w.work_id} className="flex justify-between gap-3">
            <span className="truncate">“{w.publication_title}”</span>
            <span className="text-gold-300 tabular-nums">+{w.prestige_granted}</span>
          </div>
        ))
      )}
      {otherPrestige > 0 && (
        <div className="flex justify-between gap-3">
          <span>Other prestige</span>
          <span className="text-gold-300 tabular-nums">+{otherPrestige}</span>
        </div>
      )}
      <div className="flex justify-between gap-3 border-t border-gold-500/20 mt-1 pt-1">
        <span>Prestige total</span>
        <span className="text-gold-200 tabular-nums">{prestige}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span>Citations {citations} × renown ×{mult}</span>
        <span className="text-verdigris-300 tabular-nums">+{citationPayout}</span>
      </div>
      <div className="flex justify-between gap-3 border-t border-gold-500/40 mt-1 pt-1 font-bold">
        <span>Total score</span>
        <span className="text-cream-50 tabular-nums">{total}</span>
      </div>
    </div>
  );
}



/**
 * ChatToggleButton — the header button that opens the chat panel.
 * Shows an unread-count badge when there are messages newer than the
 * last-seen pointer AND those messages weren't from the player
 * themselves.
 */
function ChatToggleButton({ open, unreadCount, onClick }) {
  return (
    <button
      onClick={onClick}
      data-tutorial="chat-button"
      className="relative font-mono text-[10px] uppercase tracking-wider text-cream-200 hover:text-gold-300 underline-offset-2 hover:underline"
      title={open ? 'Close chat' : 'Open chat'}
      aria-label={unreadCount > 0 ? `Open chat (${unreadCount} unread)` : 'Open chat'}
    >
      💬 Chat
      {unreadCount > 0 && (
        <span
          className="absolute -top-1 -right-3 min-w-[16px] h-[16px] px-1 flex items-center justify-center bg-oxblood-500 text-cream-50 font-mono text-[9px] rounded-full"
          aria-hidden="true"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}


/**
 * SoundToggleButton — header button to mute/unmute all in-game sounds
 * (publish chime, year tick, chat ping, etc.). State is persisted via
 * lib/sounds.js → localStorage 'historians.soundMuted', so the choice
 * survives page reloads and applies across the player's games.
 *
 * Visuals: 🔊 when audible, 🔇 when muted. The label text changes too
 * so screen readers announce the state — relying on emoji alone would
 * be hostile to anyone whose accessibility setup strips emoji.
 */
function SoundToggleButton({ muted, onClick }) {
  return (
    <button
      onClick={onClick}
      className="font-mono text-[10px] uppercase tracking-wider text-cream-200 hover:text-gold-300 underline-offset-2 hover:underline"
      title={muted ? 'Unmute game sounds' : 'Mute game sounds'}
      aria-pressed={muted}
      aria-label={muted ? 'Unmute game sounds' : 'Mute game sounds'}
    >
      {muted ? '🔇 Muted' : '🔊 Sound'}
    </button>
  );
}

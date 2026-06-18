import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
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
  mpReviewContinue,
  mpConferenceTake,
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
import MultiplayerBookshelf from '../components/MultiplayerBookshelf.jsx';
import PublicationModal from '../components/PublicationModal.jsx';
import ActionCommitBar from '../components/ActionCommitBar.jsx';
import ActionHistoryModal from '../components/ActionHistoryModal.jsx';
import TutorialManager from '../components/TutorialManager.jsx';
import ActionsGuideModal from '../components/ActionsGuideModal.jsx';
import ReviewPhaseModal from '../components/ReviewPhaseModal.jsx';
import ConferencePhaseModal from '../components/ConferencePhaseModal.jsx';
import { isTutorialEnabled, setTutorialEnabled as persistTutorialEnabled } from '../lib/tutorialStorage.js';
import useUserSetting from '../auth/useUserSetting.js';
import GoalLine from '../components/GoalLine.jsx';
import YearProgressBar from '../components/YearProgressBar.jsx';
import StatsStrip from '../components/StatsStrip.jsx';
import DrawZone from '../components/DrawZone.jsx';
import Tooltip from '../components/Tooltip.jsx';

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
  const [collapsedProjects, setCollapsedProjects] = useState(() => {
    const init = new Set();
    for (let i = 1; i < 3; i++) init.add(i);
    return init;
  });
  const [showTags, setShowTags] = useUserSetting('show_tags', false);
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

  // Track what's currently being dragged so DragOverlay can render a
  // floating preview that follows the cursor. Without this, drags happen
  // silently (the source card just turns translucent in place).
  const [activeDragId, setActiveDragId] = useState(null);

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
        if (!cancelled) setConclusionShelf(rows.filter((c) => c.type === 'conclusion'));
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

  function toggleProjectCollapse(projectId) {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  // Drag start — capture which draggable is active so DragOverlay can
  // render its floating preview.
  function handleDragStart(evt) {
    setActiveDragId(evt.active?.id ?? null);
  }

  function handleDragCancel() {
    setActiveDragId(null);
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
  async function handleReviewPhaseVerdict({ submission_id, verdict, flagged_card_ids, comment }) {
    await mpSubmitReview({
      player_token: playerToken,
      submission_id,
      verdict,
      flagged_card_ids: flagged_card_ids || [],
      comment,
    });
    await refresh();
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
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <DragOverlay dropAnimation={null} zIndex={9999}>
        {activeCard ? (
          activeCard.type === 'conclusion'
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
          {/* Controls row — right aligned; live indicator next to chat */}
          <div className="flex items-center justify-end gap-3 mb-2">
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

          {/* Players (left) + Goal/Year (right) */}
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start gap-6 min-w-0 flex-wrap">
              <PlayerStatCard player={you} isYou publishedWorks={state.published_works} />
              {[...state.opponents]
                .sort((a, b) => a.seat_index - b.seat_index)
                .map((op) => (
                  <PlayerStatCard key={op.player_id} player={op} publishedWorks={state.published_works} />
                ))}
            </div>

            <div className="shrink-0 max-w-md text-right">
              <GoalLine
                state={state}
                year={game.current_year}
                stage={you.stage}
                articlesPublished={you.articles_published}
                booksPublished={you.books_published}
                totalYears={totalYears}
                className="font-serif italic text-cream-50 text-lg text-right leading-snug"
              />
              <div className="font-serif italic text-cream-200/80 text-lg text-right mt-1">
                Year {game.current_year} / {totalYears}
              </div>
            </div>
          </div>
        </section>

        {/* Year progress bar — thin, visible, with gate markers at y5 and y12 */}
        <YearProgressBar currentYear={game.current_year} totalYears={totalYears} />

        {/* ── 3. Library band — full width (compact published-works shelf). */}
        <div className="surface-binding border-b border-edge-on-dark px-6 py-2">
          <MultiplayerBookshelf
            compact
            you={you}
            opponents={state.opponents}
            publishedWorks={state.published_works}
            onSpineClick={(work) => setOpenWork(work)}
          />
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
            <div className="flex-1 flex gap-4 p-4 min-h-0">
              <ConclusionSidebar
                shelf={visibleShelf}
                onConclusionClick={(card) => setOpenCard({ card, source: 'conclusionShelf' })}
                showTags={effTags} showSignificance={effSignificance}
              />
              <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col gap-4 min-w-0 overflow-y-auto">
                {projects.map((project, i) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    locked={i >= workspaces}
                    collapsed={collapsedProjects.has(project.id)}
                    onToggleCollapse={() => toggleProjectCollapse(project.id)}
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
                ))}
              </main>
            </div>
          );
        })()}

        {error && (
          <div className="mx-4 mb-2 p-3 bg-oxblood-700/40 border border-oxblood-500 text-oxblood-300 font-serif text-sm">
            {error}
          </div>
        )}

        {/* ── 5. Action commit bar (just above hand) ── */}
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

        {/* ── 6. Notebook (deck stack on left, hand on right) ── */}
        <NotebookArea
          hand={you.hand}
          capacity={capacity}
          showTags={effTags} showSignificance={effSignificance}
          onCardClick={(card) => setOpenCard({ card, source: 'hand' })}
          archiveRemaining={state.archive_remaining}
          drawCount={drawCount}
          pendingAction={you.pending_action}
          pendingCommitted={you.pending_action_committed}
          onSelectDraw={selectDraw}
          actionsDisabled={busy || !!you.game_over_reason || !!you.is_ghost}
        />

        {/* ── Stats strip — sits directly below the notebook ── */}
        <StatsStrip
          statLevels={you.stat_levels}
          citationsReceived={you.citations_received_count ?? 0}
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
            reason={you.pending_upgrade_reason || 'publish'}
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
 * ConclusionSidebar — conclusions to the LEFT of the project rows, all stacked
 * in one thin vertical column. Main (a/b) conclusions sit on top, Sub (s/p/e)
 * below, each under a small label.
 */
function ConclusionSidebar({ shelf, onConclusionClick, showTags, showSignificance }) {
  const mainTier = shelf.filter((c) => conclusionTier(c) === 'top');
  const subTier = shelf.filter((c) => conclusionTier(c) === 'sub');

  const renderTile = (c) => (
    <DraggableCard
      key={`shelf-${c.idCard}`}
      id={`shelf-${c.idCard}`}
      data={{ cardId: c.idCard, from: { kind: 'conclusionShelf' } }}
    >
      {({ dragHandleProps, isDragging }) => (
        <div {...dragHandleProps} className={isDragging ? 'opacity-50' : ''}>
          <ConclusionSpine
            thin
            card={{ ...c, id: c.idCard }}
            onClick={() => onConclusionClick(c)}
            showTags={showTags} showSignificance={showSignificance}
          />
        </div>
      )}
    </DraggableCard>
  );

  const groupLabel = (label) => (
    <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-gold-400 px-0.5">{label}</span>
  );

  return (
    <aside data-tutorial="conclusion-rail" className="shrink-0 flex flex-col gap-1.5 overflow-y-auto">
      {mainTier.length > 0 && (
        <>
          {groupLabel('Main')}
          {mainTier.map(renderTile)}
        </>
      )}
      {subTier.length > 0 && (
        <>
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-gold-400 px-0.5 mt-1.5">Sub</span>
          {subTier.map(renderTile)}
        </>
      )}
    </aside>
  );
}


/**
 * NotebookArea — bottom bar containing the deck stack (DrawZone) on
 * the left, and the player's hand on the right. Pattern ported from
 * single-player NotebookArea so the two interfaces feel consistent.
 *
 * Clicking the DrawZone selects 'draw' as the pending action — the
 * actual draw happens at year-end resolution, not on click.
 */
function NotebookArea({
  hand,
  capacity,
  showTags,
  showSignificance,
  onCardClick,
  archiveRemaining,
  drawCount,
  pendingAction,
  pendingCommitted,
  onSelectDraw,
  actionsDisabled,
}) {
  const isDrawSelected = pendingAction === 'draw';

  // Collapse state — persisted per-device in localStorage so the
  // notebook stays however the player left it across reloads and
  // future games. When account-based logins arrive this should
  // migrate to a user-level setting (same as VOIP).
  //
  // Even when collapsed, the hand remains a valid drop target — a thin
  // drop strip stays visible — so the player can return evidence to
  // their notebook without expanding first. The card count in the
  // header updates live.
  // Notebook collapse persisted to user_settings (was localStorage).
  // Sync across devices; survives sign-out/sign-in.
  const [collapsed, setCollapsed] = useUserSetting('notebook_collapsed', false);
  function toggleCollapsed() {
    setCollapsed(!collapsed);
  }

  return (
    <section className={`surface-wood border-y border-wood-900 px-6 ${collapsed ? 'py-1.5' : 'py-3 min-h-[14rem]'}`}>
      {collapsed ? (
        /* Collapsed state: a single thin bar. The chevron + label are the
           only controls; clicking expands the whole thing including the
           DrawZone. To draw, the player expands first — keeps the
           interaction model simple and gives back the vertical real
           estate the player asked for. The hand drop target moves to
           the bar itself so dragging cards back to the notebook still
           works without expanding. */
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

          {/* Left: DrawZone — clickable deck stack that selects the draw action. */}
          <DrawZone
            archiveRemaining={archiveRemaining}
            drawCount={drawCount}
            handSize={hand.length}
            handCapacity={capacity}
            selected={isDrawSelected}
            committed={pendingCommitted}
            disabled={actionsDisabled}
            onSelect={onSelectDraw}
          />

          {/* Right: the hand. Header shows count + a chevron toggle. */}
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
              <div className="flex flex-wrap gap-2 min-h-[100px]">
                {hand.length === 0 ? (
                  <p className="font-serif italic text-cream-200/60 self-center mx-auto">
                    Notebook empty. Click the archive on the left to draw cards.
                  </p>
                ) : (
                  hand.map((card) => (
                    <DraggableCard
                      key={`hand-${card.id}`}
                      id={`hand-${card.id}`}
                      data={{ cardId: card.id, from: { kind: 'hand' } }}
                    >
                      {({ dragHandleProps, isDragging }) => (
                        <div {...dragHandleProps} className={isDragging ? 'opacity-50' : ''}>
                          <CardThumbnail card={card} onClick={() => onCardClick(card)} showTags={showTags} showSignificance={showSignificance} />
                        </div>
                      )}
                    </DraggableCard>
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

  return (
    <div className="fixed inset-0 bg-black/70 z-[80] flex items-center justify-center p-4">
      <div className="surface-binding border border-gold-500/40 text-cream-100 max-w-2xl w-full p-6 font-serif">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-400 mb-1">
          Submit for Peer Review
        </p>
        <h2 className="font-display text-2xl text-cream-50 mb-2">
          {project.conclusion?.title}
        </h2>
        <p className="text-sm text-cream-200/70 mb-3">
          {project.evidence.length} evidence card{project.evidence.length === 1 ? '' : 's'} ·
          Reviewers will see titles, authors, and tags only — your argument below is what they read.
        </p>

        {/* VOIP toggle — checkbox at the top of the dialog. When enabled,
            the textbox is optional and reviewers see a "via voice"
            placeholder if it's left empty. */}
        <label className="flex items-start gap-2 mb-3 cursor-pointer select-none">
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
            The textbox below becomes optional.
          </span>
        </label>

        <label className="block mb-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
            {voipMode ? 'Notes (optional)' : 'Your argument'}
          </span>
          <textarea
            value={argument}
            onChange={(e) => onArgumentChange(e.target.value)}
            maxLength={2000}
            rows={6}
            placeholder={voipMode
              ? 'Optional. Jot down anything you want the reviewer to see in writing — or leave blank and explain by voice.'
              : 'Explain in your own words how the evidence supports the conclusion.'
            }
            className="input-dark w-full mt-1 text-sm"
            autoFocus
          />
          <div className="font-mono text-[10px] text-cream-200/50 text-right">
            {argument.length}/2000
          </div>
        </label>
        <div className="flex justify-end gap-2">
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
  const labels = {
    'graduate-student': 'Graduate Student',
    'abd': 'ABD',
    'assistant-professor': 'Assistant Professor',
    'associate-professor': 'Associate Professor',
    'full-professor': 'Full Professor',
    'endowed-professor': 'Endowed Professor',
    'retired': 'Retired',
    'failed-comps': 'Withdrew',
    'tenure-denied': 'Tenure Denied',
  };
  return labels[stage] || stage;
}


/**
 * PlayerStatCard — one column in the status strip: name, rank, and a single
 * total score (current prestige + citations × renown, as if the game ended
 * now). The score's tooltip itemizes where the points came from: each
 * publication's prestige and the citation payout. Used for you and opponents.
 */
function PlayerStatCard({ player, isYou = false, publishedWorks = [] }) {
  const col = colorForSeat(player.seat_index);
  const citations = player.citations_received_count ?? 0;
  const mult = renownMultiplier(player.stat_levels?.renown);
  const prestige = player.prestige ?? 0;
  const citationPayout = citations * mult;
  const total = prestige + citationPayout;
  const dim = player.is_ghost || player.game_over_reason;

  const works = publishedWorks.filter((w) => w.writer_player_id === player.player_id);
  const pubSum = works.reduce((s, w) => s + (w.prestige_granted || 0), 0);
  const otherPrestige = prestige - pubSum;

  const tooltip = (
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

  return (
    <div className={`flex flex-col items-start gap-1 ${dim ? 'opacity-50' : ''}`}>
      <span className="flex items-center gap-1.5 font-display text-base text-cream-50 leading-none">
        <span className={`w-2 h-4 ${col.spineBg}`} aria-hidden="true" />
        {player.player_name}
        {isYou && <span className="text-gold-400 text-xs">(you)</span>}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gold-400">
        {labelForStage(player.stage)}
      </span>
      <Tooltip content={tooltip} side="bottom" width="w-72">
        <div className="inline-flex flex-col items-center justify-center border border-gold-500/40 px-5 py-1.5 leading-none cursor-help">
          <span className={`font-display font-bold tabular-nums text-gold-200 ${isYou ? 'text-3xl' : 'text-2xl'}`}>
            {total}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-gold-400/80 mt-1">
            Score
          </span>
        </div>
      </Tooltip>
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

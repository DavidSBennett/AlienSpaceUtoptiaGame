<?php
/**
 * mp_commitAction.php
 *
 * POST — record the calling player's action for the current year and optionally
 * commit it (End Year). Tentative actions can be set without committing, then
 * the player clicks End Year to commit.
 *
 * Request body:
 *   {
 *     player_token: string,
 *     action:       'draw' | 'publish' | 'review' | 'pass',
 *     action_data:  object | null,
 *     commit:       bool      (true = clicked End Year; false = just updating selection)
 *   }
 *
 * For 'publish' action_data shape:
 *   {
 *     projectId:    int (0..2),
 *     argumentText: string (1..2000 chars)
 *   }
 *   Note: the conclusion + evidence are read from the project at resolution
 *   time, not at commit time. This means the player can still drag cards
 *   around between commit and year-end, but the moment year resolves,
 *   whatever's in that project is what gets submitted.
 *
 * For 'review' action_data shape (commit-time):
 *   {
 *     submissionId: int
 *   }
 *   The actual verdict is submitted SEPARATELY via mp_submitReview.php after
 *   the reviewer has read the submission. Committing 'review' as your action
 *   reserves your action for this year; the verdict can be submitted at any
 *   time before the year resolves (but mp_submitReview.php will require
 *   that you have committed to review this submission).
 *
 * For 'draw' and 'pass': action_data is null.
 *
 * Response:
 *   {
 *     ok: true,
 *     committed: bool,
 *     state_version: int
 *   }
 *
 * If commit=true and all players have committed (or timer expired), year
 * resolves immediately on this request — no need to wait for a poll.
 * The response in that case includes the new current_year via state_version
 * bump which the client will pick up on its next getGameState.
 */

require_once __DIR__ . '/mp_dbConfig.php';
require_once __DIR__ . '/mp_resolveYear.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

if ($game['status'] !== 'active') {
  mp_error('Game is not active', 409);
}
if (($game['phase'] ?? 'action') !== 'action') {
  mp_error('Cannot take an action during the review phase', 409);
}
if ($player['game_over_reason']) {
  mp_error('You are out of the game', 409);
}
if ($player['is_ghost']) {
  mp_error('You are no longer participating', 409);
}

$body = mp_read_json_body();
$action = isset($body['action']) ? (string) $body['action'] : '';
$actionData = $body['action_data'] ?? null;
$commit = !empty($body['commit']);

if (!in_array($action, ['draw','publish','review','pass','attend_conference'], true)) {
  mp_error('Unknown action', 400);
}

// Per-action validation
switch ($action) {
  case 'publish':
    if (!is_array($actionData)) mp_error('action_data required for publish', 400);
    $projectId = isset($actionData['projectId']) ? (int) $actionData['projectId'] : -1;
    if ($projectId < 0 || $projectId > 2) mp_error('Invalid projectId', 400);
    $argument = isset($actionData['argumentText']) ? trim((string) $actionData['argumentText']) : '';
    if (mb_strlen($argument) > 2000) {
      mp_error('argumentText cannot exceed 2000 characters', 400);
    }
    // Empty argument is allowed — the writer is explaining via voice (Discord,
    // Zoom, in-person, etc). Reviewers see a "via voice" placeholder.
    // Also confirm the project actually has a conclusion + ≥1 evidence right
    // now. (Could change before resolution but we want to fail fast for the UX.)
    $pid = (int) $player['player_id'];
    $stmt = $mysqli->prepare("
      SELECT conclusion_card_id, evidence_card_ids
      FROM mp_projects WHERE player_id = ? AND slot_index = ?
    ");
    $stmt->bind_param('ii', $pid, $projectId);
    $stmt->execute();
    $res = $stmt->get_result();
    $proj = $res->fetch_assoc();
    $stmt->close();
    if (!$proj || !$proj['conclusion_card_id']) {
      mp_error('Project has no conclusion', 400);
    }
    $ev = $proj['evidence_card_ids'] ? json_decode($proj['evidence_card_ids'], true) : [];
    if (!is_array($ev) || count($ev) < 1) {
      mp_error('Project has no evidence', 400);
    }
    // Normalize action_data to canonical form for storage
    $actionData = [
      'projectId'    => $projectId,
      'argumentText' => $argument,
    ];
    break;

  case 'review':
    if (!is_array($actionData)) mp_error('action_data required for review', 400);
    $sid = isset($actionData['submissionId']) ? (int) $actionData['submissionId'] : 0;
    if ($sid <= 0) mp_error('submissionId required', 400);
    // Verify the submission exists, is in this game, is pending, and is not
    // yours.
    $stmt = $mysqli->prepare("
      SELECT s.writer_player_id, s.status, s.game_id
      FROM mp_submissions s WHERE s.submission_id = ?
    ");
    $stmt->bind_param('i', $sid);
    $stmt->execute();
    $res = $stmt->get_result();
    $sub = $res->fetch_assoc();
    $stmt->close();
    if (!$sub) mp_error('Submission not found', 404);
    if ((int) $sub['game_id'] !== (int) $game['game_id']) {
      mp_error('Submission belongs to a different game', 403);
    }
    if ((int) $sub['writer_player_id'] === (int) $player['player_id']) {
      mp_error('Cannot review your own submission', 400);
    }
    if ($sub['status'] !== 'pending') {
      mp_error('Submission is no longer reviewable', 409);
    }
    $actionData = ['submissionId' => $sid];
    break;

  case 'attend_conference':
    // Stage cards into a project slot and attend a conference with them.
    if (!is_array($actionData)) mp_error('action_data required for attend_conference', 400);
    $projectId = isset($actionData['projectId']) ? (int) $actionData['projectId'] : -1;
    if ($projectId < 0 || $projectId > 2) mp_error('Invalid projectId', 400);
    $pid = (int) $player['player_id'];
    $stmt = $mysqli->prepare("
      SELECT evidence_card_ids FROM mp_projects WHERE player_id = ? AND slot_index = ?
    ");
    $stmt->bind_param('ii', $pid, $projectId);
    $stmt->execute();
    $proj = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    $ev = ($proj && $proj['evidence_card_ids']) ? json_decode($proj['evidence_card_ids'], true) : [];
    if (!is_array($ev) || count($ev) < 1) {
      mp_error('Stage at least one card to attend a conference', 400);
    }
    $actionData = ['projectId' => $projectId];
    break;

  case 'draw':
  case 'pass':
    $actionData = null;
    break;
}

// ----- Write the action -----

$pid = (int) $player['player_id'];
$committedInt = $commit ? 1 : 0;
$dataJson = $actionData ? json_encode($actionData) : null;

$stmt = $mysqli->prepare("
  UPDATE mp_game_players
  SET pending_action = ?,
      pending_action_data = ?,
      pending_action_committed = ?
  WHERE player_id = ?
");
$stmt->bind_param('ssii', $action, $dataJson, $committedInt, $pid);
if (!$stmt->execute()) {
  mp_error('Failed to record action: ' . $stmt->error, 500);
}
$stmt->close();

mp_log_event($mysqli, (int) $game['game_id'], $pid, $commit ? 'action_committed' : 'action_selected', [
  'action' => $action,
]);

$stateVersion = mp_bump_state_version($mysqli, (int) $game['game_id']);

// If they committed, see if everyone has → resolve immediately.
if ($commit) {
  $advanced = mp_maybe_resolve_year($mysqli, (int) $game['game_id']);
  if ($advanced) {
    // Refresh state version after resolution
    $stmt = $mysqli->prepare("SELECT state_version FROM mp_games WHERE game_id = ?");
    $gid = (int) $game['game_id'];
    $stmt->bind_param('i', $gid);
    $stmt->execute();
    $res = $stmt->get_result();
    $stateVersion = (int) $res->fetch_assoc()['state_version'];
    $stmt->close();
  }
}

mp_json([
  'ok' => true,
  'committed' => $commit,
  'state_version' => $stateVersion,
]);

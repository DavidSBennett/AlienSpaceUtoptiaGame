<?php
/**
 * mp_publishFree.php
 *
 * POST — submit a manuscript WITHOUT spending the year's action, the perk
 * Workspaces L4 has always advertised and never actually granted.
 *
 * Solo has had this since the stat existed: its publish reducer skips the year
 * advance at L4. Multiplayer couldn't copy that literally — the year resolves
 * for the whole table at once, so one player can't skip it. Here the perk means
 * the submission doesn't occupy your action slot: you submit now, and still
 * choose draw / conference / review for the same year.
 *
 * The manuscript is created immediately with status='pending', so it joins this
 * round's review phase alongside anything submitted the ordinary way. Nothing
 * about review, scoring or citations differs — this is purely about which slot
 * the submission costs you.
 *
 * Request body:  { player_token, projectId: 0..2, argumentText?: string }
 * Response:      { ok: true, submission_id, state_version }
 *
 * Errors:
 *   400 — bad projectId
 *   403 — Workspaces isn't L4 yet
 *   409 — game not active / not in the action phase / project not ready
 */

require_once __DIR__ . '/mp_dbConfig.php';
require_once __DIR__ . '/mp_resolveYear.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

$gameId = (int) $game['game_id'];
$pid    = (int) $player['player_id'];

if ($game['status'] !== 'active') {
  mp_error('Game is not active', 409);
}
// Only during the action phase. Mid-draw or mid-review the board is in a
// synchronous interstitial and submissions would land in a half-resolved round.
if (($game['phase'] ?? 'action') !== 'action') {
  mp_error('You can only submit between phases', 409);
}
if (!empty($player['game_over_reason']) || !empty($player['is_ghost'])) {
  mp_error('Your career has ended', 409);
}

// The perk itself. Workspaces L4 — the level that grants no extra slot and
// instead frees publishing from the action cost.
$workspaces = (int) ($player['workspaces_level'] ?? 1);
if ($workspaces < 4) {
  mp_error('Free publishing needs Workspaces level 4', 403);
}

$body      = mp_read_json_body();
$projectId = isset($body['projectId']) ? (int) $body['projectId'] : -1;
$argument  = isset($body['argumentText']) ? (string) $body['argumentText'] : '';

if ($projectId < 0 || $projectId > 2) {
  mp_error('projectId must be 0..2', 400);
}

$submissionId = null;

$mysqli->begin_transaction();
try {
  // Lock the game row: this must not interleave with a year resolution that
  // is reading the same project slot.
  $stmt = $mysqli->prepare("SELECT phase FROM mp_games WHERE game_id = ? FOR UPDATE");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $g = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  if (!$g || ($g['phase'] ?? 'action') !== 'action') {
    throw new Exception('The round has moved on — try again next year');
  }

  // Re-read the project under the lock and check it's actually submittable,
  // so the caller gets a clear error rather than mp_resolve_publish quietly
  // logging a skip and returning as though it worked.
  $stmt = $mysqli->prepare("
    SELECT conclusion_card_id, evidence_card_ids
    FROM mp_projects WHERE player_id = ? AND slot_index = ?
  ");
  $stmt->bind_param('ii', $pid, $projectId);
  $stmt->execute();
  $proj = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  if (!$proj || !$proj['conclusion_card_id']) {
    throw new Exception('That project has no conclusion');
  }
  // Same floor the ordinary publish path enforces (one real evidence card).
  // Deliberately not the UI's stricter two-card minimum: a free publish must
  // not reject a manuscript that submitting the normal way would accept.
  $evIds = $proj['evidence_card_ids'] ? json_decode($proj['evidence_card_ids'], true) : [];
  if (!is_array($evIds) || count($evIds) < 1) {
    throw new Exception('That project has no evidence');
  }

  // Reuse the ordinary publish path in full — submission row, citation
  // snapshot, emptying the project slot, event log. A free publish differs
  // from a normal one only in never touching pending_action.
  mp_resolve_publish($mysqli, $gameId, $player, [
    'projectId'    => $projectId,
    'argumentText' => $argument,
  ]);

  $stmt = $mysqli->prepare("
    SELECT submission_id FROM mp_submissions
    WHERE game_id = ? AND writer_player_id = ?
    ORDER BY submission_id DESC LIMIT 1
  ");
  $stmt->bind_param('ii', $gameId, $pid);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  $submissionId = $row ? (int) $row['submission_id'] : null;

  mp_log_event($mysqli, $gameId, $pid, 'published_free', [
    'projectId'     => $projectId,
    'submission_id' => $submissionId,
  ]);

  $stateVersion = mp_bump_state_version($mysqli, $gameId);
  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 409);
}

mp_json([
  'ok'            => true,
  'submission_id' => $submissionId,
  'state_version' => $stateVersion,
]);

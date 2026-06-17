<?php
/**
 * mp_submitReview.php
 *
 * POST — submit a verdict on a publication you've committed to review.
 *
 * Workflow:
 *   1. You commit action='review' with submissionId via mp_commitAction.php
 *   2. After reading the submission, you call THIS endpoint to submit your
 *      verdict (approve / reject + flagged cards if reject)
 *   3. The verdict is recorded but doesn't take effect until year-resolution
 *
 * You can change your verdict at any time before year-end by calling this
 * endpoint again. The latest verdict wins.
 *
 * Request body:
 *   {
 *     player_token:     string,
 *     submission_id:    int,
 *     verdict:          'approve' | 'reject',
 *     flagged_card_ids: int[]    (required if verdict='reject', ≥ 1 element)
 *     comment:          string   (optional, ≤ 500 chars)
 *   }
 *
 * Response:
 *   {
 *     ok: true,
 *     state_version: int
 *   }
 *
 * Errors:
 *   400 — missing/invalid fields
 *   403 — you haven't committed to review this submission
 *   404 — submission not found
 *   409 — submission is not pending (already resolved)
 */

require_once __DIR__ . '/mp_dbConfig.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

if ($game['status'] !== 'active') {
  mp_error('Game is not active', 409);
}

$body = mp_read_json_body();
$sid     = isset($body['submission_id']) ? (int) $body['submission_id'] : 0;
$verdict = isset($body['verdict']) ? (string) $body['verdict'] : '';
$flagged = (isset($body['flagged_card_ids']) && is_array($body['flagged_card_ids']))
  ? array_values(array_map('intval', $body['flagged_card_ids']))
  : [];
$added = (isset($body['added_card_ids']) && is_array($body['added_card_ids']))
  ? array_values(array_map('intval', $body['added_card_ids']))
  : [];
$comment = isset($body['comment']) ? trim((string) $body['comment']) : null;
if ($comment !== null && mb_strlen($comment) > 500) {
  mp_error('comment too long (max 500 chars)', 400);
}

if ($sid <= 0) mp_error('submission_id required', 400);
if (!in_array($verdict, ['approve','reject','revise'], true)) {
  mp_error('verdict must be approve, reject, or revise', 400);
}
if ($verdict === 'reject' && count($flagged) === 0) {
  mp_error('Reject verdicts require at least one flagged card', 400);
}
if ($verdict === 'revise' && count($flagged) === 0 && count($added) === 0) {
  mp_error('Revise verdicts require at least one card removed or added', 400);
}

// ----- Verify the submission and the player's commitment -----

$stmt = $mysqli->prepare("
  SELECT s.*, p.pending_action, p.pending_action_data, p.pending_action_committed
  FROM mp_submissions s
  JOIN mp_game_players p ON p.player_id = ?
  WHERE s.submission_id = ?
");
$pid = (int) $player['player_id'];
$stmt->bind_param('ii', $pid, $sid);
$stmt->execute();
$res = $stmt->get_result();
$row = $res->fetch_assoc();
$stmt->close();

if (!$row) mp_error('Submission not found', 404);
if ((int) $row['game_id'] !== (int) $game['game_id']) {
  mp_error('Submission belongs to a different game', 403);
}
if ($row['status'] !== 'pending') {
  mp_error('Submission is no longer reviewable', 409);
}
if ((int) $row['writer_player_id'] === $pid) {
  mp_error('Cannot review your own submission', 400);
}

// Reviewing is a FREE action: any non-writer player in an active game may
// submit a verdict on a pending submission at any time, regardless of what
// action they've selected for the year. (Previously this required the player
// to have spent their year action on 'review' for this submission.)

// Also: validate that all flagged cards are actually in the submission's
// evidence. Can't flag a card that isn't there.
if (count($flagged) > 0) {
  $evIds = json_decode($row['evidence_card_ids'], true) ?: [];
  foreach ($flagged as $f) {
    if (!in_array($f, $evIds, true)) {
      mp_error('Flagged card not in submission evidence', 400);
    }
  }
}

// If this reviewer previously proposed a revision on THIS submission, the
// cards they locked into that earlier proposal are returned to their hand
// first, so the validation below sees an accurate hand and a changed or
// withdrawn proposal releases its cards.
{
  $pStmt = $mysqli->prepare("SELECT added_card_ids FROM mp_reviews WHERE submission_id = ? AND reviewer_player_id = ?");
  $pStmt->bind_param('ii', $sid, $pid);
  $pStmt->execute();
  $pr = $pStmt->get_result()->fetch_assoc();
  $pStmt->close();
  $priorAdded = ($pr && $pr['added_card_ids']) ? (json_decode($pr['added_card_ids'], true) ?: []) : [];
  $yr = (int) $game['current_year'];
  foreach ($priorAdded as $pa) {
    $paInt = (int) $pa;
    $ins = $mysqli->prepare("INSERT IGNORE INTO mp_player_hands (player_id, idCard, added_year) VALUES (?, ?, ?)");
    $ins->bind_param('iii', $pid, $paInt, $yr);
    $ins->execute();
    $ins->close();
  }
}

// Added cards (revise only) must currently be in the reviewer's own hand.
// On a 'revise' verdict they're then LOCKED out of the hand (below) so the
// reviewer can't play cards committed to the writer's manuscript.
if (count($added) > 0) {
  $ph = implode(',', array_fill(0, count($added), '?'));
  $types = str_repeat('i', count($added)) . 'i';
  $params = array_merge($added, [$pid]);
  $stmt = $mysqli->prepare("SELECT idCard FROM mp_player_hands WHERE idCard IN ($ph) AND player_id = ?");
  $stmt->bind_param($types, ...$params);
  $stmt->execute();
  $hres = $stmt->get_result();
  $inHand = [];
  while ($hr = $hres->fetch_assoc()) $inHand[(int) $hr['idCard']] = true;
  $stmt->close();
  foreach ($added as $a) {
    if (!isset($inHand[$a])) mp_error('Added card is not in your hand', 400);
  }
}

// ----- Upsert the review -----
$flaggedJson = count($flagged) > 0 ? json_encode($flagged) : null;
$addedJson   = count($added) > 0 ? json_encode($added) : null;
$year = (int) $game['current_year'];

// Use REPLACE INTO so resubmitting overwrites the previous verdict.
// Note REPLACE deletes and re-inserts, so the review_id may change. That's
// fine because the unique constraint is on (submission_id, reviewer_player_id).
$stmt = $mysqli->prepare("
  REPLACE INTO mp_reviews
    (submission_id, reviewer_player_id, verdict, flagged_card_ids, added_card_ids, comment, reviewed_year)
  VALUES (?, ?, ?, ?, ?, ?, ?)
");
$stmt->bind_param('iissssi', $sid, $pid, $verdict, $flaggedJson, $addedJson, $comment, $year);
if (!$stmt->execute()) {
  mp_error('Failed to record review: ' . $stmt->error, 500);
}
$stmt->close();

// Lock the contributed cards out of the reviewer's hand for the duration of
// the proposal — they're committed to the writer's manuscript and must not be
// playable elsewhere. They're consumed if the writer accepts, or returned to
// the reviewer if the writer objects or rebuilds.
if ($verdict === 'revise' && count($added) > 0) {
  $ph = implode(',', array_fill(0, count($added), '?'));
  $types = str_repeat('i', count($added)) . 'i';
  $params = array_merge($added, [$pid]);
  $del = $mysqli->prepare("DELETE FROM mp_player_hands WHERE idCard IN ($ph) AND player_id = ?");
  $del->bind_param($types, ...$params);
  $del->execute();
  $del->close();
}

mp_log_event($mysqli, (int) $game['game_id'], $pid, 'review_submitted', [
  'submission_id' => $sid,
  'verdict'       => $verdict,
  'flagged_count' => count($flagged),
]);

$stateVersion = mp_bump_state_version($mysqli, (int) $game['game_id']);

mp_json([
  'ok' => true,
  'state_version' => $stateVersion,
]);

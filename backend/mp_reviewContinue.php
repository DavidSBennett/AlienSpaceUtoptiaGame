<?php
/**
 * mp_reviewContinue.php
 *
 * POST — during the synchronous review phase, the calling player marks
 * themselves "ready" (clicked Continue / Start Next Year) for the manuscript
 * currently under review. Reviewers must have recorded a verdict first; the
 * writer of that manuscript is exempt (they only acknowledge).
 *
 * When every live player is ready for the current manuscript, the phase
 * advances to the next manuscript — or, past the last one, the round finishes
 * (outcomes resolve by majority vote and the next year begins). That barrier
 * logic lives in mp_maybe_advance_review().
 *
 * Request body:  { player_token }
 * Response:      { ok: true, state_version }
 *
 * Errors:
 *   409 — game not active / not in the review phase / no verdict yet
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
if (($game['phase'] ?? 'action') !== 'review') {
  mp_error('Not in the review phase', 409);
}
if ($player['game_over_reason'] || $player['is_ghost']) {
  mp_error('You are no longer participating', 409);
}

// Resolve the manuscript currently under review.
$subIds = mp_review_submission_ids($mysqli, $gameId);
$index  = (int) $game['review_index'];
if ($index >= count($subIds)) {
  // Index already past the list — let the advancer finish/clean up.
  mp_maybe_advance_review($mysqli, $gameId);
  mp_json(['ok' => true, 'state_version' => mp_bump_state_version($mysqli, $gameId)]);
}

$currentSid = $subIds[$index];

// Look up the writer of the current manuscript.
$stmt = $mysqli->prepare("SELECT writer_player_id FROM mp_submissions WHERE submission_id = ?");
$stmt->bind_param('i', $currentSid);
$stmt->execute();
$subRow = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$subRow) {
  mp_error('Manuscript not found', 404);
}
$writerId = (int) $subRow['writer_player_id'];

// Reviewers must have recorded a verdict before they can continue.
if ($writerId !== $pid) {
  $stmt = $mysqli->prepare("SELECT 1 FROM mp_reviews WHERE submission_id = ? AND reviewer_player_id = ? LIMIT 1");
  $stmt->bind_param('ii', $currentSid, $pid);
  $stmt->execute();
  $hasVerdict = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  if (!$hasVerdict) {
    mp_error('Submit your review before continuing', 409);
  }
}

// Mark this player ready for the current manuscript (idempotent).
$stmt = $mysqli->prepare("
  INSERT INTO mp_review_progress (submission_id, player_id, ready)
  VALUES (?, ?, 1)
  ON DUPLICATE KEY UPDATE ready = 1
");
$stmt->bind_param('ii', $currentSid, $pid);
$stmt->execute();
$stmt->close();

mp_log_event($mysqli, $gameId, $pid, 'review_continue', ['submission_id' => $currentSid]);

$stateVersion = mp_bump_state_version($mysqli, $gameId);

// Try to advance the barrier now (also re-checked on every poll).
mp_maybe_advance_review($mysqli, $gameId);

// Re-read the version in case the advance bumped it.
$stmt = $mysqli->prepare("SELECT state_version FROM mp_games WHERE game_id = ?");
$stmt->bind_param('i', $gameId);
$stmt->execute();
$stateVersion = (int) $stmt->get_result()->fetch_assoc()['state_version'];
$stmt->close();

mp_json(['ok' => true, 'state_version' => $stateVersion]);

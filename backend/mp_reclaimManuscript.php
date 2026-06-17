<?php
/**
 * mp_reclaimManuscript.php
 *
 * POST — writer reclaims evidence cards from a rejected manuscript into
 * their hand. Greedy: takes cards in declared order until hand is full
 * (or manuscript is empty).
 *
 * Lifecycle:
 *   - Rejected submission has evidence_card_ids = [c1, c2, c3, ...]
 *   - Writer's hand has room for K cards (K = capacity - current size)
 *   - Take min(K, evidence_count) cards in order, move to hand
 *   - Strip those cards from the submission's evidence_card_ids
 *   - If evidence_card_ids becomes empty:
 *       * Mark submission status='reclaimed' (hides it from queries)
 *       * Conclusion is implicitly forgotten (we don't separately track it)
 *   - Otherwise: manuscript stays with remaining cards; writer can click
 *     it again later to take more
 *
 * Request body:
 *   {
 *     player_token: string,
 *     submission_id: int
 *   }
 *
 * Response:
 *   {
 *     ok: true,
 *     reclaimed_count: int,      number of cards moved to hand this call
 *     remaining_count: int,      number of cards still bound to manuscript
 *     manuscript_fully_reclaimed: bool,
 *     state_version: int
 *   }
 *
 * Errors:
 *   404 — submission not found or not yours
 *   409 — submission isn't a rejection, or already fully reclaimed,
 *         or hand has no room
 */

require_once __DIR__ . '/mp_dbConfig.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

$body = mp_read_json_body();
$sid  = isset($body['submission_id']) ? (int) $body['submission_id'] : 0;
if ($sid <= 0) mp_error('submission_id required', 400);

$pid = (int) $player['player_id'];
$gid = (int) $game['game_id'];

$mysqli->begin_transaction();
try {
  // Lock submission row
  $stmt = $mysqli->prepare("
    SELECT * FROM mp_submissions
    WHERE submission_id = ? AND writer_player_id = ?
    FOR UPDATE
  ");
  $stmt->bind_param('ii', $sid, $pid);
  $stmt->execute();
  $res = $stmt->get_result();
  $sub = $res->fetch_assoc();
  $stmt->close();

  if (!$sub) throw new Exception('Submission not found or not yours');
  $rejectedStatuses = ['rejected','auto-rejected','objection-lost'];
  if (!in_array($sub['status'], $rejectedStatuses, true)) {
    throw new Exception('Submission is not a rejection');
  }

  $evIds = $sub['evidence_card_ids'] ? json_decode($sub['evidence_card_ids'], true) : [];
  if (!is_array($evIds) || count($evIds) === 0) {
    throw new Exception('Manuscript has no cards to reclaim');
  }

  // Compute hand room
  $notebookTable = [7, 11, 15, 25];
  $capacity = $notebookTable[(int) $player['notebook_level'] - 1];
  $stmt = $mysqli->prepare("SELECT COUNT(*) AS n FROM mp_player_hands WHERE player_id = ?");
  $stmt->bind_param('i', $pid);
  $stmt->execute();
  $res = $stmt->get_result();
  $handSize = (int) $res->fetch_assoc()['n'];
  $stmt->close();
  $room = $capacity - $handSize;

  if ($room <= 0) {
    throw new Exception('Hand is full; play or place cards before reclaiming');
  }

  $year = (int) $game['current_year'];
  $takeCount = min($room, count($evIds));

  // Take the first $takeCount cards from $evIds in declared order
  $taken = array_slice($evIds, 0, $takeCount);
  $remaining = array_slice($evIds, $takeCount);

  // Move taken cards into the writer's hand
  foreach ($taken as $cid) {
    $cidInt = (int) $cid;
    $stmt = $mysqli->prepare("
      INSERT IGNORE INTO mp_player_hands (player_id, idCard, added_year)
      VALUES (?, ?, ?)
    ");
    $stmt->bind_param('iii', $pid, $cidInt, $year);
    $stmt->execute();
    $stmt->close();
  }

  // Update submission row: either strip the cards from evidence_card_ids
  // (manuscript persists), or mark 'reclaimed' (manuscript fully unpacked).
  if (count($remaining) === 0) {
    // Manuscript fully reclaimed. The conclusion is implicitly discarded;
    // it was a copy from the shelf, so no cleanup needed.
    $stmt = $mysqli->prepare("
      UPDATE mp_submissions SET status = 'reclaimed', evidence_card_ids = '[]'
      WHERE submission_id = ?
    ");
    $stmt->bind_param('i', $sid);
    $stmt->execute();
    $stmt->close();
  } else {
    $remainingJson = json_encode(array_values($remaining));
    $stmt = $mysqli->prepare("
      UPDATE mp_submissions SET evidence_card_ids = ?
      WHERE submission_id = ?
    ");
    $stmt->bind_param('si', $remainingJson, $sid);
    $stmt->execute();
    $stmt->close();
  }

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 409);
}

mp_log_event($mysqli, $gid, $pid, 'manuscript_reclaim', [
  'submission_id'    => $sid,
  'reclaimed_count'  => $takeCount,
  'remaining_count'  => count($remaining),
]);

$stateVersion = mp_bump_state_version($mysqli, $gid);

mp_json([
  'ok' => true,
  'reclaimed_count' => $takeCount,
  'remaining_count' => count($remaining),
  'manuscript_fully_reclaimed' => count($remaining) === 0,
  'state_version' => $stateVersion,
]);

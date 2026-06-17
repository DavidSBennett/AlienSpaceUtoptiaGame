<?php
/**
 * mp_drawConsolation.php
 *
 * POST — writer claims the consolation draw bonus for a rejected submission.
 * One-time per submission; gated by hand capacity (caller's notebook level).
 *
 * Behavior:
 *   - Verify the submission belongs to caller and is 'rejected'
 *   - Verify consolation_drawn is 0 (not previously claimed)
 *   - Compute hand room: capacity - current hand size
 *   - Compute draw target: min(research stat value, hand room)
 *   - Pull that many cards from the archive, dealing them to the hand
 *   - Set consolation_drawn = 1 to disable the button
 *   - Bump state_version
 *
 * The draw is IMMEDIATE — it does NOT advance the year. This is unlike
 * the normal "draw cards" action; consolation is a free reward for the
 * rejection cost (a wasted year).
 *
 * Hand-full edge case: client-side, the button should be disabled when
 * the hand is at capacity. If somehow the call lands with no room (race
 * with another action), the endpoint refuses (returns 409 with a friendly
 * message) and consolation_drawn stays 0 — they can try again after
 * playing a card.
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
 *     drew_cards: int,
 *     state_version: int
 *   }
 *
 * Errors:
 *   404 — submission not found or not yours
 *   409 — submission is not 'rejected', or consolation already drawn,
 *         or hand has no room
 */

require_once __DIR__ . '/mp_dbConfig.php';
require_once __DIR__ . '/mp_resolveYear.php';   // for reshuffle helper

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
  // Lock the submission row
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
  if ((int) $sub['consolation_drawn'] === 1) {
    throw new Exception('Consolation already claimed');
  }

  // Compute capacity and current hand size
  $notebookTable = [7, 11, 15, 25];
  $researchTable = [3, 5, 7, 'capacity'];
  $capacity = $notebookTable[(int) $player['notebook_level'] - 1];
  $rawDraw  = $researchTable[(int) $player['research_level'] - 1];

  $stmt = $mysqli->prepare("SELECT COUNT(*) AS n FROM mp_player_hands WHERE player_id = ?");
  $stmt->bind_param('i', $pid);
  $stmt->execute();
  $res = $stmt->get_result();
  $handSize = (int) $res->fetch_assoc()['n'];
  $stmt->close();

  $room = $capacity - $handSize;
  if ($room <= 0) {
    throw new Exception('Hand is full; play or place cards before claiming the consolation draw');
  }

  $drawCount = ($rawDraw === 'capacity') ? $capacity : (int) $rawDraw;
  $target = min($drawCount, $room);
  if ($target <= 0) {
    throw new Exception('Nothing to draw');
  }

  $year = (int) $game['current_year'];
  $drew = 0;
  $remaining = $target;

  while ($remaining > 0) {
    $stmt = $mysqli->prepare("
      SELECT idCard FROM mp_game_archive
      WHERE game_id = ? AND drawn_by_player_id IS NULL
      ORDER BY archive_position ASC
      LIMIT ?
    ");
    $stmt->bind_param('ii', $gid, $remaining);
    $stmt->execute();
    $res = $stmt->get_result();
    $cardIds = [];
    while ($r = $res->fetch_assoc()) $cardIds[] = (int) $r['idCard'];
    $stmt->close();

    if (count($cardIds) === 0) {
      $shuffled = mp_reshuffle_discards_into_archive($mysqli, $gid);
      if ($shuffled === 0) break;
      continue;
    }
    foreach ($cardIds as $cid) {
      $stmt = $mysqli->prepare("
        UPDATE mp_game_archive
        SET drawn_by_player_id = ?, drawn_year = ?
        WHERE game_id = ? AND idCard = ? AND drawn_by_player_id IS NULL
      ");
      $stmt->bind_param('iiii', $pid, $year, $gid, $cid);
      $stmt->execute();
      $aff = $stmt->affected_rows;
      $stmt->close();
      if ($aff !== 1) continue;

      $stmt = $mysqli->prepare("
        INSERT IGNORE INTO mp_player_hands (player_id, idCard, added_year)
        VALUES (?, ?, ?)
      ");
      $stmt->bind_param('iii', $pid, $cid, $year);
      $stmt->execute();
      $stmt->close();
      $drew++;
      $remaining--;
      if ($remaining <= 0) break;
    }
  }

  // Mark consolation claimed (always, even if we drew 0 due to mid-draw
  // archive exhaustion — players who want to retry can dispute via the
  // event log; we don't try to be clever about partial draws).
  $stmt = $mysqli->prepare("
    UPDATE mp_submissions SET consolation_drawn = 1 WHERE submission_id = ?
  ");
  $stmt->bind_param('i', $sid);
  $stmt->execute();
  $stmt->close();

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 409);
}

mp_log_event($mysqli, $gid, $pid, 'consolation_drawn', [
  'submission_id' => $sid,
  'drew_cards'    => $drew,
]);

$stateVersion = mp_bump_state_version($mysqli, $gid);

mp_json([
  'ok' => true,
  'drew_cards' => $drew,
  'state_version' => $stateVersion,
]);

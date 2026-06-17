<?php
/**
 * mp_claimResultRewards.php
 *
 * POST — mark a resolved submission as "dismissed" by the writer so the
 * auto-pop dialog stops appearing. The writer can still click the
 * manuscript spine in their "Out for Review" list to re-open the dialog
 * (e.g. to claim consolation later or reclaim cards).
 *
 * Note on scope reduction: this endpoint used to deliver the consolation
 * draw at acknowledgement time. With the new three/four-button result
 * modal, the consolation draw is its own explicit button
 * (mp_drawConsolation.php) and card reclaim is its own explicit button
 * (mp_reclaimManuscript.php). This endpoint now just marks "yes, I saw
 * the result."
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
 *     state_version: int
 *   }
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

$mysqli->begin_transaction();
try {
  $stmt = $mysqli->prepare("
    SELECT status, writer_seen_result FROM mp_submissions
    WHERE submission_id = ? AND writer_player_id = ?
    FOR UPDATE
  ");
  $stmt->bind_param('ii', $sid, $pid);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();
  if (!$row) throw new Exception('Submission not found or not yours');

  $stmt = $mysqli->prepare("
    UPDATE mp_submissions SET writer_seen_result = 1 WHERE submission_id = ?
  ");
  $stmt->bind_param('i', $sid);
  $stmt->execute();
  $stmt->close();

  // Anti-grief: accepting a peer reviewer's rejection (acknowledging it
  // without objecting) refunds one objection token, capped at 4. This stops
  // a reviewer from grinding a writer down to zero tokens with repeat
  // rejections. Granted once, only on the first acknowledgement, and only for
  // a straight rejection (not objection-lost, where the writer already chose
  // to spend tokens).
  $grantedToken = false;
  if (((int) $row['writer_seen_result']) === 0
      && in_array($row['status'], ['rejected', 'auto-rejected'], true)) {
    $stmt = $mysqli->prepare("
      UPDATE mp_game_players
      SET objection_tokens_remaining = LEAST(objection_tokens_remaining + 1, 4)
      WHERE player_id = ?
    ");
    $stmt->bind_param('i', $pid);
    $stmt->execute();
    $stmt->close();
    $grantedToken = true;
  }

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 409);
}

mp_log_event($mysqli, (int) $game['game_id'], $pid, 'result_dismissed', [
  'submission_id'           => $sid,
  'objection_token_granted' => $grantedToken,
]);

$stateVersion = mp_bump_state_version($mysqli, (int) $game['game_id']);

mp_json([
  'ok' => true,
  'objection_token_granted' => $grantedToken,
  'state_version' => $stateVersion,
]);

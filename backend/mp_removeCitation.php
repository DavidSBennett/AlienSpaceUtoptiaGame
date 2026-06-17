<?php
/**
 * mp_removeCitation.php
 *
 * POST — remove a citation from one of caller's projects. No-cost
 * (citations don't consume anything; removing one just deletes the row).
 *
 * Request body:
 *   {
 *     player_token: string,
 *     citation_id:  int
 *   }
 *
 * Response:
 *   {
 *     ok: true,
 *     state_version: int
 *   }
 *
 * Errors:
 *   404 — citation not found or not yours
 */

require_once __DIR__ . '/mp_dbConfig.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

$body = mp_read_json_body();
$cid  = isset($body['citation_id']) ? (int) $body['citation_id'] : 0;
if ($cid <= 0) mp_error('citation_id required', 400);

$pid = (int) $player['player_id'];
$gid = (int) $game['game_id'];

$mysqli->begin_transaction();
try {
  $stmt = $mysqli->prepare("
    DELETE FROM mp_citations
    WHERE citation_id = ? AND player_id = ?
  ");
  $stmt->bind_param('ii', $cid, $pid);
  $stmt->execute();
  $affected = $stmt->affected_rows;
  $stmt->close();
  if ($affected === 0) {
    throw new Exception('Citation not found or not yours');
  }
  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 404);
}

mp_log_event($mysqli, $gid, $pid, 'citation_removed', [
  'citation_id' => $cid,
]);

$stateVersion = mp_bump_state_version($mysqli, $gid);

mp_json([
  'ok' => true,
  'state_version' => $stateVersion,
]);

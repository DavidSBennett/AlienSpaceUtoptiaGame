<?php
/**
 * mp_conferenceTake.php
 *
 * POST — during the conference phase, the attendee whose turn it is drafts the
 * chosen pool cards (up to as many as they contributed), then their turn ends.
 * When every attendee has drafted (or dropped out), the conference resolves:
 * citation tokens are granted, leftovers are disposed of, and the round
 * finishes (outcomes resolve + the year advances).
 *
 * Request body:  { player_token, pool_ids: int[] }
 * Response:      { ok: true, state_version }
 *
 * Errors:
 *   409 — not in the conference phase / not your turn / too many cards
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
if (($game['phase'] ?? 'action') !== 'conference') {
  mp_error('Not in the conference phase', 409);
}

$body = mp_read_json_body();
$poolIds = (isset($body['pool_ids']) && is_array($body['pool_ids'])) ? $body['pool_ids'] : [];

// Draft, in a transaction holding the game-row lock.
$mysqli->begin_transaction();
try {
  $stmt = $mysqli->prepare("SELECT phase FROM mp_games WHERE game_id = ? FOR UPDATE");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $g = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  if (!$g || $g['phase'] !== 'conference') {
    throw new Exception('Conference is no longer in progress');
  }
  mp_conference_take($mysqli, $gameId, $pid, $poolIds);
  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 409);
}

// End the conference if everyone has now drafted.
mp_maybe_finish_conference($mysqli, $gameId);

// Make sure a state bump propagates the new turn/phase to other clients.
$stateVersion = mp_bump_state_version($mysqli, $gameId);

mp_json(['ok' => true, 'state_version' => $stateVersion]);

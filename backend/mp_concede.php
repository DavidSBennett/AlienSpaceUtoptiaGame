<?php
/**
 * mp_concede.php
 *
 * POST — player voluntarily exits the game. Marks them game-over with
 * reason 'conceded', clears any pending action so they don't block
 * resolution, and lets the game continue for remaining live players.
 *
 * If conceding leaves zero live players, mp_maybe_resolve_year (which
 * is called by every subsequent state poll) will detect that and end
 * the game cleanly.
 *
 * Request body:
 *   { player_token: string }
 *
 * Response:
 *   { ok: true, state_version: int }
 */

require_once __DIR__ . '/mp_dbConfig.php';
require_once __DIR__ . '/mp_resolveYear.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

$pid = (int) $player['player_id'];
$gid = (int) $game['game_id'];

// Already game-over? No-op.
if ($player['game_over_reason']) {
  mp_json(['ok' => true, 'state_version' => (int) $game['state_version']]);
}

$mysqli->begin_transaction();
try {
  $stmt = $mysqli->prepare("
    UPDATE mp_game_players
    SET game_over_reason = 'conceded',
        pending_action = NULL,
        pending_action_data = NULL,
        pending_action_committed = 0
    WHERE player_id = ?
  ");
  $stmt->bind_param('i', $pid);
  $stmt->execute();
  $stmt->close();
  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error('Concede failed: ' . $e->getMessage(), 500);
}

mp_log_event($mysqli, $gid, $pid, 'player_conceded', null);

// Trigger an immediate resolve check — with this player out of the
// running, the remaining live players might already all be committed,
// in which case the year should advance now. (And if there are no
// remaining live players, the resolve will end the game.)
mp_maybe_resolve_year($mysqli, $gid);

$stateVersion = mp_bump_state_version($mysqli, $gid);

mp_json(['ok' => true, 'state_version' => $stateVersion]);

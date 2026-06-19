<?php
/**
 * mp_aftermathReady.php
 *
 * POST — during the final-year 'aftermath' phase, the WRITER signs off: "I'm
 * done responding to my manuscripts; end the game." Sets their aftermath_ready
 * flag, then attempts to finalize the game (which only happens once no live
 * writer is still blocking).
 *
 * A writer reaches this state by either resolving every outstanding manuscript
 * (Revise & Resubmit decision / objection) or by choosing to let the current
 * outcomes stand. Either way, this is how the final window is closed.
 *
 * Request body: { player_token }
 * Response:     { ok: true, finalized: bool, state_version: int }
 */

require_once __DIR__ . '/mp_dbConfig.php';
require_once __DIR__ . '/mp_resolveYear.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

$pid = (int) $player['player_id'];
$gid = (int) $game['game_id'];

// Mark this player ready. Harmless outside the aftermath phase (the flag is
// reset on entry and ignored elsewhere).
$stmt = $mysqli->prepare("UPDATE mp_game_players SET aftermath_ready = 1 WHERE player_id = ?");
$stmt->bind_param('i', $pid);
$stmt->execute();
$stmt->close();

mp_log_event($mysqli, $gid, $pid, 'aftermath_ready', []);

// Try to finalize now (opens its own lock/transaction). Returns true if the
// game ended on this call.
$finalized = mp_maybe_finish_aftermath($mysqli, $gid);

$stateVersion = mp_bump_state_version($mysqli, $gid);

mp_json([
  'ok'            => true,
  'finalized'     => $finalized,
  'state_version' => $stateVersion,
]);

<?php
/**
 * mp_setGameToggle.php
 *
 * POST — host-only. Sets a table-wide display toggle that affects every
 * player in the game (force tags / significance visible).
 *
 * Request body:
 *   {
 *     player_token: string,   (must be the host's)
 *     toggle: 'tags' | 'significance',
 *     value:  boolean
 *   }
 *
 * Response 200: { ok: true, toggle, value, state_version }
 * Errors: 401 bad token · 403 not host · 422 unknown toggle
 */

require_once __DIR__ . '/mp_dbConfig.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

if ((int) $game['host_player_id'] !== (int) $player['player_id']) {
  mp_error('Only the host can change table settings', 403);
}

$body   = mp_read_json_body();
$toggle = isset($body['toggle']) ? (string) $body['toggle'] : '';
$value  = !empty($body['value']) ? 1 : 0;

// Whitelist the toggle → column mapping (never interpolate user input).
$column = $toggle === 'tags'         ? 'force_show_tags'
        : ($toggle === 'significance' ? 'force_show_significance'
        : null);
if ($column === null) {
  mp_error('Unknown toggle', 422);
}

$gameId = (int) $game['game_id'];

$stmt = $mysqli->prepare("UPDATE mp_games SET $column = ? WHERE game_id = ?");
$stmt->bind_param('ii', $value, $gameId);
$stmt->execute();
$stmt->close();

$stateVersion = mp_bump_state_version($mysqli, $gameId);

mp_log_event($mysqli, $gameId, (int) $player['player_id'], 'table_setting_changed', [
  'toggle' => $toggle,
  'value'  => (bool) $value,
]);

mp_json([
  'ok'            => true,
  'toggle'        => $toggle,
  'value'         => (bool) $value,
  'state_version' => $stateVersion,
]);

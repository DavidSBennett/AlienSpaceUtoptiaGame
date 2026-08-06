<?php
/**
 * sp_getGameState.php — GET ?player_token=… Per-player masked state.
 * Full state every poll (the mp_ lesson: no since_version short-circuit).
 */
require_once __DIR__ . '/sp_engine.php';

mp_require_method('GET');
$me = sp_authenticate($mysqli);
$gameId = (int)$me['game_id'];

$game = sp_load_game($mysqli, $gameId, false);
if (!$game) mp_error('Game not found', 404);
$players = sp_load_players($mysqli, $gameId);
$seat = (int)$me['seat'];

if ($game['status'] === 'lobby') {
  // Minimal lobby view.
  $pub = [];
  foreach ($players as $s => $p) {
    $pub[] = ['seat' => $s, 'name' => $p['player_name'], 'is_you' => $s === $seat];
  }
  mp_json([
    'game' => [
      'game_id' => $gameId, 'status' => 'lobby',
      'max_players' => (int)$game['max_players'],
      'host_player_id' => $game['host_player_id'] !== null ? (int)$game['host_player_id'] : null,
      'state_version' => (int)$game['state_version'],
    ],
    'you' => ['seat' => $seat, 'player_id' => (int)$me['player_id']],
    'players' => $pub,
  ]);
}

mp_json(sp_public_state($mysqli, $game, $players, $seat));

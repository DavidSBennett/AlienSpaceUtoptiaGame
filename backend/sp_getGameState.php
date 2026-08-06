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

// Poll-path maintenance:
//  1. Pre-v3 games (drone/control boards) can't run under the ship ruleset —
//     sunset them gracefully so the client shows a clean ending.
//  2. One-time v1 heal for reset cards stranded in discards.
if ($game['status'] === 'active'
    && (!empty($game['legacy_ruleset']) || empty($game['board_state']['meta']['reset_healed']))) {
  $mysqli->begin_transaction();
  try {
    $game = sp_load_game($mysqli, $gameId, true);
    $players = sp_load_players($mysqli, $gameId);
    if (!empty($game['legacy_ruleset'])) {
      $game['status'] = 'ended';
      sp_save_game($mysqli, $game);
      sp_log($mysqli, $gameId, null, 'game_ended',
        'Ruleset updated (ships & occupations) — this old game was closed. Launch a new one!');
    } elseif (sp_heal_stranded_resets($game, $players)) {
      sp_save_game($mysqli, $game);
      foreach ($players as $p) sp_save_player($mysqli, $p);
    }
    $mysqli->commit();
    sp_bump($mysqli, $gameId);
  } catch (Exception $e) {
    $mysqli->rollback();
    // Non-fatal: serve state as loaded.
  }
}

// A sunset legacy game has no v3 board — return a minimal ended shell the
// client can render without the map machinery.
if (!empty($game['legacy_ruleset'])) {
  mp_json([
    'game' => [
      'game_id' => $gameId, 'status' => 'ended', 'legacy' => true,
      'state_version' => (int)$game['state_version'],
    ],
    'message' => 'This game predates the ships-and-occupations ruleset and has been closed. Start a new game from the lobby.',
  ]);
}

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

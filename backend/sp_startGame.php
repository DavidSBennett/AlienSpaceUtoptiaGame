<?php
/**
 * sp_startGame.php — POST { player_token }. Host starts a lobby with ≥2 players.
 */
require_once __DIR__ . '/sp_engine.php';

mp_require_method('POST');
$me = sp_authenticate($mysqli);
$gameId = (int)$me['game_id'];

$mysqli->begin_transaction();
try {
  $game = sp_load_game($mysqli, $gameId, true);
  if (!$game) throw new Exception('Game not found');
  if ($game['status'] !== 'lobby') throw new Exception('Game already started');
  if ((int)$game['host_player_id'] !== (int)$me['player_id']) {
    throw new Exception('Only the host can start the game');
  }
  $players = sp_load_players($mysqli, $gameId);
  if (count($players) < 2) throw new Exception('Need at least 2 players');

  sp_setup_game($game, $players);
  sp_save_game($mysqli, $game);
  foreach ($players as $p) sp_save_player($mysqli, $p);
  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 400);
}

sp_log($mysqli, $gameId, (int)$me['seat'], 'game_started', 'The expedition is underway');
sp_bump($mysqli, $gameId);
mp_json(['ok' => true]);

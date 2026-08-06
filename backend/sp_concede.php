<?php
/**
 * sp_concede.php — POST { player_token }. Leave the game. If it was your
 * turn, the turn advances; the last player standing ends the game.
 */
require_once __DIR__ . '/sp_engine.php';

mp_require_method('POST');
$me = sp_authenticate($mysqli);
$gameId = (int)$me['game_id'];

$mysqli->begin_transaction();
try {
  $game = sp_load_game($mysqli, $gameId, true);
  if (!$game) throw new Exception('Game not found');
  if ($game['status'] === 'ended') throw new Exception('Game already ended');
  $players = sp_load_players($mysqli, $gameId);
  $seat = (int)$me['seat'];
  if ((int)$players[$seat]['conceded']) throw new Exception('Already conceded');

  $players[$seat]['conceded'] = 1;
  sp_log($mysqli, $gameId, $seat, 'conceded', $players[$seat]['player_name'] . ' withdrew from the sector');

  $active = sp_active_seats($players);
  if ($game['status'] === 'active') {
    if (count($active) <= 1) {
      sp_end_game($game, $players, $mysqli);
    } elseif ((int)$game['current_seat'] === $seat) {
      sp_advance_turn($game, $players, $mysqli);
    }
  }

  sp_save_game($mysqli, $game);
  foreach ($players as $p) sp_save_player($mysqli, $p);
  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 400);
}

sp_bump($mysqli, $gameId);
mp_json(['ok' => true]);

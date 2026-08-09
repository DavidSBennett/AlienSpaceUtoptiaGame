<?php
/**
 * sp_harvest.php — POST. The Exobiology HARVEST: a free-standing turn
 * action that plays NO card. Any number of planted field cards resolve
 * distinct docket missions at their grown strength.
 *
 * Body: { player_token, assignments: [ { field: <index>, mission: '<key>' } ] }
 * Everything runs inside a FOR UPDATE lock on the game row.
 */
require_once __DIR__ . '/sp_engine.php';

mp_require_method('POST');
$me = sp_authenticate($mysqli);
$gameId = (int)$me['game_id'];
$body = mp_read_json_body();

$params = ['assignments' => is_array($body['assignments'] ?? null) ? $body['assignments'] : []];

$mysqli->begin_transaction();
try {
  $game = sp_load_game($mysqli, $gameId, true);
  if (!$game) throw new Exception('Game not found');
  $players = sp_load_players($mysqli, $gameId);
  $seat = (int)$me['seat'];

  $msg = sp_do_harvest($game, $players, $seat, $params, $mysqli);

  sp_save_game($mysqli, $game);
  foreach ($players as $p) sp_save_player($mysqli, $p);
  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 400);
}

sp_bump($mysqli, $gameId);
mp_json(['ok' => true, 'message' => $msg]);

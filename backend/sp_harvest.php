<?php
/**
 * sp_harvest.php — POST. The Exobiology HARVEST: an interactive turn
 * action that plays NO card.
 *
 * Body: { player_token, op: 'solve', field: <index>, mission: '<key>' }
 *   — resolve ONE grown card against one docket mission; the docket
 *     refills immediately and the turn HOLDS for the next pick.
 * Body: { player_token, op: 'finish' }
 *   — close the harvest and advance the turn.
 * Everything runs inside a FOR UPDATE lock on the game row.
 */
require_once __DIR__ . '/sp_engine.php';

mp_require_method('POST');
$me = sp_authenticate($mysqli);
$gameId = (int)$me['game_id'];
$body = mp_read_json_body();

$params = [
  'op' => isset($body['op']) && is_string($body['op']) ? $body['op'] : 'solve',
  'field' => $body['field'] ?? -1,
  'mission' => $body['mission'] ?? '',
];

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

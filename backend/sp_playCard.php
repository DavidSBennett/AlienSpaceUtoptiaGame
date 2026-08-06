<?php
/**
 * sp_playCard.php — POST. THE action endpoint: play one card from hand.
 *
 * Body: { player_token, card: '<key>', params: {…per action type…} }
 * The engine validates turn ownership and dispatches on the card's action.
 * Everything runs inside a FOR UPDATE lock on the game row.
 */
require_once __DIR__ . '/sp_engine.php';

mp_require_method('POST');
$me = sp_authenticate($mysqli);
$gameId = (int)$me['game_id'];
$body = mp_read_json_body();

$cardKey = isset($body['card']) ? (string)$body['card'] : '';
$params = is_array($body['params'] ?? null) ? $body['params'] : [];
if ($cardKey === '' || !isset(sp_cards()[$cardKey])) mp_error('Unknown card', 400);

$mysqli->begin_transaction();
try {
  $game = sp_load_game($mysqli, $gameId, true);
  if (!$game) throw new Exception('Game not found');
  $players = sp_load_players($mysqli, $gameId);
  $seat = (int)$me['seat'];

  $msg = sp_play_card($game, $players, $seat, $cardKey, $params, $mysqli);

  sp_save_game($mysqli, $game);
  foreach ($players as $p) sp_save_player($mysqli, $p);
  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 400);
}

sp_bump($mysqli, $gameId);
mp_json(['ok' => true, 'message' => $msg]);

<?php
/**
 * sp_joinGame.php — POST { game_id }. Join a lobby; seat assigned in order.
 * Response: { game_id, player_id, player_token, seat }
 */
require_once __DIR__ . '/sp_engine.php';
require_once __DIR__ . '/users_helpers.php';

mp_require_method('POST');
$auth = users_require_session($mysqli);
$userId = (int)$auth['user']['user_id'];
$playerName = $auth['user']['username'];

$body = mp_read_json_body();
$gameId = isset($body['game_id']) ? (int)$body['game_id'] : 0;
if ($gameId <= 0) mp_error('game_id required', 400);

$mysqli->begin_transaction();
try {
  $game = sp_load_game($mysqli, $gameId, true);
  if (!$game) throw new Exception('Game not found');
  if ($game['status'] !== 'lobby') throw new Exception('Game already started');

  $players = sp_load_players($mysqli, $gameId);
  foreach ($players as $p) {
    if ((int)$p['user_id'] === $userId) throw new Exception('You are already in this game');
  }
  if (count($players) >= (int)$game['max_players']) throw new Exception('Game is full');

  $seat = count($players);
  $token = mp_generate_token(32);
  $stmt = $mysqli->prepare("
    INSERT INTO sp_game_players (game_id, user_id, seat, player_name, player_token)
    VALUES (?, ?, ?, ?, ?)");
  $stmt->bind_param('iiiss', $gameId, $userId, $seat, $playerName, $token);
  if (!$stmt->execute()) throw new Exception('Failed to join: ' . $stmt->error);
  $playerId = $mysqli->insert_id;
  $stmt->close();

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 400);
}

sp_log($mysqli, $gameId, $seat, 'player_joined', $playerName . ' joined the expedition');
sp_bump($mysqli, $gameId);

mp_json([
  'game_id' => $gameId,
  'player_id' => (int)$playerId,
  'player_token' => $token,
  'seat' => $seat,
]);

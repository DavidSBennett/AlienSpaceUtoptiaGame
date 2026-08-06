<?php
/**
 * sp_createGame.php — POST. Create a space game with the caller as host.
 *
 * Body: { max_players?: 1..5 }   max_players 1 = SOLO: starts immediately.
 * Response: { game_id, player_id, player_token, seat: 0, status }
 */
require_once __DIR__ . '/sp_engine.php';
require_once __DIR__ . '/users_helpers.php';

mp_require_method('POST');
$auth = users_require_session($mysqli);
$userId = (int)$auth['user']['user_id'];
$playerName = $auth['user']['username'];

$body = mp_read_json_body();
$maxPlayers = isset($body['max_players']) ? (int)$body['max_players'] : 2;
if ($maxPlayers < 1 || $maxPlayers > 5) mp_error('max_players must be 1–5', 400);

$mysqli->begin_transaction();
try {
  $stmt = $mysqli->prepare("INSERT INTO sp_games (max_players, status) VALUES (?, 'lobby')");
  $stmt->bind_param('i', $maxPlayers);
  if (!$stmt->execute()) throw new Exception('Failed to create game: ' . $stmt->error);
  $gameId = $mysqli->insert_id;
  $stmt->close();

  $token = mp_generate_token(32);
  $stmt = $mysqli->prepare("
    INSERT INTO sp_game_players (game_id, user_id, seat, player_name, player_token)
    VALUES (?, ?, 0, ?, ?)");
  $stmt->bind_param('iiss', $gameId, $userId, $playerName, $token);
  if (!$stmt->execute()) throw new Exception('Failed to insert host: ' . $stmt->error);
  $playerId = $mysqli->insert_id;
  $stmt->close();

  $stmt = $mysqli->prepare("UPDATE sp_games SET host_player_id = ? WHERE game_id = ?");
  $stmt->bind_param('ii', $playerId, $gameId);
  $stmt->execute();
  $stmt->close();

  $status = 'lobby';
  if ($maxPlayers === 1) {
    // Solo: set up and start immediately through the same engine path.
    $game = sp_load_game($mysqli, $gameId, true);
    $players = sp_load_players($mysqli, $gameId);
    sp_setup_game($game, $players);
    sp_save_game($mysqli, $game);
    foreach ($players as $p) sp_save_player($mysqli, $p);
    $status = 'active';
  }

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 500);
}

sp_log($mysqli, $gameId, 0, 'game_created',
  $playerName . ' founded the expedition' . ($maxPlayers === 1 ? ' (solo)' : ''));
sp_bump($mysqli, $gameId);

mp_json([
  'game_id' => (int)$gameId,
  'player_id' => (int)$playerId,
  'player_token' => $token,
  'seat' => 0,
  'status' => $status,
]);

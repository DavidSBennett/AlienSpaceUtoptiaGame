<?php
/**
 * mp_joinGame.php
 *
 * POST — join an existing game in 'lobby' status. Assigns the next
 * available seat_index and returns a player_token for future authentication.
 *
 * Locked-version behavior: REQUIRES a Bearer session. The joining
 * player's name is the signed-in user's username. Also enforces
 * one-user-per-game: if the caller already has a row in this game,
 * the existing player_token is returned instead of a new seat (so
 * accidentally clicking "join" twice doesn't create a ghost seat).
 *
 * Request body:
 *   { game_id: int }   (required)
 *
 * Response:
 *   {
 *     game_id:      int,
 *     player_id:    int,
 *     player_token: string,
 *     seat_index:   int,
 *     resumed:      bool   (true when the user was already in this game)
 *   }
 */

require_once __DIR__ . '/users_helpers.php';

mp_require_method('POST');

$auth = users_require_session($mysqli);
$userId = (int) $auth['user']['user_id'];
$playerName = $auth['user']['username'];

$body = mp_read_json_body();

$gameId = isset($body['game_id']) ? (int) $body['game_id'] : 0;
if ($gameId <= 0) mp_error('game_id required', 400);

$mysqli->begin_transaction();

try {
  // 0. Already in this game? Return existing creds rather than adding
  //    a second row. This makes the "join" button idempotent.
  $stmt = $mysqli->prepare("
    SELECT player_id, player_token, seat_index
    FROM mp_game_players
    WHERE game_id = ? AND user_id = ?
    LIMIT 1
  ");
  $stmt->bind_param('ii', $gameId, $userId);
  $stmt->execute();
  $existing = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  if ($existing) {
    $mysqli->commit();
    mp_json([
      'game_id'      => $gameId,
      'player_id'    => (int) $existing['player_id'],
      'player_token' => $existing['player_token'],
      'seat_index'   => (int) $existing['seat_index'],
      'resumed'      => true,
    ]);
  }
  // Lock the game row so a concurrent join can't grab the same seat.
  $stmt = $mysqli->prepare("
    SELECT game_id, status, max_players
    FROM mp_games
    WHERE game_id = ?
    FOR UPDATE
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $game = $res->fetch_assoc();
  $stmt->close();

  if (!$game) {
    $mysqli->rollback();
    mp_error('Game not found', 404);
  }
  if ($game['status'] !== 'lobby') {
    $mysqli->rollback();
    mp_error('Game is not accepting new players', 409);
  }

  // Find the lowest available seat_index. Simple: count current players.
  // Since seats are assigned 0..N-1 and never re-used (no rejoin in Phase A),
  // count = next seat.
  $stmt = $mysqli->prepare("
    SELECT COUNT(*) AS n FROM mp_game_players WHERE game_id = ?
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();
  $currentCount = (int) $row['n'];

  if ($currentCount >= (int) $game['max_players']) {
    $mysqli->rollback();
    mp_error('Game is full', 409);
  }

  // Mint a token and insert.
  $token = mp_generate_token(32);
  $stmt = $mysqli->prepare("
    INSERT INTO mp_game_players (game_id, user_id, player_name, seat_index, player_token)
    VALUES (?, ?, ?, ?, ?)
  ");
  $stmt->bind_param('iisis', $gameId, $userId, $playerName, $currentCount, $token);
  if (!$stmt->execute()) {
    throw new Exception('Failed to insert player: ' . $stmt->error);
  }
  $playerId = $mysqli->insert_id;
  $stmt->close();

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 500);
}

// Bump state version so the lobby's waiting room polling shows the new player.
mp_bump_state_version($mysqli, $gameId);

mp_log_event($mysqli, $gameId, $playerId, 'player_joined', [
  'name'       => $playerName,
  'seat_index' => $currentCount,
]);

mp_json([
  'game_id'      => $gameId,
  'player_id'    => (int) $playerId,
  'player_token' => $token,
  'seat_index'   => $currentCount,
]);

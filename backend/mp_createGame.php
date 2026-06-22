<?php
/**
 * mp_createGame.php
 *
 * POST — create a new game in 'lobby' status with the caller as host.
 *
 * Locked-version behavior: REQUIRES a Bearer session. The hosting
 * player's name is the signed-in user's username; the request body
 * no longer accepts player_name. The mp_game_players row stores
 * both player_id (per-game identity, still used by all mp_* calls
 * via player_token) AND user_id (account-level identity, used by
 * lobby "your active games" and end-of-game stat aggregation).
 *
 * Request body:
 *   {
 *     idDeck:      int,       (required)
 *     max_players: int,       (optional, default 5, must be 2..5)
 *     mode:        string     (optional: 'short'|'medium'|'long', default 'long')
 *   }
 *
 * The mode sets the game length: short = 10 rounds, medium = 18, long = 25.
 * Career gate rounds (comps at 5, tenure at 12) stay fixed regardless.
 *
 * Response:
 *   {
 *     game_id:      int,
 *     player_id:    int,
 *     player_token: string,
 *     seat_index:   0
 *   }
 */

require_once __DIR__ . '/users_helpers.php';

mp_require_method('POST');

// Locked: caller must be signed in. Their session's user becomes the
// host. No player_name needed in the body.
$auth = users_require_session($mysqli);
$userId = (int) $auth['user']['user_id'];
$playerName = $auth['user']['username'];

$body = mp_read_json_body();

// ----- Validate inputs -----

$idDeck = isset($body['idDeck']) ? (int) $body['idDeck'] : 0;
if ($idDeck <= 0) mp_error('idDeck required', 400);

$maxPlayers = isset($body['max_players']) ? (int) $body['max_players'] : 5;
if ($maxPlayers < 2 || $maxPlayers > 5) {
  mp_error('max_players must be between 2 and 5', 400);
}

// Game-length mode → total rounds. Keep this map in sync with the frontend
// (src/lib/gameModes.js).
$modeYears = ['short' => 8, 'medium' => 12, 'long' => 15];
$mode = isset($body['mode']) ? strtolower(trim((string) $body['mode'])) : 'long';
if (!isset($modeYears[$mode])) {
  mp_error('mode must be short, medium, or long', 400);
}
$totalYears = $modeYears[$mode];

// ----- Verify deck exists -----

$stmt = $mysqli->prepare("SELECT idDeck FROM Decks WHERE idDeck = ? LIMIT 1");
$stmt->bind_param('i', $idDeck);
$stmt->execute();
$stmt->bind_result($foundDeck);
$found = $stmt->fetch();
$stmt->close();
if (!$found) mp_error('Deck not found', 404);

// ----- Insert the game row -----
//
// We do this transactionally — game + host player are created together;
// if anything fails we roll back so we don't leave orphaned half-created
// games.

$mysqli->begin_transaction();

try {
  // 1. Create the game (status='lobby', no host yet — we'll fill in host
  //    immediately after we know the player_id).
  $stmt = $mysqli->prepare("
    INSERT INTO mp_games (idDeck, max_players, total_years, status)
    VALUES (?, ?, ?, 'lobby')
  ");
  $stmt->bind_param('iii', $idDeck, $maxPlayers, $totalYears);
  if (!$stmt->execute()) {
    throw new Exception('Failed to create game: ' . $stmt->error);
  }
  $gameId = $mysqli->insert_id;
  $stmt->close();

  // 2. Mint a player token and insert the host as player (seat 0).
  //    user_id ties the per-game player row to the signed-in account.
  $token = mp_generate_token(32);
  $stmt = $mysqli->prepare("
    INSERT INTO mp_game_players (game_id, user_id, player_name, seat_index, player_token)
    VALUES (?, ?, ?, 0, ?)
  ");
  $stmt->bind_param('iiss', $gameId, $userId, $playerName, $token);
  if (!$stmt->execute()) {
    throw new Exception('Failed to insert host player: ' . $stmt->error);
  }
  $playerId = $mysqli->insert_id;
  $stmt->close();

  // 3. Set host_player_id on the game row now that we know the player_id.
  $stmt = $mysqli->prepare("UPDATE mp_games SET host_player_id = ? WHERE game_id = ?");
  $stmt->bind_param('ii', $playerId, $gameId);
  if (!$stmt->execute()) {
    throw new Exception('Failed to set host: ' . $stmt->error);
  }
  $stmt->close();

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 500);
}

mp_log_event($mysqli, $gameId, $playerId, 'game_created', [
  'deck' => $idDeck,
  'max_players' => $maxPlayers,
  'mode' => $mode,
  'total_years' => $totalYears,
]);

mp_json([
  'game_id'      => (int) $gameId,
  'player_id'    => (int) $playerId,
  'player_token' => $token,
  'seat_index'   => 0,
  'total_years'  => $totalYears,
]);

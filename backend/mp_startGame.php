<?php
/**
 * mp_startGame.php
 *
 * POST — host-only. Transitions a game from 'lobby' to 'active' state.
 *
 * Side effects when starting:
 *   1. Fetch all archive cards for the game's deck
 *   2. Shuffle them server-side and write to mp_game_archive with positions
 *   3. Initialize each player's 3 project slots (mp_projects)
 *   4. Set the year_started_at timestamp (the timer's anchor for year 1)
 *   5. Flip status to 'active' and bump state_version
 *
 * Request body:
 *   {
 *     player_token: string  (must be the host's)
 *   }
 *
 * Response:
 *   {
 *     ok: true,
 *     game_id: int,
 *     started_at: string (datetime),
 *     archive_size: int
 *   }
 *
 * Errors:
 *   401 — bad token
 *   403 — caller isn't the host
 *   409 — game is not in 'lobby' state
 *   422 — fewer than 2 players (need at least 2)
 *   500 — deck has no archive cards
 */

require_once __DIR__ . '/mp_dbConfig.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

if ($game['status'] !== 'lobby') {
  mp_error('Game is not in lobby state', 409);
}
if ((int) $game['host_player_id'] !== (int) $player['player_id']) {
  mp_error('Only the host can start the game', 403);
}

$gameId = (int) $game['game_id'];
$idDeck = (int) $game['idDeck'];

// ----- Roster check -----
$stmt = $mysqli->prepare("SELECT COUNT(*) AS n FROM mp_game_players WHERE game_id = ?");
$stmt->bind_param('i', $gameId);
$stmt->execute();
$res = $stmt->get_result();
$row = $res->fetch_assoc();
$stmt->close();
$playerCount = (int) $row['n'];
if ($playerCount < 2) {
  mp_error('Need at least 2 players to start', 422);
}

// ----- Pull archive cards for the deck -----
//
// Mirror the single-player split: archive cards have type='archive',
// conclusion cards have type='conclusion'. We only shuffle archive cards;
// conclusions are always available (handled client-side via the conclusion
// shelf, same as single-player — the data is fetched fresh by the React
// app via the existing listCards.php).

$stmt = $mysqli->prepare("
  SELECT idCard FROM Cards
  WHERE idDeck = ? AND type = 'archive'
");
$stmt->bind_param('i', $idDeck);
$stmt->execute();
$res = $stmt->get_result();
$archiveCardIds = [];
while ($row = $res->fetch_assoc()) {
  $archiveCardIds[] = (int) $row['idCard'];
}
$stmt->close();

if (count($archiveCardIds) === 0) {
  mp_error('Deck has no archive cards', 500);
}

// ----- Shuffle (Fisher-Yates in PHP) -----
//
// Use a cryptographically-random shuffle so we can't be accused of bias.
// Tag a seed value in the game row for diagnostic purposes.
$seed = bin2hex(random_bytes(8));
$n = count($archiveCardIds);
for ($i = $n - 1; $i > 0; $i--) {
  $j = random_int(0, $i);
  $tmp = $archiveCardIds[$i];
  $archiveCardIds[$i] = $archiveCardIds[$j];
  $archiveCardIds[$j] = $tmp;
}

// ----- Insert shuffled archive in a transaction -----
//
// Plus: create 3 project slots per player, flip the game status, anchor
// the timer. All atomic.

$mysqli->begin_transaction();

try {
  // 1. Bulk-insert the archive. We do this in chunks of 100 for shared-hosting
  //    safety (avoiding overly long single queries).
  $insertedArchive = 0;
  $chunkSize = 100;
  for ($i = 0; $i < $n; $i += $chunkSize) {
    $chunk = array_slice($archiveCardIds, $i, $chunkSize);
    $placeholders = [];
    $values = [];
    $types = '';
    foreach ($chunk as $offset => $cardId) {
      $position = $i + $offset;
      $placeholders[] = '(?,?,?)';
      $values[] = $gameId;
      $values[] = $cardId;
      $values[] = $position;
      $types .= 'iii';
    }
    $sql = "INSERT INTO mp_game_archive (game_id, idCard, archive_position) VALUES "
         . implode(',', $placeholders);
    $stmt = $mysqli->prepare($sql);
    if (!$stmt) throw new Exception('Archive insert prepare failed: ' . $mysqli->error);
    $stmt->bind_param($types, ...$values);
    if (!$stmt->execute()) {
      throw new Exception('Archive insert exec failed: ' . $stmt->error);
    }
    $insertedArchive += $stmt->affected_rows;
    $stmt->close();
  }

  // 2. Create 3 project slots for each player. Single bulk insert.
  $stmt = $mysqli->prepare("SELECT player_id FROM mp_game_players WHERE game_id = ?");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $playerIds = [];
  while ($row = $res->fetch_assoc()) $playerIds[] = (int) $row['player_id'];
  $stmt->close();

  $slotPlaceholders = [];
  $slotValues = [];
  $slotTypes = '';
  foreach ($playerIds as $pid) {
    for ($slot = 0; $slot < 3; $slot++) {
      $slotPlaceholders[] = '(?,?)';
      $slotValues[] = $pid;
      $slotValues[] = $slot;
      $slotTypes .= 'ii';
    }
  }
  $sql = "INSERT INTO mp_projects (player_id, slot_index) VALUES "
       . implode(',', $slotPlaceholders);
  $stmt = $mysqli->prepare($sql);
  $stmt->bind_param($slotTypes, ...$slotValues);
  if (!$stmt->execute()) {
    throw new Exception('Project slot init failed: ' . $stmt->error);
  }
  $stmt->close();

  // 3. Flip the game to active and anchor the year timer.
  $stmt = $mysqli->prepare("
    UPDATE mp_games
    SET status = 'active',
        current_year = 1,
        year_started_at = NOW(),
        shuffle_seed = ?
    WHERE game_id = ?
  ");
  $stmt->bind_param('si', $seed, $gameId);
  if (!$stmt->execute()) {
    throw new Exception('Game status update failed: ' . $stmt->error);
  }
  $stmt->close();

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 500);
}

mp_bump_state_version($mysqli, $gameId);

mp_log_event($mysqli, $gameId, (int) $player['player_id'], 'game_started', [
  'player_count' => $playerCount,
  'archive_size' => $insertedArchive,
  'seed'         => $seed,
]);

mp_json([
  'ok'           => true,
  'game_id'      => $gameId,
  'started_at'   => date('c'),
  'archive_size' => $insertedArchive,
]);

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
 *   4. Deal each player a starting hand of 3 cards off the top of the archive
 *   5. Set the year_started_at timestamp (the timer's anchor for year 1)
 *   6. Flip status to 'active' and bump state_version
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
// Mirror the single-player split: archive cards are flagged 'archive',
// conclusion cards 'conclusion'. We only shuffle archive cards; conclusions
// are always available (handled client-side via the conclusion shelf, same as
// single-player — the data is fetched fresh by the React app via listCards.php).
//
// The flag column was renamed `type` → `card_identifier` (migration 26). We
// SELECT * and filter in PHP so this works whichever name the column has.

$stmt = $mysqli->prepare("
  SELECT * FROM Cards WHERE idDeck = ?
");
$stmt->bind_param('i', $idDeck);
$stmt->execute();
$res = $stmt->get_result();
$archiveCardIds = [];
while ($row = $res->fetch_assoc()) {
  $ident = $row['card_identifier'] ?? $row['type'] ?? '';
  if ($ident === 'archive') {
    $archiveCardIds[] = (int) $row['idCard'];
  }
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
  //    Ordered by seat so the starting-hand deal below is deterministic.
  $stmt = $mysqli->prepare("SELECT player_id FROM mp_game_players WHERE game_id = ? ORDER BY seat_index ASC");
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

  // 2b. Deal a starting hand. Each player begins grad school with a few
  //     evidence cards already in their Research Notebook to represent the
  //     interests that brought them to the field. Cards come off the top of
  //     the freshly shuffled archive, dealt seat by seat, and are marked as
  //     drawn in year 1 (so they reshuffle normally once the archive cycles).
  //
  //     $archiveCardIds is the shuffled order and its indices line up with
  //     archive_position, so we can deal straight off the front of it.
  $STARTING_HAND_SIZE = 3;
  $dealPos = 0;
  foreach ($playerIds as $pid) {
    for ($k = 0; $k < $STARTING_HAND_SIZE && $dealPos < $n; $k++, $dealPos++) {
      $cid = $archiveCardIds[$dealPos];

      $stmt = $mysqli->prepare("
        UPDATE mp_game_archive
        SET drawn_by_player_id = ?, drawn_year = 1
        WHERE game_id = ? AND idCard = ? AND drawn_by_player_id IS NULL
      ");
      $stmt->bind_param('iii', $pid, $gameId, $cid);
      if (!$stmt->execute()) {
        throw new Exception('Starting-hand archive update failed: ' . $stmt->error);
      }
      $stmt->close();

      $stmt = $mysqli->prepare("
        INSERT IGNORE INTO mp_player_hands (player_id, idCard, added_year)
        VALUES (?, ?, 1)
      ");
      $stmt->bind_param('ii', $pid, $cid);
      if (!$stmt->execute()) {
        throw new Exception('Starting-hand deal failed: ' . $stmt->error);
      }
      $stmt->close();
    }
  }

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

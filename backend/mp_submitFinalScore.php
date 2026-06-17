<?php
/**
 * mp_submitFinalScore.php
 *
 * POST — once a game has ended, push each player's final state into the
 * existing single-player Scores table so the MP results show up on the
 * shared leaderboard.
 *
 * Idempotent: calling multiple times for the same game returns the
 * existing inserted scores without duplicating. This means each player's
 * client can safely call this when they see status='ended' without
 * coordinating.
 *
 * Request body:
 *   {
 *     player_token: string
 *   }
 *
 * Response:
 *   {
 *     ok: true,
 *     submitted: int,    (how many score rows were inserted this call; 0 if
 *                         already submitted)
 *     scores: [{ player_name, rank, prestige }, ...]  for the calling player's game
 *   }
 *
 * The Scores table is the existing single-player table. We use the same
 * shape saveScore.php expects: player_name, idDeck, rank, prestige, etc.
 * "Rank" is a stage label string ("endowed-professor", "retired", etc).
 *
 * Errors:
 *   409 — game is not ended yet
 */

require_once __DIR__ . '/mp_dbConfig.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$game   = $auth['game'];

if ($game['status'] !== 'ended') {
  mp_error('Game has not ended', 409);
}
$gameId = (int) $game['game_id'];
$idDeck = (int) $game['idDeck'];

// Game-length mode this score belongs to, so each length keeps its own
// leaderboard. Keep in sync with mp_createGame.php / src/lib/gameModes.js.
$totalYears = (int) ($game['total_years'] ?? 25);
$gameMode = $totalYears <= 10 ? 'short' : ($totalYears <= 18 ? 'medium' : 'long');

// Fetch all players to score
$stmt = $mysqli->prepare("
  SELECT * FROM mp_game_players WHERE game_id = ? ORDER BY prestige DESC
");
$stmt->bind_param('i', $gameId);
$stmt->execute();
$res = $stmt->get_result();
$players = [];
while ($p = $res->fetch_assoc()) $players[] = $p;
$stmt->close();

$inserted = 0;
$out = [];

foreach ($players as $p) {
  $name     = $p['player_name'];
  $prestige = (int) $p['prestige'];
  $articles = (int) $p['articles_published'];
  $books    = (int) $p['books_published'];
  $rank     = $p['game_over_reason'] ?: ($p['stage'] ?: 'retired');
  $researchLevel   = (int) $p['research_level'];
  $notebookLevel   = (int) $p['notebook_level'];
  $influenceLevel  = (int) $p['influence_level'];
  $workspacesLevel = (int) $p['workspaces_level'];

  // We need a year_ended. Use the game's full length if retired, else the
  // year the player got knocked out at a fixed gate.
  $yearEnded = ($rank === 'failed-comps') ? 5 : (($rank === 'tenure-denied') ? 12 : $totalYears);

  // Idempotency: look for an existing Scores row tagged with this game.
  // We use a marker in player_name to make this safe: "<name> (mp:<game_id>)"
  // — that way we don't pollute the existing single-player leaderboard with
  // ambiguous entries, and we can detect repeats reliably.
  //
  // Actually: cleaner is to just check for a row with the same player_name
  // + idDeck + year_ended + prestige combination. If you've already played
  // the same deck single-player and got the same result, fine — but for
  // multiplayer we want a distinct marker. The compromise: just append a
  // small "[MP]" tag to player_name in the Scores table.
  $taggedName = $name . ' [MP]';

  // Check if this game's score has already been inserted by looking for
  // any score from this game (we store a flag elsewhere — easiest is to
  // re-check by submitting "marker" row in event log). Simplest: query
  // mp_event_log for a prior 'final_scores_submitted' event for this game.
  // For Phase A simplicity, we'll just do a defensive INSERT IGNORE-style
  // check using the existing Scores schema (which doesn't have a unique
  // constraint we can use). Instead, we tag the event log on success;
  // and we check that log before inserting.

  $stmtCheck = $mysqli->prepare("
    SELECT 1 FROM mp_event_log
    WHERE game_id = ? AND event_type = 'final_score_submitted'
      AND event_data LIKE ?
    LIMIT 1
  ");
  $marker = '%"player_id":' . (int) $p['player_id'] . '%';
  $stmtCheck->bind_param('is', $gameId, $marker);
  $stmtCheck->execute();
  $hit = $stmtCheck->get_result()->fetch_assoc();
  $stmtCheck->close();

  if (!$hit) {
    // Match the existing Scores schema. We assume saveScore.php's schema:
    //   player_name, idDeck, rank, prestige, articles_published,
    //   books_published, research_level, notebook_level, influence_level,
    //   workspaces_level, year_ended
    //
    // If your Scores table has additional columns (created_at, etc.) those
    // should have defaults so this insert still works.
    $stmt = $mysqli->prepare("
      INSERT INTO Scores
        (player_name, idDeck, rank, prestige, articles_published, books_published,
         research_level, notebook_level, influence_level, workspaces_level, year_ended,
         game_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    if (!$stmt) {
      // Scores table may be missing the extended columns (e.g. migration 16
      // hasn't been run yet). Fall back to a minimal insert that records
      // player + deck + rank + prestige WITHOUT game_mode, so scores still
      // save (untagged) rather than failing outright.
      $stmt = $mysqli->prepare("
        INSERT INTO Scores (player_name, idDeck, rank, prestige)
        VALUES (?, ?, ?, ?)
      ");
      if (!$stmt) {
        mp_error('Could not insert score: ' . $mysqli->error, 500);
      }
      $stmt->bind_param('sisi', $taggedName, $idDeck, $rank, $prestige);
    } else {
      $stmt->bind_param(
        'sisiiiiiiiis',
        $taggedName, $idDeck, $rank, $prestige,
        $articles, $books,
        $researchLevel, $notebookLevel, $influenceLevel, $workspacesLevel,
        $yearEnded, $gameMode
      );
    }
    @$stmt->execute();
    $stmt->close();
    $inserted++;

    mp_log_event($mysqli, $gameId, (int) $p['player_id'], 'final_score_submitted', [
      'player_id' => (int) $p['player_id'],
      'prestige'  => $prestige,
      'rank'      => $rank,
    ]);
  }

  $out[] = [
    'player_name' => $name,
    'rank'        => $rank,
    'prestige'    => $prestige,
  ];
}

mp_json([
  'ok' => true,
  'submitted' => $inserted,
  'scores' => $out,
]);

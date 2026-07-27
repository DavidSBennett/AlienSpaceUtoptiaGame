<?php
/**
 * publicScores.php — PUBLIC GET — top scores for one deck, solo or multiplayer.
 *
 * Unauthenticated, read-only. Returns only the fields already shown on the
 * in-app leaderboard (display name + score), filtered to a single deck and
 * capped. Intended for embedding a live class scoreboard (e.g. an iframe or a
 * fetch from the public landing page). It exposes player display names + scores
 * for the given deck to anyone with the URL — that's the point of a public board.
 *
 *   GET /publicScores.php?deck=<idDeck>&mode=<solo|mp>&limit=<N>
 *
 * mode:
 *   solo (default) — reads user_scores (the signed-in solo leaderboard).
 *   mp             — reads the legacy Scores table (multiplayer game-end board).
 * Both return the same JSON shape, so one embed can toggle between them.
 *
 * Response 200: { ok:true, deck:int, mode:str, count:int, scores:[ {player_name,
 *   prestige, rank, articles_published, books_published, year_ended} ] }
 */

require_once __DIR__ . '/users_helpers.php';   // $mysqli + mp_json/mp_error/mp_require_method

mp_require_method('GET');

header('Access-Control-Allow-Origin: *');

$idDeck = isset($_GET['deck'])  ? (int) $_GET['deck']  : 0;
$limit  = isset($_GET['limit']) ? max(1, min(100, (int) $_GET['limit'])) : 20;
$mode   = (isset($_GET['mode']) && strtolower($_GET['mode']) === 'mp') ? 'mp' : 'solo';
if ($idDeck <= 0) mp_error('deck (idDeck) is required', 400);

if ($mode === 'mp') {
  // Multiplayer: the Scores table already stores player_name directly (written
  // at game-end by mp_submitFinalScore.php) — no users join needed.
  $sql = "
    SELECT player_name, prestige, `rank`,
           articles_published, books_published, year_ended
    FROM Scores
    WHERE idDeck = ?
    ORDER BY prestige DESC, created_at ASC
    LIMIT ?
  ";
} else {
  // Solo: the admin per-score name override (migration 27) may not exist yet —
  // detect it so the board works both before and after that migration.
  $hasDisplayName = false;
  if ($c = $mysqli->query("SHOW COLUMNS FROM user_scores LIKE 'display_name'")) {
    $hasDisplayName = $c->num_rows > 0;
    $c->close();
  }
  $nameExpr = $hasDisplayName ? 'COALESCE(s.display_name, u.username)' : 'u.username';
  $sql = "
    SELECT {$nameExpr} AS player_name, s.prestige, s.rank,
           s.articles_published, s.books_published, s.year_ended
    FROM user_scores s
    JOIN users u ON u.user_id = s.user_id
    WHERE s.idDeck = ?
    ORDER BY s.prestige DESC, s.submitted_at ASC
    LIMIT ?
  ";
}

$stmt = $mysqli->prepare($sql);
if (!$stmt) mp_error('Could not read scores: ' . $mysqli->error, 500);
$stmt->bind_param('ii', $idDeck, $limit);
$stmt->execute();
$res = $stmt->get_result();

$scores = [];
while ($r = $res->fetch_assoc()) {
  $scores[] = [
    'player_name'        => $r['player_name'],
    'prestige'           => (int) $r['prestige'],
    'rank'               => $r['rank'],
    'articles_published' => (int) $r['articles_published'],
    'books_published'    => (int) $r['books_published'],
    'year_ended'         => $r['year_ended'] !== null ? (int) $r['year_ended'] : null,
  ];
}
$stmt->close();

mp_json(['ok' => true, 'deck' => $idDeck, 'mode' => $mode, 'count' => count($scores), 'scores' => $scores]);

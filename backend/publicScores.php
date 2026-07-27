<?php
/**
 * publicScores.php — PUBLIC GET — top scores, solo / multiplayer / merged.
 *
 * Unauthenticated, read-only. Returns only the fields already shown on the
 * in-app leaderboard (display name + score), optionally filtered to a single
 * deck and capped. Intended for embedding a live class scoreboard (e.g. a
 * fetch from the public landing page). It exposes player display names + scores
 * to anyone with the URL — that's the point of a public board.
 *
 *   GET /publicScores.php?deck=<idDeck>&mode=<all|solo|mp>&length=<all|short|medium|long>&limit=<N>
 *
 * deck: a positive idDeck filters to that deck; 0 / absent = every deck.
 * mode:
 *   all (default) — merges the solo (user_scores) and multiplayer (Scores)
 *                   boards into one prestige-ranked list.
 *   solo          — reads user_scores only.
 *   mp            — reads the legacy Scores table only.
 * length: all (default) / short / medium / long — filters by game length.
 *   MP uses Scores.game_mode; solo buckets by year_ended (<=8 / 9-12 / >=13).
 * All combinations return the same JSON shape, so one embed can toggle freely.
 *
 * Response 200: { ok:true, deck:int, mode:str, count:int, scores:[ {player_name,
 *   prestige, rank, articles_published, books_published, year_ended} ] }
 */

require_once __DIR__ . '/users_helpers.php';   // $mysqli + mp_json/mp_error/mp_require_method

mp_require_method('GET');

header('Access-Control-Allow-Origin: *');

$idDeck   = isset($_GET['deck'])  ? (int) $_GET['deck']  : 0;    // 0 = all decks
$limit    = isset($_GET['limit']) ? max(1, min(100, (int) $_GET['limit'])) : 20;
$modeRaw  = strtolower($_GET['mode'] ?? 'all');
$mode     = in_array($modeRaw, ['all', 'solo', 'mp'], true) ? $modeRaw : 'all';
$lenRaw   = strtolower($_GET['length'] ?? 'all');
$length   = in_array($lenRaw, ['all', 'short', 'medium', 'long'], true) ? $lenRaw : 'all';
$deckCond = $idDeck > 0;
$lenCond  = $length !== 'all';

// Game-length buckets. Multiplayer stores the chosen length directly in
// Scores.game_mode. Solo has no length column, but its careers are exactly
// Short 8 / Medium 12 / Long 15 years and year_ended caps at the game length,
// so the same thresholds bucket it (exact for a completed game; an early
// retiree lands in a shorter bucket — a fair reading of career length played).
// $length is whitelisted above, so these literal conditions are injection-safe.
$soloLenSql = '';
$mpLenSql   = '';
if ($lenCond) {
  $soloLenSql = $length === 'short'  ? 's.year_ended <= 8'
              : ($length === 'medium' ? 's.year_ended BETWEEN 9 AND 12'
              : 's.year_ended >= 13');
  $mpLenSql   = "game_mode = '{$length}'";
}

$parts  = [];
$types  = '';
$params = [];

// Solo half — user_scores joined to users for the display name. The admin
// per-score name override (migration 27) may not exist yet; detect it so the
// board works both before and after that migration.
if ($mode === 'solo' || $mode === 'all') {
  $hasDisplayName = false;
  if ($c = $mysqli->query("SHOW COLUMNS FROM user_scores LIKE 'display_name'")) {
    $hasDisplayName = $c->num_rows > 0;
    $c->close();
  }
  $nameExpr = $hasDisplayName ? 'COALESCE(s.display_name, u.username)' : 'u.username';
  $conds = [];
  if ($deckCond) $conds[] = 's.idDeck = ?';
  if ($lenCond)  $conds[] = $soloLenSql;
  $where = $conds ? 'WHERE ' . implode(' AND ', $conds) : '';
  $parts[] = "
    SELECT {$nameExpr} AS player_name, s.prestige AS prestige,
           s.rank AS rank_title,
           s.articles_published AS articles_published,
           s.books_published AS books_published,
           s.year_ended AS year_ended,
           s.idDeck AS idDeck, 'solo' AS row_mode,
           CASE WHEN s.year_ended <= 8 THEN 'short'
                WHEN s.year_ended <= 12 THEN 'medium'
                ELSE 'long' END AS length_bucket,
           s.submitted_at AS sort_time
    FROM user_scores s JOIN users u ON u.user_id = s.user_id
    $where";
  if ($deckCond) { $types .= 'i'; $params[] = $idDeck; }
}

// Multiplayer half — the Scores table stores player_name directly. `rank` is a
// reserved word, so it's backticked; aliased to rank_title to keep the outer
// query and the UNION column names clear of reserved words.
if ($mode === 'mp' || $mode === 'all') {
  $conds = [];
  if ($deckCond) $conds[] = 'idDeck = ?';
  if ($lenCond)  $conds[] = $mpLenSql;
  $where = $conds ? 'WHERE ' . implode(' AND ', $conds) : '';
  $parts[] = "
    SELECT player_name AS player_name, prestige AS prestige,
           `rank` AS rank_title,
           articles_published AS articles_published,
           books_published AS books_published,
           year_ended AS year_ended,
           idDeck AS idDeck, 'mp' AS row_mode,
           game_mode AS length_bucket,
           created_at AS sort_time
    FROM Scores
    $where";
  if ($deckCond) { $types .= 'i'; $params[] = $idDeck; }
}

$union = implode("\n    UNION ALL\n", $parts);
$sql = "
  SELECT player_name, prestige, rank_title, articles_published, books_published,
         year_ended, idDeck, row_mode, length_bucket
  FROM (
    $union
  ) t
  ORDER BY prestige DESC, sort_time ASC
  LIMIT ?
";
$types .= 'i';
$params[] = $limit;

$stmt = $mysqli->prepare($sql);
if (!$stmt) mp_error('Could not read scores: ' . $mysqli->error, 500);
$stmt->bind_param($types, ...$params);
$stmt->execute();
$res = $stmt->get_result();

$scores = [];
while ($r = $res->fetch_assoc()) {
  $scores[] = [
    'player_name'        => $r['player_name'],
    'prestige'           => (int) $r['prestige'],
    'rank'               => $r['rank_title'],
    'articles_published' => (int) $r['articles_published'],
    'books_published'    => (int) $r['books_published'],
    'year_ended'         => $r['year_ended'] !== null ? (int) $r['year_ended'] : null,
    'idDeck'             => (int) $r['idDeck'],
    'mode'               => $r['row_mode'],
    'length'             => $r['length_bucket'],
  ];
}
$stmt->close();

mp_json(['ok' => true, 'deck' => $idDeck, 'mode' => $mode, 'length' => $length, 'count' => count($scores), 'scores' => $scores]);

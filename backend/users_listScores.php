<?php
/**
 * users_listScores.php
 *
 * GET — list scores from user_scores (the locked-version solo
 * leaderboard). Joins users for the username display.
 *
 * Query params:
 *   ?idDeck=N           (optional) — filter to one deck. Without it,
 *                       returns scores across all decks.
 *   ?user_id=N          (optional) — filter to one user (e.g. their
 *                       personal career history). Without it, shows
 *                       all users.
 *   ?limit=N            (optional) — cap results (default 100, max 500).
 *   ?sort=prestige|year (optional) — sort key (default prestige).
 *
 * Requires session — the leaderboard is part of the locked surface.
 *
 * Response 200:
 *   { ok: true, scores: [ { ...row, username }, ... ] }
 */

require_once __DIR__ . '/users_helpers.php';

mp_require_method('GET');

users_require_session($mysqli);

$idDeck = isset($_GET['idDeck']) ? (int) $_GET['idDeck'] : 0;
$forUser = isset($_GET['user_id']) ? (int) $_GET['user_id'] : 0;
$limit = isset($_GET['limit']) ? max(1, min(500, (int) $_GET['limit'])) : 100;
$sortKey = ($_GET['sort'] ?? 'prestige') === 'year' ? 'submitted_at' : 'prestige';

// Build WHERE
$conds = [];
$types = '';
$params = [];
if ($idDeck > 0)  { $conds[] = 's.idDeck = ?';  $types .= 'i'; $params[] = $idDeck; }
if ($forUser > 0) { $conds[] = 's.user_id = ?'; $types .= 'i'; $params[] = $forUser; }
$whereSql = count($conds) > 0 ? 'WHERE ' . implode(' AND ', $conds) : '';

$sql = "
  SELECT s.score_id, s.user_id, s.idDeck, s.rank, s.prestige,
         s.articles_published, s.books_published,
         s.research_level, s.notebook_level, s.influence_level, s.workspaces_level,
         s.year_ended, s.submitted_at,
         u.username, u.username AS player_name
  FROM user_scores s
  JOIN users u ON u.user_id = s.user_id
  $whereSql
  ORDER BY s.$sortKey DESC, s.submitted_at DESC
  LIMIT ?
";

if (count($params) > 0) {
  $types .= 'i';
  $params[] = $limit;
  $stmt = $mysqli->prepare($sql);
  $stmt->bind_param($types, ...$params);
} else {
  $stmt = $mysqli->prepare($sql);
  $stmt->bind_param('i', $limit);
}
$stmt->execute();
$res = $stmt->get_result();

$scores = [];
while ($r = $res->fetch_assoc()) {
  $scores[] = [
    'score_id'           => (int) $r['score_id'],
    'user_id'            => (int) $r['user_id'],
    'username'           => $r['username'],
    'player_name'        => $r['player_name'],
    'idDeck'             => (int) $r['idDeck'],
    'rank'               => $r['rank'],
    'prestige'           => (int) $r['prestige'],
    'articles_published' => (int) $r['articles_published'],
    'books_published'    => (int) $r['books_published'],
    'research_level'     => (int) $r['research_level'],
    'notebook_level'     => (int) $r['notebook_level'],
    'influence_level'    => (int) $r['influence_level'],
    'workspaces_level'   => (int) $r['workspaces_level'],
    'year_ended'         => (int) $r['year_ended'],
    'submitted_at'       => $r['submitted_at'],
  ];
}
$stmt->close();

mp_json([
  'ok' => true,
  'scores' => $scores,
]);

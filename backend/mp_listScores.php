<?php
/**
 * mp_listScores.php
 *
 * GET — list multiplayer final scores from the legacy `Scores` table
 * (written by mp_submitFinalScore.php at game-end). Shaped to match the
 * solo endpoint (users_listScores.php) so the same <Leaderboard> table
 * renders both: player_name, idDeck, rank, prestige, etc.
 *
 * Query params (all optional):
 *   ?idDeck=N    — filter to one deck (omit / all=1 for every deck)
 *   ?player=str  — case-insensitive name search
 *   ?limit=N     — cap results (default 100, max 500)
 *   ?sort=prestige|year — sort key (default prestige)
 *
 * Requires session — the leaderboard is part of the locked surface.
 *
 * Response 200: { ok: true, scores: [ { score_id, player_name, idDeck,
 *                 rank, prestige, articles_published, books_published,
 *                 research_level, notebook_level, influence_level,
 *                 workspaces_level, year_ended, submitted_at }, ... ] }
 */

require_once __DIR__ . '/users_helpers.php';

mp_require_method('GET');
users_require_session($mysqli);

$idDeck  = isset($_GET['idDeck']) ? (int) $_GET['idDeck'] : 0;
$player  = isset($_GET['player']) ? trim($_GET['player']) : '';
$limit   = isset($_GET['limit'])  ? max(1, min(500, (int) $_GET['limit'])) : 100;
// Whitelist the sort key — never interpolate raw user input into SQL.
$sortKey = ($_GET['sort'] ?? 'prestige') === 'year' ? 'created_at' : 'prestige';

$conds = [];
$types = '';
$params = [];
if ($idDeck > 0) {
  $conds[] = 'idDeck = ?';
  $types  .= 'i';
  $params[] = $idDeck;
}
if ($player !== '') {
  $conds[] = 'LOWER(player_name) LIKE ?';
  $types  .= 's';
  $params[] = '%' . strtolower($player) . '%';
}
$whereSql = count($conds) > 0 ? 'WHERE ' . implode(' AND ', $conds) : '';

$sql = "
  SELECT idScore AS score_id, player_name, idDeck, `rank`, prestige,
         articles_published, books_published,
         research_level, notebook_level, influence_level, workspaces_level,
         year_ended, created_at AS submitted_at
  FROM Scores
  $whereSql
  ORDER BY $sortKey DESC, created_at DESC
  LIMIT ?
";

$types  .= 'i';
$params[] = $limit;

$stmt = $mysqli->prepare($sql);
if (!$stmt) {
  mp_error('Could not read scores: ' . $mysqli->error, 500);
}
$stmt->bind_param($types, ...$params);
$stmt->execute();
$res = $stmt->get_result();

$scores = [];
while ($row = $res->fetch_assoc()) {
  $row['score_id']           = (int) $row['score_id'];
  $row['idDeck']             = (int) $row['idDeck'];
  $row['prestige']           = (int) $row['prestige'];
  $row['articles_published'] = (int) $row['articles_published'];
  $row['books_published']    = (int) $row['books_published'];
  $row['research_level']     = (int) $row['research_level'];
  $row['notebook_level']     = (int) $row['notebook_level'];
  $row['influence_level']    = (int) $row['influence_level'];
  $row['workspaces_level']   = (int) $row['workspaces_level'];
  $row['year_ended']         = $row['year_ended'] !== null ? (int) $row['year_ended'] : null;
  $scores[] = $row;
}
$stmt->close();

mp_json(['ok' => true, 'scores' => $scores]);

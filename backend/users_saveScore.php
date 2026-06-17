<?php
/**
 * users_saveScore.php
 *
 * POST — submit a final solo-game score for the signed-in user. Writes
 * to user_scores (NOT the legacy Scores table — see 06 migration).
 *
 * Request body (player_name NO LONGER accepted — the server uses the
 * session's username):
 *   {
 *     idDeck:             int,
 *     rank:               string,
 *     prestige:           int,
 *     articles_published: int,
 *     books_published:    int,
 *     research_level:     int (1-4),
 *     notebook_level:     int (1-4),
 *     influence_level:    int (1-4),
 *     workspaces_level:   int (1-4),
 *     year_ended:         int (1-25)
 *   }
 *
 * Response 200: { ok: true, score_id: int }
 */

require_once __DIR__ . '/users_helpers.php';

mp_require_method('POST');

$auth = users_require_session($mysqli);
$userId = (int) $auth['user']['user_id'];

$body = mp_read_json_body();

$idDeck = isset($body['idDeck']) ? (int) $body['idDeck'] : 0;
if ($idDeck <= 0) mp_error('idDeck required', 400);

$rank = isset($body['rank']) && is_string($body['rank']) ? trim($body['rank']) : '';
if ($rank === '' || strlen($rank) > 64) mp_error('rank required (max 64 chars)', 400);

$prestige   = max(0, (int) ($body['prestige']           ?? 0));
$articles   = max(0, (int) ($body['articles_published'] ?? 0));
$books      = max(0, (int) ($body['books_published']    ?? 0));
$research   = max(1, min(4, (int) ($body['research_level']   ?? 1)));
$notebook   = max(1, min(4, (int) ($body['notebook_level']   ?? 1)));
$influence  = max(1, min(4, (int) ($body['influence_level']  ?? 1)));
$workspaces = max(1, min(4, (int) ($body['workspaces_level'] ?? 1)));
$yearEnded  = max(1, min(25, (int) ($body['year_ended']      ?? 1)));

$stmt = $mysqli->prepare("
  INSERT INTO user_scores
    (user_id, idDeck, rank, prestige, articles_published, books_published,
     research_level, notebook_level, influence_level, workspaces_level,
     year_ended)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
");
$stmt->bind_param(
  'iisiiiiiiii',
  $userId, $idDeck, $rank, $prestige, $articles, $books,
  $research, $notebook, $influence, $workspaces, $yearEnded
);
$stmt->execute();
$scoreId = $mysqli->insert_id;
$stmt->close();

mp_json([
  'ok' => true,
  'score_id' => $scoreId,
]);

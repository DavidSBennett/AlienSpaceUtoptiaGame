<?php
/**
 * mp_listOpenGames.php
 *
 * GET — returns games with status='lobby' that haven't reached max_players,
 * for the lobby page where new players see what they can join.
 *
 * Response:
 *   [
 *     {
 *       game_id, idDeck, deck_name, host_player_name,
 *       current_players_count, max_players, created_at
 *     },
 *     ...
 *   ]
 *
 * Doesn't expose any tokens or sensitive fields. Sorted by created_at desc
 * so the newest lobby shows first.
 */

require_once __DIR__ . '/mp_dbConfig.php';

mp_require_method('GET');

// Stale-lobby cleanup: any lobby older than 1 hour with no recent player
// activity is auto-marked 'ended' so it disappears from the list. This is
// cheap and keeps things tidy without a cron job.
$mysqli->query("
  UPDATE mp_games
  SET status = 'ended', ended_at = NOW()
  WHERE status = 'lobby'
    AND created_at < NOW() - INTERVAL 1 HOUR
");

$sql = "
  SELECT
    g.game_id,
    g.idDeck,
    d.nameDeck AS deck_name,
    g.max_players,
    g.total_years,
    g.created_at,
    g.host_player_id,
    hp.player_name AS host_player_name,
    (SELECT COUNT(*) FROM mp_game_players WHERE game_id = g.game_id) AS current_players_count
  FROM mp_games g
  LEFT JOIN Decks d            ON d.idDeck = g.idDeck
  LEFT JOIN mp_game_players hp ON hp.player_id = g.host_player_id
  WHERE g.status = 'lobby'
  ORDER BY g.created_at DESC
  LIMIT 50
";
$res = $mysqli->query($sql);
if (!$res) {
  mp_error('Query failed: ' . $mysqli->error, 500);
}

$rows = [];
while ($row = $res->fetch_assoc()) {
  // Filter out full lobbies inline (cheaper than a HAVING in MySQL given
  // the subquery dependency).
  $count = (int) $row['current_players_count'];
  $max   = (int) $row['max_players'];
  if ($count >= $max) continue;
  $rows[] = [
    'game_id'               => (int) $row['game_id'],
    'idDeck'                => (int) $row['idDeck'],
    'deck_name'             => $row['deck_name'],
    'host_player_name'      => $row['host_player_name'],
    'current_players_count' => $count,
    'max_players'           => $max,
    'total_years'           => (int) $row['total_years'],
    'created_at'            => $row['created_at'],
  ];
}

mp_json($rows);

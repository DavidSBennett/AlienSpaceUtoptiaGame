<?php
/**
 * sp_listOpenGames.php — GET. Lobby games with open seats (signed-in users).
 */
require_once __DIR__ . '/sp_engine.php';
require_once __DIR__ . '/users_helpers.php';

mp_require_method('GET');
users_require_session($mysqli);

$res = $mysqli->query("
  SELECT g.game_id, g.max_players, g.created_at,
         COUNT(p.player_id) AS player_count,
         (SELECT player_name FROM sp_game_players
           WHERE player_id = g.host_player_id) AS host_name
  FROM sp_games g
  LEFT JOIN sp_game_players p ON p.game_id = g.game_id
  WHERE g.status = 'lobby' AND g.max_players > 1
  GROUP BY g.game_id
  HAVING player_count < g.max_players
  ORDER BY g.game_id DESC
  LIMIT 30");

$games = [];
while ($row = $res->fetch_assoc()) {
  $games[] = [
    'game_id' => (int)$row['game_id'],
    'max_players' => (int)$row['max_players'],
    'player_count' => (int)$row['player_count'],
    'host_name' => $row['host_name'],
    'created_at' => $row['created_at'],
  ];
}
mp_json(['games' => $games]);

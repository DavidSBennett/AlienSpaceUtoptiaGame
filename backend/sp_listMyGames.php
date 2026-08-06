<?php
/**
 * sp_listMyGames.php — GET. All space games tied to the signed-in account,
 * with per-game player_token so any device can resume (mp pattern).
 */
require_once __DIR__ . '/sp_engine.php';
require_once __DIR__ . '/users_helpers.php';

mp_require_method('GET');
$auth = users_require_session($mysqli);
$userId = (int)$auth['user']['user_id'];

$stmt = $mysqli->prepare("
  SELECT g.game_id, g.status, g.max_players, g.current_seat, g.turn_number,
         g.winner_seat, g.created_at, g.updated_at,
         p.seat, p.player_token, p.conceded, p.final_score,
         (SELECT COUNT(*) FROM sp_game_players q WHERE q.game_id = g.game_id) AS player_count
  FROM sp_game_players p
  JOIN sp_games g ON g.game_id = p.game_id
  WHERE p.user_id = ?
  ORDER BY g.updated_at DESC
  LIMIT 30");
$stmt->bind_param('i', $userId);
$stmt->execute();
$res = $stmt->get_result();

$games = [];
while ($row = $res->fetch_assoc()) {
  $games[] = [
    'game_id' => (int)$row['game_id'],
    'status' => $row['status'],
    'max_players' => (int)$row['max_players'],
    'player_count' => (int)$row['player_count'],
    'is_solo' => (int)$row['max_players'] === 1,
    'seat' => (int)$row['seat'],
    'player_token' => $row['player_token'],
    'your_turn' => $row['status'] === 'active' && (int)$row['current_seat'] === (int)$row['seat'],
    'turn_number' => (int)$row['turn_number'],
    'winner_seat' => $row['winner_seat'] !== null ? (int)$row['winner_seat'] : null,
    'conceded' => (int)$row['conceded'],
    'final_score' => $row['final_score'] !== null ? (int)$row['final_score'] : null,
    'updated_at' => $row['updated_at'],
  ];
}
$stmt->close();
mp_json(['games' => $games]);

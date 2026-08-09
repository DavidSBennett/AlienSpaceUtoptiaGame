<?php
/**
 * sp_highScores.php — GET. The high-score track for the lobby: top final
 * scores across all ended games, best first. Signed-in users only (same
 * gate as the other lobby lists).
 */
require_once __DIR__ . '/sp_engine.php';
require_once __DIR__ . '/users_helpers.php';

mp_require_method('GET');
users_require_session($mysqli);

$stmt = $mysqli->prepare("
  SELECT p.player_name, p.final_score, p.seat,
         g.game_id, g.deck_key, g.max_players, g.winner_seat, g.endgame_trigger,
         g.turn_number, g.updated_at
  FROM sp_game_players p
  JOIN sp_games g ON g.game_id = p.game_id
  WHERE g.status = 'ended' AND p.final_score IS NOT NULL AND p.conceded = 0
  ORDER BY p.final_score DESC, g.updated_at ASC
  LIMIT 10");
$stmt->execute();
$res = $stmt->get_result();

$scores = [];
while ($row = $res->fetch_assoc()) {
  $scores[] = [
    'name' => $row['player_name'],
    'score' => (int)$row['final_score'],
    'game_id' => (int)$row['game_id'],
    'variant' => (($row['deck_key'] ?? '') === 'story') ? 'story' : 'plain',
    'solo' => (int)$row['max_players'] === 1,
    'won' => $row['winner_seat'] !== null && (int)$row['winner_seat'] === (int)$row['seat'],
    'ending' => $row['endgame_trigger'],
    'turns' => (int)$row['turn_number'],
    'when' => $row['updated_at'],
  ];
}
$stmt->close();
mp_json(['scores' => $scores]);

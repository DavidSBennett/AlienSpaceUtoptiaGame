<?php
/**
 * sp_exportGame.php — GET. Export the entire playthrough as JSON: game
 * summary, every player's final position, the written story, and the
 * complete action-by-action event log (not just the last 40).
 *
 * ?player_token=… — any seated player may export, at any point; the
 * results screen offers it as "Save playthrough" once the game ends.
 */
require_once __DIR__ . '/sp_engine.php';

$me = sp_authenticate($mysqli);
$gameId = (int)$me['game_id'];

$game = sp_load_game($mysqli, $gameId);
if (!$game) mp_error('Game not found', 404);
$players = sp_load_players($mysqli, $gameId);
$board = $game['board_state'];

$pubPlayers = [];
foreach ($players as $seat => $p) {
  $pubPlayers[] = [
    'seat' => $seat,
    'name' => $p['player_name'],
    'credits' => (int)$p['credits'],
    'tracks' => [
      'geology' => (int)$p['tracks']['military']['step'],
      'anthropology' => (int)$p['tracks']['diplomacy']['step'],
      'biology' => (int)$p['tracks']['trade']['step'],
    ],
    'hand' => $p['hand'],
    'discard' => $p['discard'],
    'field' => sp_player_field($p),
    'boons' => sp_player_boons($p),
    'pending_boons' => sp_player_pending($p),
    'trophy' => (int)$p['trophy'],
    'conceded' => (int)$p['conceded'],
    'final_score' => $p['final_score'] !== null ? (int)$p['final_score'] : null,
    'score_breakdown' => is_string($p['score_breakdown'])
      ? sp_j($p['score_breakdown'], null) : $p['score_breakdown'],
  ];
}

$events = [];
$stmt = $mysqli->prepare("
  SELECT event_id, seat, event_type, message, event_data, created_at
  FROM sp_event_log WHERE game_id = ? ORDER BY event_id ASC");
$stmt->bind_param('i', $gameId);
$stmt->execute();
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) {
  $events[] = [
    'n' => (int)$row['event_id'],
    'seat' => $row['seat'] !== null ? (int)$row['seat'] : null,
    'type' => $row['event_type'],
    'message' => $row['message'],
    'data' => $row['event_data'] !== null ? json_decode($row['event_data'], true) : null,
    'at' => $row['created_at'],
  ];
}
$stmt->close();

mp_json([
  'ok' => true,
  'export' => [
    'format' => 'utopian-space-game-playthrough/1',
    'exported_at' => gmdate('c'),
    'game' => [
      'game_id' => $gameId,
      'variant' => sp_variant(),
      'status' => $game['status'],
      'turn_number' => (int)$game['turn_number'],
      'endgame_trigger' => $game['endgame_trigger'],
      'winner_seat' => $game['winner_seat'] !== null ? (int)$game['winner_seat'] : null,
      'chaos' => (int)$board['chaos'],
      'max_players' => (int)$game['max_players'],
      'missions_remaining' => count($board['mission_stack']) + count($board['docket']),
    ],
    'players' => $pubPlayers,
    'story' => $board['solved'],
    'events' => $events,
  ],
]);

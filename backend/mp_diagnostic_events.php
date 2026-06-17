<?php
/**
 * mp_diagnostic_events.php
 *
 * Returns the last N events from mp_event_log for a given game, in
 * reverse chronological order. Useful for diagnosing "actions had no
 * effect" bugs — you can see exactly what happened year-by-year.
 *
 * GET params:
 *   player_token  (required)  authenticates and identifies the game
 *   limit         (optional)  default 50, max 500
 *
 * Returns:
 *   { events: [{event_id, event_type, player_id, player_name, event_data,
 *               occurred_at}, ...] }
 *
 * No mutations.
 */

require_once __DIR__ . '/mp_dbConfig.php';

mp_require_method('GET');

$auth = mp_authenticate($mysqli);
$game = $auth['game'];
$gameId = (int) $game['game_id'];

$limit = isset($_GET['limit']) ? (int) $_GET['limit'] : 50;
if ($limit < 1) $limit = 50;
if ($limit > 500) $limit = 500;

$stmt = $mysqli->prepare("
  SELECT e.event_id, e.event_type, e.player_id, e.event_data, e.occurred_at,
         p.player_name
  FROM mp_event_log e
  LEFT JOIN mp_game_players p ON p.player_id = e.player_id
  WHERE e.game_id = ?
  ORDER BY e.event_id DESC
  LIMIT ?
");
$stmt->bind_param('ii', $gameId, $limit);
$stmt->execute();
$res = $stmt->get_result();
$events = [];
while ($r = $res->fetch_assoc()) {
  $events[] = [
    'event_id'    => (int) $r['event_id'],
    'event_type'  => $r['event_type'],
    'player_id'   => $r['player_id'] ? (int) $r['player_id'] : null,
    'player_name' => $r['player_name'],
    'event_data'  => $r['event_data'] ? json_decode($r['event_data'], true) : null,
    'occurred_at' => $r['occurred_at'],
  ];
}
$stmt->close();

mp_json(['events' => $events, 'game_id' => $gameId]);

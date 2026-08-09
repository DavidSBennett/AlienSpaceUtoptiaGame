<?php
/**
 * sp_exportAll.php — GET. The ENTIRE playthrough database as one JSON
 * document: every game (any status, any player) with its full verbatim
 * event log, plus every playtest report. Admin only — this crosses game
 * and player boundaries.
 */
require_once __DIR__ . '/sp_engine.php';
require_once __DIR__ . '/users_helpers.php';

mp_require_method('GET');
users_require_admin($mysqli);

$ids = [];
$res = $mysqli->query("SELECT game_id FROM sp_games ORDER BY game_id ASC");
while ($row = $res->fetch_assoc()) $ids[] = (int)$row['game_id'];

$games = [];
foreach ($ids as $id) {
  $game = sp_load_game($mysqli, $id);   // also sets the variant per game
  if (!$game) continue;
  $players = sp_load_players($mysqli, $id);
  $games[] = sp_build_export($mysqli, $game, $players);
}

// Playtest reports ride along (table may not exist on older installs).
$reports = [];
$rres = @$mysqli->query("
  SELECT report_id, game_id, seat, player_name, variant, rating, notes,
         snapshot, created_at
  FROM sp_playtest_reports ORDER BY report_id ASC");
if ($rres) {
  while ($row = $rres->fetch_assoc()) {
    $reports[] = [
      'report_id' => (int)$row['report_id'],
      'game_id' => (int)$row['game_id'],
      'seat' => $row['seat'] !== null ? (int)$row['seat'] : null,
      'player_name' => $row['player_name'],
      'variant' => $row['variant'],
      'rating' => $row['rating'] !== null ? (int)$row['rating'] : null,
      'notes' => $row['notes'],
      'snapshot' => $row['snapshot'] !== null ? json_decode($row['snapshot'], true) : null,
      'at' => $row['created_at'],
    ];
  }
}

mp_json([
  'ok' => true,
  'export' => [
    'format' => 'utopian-space-game-playthrough-collection/1',
    'exported_at' => gmdate('c'),
    'game_count' => count($games),
    'games' => $games,
    'reports' => $reports,
  ],
]);

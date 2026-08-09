<?php
/**
 * sp_submitReport.php — POST. File a playtest report: free-form notes
 * plus an optional 1–5 rating, stored with a compact snapshot of the
 * game at filing time. Allowed mid-game or after the end.
 *
 * Body: { player_token, notes, rating? }
 */
require_once __DIR__ . '/sp_engine.php';

mp_require_method('POST');
$me = sp_authenticate($mysqli);
$gameId = (int)$me['game_id'];
$body = mp_read_json_body();

$notes = isset($body['notes']) && is_string($body['notes']) ? trim($body['notes']) : '';
if ($notes === '') mp_error('Write a few words first', 400);
if (mb_strlen($notes) > 5000) $notes = mb_substr($notes, 0, 5000);

$rating = null;
if (isset($body['rating']) && is_numeric($body['rating'])) {
  $rating = (int)$body['rating'];
  if ($rating < 1 || $rating > 5) $rating = null;
}

$game = sp_load_game($mysqli, $gameId);
if (!$game) mp_error('Game not found', 404);
$players = sp_load_players($mysqli, $gameId);
$seat = (int)$me['seat'];

$scores = [];
foreach ($players as $s => $p) {
  $scores[] = [
    'seat' => $s, 'name' => $p['player_name'],
    'final_score' => $p['final_score'] !== null ? (int)$p['final_score'] : null,
    'vp_current' => $p['vp_current'] !== null ? (int)$p['vp_current'] : null,
  ];
}
$snapshot = json_encode([
  'status' => $game['status'],
  'turn_number' => (int)$game['turn_number'],
  'chaos' => (int)$game['board_state']['chaos'],
  'endgame_trigger' => $game['endgame_trigger'],
  'missions_solved' => count($game['board_state']['solved']),
  'scores' => $scores,
]);

$variant = sp_variant();
$playerName = $players[$seat]['player_name'] ?? null;

$stmt = $mysqli->prepare("
  INSERT INTO sp_playtest_reports
    (game_id, seat, player_name, variant, rating, notes, snapshot)
  VALUES (?, ?, ?, ?, ?, ?, ?)");
if (!$stmt) {
  mp_error('Report table missing — run database/35_playtest_reports.sql', 500);
}
$stmt->bind_param('iississ', $gameId, $seat, $playerName, $variant, $rating, $notes, $snapshot);
if (!$stmt->execute()) {
  $stmt->close();
  mp_error('Could not save the report', 500);
}
$stmt->close();

sp_log($mysqli, $gameId, $seat, 'report',
  ($playerName ?? 'Someone') . ' filed a playtest report'
  . ($rating !== null ? " ({$rating}/5)" : ''));

mp_json(['ok' => true, 'message' => 'Report saved — thank you!']);

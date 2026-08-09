<?php
/**
 * sp_deleteGame.php — POST. Clear a finished playthrough: deletes the
 * game, its players, and its event log. Only ENDED games can be cleared,
 * by any player who sat in them. Playtest reports are kept (they carry
 * their own snapshot and belong to the designers, not the game).
 *
 * Body: { player_token }
 */
require_once __DIR__ . '/sp_engine.php';

mp_require_method('POST');
$me = sp_authenticate($mysqli);
$gameId = (int)$me['game_id'];

$game = sp_load_game($mysqli, $gameId);
if (!$game) mp_error('Game not found', 404);
if ($game['status'] !== 'ended') {
  mp_error('Only finished games can be cleared', 400);
}

$mysqli->begin_transaction();
try {
  foreach (['sp_event_log', 'sp_game_players', 'sp_games'] as $table) {
    $stmt = $mysqli->prepare("DELETE FROM {$table} WHERE game_id = ?");
    $stmt->bind_param('i', $gameId);
    $stmt->execute();
    $stmt->close();
  }
  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error('Could not clear the playthrough', 500);
}

mp_json(['ok' => true, 'message' => "Playthrough #$gameId cleared"]);

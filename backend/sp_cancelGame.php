<?php
/**
 * sp_cancelGame.php — POST { player_token }. Host cancels a LOBBY game.
 */
require_once __DIR__ . '/sp_engine.php';

mp_require_method('POST');
$me = sp_authenticate($mysqli);
$gameId = (int)$me['game_id'];

$mysqli->begin_transaction();
try {
  $game = sp_load_game($mysqli, $gameId, true);
  if (!$game) throw new Exception('Game not found');
  if ($game['status'] !== 'lobby') throw new Exception('Only lobby games can be cancelled');
  if ((int)$game['host_player_id'] !== (int)$me['player_id']) {
    throw new Exception('Only the host can cancel');
  }
  $stmt = $mysqli->prepare("DELETE FROM sp_game_players WHERE game_id = ?");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $stmt->close();
  $stmt = $mysqli->prepare("DELETE FROM sp_event_log WHERE game_id = ?");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $stmt->close();
  $stmt = $mysqli->prepare("DELETE FROM sp_games WHERE game_id = ?");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $stmt->close();
  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 400);
}

mp_json(['ok' => true]);

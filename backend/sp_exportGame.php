<?php
/**
 * sp_exportGame.php — GET. Export one playthrough as JSON: game summary,
 * every player's final position, the written story, and the complete
 * action-by-action event log (not just the last 40).
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

mp_json(['ok' => true, 'export' => sp_build_export($mysqli, $game, $players)]);

<?php
/**
 * mp_revealSignificance.php
 *
 * POST — record that a player has engaged the historical-significance reveal
 * toggle, so the other players in the game get a notification (a toast,
 * surfaced from the event log by the client's poll). Display-only: it changes
 * no game state.
 *
 * Request body:  { player_token: string }
 * Response 200:  { ok: true }
 */

require_once __DIR__ . '/mp_dbConfig.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

mp_log_event($mysqli, (int) $game['game_id'], (int) $player['player_id'], 'significance_revealed', []);

mp_json(['ok' => true]);

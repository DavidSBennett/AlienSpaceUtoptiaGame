<?php
/**
 * mp_sendChatMessage.php
 *
 * POST — send a chat message to the game. Auth via player_token.
 * The sender's player_name is snapshotted onto the message row at
 * send time (denormalized for fast reads).
 *
 * Works in both lobby and active games — there's no status check
 * because chatting in a finished/ended game (e.g., for postgame
 * discussion) is still valuable.
 *
 * Request body:
 *   { player_token: string, content: string }
 *
 * Response 200:
 *   { ok: true, message_id: int }
 *
 * Errors:
 *   400 — empty/too-long content
 *   401 — bad player_token
 */

require_once __DIR__ . '/mp_dbConfig.php';

mp_require_method('POST');

$auth = mp_authenticate($mysqli);
$player = $auth['player'];
$game = $auth['game'];

$body = mp_read_json_body();
$content = isset($body['content']) ? trim((string) $body['content']) : '';
if ($content === '') {
  mp_error('content required', 400);
}
if (mb_strlen($content) > 500) {
  mp_error('content too long (max 500 characters)', 400);
}

$gid = (int) $game['game_id'];
$pid = (int) $player['player_id'];
$pname = (string) $player['player_name'];

$stmt = $mysqli->prepare("
  INSERT INTO mp_chat_messages (game_id, player_id, player_name, content)
  VALUES (?, ?, ?, ?)
");
$stmt->bind_param('iiss', $gid, $pid, $pname, $content);
$stmt->execute();
$msgId = $mysqli->insert_id;
$stmt->close();

// We don't bump state_version here — chat is "soft" data that doesn't
// invalidate the game-state cache. Polling will pick up the new
// message on the next mp_getGameState call. This keeps the realtime
// version-bump dance focused on actual gameplay state changes.

mp_json([
  'ok' => true,
  'message_id' => $msgId,
]);

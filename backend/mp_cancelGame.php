<?php
/**
 * mp_cancelGame.php
 *
 * POST — the HOST permanently deletes their game (lobby or in-progress).
 * Removes the game and every row tied to it across all mp_* tables, so
 * it disappears from the open-games queue and from every player's
 * "your games" list.
 *
 * Auth: player_token (same as the other mp_* endpoints). Only the player
 * who is the game's host may delete it; anyone else gets 403.
 *
 * Request body:
 *   { player_token: string }
 *
 * Response:
 *   { ok: true, game_id: int, deleted: true }
 */

require_once __DIR__ . '/mp_dbConfig.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

$pid = (int) $player['player_id'];
$gid = (int) $game['game_id'];

// ── Host check ──────────────────────────────────────────────────────────
// Read host_player_id straight from the table rather than trusting the
// shape of the auth payload, then require the caller to BE that host.
$stmt = $mysqli->prepare("SELECT host_player_id FROM mp_games WHERE game_id = ?");
$stmt->bind_param('i', $gid);
$stmt->execute();
$stmt->bind_result($hostPlayerId);
$stmt->fetch();
$stmt->close();

if ((int) $hostPlayerId !== $pid) {
  mp_error('Only the host can delete this game', 403);
}

// ── Delete the game and all its children ────────────────────────────────
// Children are removed before parents so the subqueries that resolve
// player_ids / submission_ids still see their rows. All scoped to this
// one game_id.
$mysqli->begin_transaction();
try {
  $run = function ($sql) use ($mysqli, $gid) {
    $stmt = $mysqli->prepare($sql);
    if (!$stmt) {
      throw new Exception('prepare failed: ' . $mysqli->error);
    }
    $stmt->bind_param('i', $gid);
    $stmt->execute();
    $stmt->close();
  };

  // submission-keyed
  $run("DELETE FROM mp_reviews WHERE submission_id IN
          (SELECT submission_id FROM mp_submissions WHERE game_id = ?)");

  // player-keyed (resolve via mp_game_players, which we delete LAST)
  $run("DELETE FROM mp_citations WHERE player_id IN
          (SELECT player_id FROM mp_game_players WHERE game_id = ?)");
  $run("DELETE FROM mp_projects WHERE player_id IN
          (SELECT player_id FROM mp_game_players WHERE game_id = ?)");
  $run("DELETE FROM mp_player_discards WHERE player_id IN
          (SELECT player_id FROM mp_game_players WHERE game_id = ?)");
  $run("DELETE FROM mp_player_hands WHERE player_id IN
          (SELECT player_id FROM mp_game_players WHERE game_id = ?)");

  // game-keyed
  $run("DELETE FROM mp_citation_tokens WHERE game_id = ?");
  $run("DELETE FROM mp_published_works WHERE game_id = ?");
  $run("DELETE FROM mp_submissions    WHERE game_id = ?");
  $run("DELETE FROM mp_event_log      WHERE game_id = ?");
  $run("DELETE FROM mp_game_archive   WHERE game_id = ?");
  $run("DELETE FROM mp_chat_messages  WHERE game_id = ?");
  $run("DELETE FROM mp_game_players   WHERE game_id = ?");
  $run("DELETE FROM mp_games          WHERE game_id = ?");

  $mysqli->commit();
} catch (Throwable $e) {
  $mysqli->rollback();
  mp_error('Delete failed: ' . $e->getMessage(), 500);
}

mp_json(['ok' => true, 'game_id' => $gid, 'deleted' => true]);

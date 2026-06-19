<?php
/**
 * admin_purgeGames.php
 *
 * POST — ADMIN ONLY. Permanently delete every multiplayer game (and all of
 * its child rows across the mp_* tables) older than a given age, regardless of
 * status (stale lobbies, abandoned active games, and finished games alike).
 *
 * "Age" is measured from a game's most recent activity:
 *   COALESCE(ended_at, year_started_at, created_at)
 * so a finished game ages from when it ended, an in-progress game from its last
 * year advance, and a never-started lobby from when it was created.
 *
 * Auth: Authorization: Bearer <session token>; the user must have is_admin = 1
 * (enforced by users_require_admin).
 *
 * Request body:
 *   {
 *     older_than_days: int,   // >= 1; games older than this are purged
 *     dry_run?: bool          // if true, only COUNT — delete nothing
 *   }
 *
 * Response:
 *   { ok: true, dry_run: bool, older_than_days: int, cutoff: string,
 *     matched: int, purged: int }
 */

require_once __DIR__ . '/users_helpers.php';   // loads mp_dbConfig.php → $mysqli + helpers

mp_require_method('POST');
users_require_admin($mysqli);

$body = mp_read_json_body();
$days   = isset($body['older_than_days']) ? (int) $body['older_than_days'] : 0;
$dryRun = !empty($body['dry_run']);

if ($days < 1) {
  mp_error('older_than_days must be a positive integer', 400);
}

// Compute the cutoff timestamp ONCE so every statement uses the same instant
// (avoids NOW() drift across the multi-statement delete).
$stmt = $mysqli->prepare("SELECT (NOW() - INTERVAL ? DAY) AS cutoff");
$stmt->bind_param('i', $days);
$stmt->execute();
$cutoff = $stmt->get_result()->fetch_assoc()['cutoff'];
$stmt->close();

// A game is "old" when its most-recent-activity timestamp is before the cutoff.
$AGE = "COALESCE(ended_at, year_started_at, created_at) < ?";

// How many games match?
$stmt = $mysqli->prepare("SELECT COUNT(*) AS n FROM mp_games WHERE $AGE");
$stmt->bind_param('s', $cutoff);
$stmt->execute();
$matched = (int) $stmt->get_result()->fetch_assoc()['n'];
$stmt->close();

if ($dryRun) {
  mp_json([
    'ok'              => true,
    'dry_run'         => true,
    'older_than_days' => $days,
    'cutoff'          => $cutoff,
    'matched'         => $matched,
    'purged'          => 0,
  ]);
}

if ($matched === 0) {
  mp_json([
    'ok'              => true,
    'dry_run'         => false,
    'older_than_days' => $days,
    'cutoff'          => $cutoff,
    'matched'         => 0,
    'purged'          => 0,
  ]);
}

// ── Delete the matching games and all their children ────────────────────────
// Children are removed before parents so the subqueries that resolve
// player_ids / submission_ids / game_ids still see their rows. Every statement
// is scoped by the same age cutoff on mp_games, which is deleted LAST.
$mysqli->begin_transaction();
try {
  $run = function ($sql) use ($mysqli, $cutoff) {
    $stmt = $mysqli->prepare($sql);
    if (!$stmt) {
      throw new Exception('prepare failed: ' . $mysqli->error);
    }
    $stmt->bind_param('s', $cutoff);
    $stmt->execute();
    $stmt->close();
  };

  $oldGames = "SELECT game_id FROM mp_games WHERE $AGE";
  $oldPlayers = "SELECT player_id FROM mp_game_players WHERE game_id IN ($oldGames)";
  $oldSubs = "SELECT submission_id FROM mp_submissions WHERE game_id IN ($oldGames)";

  // submission-keyed
  $run("DELETE FROM mp_reviews         WHERE submission_id IN ($oldSubs)");
  $run("DELETE FROM mp_review_progress WHERE submission_id IN ($oldSubs)");

  // player-keyed (resolve via mp_game_players, deleted near the end)
  $run("DELETE FROM mp_citations       WHERE player_id IN ($oldPlayers)");
  $run("DELETE FROM mp_projects        WHERE player_id IN ($oldPlayers)");
  $run("DELETE FROM mp_player_discards WHERE player_id IN ($oldPlayers)");
  $run("DELETE FROM mp_player_hands    WHERE player_id IN ($oldPlayers)");

  // game-keyed
  $run("DELETE FROM mp_conference_pool      WHERE game_id IN ($oldGames)");
  $run("DELETE FROM mp_conference_attendees WHERE game_id IN ($oldGames)");
  $run("DELETE FROM mp_citation_tokens      WHERE game_id IN ($oldGames)");
  $run("DELETE FROM mp_published_works      WHERE game_id IN ($oldGames)");
  $run("DELETE FROM mp_submissions          WHERE game_id IN ($oldGames)");
  $run("DELETE FROM mp_event_log            WHERE game_id IN ($oldGames)");
  $run("DELETE FROM mp_game_archive         WHERE game_id IN ($oldGames)");
  $run("DELETE FROM mp_chat_messages        WHERE game_id IN ($oldGames)");
  $run("DELETE FROM mp_game_players         WHERE game_id IN ($oldGames)");

  // Finally the games themselves.
  $run("DELETE FROM mp_games WHERE $AGE");

  $mysqli->commit();
} catch (Throwable $e) {
  $mysqli->rollback();
  mp_error('Purge failed: ' . $e->getMessage(), 500);
}

mp_json([
  'ok'              => true,
  'dry_run'         => false,
  'older_than_days' => $days,
  'cutoff'          => $cutoff,
  'matched'         => $matched,
  'purged'          => $matched,
]);

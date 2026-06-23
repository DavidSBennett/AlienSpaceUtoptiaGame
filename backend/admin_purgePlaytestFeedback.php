<?php
/**
 * admin_purgePlaytestFeedback.php — POST — ADMIN ONLY.
 *
 * Permanently delete ALL anonymous playtest feedback responses.
 *
 * Auth: Authorization: Bearer <session token>; user must have is_admin = 1.
 *
 * Body (JSON):
 *   {
 *     confirm:  'PURGE PLAYTEST',   // required unless dry_run
 *     dry_run?: bool                // if true, only COUNT — delete nothing
 *   }
 *
 * Response: { ok: true, dry_run: bool, matched: int, purged: int }
 */

require_once __DIR__ . '/users_helpers.php';   // $mysqli + helpers

mp_require_method('POST');
users_require_admin($mysqli);

$body    = mp_read_json_body();
$dryRun  = !empty($body['dry_run']);
$confirm = (string) ($body['confirm'] ?? '');

// Count current rows. If the table doesn't exist there is nothing to purge.
$matched = 0;
try {
  if ($r = $mysqli->query("SELECT COUNT(*) AS n FROM playtest_feedback")) {
    $matched = (int) $r->fetch_assoc()['n'];
    $r->close();
  }
} catch (\Throwable $e) {
  mp_json(['ok' => true, 'dry_run' => $dryRun, 'matched' => 0, 'purged' => 0]);
}

if ($dryRun) {
  mp_json(['ok' => true, 'dry_run' => true, 'matched' => $matched, 'purged' => 0]);
}

if ($confirm !== 'PURGE PLAYTEST') {
  mp_error("confirm must equal 'PURGE PLAYTEST'", 400);
}

try {
  $mysqli->query("DELETE FROM playtest_feedback");
  $purged = $mysqli->affected_rows;
} catch (\Throwable $e) {
  mp_error('Purge failed: ' . $e->getMessage(), 500);
}

mp_json(['ok' => true, 'dry_run' => false, 'matched' => $matched, 'purged' => (int) $purged]);

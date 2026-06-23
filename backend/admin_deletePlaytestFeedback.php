<?php
/**
 * admin_deletePlaytestFeedback.php — POST — ADMIN ONLY.
 *
 * Delete specific playtest feedback responses by id (for curating the data —
 * removing test runs, junk, or duplicates while keeping the rest).
 *
 * Auth: Authorization: Bearer <session token>; user must have is_admin = 1.
 *
 * Body (JSON): { ids: [int, ...] }   // 1..1000 row ids
 *
 * Response: { ok: true, deleted: int }
 */

require_once __DIR__ . '/users_helpers.php';   // $mysqli + helpers

mp_require_method('POST');
users_require_admin($mysqli);

$body = mp_read_json_body();
$ids  = $body['ids'] ?? null;
if (!is_array($ids) || count($ids) === 0) {
  mp_error('ids must be a non-empty array', 400);
}

// Sanitize to positive ints, dedupe, cap.
$clean = [];
foreach ($ids as $v) {
  $i = (int) $v;
  if ($i > 0) $clean[$i] = true;
}
$clean = array_keys($clean);
if (count($clean) === 0)    mp_error('No valid ids provided', 400);
if (count($clean) > 1000)   mp_error('Too many ids (max 1000)', 400);

$placeholders = implode(',', array_fill(0, count($clean), '?'));
$types = str_repeat('i', count($clean));

try {
  $stmt = $mysqli->prepare("DELETE FROM playtest_feedback WHERE id IN ($placeholders)");
  if (!$stmt) throw new \Exception($mysqli->error);
  // bind_param needs values by reference — build a references array.
  $bind = [$types];
  foreach ($clean as $k => $v) { $bind[] = &$clean[$k]; }
  call_user_func_array([$stmt, 'bind_param'], $bind);
  $stmt->execute();
  $deleted = $stmt->affected_rows;
  $stmt->close();
} catch (\Throwable $e) {
  mp_error('Delete failed: ' . $e->getMessage(), 500);
}

mp_json(['ok' => true, 'deleted' => (int) $deleted]);

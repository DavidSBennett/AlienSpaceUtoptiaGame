<?php
/**
 * users_changePassword.php
 *
 * POST — change the current user's password. Requires the old
 * password as a security check (so a stolen session token alone can't
 * lock the real owner out by changing their password).
 *
 * On success: all OTHER sessions for this user are revoked (forcing
 * any other device to re-login). The current session stays valid so
 * the user doesn't immediately get bounced from the page where they
 * just changed the password.
 *
 * Request body:
 *   { old_password: string, new_password: string }
 *
 * Response 200: { ok: true }
 *
 * Errors:
 *   400 — missing fields, or new_password fails validation
 *   401 — old_password incorrect
 */

require_once __DIR__ . '/users_helpers.php';

mp_require_method('POST');

$auth = users_require_session($mysqli);
$userId = (int) $auth['user']['user_id'];
$currentSessionId = (int) $auth['session']['session_id'];

$body = mp_read_json_body();
$oldPw = $body['old_password'] ?? '';
$newPw = $body['new_password'] ?? '';

if (!is_string($oldPw) || $oldPw === '') mp_error('Current password required', 400);
$err = users_validate_password($newPw);
if ($err) mp_error($err, 400);

if ($oldPw === $newPw) {
  mp_error('New password must differ from the current one', 400);
}

// Fetch current hash to verify old_password
$stmt = $mysqli->prepare("SELECT password_hash FROM users WHERE user_id = ?");
$stmt->bind_param('i', $userId);
$stmt->execute();
$res = $stmt->get_result();
$row = $res->fetch_assoc();
$stmt->close();
if (!$row) mp_error('User not found', 401);

if (!password_verify($oldPw, $row['password_hash'])) {
  mp_error('Current password is incorrect', 401);
}

$newHash = password_hash($newPw, PASSWORD_DEFAULT);

$mysqli->begin_transaction();
try {
  $stmt = $mysqli->prepare("UPDATE users SET password_hash = ? WHERE user_id = ?");
  $stmt->bind_param('si', $newHash, $userId);
  $stmt->execute();
  $stmt->close();

  // Revoke all OTHER sessions. The current one stays so the user
  // remains signed in on the device they just changed the password from.
  $stmt = $mysqli->prepare("
    DELETE FROM user_sessions
    WHERE user_id = ? AND session_id <> ?
  ");
  $stmt->bind_param('ii', $userId, $currentSessionId);
  $stmt->execute();
  $stmt->close();

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 500);
}

mp_json(['ok' => true]);

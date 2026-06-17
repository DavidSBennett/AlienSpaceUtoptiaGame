<?php
/**
 * users_completeReset.php
 *
 * POST — finish the password-reset flow. Given the token from the
 * reset email and a new password, set the new password and revoke
 * ALL sessions for this user (anyone who has the old password — or
 * a still-valid session token — is forcibly signed out).
 *
 * Unlike change-password, this issues a NEW session token so the user
 * is immediately signed in after completing the reset. This is the
 * pattern most apps use (avoids forcing the user to type the
 * just-set password again).
 *
 * Request body:
 *   { token: string, new_password: string }
 *
 * Response 200:
 *   { ok: true, session_token: string, user: <public user row> }
 *
 * Errors:
 *   400 — bad token format or weak password
 *   404 — token invalid, expired, or already used
 */

require_once __DIR__ . '/users_helpers.php';

mp_require_method('POST');

$body = mp_read_json_body();
$token = $body['token'] ?? '';
$newPw = $body['new_password'] ?? '';

if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) {
  mp_error('Invalid or expired reset link', 404);
}
$err = users_validate_password($newPw);
if ($err) mp_error($err, 400);

$mysqli->begin_transaction();
try {
  // Lock and look up the token row
  $stmt = $mysqli->prepare("
    SELECT token_id, user_id, expires_at, used_at
    FROM password_reset_tokens
    WHERE token = ?
    FOR UPDATE
  ");
  $stmt->bind_param('s', $token);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();

  if (!$row || $row['used_at'] !== null || strtotime($row['expires_at']) <= time()) {
    throw new Exception('Invalid or expired reset link');
  }
  $userId = (int) $row['user_id'];
  $tokenId = (int) $row['token_id'];

  // Set new password
  $newHash = password_hash($newPw, PASSWORD_DEFAULT);
  $stmt = $mysqli->prepare("
    UPDATE users SET password_hash = ?, failed_logins = 0, login_blocked_until = NULL
    WHERE user_id = ?
  ");
  $stmt->bind_param('si', $newHash, $userId);
  $stmt->execute();
  $stmt->close();

  // Mark token used
  $stmt = $mysqli->prepare("UPDATE password_reset_tokens SET used_at = NOW() WHERE token_id = ?");
  $stmt->bind_param('i', $tokenId);
  $stmt->execute();
  $stmt->close();

  // Revoke ALL existing sessions for this user
  $stmt = $mysqli->prepare("DELETE FROM user_sessions WHERE user_id = ?");
  $stmt->bind_param('i', $userId);
  $stmt->execute();
  $stmt->close();

  // Issue a fresh session
  $sessionToken = users_issue_session($mysqli, $userId);

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 404);
}

mp_json([
  'ok'            => true,
  'session_token' => $sessionToken,
  'user'          => users_public_user_row($mysqli, $userId),
]);

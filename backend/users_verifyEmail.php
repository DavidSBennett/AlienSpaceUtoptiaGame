<?php
/**
 * users_verifyEmail.php
 *
 * POST — consume an email-verification token. After this succeeds the
 * user's email_verified flag is set to 1, which enables password-reset
 * emails to flow to that address.
 *
 * Doesn't require a signed-in session — the token itself is the proof
 * of identity. Doesn't issue a session either; the user can sign in
 * separately if not already.
 *
 * Request body: { token: string }
 *
 * Response 200: { ok: true }
 *
 * Errors:
 *   400 — bad token format
 *   404 — token invalid, expired, or used
 *
 * If the user lost the verification email, they can request a new one
 * from the account settings page (users_resendVerification.php, future).
 */

require_once __DIR__ . '/users_helpers.php';

mp_require_method('POST');

$body = mp_read_json_body();
$token = $body['token'] ?? '';
if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) {
  mp_error('Invalid or expired verification link', 404);
}

$mysqli->begin_transaction();
try {
  $stmt = $mysqli->prepare("
    SELECT token_id, user_id, expires_at, used_at
    FROM email_verification_tokens
    WHERE token = ?
    FOR UPDATE
  ");
  $stmt->bind_param('s', $token);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  if (!$row || $row['used_at'] !== null || strtotime($row['expires_at']) <= time()) {
    throw new Exception('Invalid or expired verification link');
  }

  $userId = (int) $row['user_id'];
  $tokenId = (int) $row['token_id'];

  $stmt = $mysqli->prepare("UPDATE users SET email_verified = 1 WHERE user_id = ?");
  $stmt->bind_param('i', $userId);
  $stmt->execute();
  $stmt->close();

  $stmt = $mysqli->prepare("UPDATE email_verification_tokens SET used_at = NOW() WHERE token_id = ?");
  $stmt->bind_param('i', $tokenId);
  $stmt->execute();
  $stmt->close();

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 404);
}

mp_json(['ok' => true]);

<?php
/**
 * users_requestReset.php
 *
 * POST — start a password-reset flow. Given an email, generates a
 * one-time token and emails a reset link to that address.
 *
 * Request body: { email: string }
 *
 * Response 200: { ok: true } — ALWAYS. Whether or not the email is
 * registered, the response is identical. This prevents an attacker
 * from probing which emails have accounts (enumeration attack).
 *
 * The actual outbound email is only sent if (a) an account with that
 * email exists AND (b) that account's email is verified. We don't
 * send reset links to unverified addresses because the verification
 * step is what proves the email actually belongs to the requester.
 * If you forget your password AND haven't verified your email yet,
 * you'll need admin help — that's the tradeoff for not allowing
 * password-reset on unverified accounts.
 */

require_once __DIR__ . '/users_helpers.php';

mp_require_method('POST');

$body = mp_read_json_body();
$email = trim($body['email'] ?? '');

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
  // Even on validation failure, respond as if it succeeded. The client
  // shouldn't be told "no email at this address" either.
  mp_json(['ok' => true]);
}

// Look up the user
$stmt = $mysqli->prepare("
  SELECT user_id, email_verified, username
  FROM users WHERE email_lower = LOWER(?) AND is_disabled = 0
  LIMIT 1
");
$stmt->bind_param('s', $email);
$stmt->execute();
$res = $stmt->get_result();
$row = $res->fetch_assoc();
$stmt->close();

if ($row && (int) $row['email_verified'] === 1) {
  $userId = (int) $row['user_id'];
  $username = $row['username'];
  $token = users_generate_token();
  $ttlHours = USERS_RESET_TOKEN_TTL_HOURS;

  // Invalidate any existing unused reset tokens for this user — only
  // the most recent one should work. Prevents accumulating tokens
  // from accidental repeated clicks.
  $stmt = $mysqli->prepare("
    UPDATE password_reset_tokens
    SET used_at = NOW()
    WHERE user_id = ? AND used_at IS NULL
  ");
  $stmt->bind_param('i', $userId);
  $stmt->execute();
  $stmt->close();

  // Issue the new token
  $stmt = $mysqli->prepare("
    INSERT INTO password_reset_tokens (user_id, token, expires_at)
    VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))
  ");
  $stmt->bind_param('isi', $userId, $token, $ttlHours);
  $stmt->execute();
  $stmt->close();

  $resetUrl = USERS_APP_BASE_URL . '/reset-password?token=' . $token;
  $body = "Someone (hopefully you, $username) requested a password reset for your account.\n\n"
        . "Reset your password here:\n$resetUrl\n\n"
        . "The link expires in $ttlHours hour(s). If you didn't request this, ignore this email.";
  users_send_email($email, 'Password reset — The Historians', $body);
}

// Always respond ok, even if no user matched. Same response shape +
// timing whether the email exists or not.
mp_json(['ok' => true]);

<?php
/**
 * users_register.php
 *
 * POST — create a new user account. Gated by an invite code: the
 * request must include a valid invite_code that hasn't been revoked,
 * expired, or exhausted its max_uses. The matching invite is consumed
 * atomically as part of the registration transaction, so a race
 * between two concurrent uses of the same single-use code can't
 * create two accounts.
 *
 * Sends an email-verification link on success (best-effort; account
 * is usable immediately, but password reset requires a verified
 * email).
 *
 * Request body:
 *   { username: string, password: string, email: string, invite_code: string }
 *
 * Response 200:
 *   { ok: true, session_token: string, user: <public user row> }
 *
 * Errors:
 *   400 — validation failure (bad username/password/email/code shape)
 *   404 — invite code unrecognized, expired, revoked, or exhausted
 *   409 — username or email already taken (collapsed to a generic
 *         "credentials unavailable" unless USERS_LEAK_TAKEN_RESPONSES)
 *
 * After creation, the user is immediately signed in (we issue a
 * session). If the invite was admin-granting (e.g., the bootstrap
 * invite), the new user is created with is_admin = 1.
 */

require_once __DIR__ . '/users_helpers.php';

mp_require_method('POST');

const USERS_LEAK_TAKEN_RESPONSES = false;  // flip to true for clearer dev errors

$body = mp_read_json_body();
$username = $body['username'] ?? '';
$password = $body['password'] ?? '';
$email    = $body['email'] ?? '';
$inviteRaw = $body['invite_code'] ?? '';

// Validate inputs before touching the DB
$err = users_validate_username($username)
    ?? users_validate_password($password)
    ?? users_validate_email($email);
if ($err) mp_error($err, 400);

// Validate the invite code SHAPE up front so a malformed code gives a
// clearer error than the generic "not recognized." Actual existence /
// validity check happens inside the transaction below.
if (users_normalize_invite_code($inviteRaw) === null) {
  mp_error('Invite code is invalid or malformed', 400);
}

$username = trim($username);
$email    = trim($email);
$hash     = password_hash($password, PASSWORD_DEFAULT);

$mysqli->begin_transaction();
try {
  // Consume the invite code FIRST. If it's bad, we bail out before
  // creating any account. The FOR UPDATE inside this helper holds the
  // invite row through the rest of the transaction, so concurrent
  // double-registers on the same single-use code can't slip through.
  $invite = users_consume_invite_code($mysqli, $inviteRaw);

  // INSERT and let the unique index catch duplicate username/email
  // rather than a pre-SELECT (avoids race conditions).
  $isAdmin = $invite['grants_admin'] ? 1 : 0;
  $stmt = $mysqli->prepare("
    INSERT INTO users (username, password_hash, email, is_admin)
    VALUES (?, ?, ?, ?)
  ");
  $stmt->bind_param('sssi', $username, $hash, $email, $isAdmin);
  try {
    $stmt->execute();
  } catch (Exception $e) {
    $stmt->close();
    if ($mysqli->errno === 1062) {
      // 1062 = duplicate key. Either username_lower or email_lower hit.
      if (USERS_LEAK_TAKEN_RESPONSES) {
        $check = $mysqli->prepare("
          SELECT
            (SELECT 1 FROM users WHERE username_lower = LOWER(?) LIMIT 1) AS u_taken,
            (SELECT 1 FROM users WHERE email_lower    = LOWER(?) LIMIT 1) AS e_taken
        ");
        $check->bind_param('ss', $username, $email);
        $check->execute();
        $r = $check->get_result()->fetch_assoc();
        $check->close();
        if ($r['u_taken']) throw new Exception('That username is already taken');
        if ($r['e_taken']) throw new Exception('An account with that email already exists');
      }
      throw new Exception('Those credentials are unavailable');
    }
    throw $e;
  }
  $userId = $mysqli->insert_id;
  $stmt->close();

  // Record the consumption (audit trail). The invite row's uses_count
  // was already bumped by users_consume_invite_code.
  $stmt = $mysqli->prepare("
    INSERT INTO user_invite_consumptions (invite_id, user_id)
    VALUES (?, ?)
  ");
  $stmt->bind_param('ii', $invite['invite_id'], $userId);
  $stmt->execute();
  $stmt->close();

  // Set up an empty settings row so subsequent reads don't need to
  // handle the missing-row case.
  $stmt = $mysqli->prepare("INSERT INTO user_settings (user_id) VALUES (?)");
  $stmt->bind_param('i', $userId);
  $stmt->execute();
  $stmt->close();

  // Issue session
  $sessionToken = users_issue_session($mysqli, $userId);

  // Generate + store email verification token
  $verifyToken = users_generate_token();
  $ttlDays = USERS_VERIFY_TOKEN_TTL_DAYS;
  $stmt = $mysqli->prepare("
    INSERT INTO email_verification_tokens (user_id, token, expires_at)
    VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))
  ");
  $stmt->bind_param('isi', $userId, $verifyToken, $ttlDays);
  $stmt->execute();
  $stmt->close();

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  $msg = $e->getMessage();
  // Invite-related failures should be 404 (not recognized / expired /
  // revoked); credential conflicts are 409; other validation is 400.
  $status = 409;
  if (stripos($msg, 'invite') !== false) $status = 404;
  if (stripos($msg, 'malformed') !== false) $status = 400;
  mp_error($msg, $status);
}

// Send verification email (best-effort — not transactional. If mail
// delivery fails the account still exists; user can request a re-send
// from the account-settings page later.)
$verifyUrl = USERS_APP_BASE_URL . '/verify-email?token=' . $verifyToken;
$mailBody = "Welcome to The Historians.\n\n"
          . "To confirm this email and enable password recovery, click:\n"
          . $verifyUrl . "\n\n"
          . "The link expires in " . USERS_VERIFY_TOKEN_TTL_DAYS . " days.\n\n"
          . "If you didn't create an account, you can ignore this email.";
users_send_email($email, 'Confirm your email — The Historians', $mailBody);

mp_json([
  'ok'            => true,
  'session_token' => $sessionToken,
  'user'          => users_public_user_row($mysqli, $userId),
]);

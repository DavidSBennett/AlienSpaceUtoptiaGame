<?php
/**
 * users_login.php
 *
 * POST — sign in with username + password. On success returns a
 * session token to be sent as Authorization: Bearer <token> on
 * subsequent requests.
 *
 * Request body:
 *   { username: string, password: string }
 *
 * Response 200:
 *   { ok: true, session_token: string, user: <public user row> }
 *
 * Errors:
 *   400 — missing fields
 *   401 — invalid username OR invalid password (we don't distinguish,
 *         to avoid leaking which usernames exist)
 *   403 — account disabled
 *   429 — too many failed attempts; locked out until login_blocked_until
 *
 * Brute-force protection:
 *   • Each failed attempt bumps users.failed_logins.
 *   • At USERS_THROTTLE_MAX_FAILURES (10), login_blocked_until is set to
 *     NOW + USERS_THROTTLE_LOCKOUT_MINUTES (15 min). During that window
 *     every login attempt for that user returns 429 regardless of
 *     password correctness.
 *   • A successful login resets the counter to 0.
 *   • Lookups are by username only, NOT by IP, so this protects accounts
 *     but doesn't slow down a distributed attacker hammering many
 *     different usernames. That's an acceptable tradeoff for this
 *     deployment; if abuse appears, add an IP-rate limit on top.
 */

require_once __DIR__ . '/users_helpers.php';

mp_require_method('POST');

$body = mp_read_json_body();
$username = trim($body['username'] ?? '');
$password = $body['password'] ?? '';

if ($username === '' || !is_string($password) || $password === '') {
  mp_error('Username and password required', 400);
}

// Look up the user. We do this without locking (the password check is
// constant-time-ish via password_verify, but we don't actually need
// to lock the row — concurrent logins are fine).
$stmt = $mysqli->prepare("
  SELECT user_id, password_hash, is_disabled
  FROM users
  WHERE username_lower = LOWER(?)
  LIMIT 1
");
$stmt->bind_param('s', $username);
$stmt->execute();
$res = $stmt->get_result();
$row = $res->fetch_assoc();
$stmt->close();

if (!$row) {
  // No such user. We still want this to take a roughly constant amount
  // of time so an attacker can't enumerate usernames by timing — burn
  // a token-equivalent amount of work.
  password_verify($password, '$2y$10$ABCDEFGHIJKLMNOPQRSTUuJ8a/x.l8aHk2BCRrtsg7nIa0WnVqu7m');
  mp_error('Invalid username or password', 401);
}

$userId = (int) $row['user_id'];
$hash = $row['password_hash'];

if ((int) $row['is_disabled'] === 1) {
  mp_error('Account is disabled', 403);
}

// Throttle check BEFORE password verify. If they're already locked
// out, don't even peek at the password — saves CPU and prevents
// timing leaks that could narrow down which accounts exist.
users_throttle_check($mysqli, $userId);

if (!password_verify($password, $hash)) {
  users_throttle_record_failure($mysqli, $userId);
  mp_error('Invalid username or password', 401);
}

// Success — clear throttle, issue session
users_throttle_clear($mysqli, $userId);
$sessionToken = users_issue_session($mysqli, $userId);

mp_json([
  'ok'            => true,
  'session_token' => $sessionToken,
  'user'          => users_public_user_row($mysqli, $userId),
]);

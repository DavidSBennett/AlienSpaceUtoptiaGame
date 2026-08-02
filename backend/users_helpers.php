<?php
/**
 * users_helpers.php
 *
 * Shared functions for the user-account / authentication layer. Pulls
 * in mp_dbConfig.php to inherit the $mysqli connection and its JSON
 * helpers (mp_json, mp_error, mp_require_method, mp_read_json_body),
 * then layers user-account-specific concerns on top:
 *
 *   - users_require_session($mysqli) — validate Bearer token, return
 *     user row + session row, 401 on failure. Called at the top of
 *     every protected endpoint.
 *
 *   - users_optional_session($mysqli) — same lookup but returns null
 *     instead of erroring. Useful for endpoints that work for both
 *     logged-in and guest callers (none in the locked version, but
 *     useful for migration).
 *
 *   - users_generate_token() — 64-char hex from CSPRNG.
 *
 *   - users_send_email($to, $subject, $body) — wraps mail() with
 *     sensible defaults. Returns bool. Replace internals later if
 *     deliverability requires SendGrid/etc.
 *
 *   - users_throttle_check($mysqli, $userId) — inspects failed_logins
 *     and login_blocked_until; errors if currently throttled.
 *
 *   - users_throttle_record_failure($mysqli, $userId) — bumps the
 *     counter, sets login_blocked_until when threshold is hit.
 *
 *   - users_throttle_clear($mysqli, $userId) — resets on successful
 *     login.
 *
 * All endpoints under the user-accounts layer should require_once this
 * file as their FIRST line. It in turn loads mp_dbConfig.php.
 */

require_once __DIR__ . '/mp_dbConfig.php';


// ───────────────────────────────────────────────────────────────────────
// Configuration constants. Tune these if needed.
// ───────────────────────────────────────────────────────────────────────

// How long a session lasts before expiring (server-side). The client
// can extend by renewing — last_used_at is bumped on every request.
const USERS_SESSION_TTL_DAYS = 30;

// How long a password-reset token lives.
const USERS_RESET_TOKEN_TTL_HOURS = 1;

// How long an email-verification token lives.
const USERS_VERIFY_TOKEN_TTL_DAYS = 7;

// Brute-force throttle. After this many consecutive failures, the
// account is blocked for the lockout window.
const USERS_THROTTLE_MAX_FAILURES = 10;
const USERS_THROTTLE_LOCKOUT_MINUTES = 15;

// Password length floor. Server-enforced; the frontend should mirror.
const USERS_PASSWORD_MIN_LENGTH = 8;

// Username constraints. Letters, digits, underscores; 3-32 chars.
const USERS_USERNAME_PATTERN = '/^[A-Za-z0-9_]{3,32}$/';

// Invite code constraints. Stored as 12 uppercase chars from the
// base32-style alphabet (digits 2-9 and letters except I/L/O). Input
// is normalized — dashes and whitespace stripped, lowercase letters
// uppercased — before lookup, so users can type "abcd-efgh-jkmn" or
// "ABCDEFGHJKMN" or "abcd efghjkmn" and we'll match all three.
const USERS_INVITE_CODE_LENGTH = 12;
const USERS_INVITE_ALPHABET    = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Email "from" address for system mail. MUST be a mailbox you control
// on the SENDING domain (thehistorians.org) so SPF/DKIM pass and the
// mail isn't junked. Create it in cPanel -> Email Accounts.
const USERS_MAIL_FROM = 'no-reply@thehistorians.org';
const USERS_MAIL_FROM_NAME = 'The Historians';

// Public-facing URL used to build links in outbound email (verify,
// password reset). Must match where the app actually lives. This
// assumes a ROOT deploy at thehistorians.org; if you deploy in a
// subfolder, append it here AND set vite's `base` to match.
const USERS_APP_BASE_URL = 'https://alienspace.thehistorians.org';

// ── SMTP credentials (authenticated send via PHPMailer) ─────────────
// GreenGeeks sends over SSL on port 465. Host is mail.<your-domain>.
// 1. Create the no-reply@thehistorians.org mailbox in cPanel.
// 2. Put that mailbox's password in SMTP_PASS below (on the server —
//    never commit it anywhere public).
// If PHPMailer isn't installed, users_send_email() falls back to mail().
require_once __DIR__ . '/config.secret.php';
const SMTP_HOST   = SECRET_SMTP_HOST;
const SMTP_PORT   = SECRET_SMTP_PORT;
const SMTP_SECURE = SECRET_SMTP_SECURE;                         // 'ssl' for port 465
const SMTP_USER   = SECRET_SMTP_USER;
const SMTP_PASS   = SECRET_SMTP_PASS;


// ───────────────────────────────────────────────────────────────────────
// Session validation — auth middleware
// ───────────────────────────────────────────────────────────────────────

/**
 * Validate the Authorization: Bearer <token> header. On success returns
 *   ['user' => <row from users>, 'session' => <row from user_sessions>]
 * On failure (no header, bad token, expired, disabled account) emits a
 * 401 JSON response and exits.
 *
 * Also bumps last_used_at on the session row so the active-sessions UI
 * later can show "Last used 2 minutes ago."
 */
function users_require_session($mysqli) {
  $session = users_optional_session($mysqli);
  if (!$session) {
    mp_error('Not signed in', 401);
  }
  return $session;
}


function users_optional_session($mysqli) {
  $token = users_extract_bearer_token();
  if ($token === null) return null;

  // Lock the session row + join user. We DO need a write here
  // (last_used_at bump) but locking would be overkill since touching
  // last_used_at is idempotent and a small race is harmless.
  $stmt = $mysqli->prepare("
    SELECT s.session_id, s.user_id, s.token, s.expires_at,
           u.username, u.email, u.email_verified, u.is_admin, u.is_disabled,
           u.created_at AS user_created_at
    FROM user_sessions s
    JOIN users u ON u.user_id = s.user_id
    WHERE s.token = ? AND s.expires_at > NOW() AND u.is_disabled = 0
    LIMIT 1
  ");
  $stmt->bind_param('s', $token);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();
  if (!$row) return null;

  // Bump last_used_at (fire-and-forget; failure here would be weird but
  // shouldn't break the request).
  $sid = (int) $row['session_id'];
  $bump = $mysqli->prepare("
    UPDATE user_sessions SET last_used_at = NOW() WHERE session_id = ?
  ");
  $bump->bind_param('i', $sid);
  $bump->execute();
  $bump->close();

  return [
    'session' => [
      'session_id' => (int) $row['session_id'],
      'token'      => $row['token'],
      'expires_at' => $row['expires_at'],
    ],
    'user' => [
      'user_id'        => (int) $row['user_id'],
      'username'       => $row['username'],
      'email'          => $row['email'],
      'email_verified' => (bool) $row['email_verified'],
      'is_admin'       => (bool) $row['is_admin'],
      'created_at'     => $row['user_created_at'],
    ],
  ];
}


/**
 * Read the Bearer token from the Authorization header. Returns the
 * hex token string or null if missing/malformed.
 *
 * Apache + PHP on cPanel sometimes strips Authorization headers; we
 * accept either HTTP_AUTHORIZATION (most setups) or REDIRECT_HTTP_AUTHORIZATION
 * (some mod_rewrite chains). If neither is set, return null.
 */
function users_extract_bearer_token() {
  $hdr = $_SERVER['HTTP_AUTHORIZATION']
       ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
       ?? null;
  if (!$hdr) return null;
  if (!preg_match('/^Bearer\s+([A-Fa-f0-9]{64})$/', $hdr, $m)) return null;
  return $m[1];
}


/**
 * Convenience: require a signed-in user AND admin privilege. Used by
 * admin_*.php endpoints (e.g. mass wipe).
 */
function users_require_admin($mysqli) {
  $auth = users_require_session($mysqli);
  if (!$auth['user']['is_admin']) {
    mp_error('Admin privilege required', 403);
  }
  return $auth;
}


// ───────────────────────────────────────────────────────────────────────
// Token generation
// ───────────────────────────────────────────────────────────────────────

/**
 * 64-character hex token from PHP's CSPRNG. Used for session tokens,
 * password-reset tokens, and email-verification tokens.
 *
 * 32 bytes = 256 bits of entropy, which is overkill for sessions and
 * exactly right for one-time URLs that travel through email logs.
 */
function users_generate_token() {
  return bin2hex(random_bytes(32));
}


// ───────────────────────────────────────────────────────────────────────
// Email
// ───────────────────────────────────────────────────────────────────────

/**
 * Send a transactional email (verify, password reset, etc).
 *
 * Preferred path: authenticated SMTP via PHPMailer, sending from a real
 * mailbox on the sending domain (thehistorians.org). This passes SPF/DKIM
 * and lands in inboxes reliably — unlike bare mail(), which shared hosts
 * frequently get junked by Gmail/Outlook.
 *
 * Graceful fallback: if PHPMailer isn't installed yet, or an SMTP send
 * throws, we fall back to PHP mail() so a transient hiccup doesn't hard-
 * block registration. Callers don't need to change either way.
 *
 * Returns true on accept, false on failure. Doesn't throw.
 */
function users_send_email($to, $subject, $bodyPlain) {
  // Composer autoloader — PHPMailer (and PhpSpreadsheet) live here.
  // __DIR__ keeps this correct no matter which endpoint included us.
  $autoload = __DIR__ . '/vendor/autoload.php';
  if (is_file($autoload)) {
    require_once $autoload;
  }

  // ── Preferred: authenticated SMTP ──────────────────────────────────
  if (class_exists('\\PHPMailer\\PHPMailer\\PHPMailer')) {
    try {
      $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
      $mail->isSMTP();
      $mail->Host       = SMTP_HOST;
      $mail->SMTPAuth   = true;
      $mail->Username   = SMTP_USER;
      $mail->Password   = SMTP_PASS;
      $mail->SMTPSecure = SMTP_SECURE;   // 'ssl' for port 465
      $mail->Port       = SMTP_PORT;     // 465 on GreenGeeks
      $mail->CharSet    = 'UTF-8';

      $mail->setFrom(USERS_MAIL_FROM, USERS_MAIL_FROM_NAME);
      $mail->addReplyTo(USERS_MAIL_FROM, USERS_MAIL_FROM_NAME);
      $mail->addAddress($to);
      $mail->Subject = $subject;
      $mail->Body    = $bodyPlain;
      $mail->isHTML(false);

      $mail->send();
      return true;
    } catch (\Throwable $e) {
      // Log and fall through to mail() so registration still works.
      error_log('users_send_email SMTP failed: ' . $e->getMessage());
    }
  }

  // ── Fallback: PHP mail() against the local MTA ─────────────────────
  $headers = implode("\r\n", [
    'From: ' . USERS_MAIL_FROM_NAME . ' <' . USERS_MAIL_FROM . '>',
    'Reply-To: ' . USERS_MAIL_FROM,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'X-Mailer: PHP/' . phpversion(),
  ]);
  // The -f flag sets the envelope sender so bounces go to a real
  // mailbox instead of the apache user. cPanel typically allows this.
  $envelope = '-f' . USERS_MAIL_FROM;
  return @mail($to, $subject, $bodyPlain, $headers, $envelope);
}


// ───────────────────────────────────────────────────────────────────────
// Throttle (brute-force protection)
// ───────────────────────────────────────────────────────────────────────

/**
 * Throws a 429 error if the given account is currently locked out.
 * Call BEFORE attempting to verify a password.
 */
function users_throttle_check($mysqli, $userId) {
  $stmt = $mysqli->prepare("
    SELECT failed_logins, login_blocked_until,
           login_blocked_until IS NOT NULL AND login_blocked_until > NOW() AS is_blocked
    FROM users WHERE user_id = ?
  ");
  $stmt->bind_param('i', $userId);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();
  if ($row && (int) $row['is_blocked'] === 1) {
    mp_error('Too many failed attempts. Try again in a few minutes.', 429);
  }
}


function users_throttle_record_failure($mysqli, $userId) {
  // Atomically bump the counter; if it reaches the threshold, set the
  // lockout timestamp.
  $stmt = $mysqli->prepare("
    UPDATE users
    SET failed_logins = failed_logins + 1,
        login_blocked_until = IF(failed_logins + 1 >= ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), login_blocked_until)
    WHERE user_id = ?
  ");
  $max = USERS_THROTTLE_MAX_FAILURES;
  $minutes = USERS_THROTTLE_LOCKOUT_MINUTES;
  $stmt->bind_param('iii', $max, $minutes, $userId);
  $stmt->execute();
  $stmt->close();
}


function users_throttle_clear($mysqli, $userId) {
  $stmt = $mysqli->prepare("
    UPDATE users SET failed_logins = 0, login_blocked_until = NULL,
                     last_login_at = NOW()
    WHERE user_id = ?
  ");
  $stmt->bind_param('i', $userId);
  $stmt->execute();
  $stmt->close();
}


// ───────────────────────────────────────────────────────────────────────
// Validation helpers used by register / changePassword / completeReset
// ───────────────────────────────────────────────────────────────────────

function users_validate_username($username) {
  if (!is_string($username)) return 'Username is required';
  $username = trim($username);
  if ($username === '') return 'Username is required';
  if (!preg_match(USERS_USERNAME_PATTERN, $username)) {
    return 'Username must be 3–32 characters, letters/digits/underscore only';
  }
  return null;
}

function users_validate_password($password) {
  if (!is_string($password)) return 'Password is required';
  if (strlen($password) < USERS_PASSWORD_MIN_LENGTH) {
    return 'Password must be at least ' . USERS_PASSWORD_MIN_LENGTH . ' characters';
  }
  return null;
}

function users_validate_email($email) {
  if (!is_string($email)) return 'Email is required';
  $email = trim($email);
  if ($email === '') return 'Email is required';
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) return 'Email address looks invalid';
  if (strlen($email) > 255) return 'Email address is too long';
  return null;
}


// ───────────────────────────────────────────────────────────────────────
// Invite codes
// ───────────────────────────────────────────────────────────────────────

/**
 * Normalize a user-supplied invite code: strip whitespace and dashes,
 * uppercase letters. Returns the cleaned 12-char string or null if it
 * doesn't look right after normalization.
 */
function users_normalize_invite_code($raw) {
  if (!is_string($raw)) return null;
  $clean = strtoupper(preg_replace('/[\s\-]+/', '', $raw));
  if (strlen($clean) !== USERS_INVITE_CODE_LENGTH) return null;
  // Require every char to be from the alphabet (defense against the
  // user pasting in something weird that happens to be 12 chars).
  if (!preg_match('/^[' . USERS_INVITE_ALPHABET . ']+$/', $clean)) return null;
  return $clean;
}


/**
 * Generate a fresh 12-char invite code, retrying on the (vanishingly
 * unlikely) chance the random pick collides with an existing code.
 * Uses the ambiguity-free alphabet so codes printed in chat or read
 * aloud don't confuse 0/O/1/I/L.
 */
function users_generate_invite_code($mysqli) {
  $alpha = USERS_INVITE_ALPHABET;
  $len = USERS_INVITE_CODE_LENGTH;
  $alphaLen = strlen($alpha);
  for ($attempt = 0; $attempt < 5; $attempt++) {
    $code = '';
    for ($i = 0; $i < $len; $i++) {
      $code .= $alpha[random_int(0, $alphaLen - 1)];
    }
    // Collision check
    $stmt = $mysqli->prepare("SELECT 1 FROM user_invite_codes WHERE code_lower = LOWER(?)");
    $stmt->bind_param('s', $code);
    $stmt->execute();
    $exists = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$exists) return $code;
  }
  throw new Exception('Could not generate a unique invite code (5 retries)');
}


/**
 * Format a 12-char code as XXXX-XXXX-XXXX for display. Storage is
 * always the unformatted version.
 */
function users_format_invite_code($code) {
  $clean = strtoupper(preg_replace('/[^A-Z0-9]/', '', $code));
  if (strlen($clean) !== USERS_INVITE_CODE_LENGTH) return $code;
  return substr($clean, 0, 4) . '-' . substr($clean, 4, 4) . '-' . substr($clean, 8, 4);
}


/**
 * Consume an invite code as part of registration. Atomically validates
 * (exists, not revoked, not expired, has remaining uses) and bumps
 * uses_count. Returns the invite row on success. Throws on failure.
 *
 * Caller is responsible for inserting the matching row in
 * user_invite_consumptions and (if invite.grants_admin) flipping the
 * new user's is_admin column. Must be called inside an open transaction
 * so the invite consume and the user create are all-or-nothing.
 */
function users_consume_invite_code($mysqli, $rawCode) {
  $code = users_normalize_invite_code($rawCode);
  if ($code === null) {
    throw new Exception('Invite code is invalid or malformed');
  }

  // Lock the row + check validity in one shot
  $stmt = $mysqli->prepare("
    SELECT invite_id, code, grants_admin, max_uses, uses_count, expires_at, revoked_at
    FROM user_invite_codes
    WHERE code_lower = LOWER(?)
    FOR UPDATE
  ");
  $stmt->bind_param('s', $code);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  if (!$row)                              throw new Exception('Invite code not recognized');
  if ($row['revoked_at'] !== null)        throw new Exception('Invite code has been revoked');
  if ($row['expires_at'] !== null &&
      strtotime($row['expires_at']) <= time()) throw new Exception('Invite code has expired');
  if ((int) $row['uses_count'] >= (int) $row['max_uses']) {
    throw new Exception('Invite code has no remaining uses');
  }

  // Atomically bump uses_count (the FOR UPDATE lock above guards us
  // against a second concurrent registration tipping the count past
  // max_uses).
  $iid = (int) $row['invite_id'];
  $stmt = $mysqli->prepare("UPDATE user_invite_codes SET uses_count = uses_count + 1 WHERE invite_id = ?");
  $stmt->bind_param('i', $iid);
  $stmt->execute();
  $stmt->close();

  return [
    'invite_id'    => $iid,
    'code'         => $row['code'],
    'grants_admin' => (int) $row['grants_admin'] === 1,
  ];
}


// ───────────────────────────────────────────────────────────────────────
// Issue a session — used by register and login
// ───────────────────────────────────────────────────────────────────────

/**
 * Create a new session row for the given user_id and return the token.
 * Captures user_agent and ip_address for the active-sessions display.
 */
function users_issue_session($mysqli, $userId) {
  $token = users_generate_token();
  $ua = substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255);
  $ip = substr($_SERVER['REMOTE_ADDR'] ?? '', 0, 45);
  $expiresInDays = USERS_SESSION_TTL_DAYS;
  $stmt = $mysqli->prepare("
    INSERT INTO user_sessions (user_id, token, user_agent, ip_address, expires_at)
    VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))
  ");
  $stmt->bind_param('isssi', $userId, $token, $ua, $ip, $expiresInDays);
  $stmt->execute();
  $stmt->close();
  return $token;
}


/**
 * Build the public user payload sent in JSON responses. Excludes the
 * password hash and anything else that shouldn't leave the server.
 */
function users_public_user_row($mysqli, $userId) {
  $stmt = $mysqli->prepare("
    SELECT user_id, username, email, email_verified, is_admin, created_at
    FROM users WHERE user_id = ?
  ");
  $stmt->bind_param('i', $userId);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();
  if (!$row) return null;
  return [
    'user_id'        => (int) $row['user_id'],
    'username'       => $row['username'],
    'email'          => $row['email'],
    'email_verified' => (bool) $row['email_verified'],
    'is_admin'       => (bool) $row['is_admin'],
    'created_at'     => $row['created_at'],
  ];
}

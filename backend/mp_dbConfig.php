<?php
/**
 * mp_dbConfig.php
 *
 * Shared database connection for all multiplayer endpoints. This file is a
 * thin wrapper around the existing dbConfig.php — it includes that file
 * (which sets up $mysqli with the actual credentials) and then provides a
 * few helper functions used by every mp_*.php endpoint:
 *
 *   - mp_json($data, $status = 200)        Send a JSON response and exit
 *   - mp_error($message, $status = 400)    Send an error response and exit
 *   - mp_require_method($method)           Enforce HTTP method (e.g. 'POST')
 *   - mp_read_json_body()                  Parse incoming JSON body, error on bad
 *   - mp_authenticate($mysqli)             Resolve player_token → row, error on bad
 *   - mp_bump_state_version($mysqli, $gameId)  Increment state_version atomically
 *
 * No database credentials live in this file. Keep all credentials in
 * dbConfig.php where the existing single-player endpoints already use them.
 */

// ----------------------------------------------------------------------------
// Database connection
// ----------------------------------------------------------------------------
//
// The single-player codebase uses a PDO-based wrapper class (MyDatabase) in
// dbConfig.php. The multiplayer code I'm adding uses raw mysqli throughout
// because its query patterns (FOR UPDATE locks, transactional row-locking,
// last_insert_id, multi-statement batches) read more cleanly in mysqli's
// procedural style.
//
// Rather than rewrite every multiplayer endpoint to use the MyDatabase
// wrapper, OR force MyDatabase to expose its internal PDO handle, we just
// open a SEPARATE mysqli connection here using the same credentials. The
// two connections coexist happily — the existing single-player endpoints
// keep using the MyDatabase PDO connection, multiplayer uses this mysqli
// connection. Same database, no conflict, no shared state.
//
// Credentials are duplicated from dbConfig.php's MyDatabase class. If you
// change them there, change them here too. (For Phase A this hardcoding is
// acceptable; if it becomes a maintenance pain, Phase B can refactor to
// read them from a single shared include.)

require_once __DIR__ . '/config.secret.php';
$MP_DB_HOST = SECRET_DB_HOST;
$MP_DB_USER = SECRET_DB_USER;
$MP_DB_PASS = SECRET_DB_PASS;
$MP_DB_NAME = SECRET_DB_NAME;

// mysqli connection. Use the procedural-equivalent OO API.
// Suppress the default warning-on-failure so we can convert it to a clean
// JSON error response below.
$mysqli = @new mysqli($MP_DB_HOST, $MP_DB_USER, $MP_DB_PASS, $MP_DB_NAME);

if ($mysqli->connect_errno) {
  http_response_code(500);
  header('Content-Type: application/json');
  echo json_encode([
    'error' => 'MP database connection failed: ' . $mysqli->connect_error,
  ]);
  exit;
}

// Ensure utf8mb4 throughout — card content has em dashes, smart quotes, etc.
$mysqli->set_charset('utf8mb4');


/**
 * Send a JSON response and exit.
 *
 * @param mixed $data    will be JSON-encoded
 * @param int   $status  HTTP status code (default 200)
 */
function mp_json($data, $status = 200) {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  // JSON_UNESCAPED_UNICODE so accented characters in author names ("Côté")
  // come through readable rather than as \u00e9.
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}


/**
 * Send a JSON error response and exit. Convenience wrapper around mp_json().
 *
 * The response shape is { "error": "<message>" } — matches what the existing
 * single-player endpoints return, so the frontend's normalizeError() handles
 * it without changes.
 *
 * @param string $message  human-readable error
 * @param int    $status   HTTP status code (default 400)
 */
function mp_error($message, $status = 400) {
  mp_json(['error' => $message], $status);
}


/**
 * Enforce that the request method matches what the endpoint expects.
 * Call at the top of every endpoint to reject misrouted requests.
 *
 * @param string $method  'GET' or 'POST'
 */
function mp_require_method($method) {
  if ($_SERVER['REQUEST_METHOD'] !== $method) {
    mp_error("This endpoint requires $method", 405);
  }
}


/**
 * Read and JSON-decode the request body. Returns an associative array.
 * Errors out (400) if the body isn't valid JSON.
 *
 * Used by every POST endpoint that expects a JSON body (which is all of them).
 *
 * @return array
 */
function mp_read_json_body() {
  $raw = file_get_contents('php://input');
  if ($raw === false || strlen($raw) === 0) {
    mp_error('Empty request body — expected JSON', 400);
  }
  $data = json_decode($raw, true);
  if (json_last_error() !== JSON_ERROR_NONE) {
    mp_error('Invalid JSON: ' . json_last_error_msg(), 400);
  }
  if (!is_array($data)) {
    mp_error('Request body must be a JSON object', 400);
  }
  return $data;
}


/**
 * Resolve a player_token (from request body or query string) to the player
 * row from mp_game_players. Errors out (401) if missing or invalid.
 *
 * Returns the full player row plus the game row joined in, since most
 * endpoints need both. Updates last_seen_at as a side effect — this is
 * how we know who's alive vs. who's about to ghost.
 *
 * @param mysqli $mysqli
 * @param string|null $tokenOverride  if provided, use this instead of reading from request
 * @return array { player: <row>, game: <row> }
 */
function mp_authenticate($mysqli, $tokenOverride = null) {
  $token = $tokenOverride;
  if ($token === null) {
    // Try the request body first (POST/JSON), then the query string (GET).
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
      $body = json_decode(file_get_contents('php://input'), true);
      if (is_array($body) && isset($body['player_token'])) {
        $token = $body['player_token'];
      }
    }
    if (!$token && isset($_GET['player_token'])) {
      $token = $_GET['player_token'];
    }
  }

  if (!$token || !is_string($token)) {
    mp_error('player_token required', 401);
  }

  // Token is hex; reject anything that isn't, before hitting the DB
  if (!preg_match('/^[a-f0-9]{32,64}$/', $token)) {
    mp_error('Invalid player_token format', 401);
  }

  $stmt = $mysqli->prepare("
    SELECT p.*, g.game_id AS g_game_id, g.idDeck AS g_idDeck,
           g.status AS g_status, g.current_year AS g_current_year,
           g.host_player_id AS g_host_player_id,
           g.year_started_at AS g_year_started_at,
           g.timer_seconds_default AS g_timer_seconds_default,
           g.timer_seconds_review AS g_timer_seconds_review,
           g.state_version AS g_state_version
    FROM mp_game_players p
    JOIN mp_games g ON g.game_id = p.game_id
    WHERE p.player_token = ?
    LIMIT 1
  ");
  if (!$stmt) {
    mp_error('DB prepare failed: ' . $mysqli->error, 500);
  }
  $stmt->bind_param('s', $token);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();

  if (!$row) {
    mp_error('Unknown player_token', 401);
  }

  // ── Locked version: require session-match ──────────────────────────
  //
  // Beyond the player_token check above, we also require an
  // Authorization: Bearer <session_token> header whose owning user_id
  // matches the mp_game_players.user_id on this row.
  //
  // Defense-in-depth: a leaked player_token alone won't grant access
  // unless the attacker ALSO has the user's session token. Stops most
  // casual cross-account hijacks.
  //
  // We tolerate user_id IS NULL on the player row to keep this helper
  // working for any legacy guest rows that pre-date Session 1. Session
  // 4 will wipe those guest rows on cutover so production-locked data
  // always has a user_id.
  if ($row['user_id'] !== null) {
    // users_helpers.php may already be loaded (the new endpoints
    // include it), but mp_dbConfig.php doesn't pull it in by default.
    // require_once is idempotent and cheap.
    require_once __DIR__ . '/users_helpers.php';
    $sessAuth = users_optional_session($mysqli);
    if (!$sessAuth) {
      mp_error('Not signed in', 401);
    }
    if ((int) $sessAuth['user']['user_id'] !== (int) $row['user_id']) {
      mp_error('Session does not match this player_token', 403);
    }
  }

  // Touch last_seen_at — this is how the timer logic knows whether to mark
  // a player as ghost vs. waiting. Done unconditionally so every API call
  // counts as a heartbeat.
  $touchStmt = $mysqli->prepare("UPDATE mp_game_players SET last_seen_at = NOW() WHERE player_id = ?");
  $touchStmt->bind_param('i', $row['player_id']);
  $touchStmt->execute();
  $touchStmt->close();

  // Split the joined row into a player struct and a game struct for caller
  // convenience.
  $game = [
    'game_id'        => (int) $row['g_game_id'],
    'idDeck'         => (int) $row['g_idDeck'],
    'status'         => $row['g_status'],
    'current_year'   => (int) $row['g_current_year'],
    'host_player_id' => $row['g_host_player_id'] ? (int) $row['g_host_player_id'] : null,
    'year_started_at' => $row['g_year_started_at'],
    'timer_seconds_default' => (int) $row['g_timer_seconds_default'],
    'timer_seconds_review'  => (int) $row['g_timer_seconds_review'],
    'state_version'  => (int) $row['g_state_version'],
  ];

  // Strip g_* keys from the player row
  $player = [];
  foreach ($row as $k => $v) {
    if (strpos($k, 'g_') !== 0) {
      $player[$k] = $v;
    }
  }

  return ['player' => $player, 'game' => $game];
}


/**
 * Bump the state_version for a game. Called after every write that affects
 * game state. Atomic increment so concurrent writes don't collide.
 *
 * Returns the new version (caller can include in response so client knows
 * what version it now reflects).
 *
 * @param mysqli $mysqli
 * @param int $gameId
 * @return int new state_version
 */
function mp_bump_state_version($mysqli, $gameId) {
  $stmt = $mysqli->prepare("UPDATE mp_games SET state_version = state_version + 1 WHERE game_id = ?");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $stmt->close();

  $stmt = $mysqli->prepare("SELECT state_version FROM mp_games WHERE game_id = ?");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();
  return $row ? (int) $row['state_version'] : 0;
}


/**
 * Generate a cryptographically random hex string for player tokens.
 * 32 chars = 128 bits of entropy. Used at join time to mint the token
 * that authenticates a player for the rest of the game.
 *
 * @param int $length  number of hex chars (default 32, max 64)
 * @return string
 */
function mp_generate_token($length = 32) {
  $bytes = $length / 2;
  if (function_exists('random_bytes')) {
    return bin2hex(random_bytes($bytes));
  }
  if (function_exists('openssl_random_pseudo_bytes')) {
    return bin2hex(openssl_random_pseudo_bytes($bytes));
  }
  // Fallback — not crypto-strong but unlikely to collide
  $hex = '';
  for ($i = 0; $i < $length; $i++) {
    $hex .= dechex(mt_rand(0, 15));
  }
  return $hex;
}


/**
 * Log an event to mp_event_log. Best-effort — failures are silent.
 *
 * @param mysqli $mysqli
 * @param int $gameId
 * @param int|null $playerId
 * @param string $eventType
 * @param array|null $eventData  will be JSON-encoded
 */
function mp_log_event($mysqli, $gameId, $playerId, $eventType, $eventData = null) {
  $dataJson = $eventData ? json_encode($eventData) : null;
  $stmt = $mysqli->prepare("
    INSERT INTO mp_event_log (game_id, player_id, event_type, event_data)
    VALUES (?, ?, ?, ?)
  ");
  if (!$stmt) return;
  $stmt->bind_param('iiss', $gameId, $playerId, $eventType, $dataJson);
  @$stmt->execute();
  $stmt->close();
}

<?php
/**
 * admin_editScoreName.php — POST (JSON) — admin only.
 *
 * Edit the name shown on a leaderboard entry.
 *
 * Body:
 *   mode:     'solo' | 'mp'         which leaderboard the score lives on
 *   score_id: int                   the row to edit (user_scores.score_id for
 *                                   solo; Scores.idScore for mp)
 *   scope:    'entry' | 'account'   'entry' = this leaderboard row only;
 *                                   'account' = rename the user (solo only —
 *                                   changes their login username everywhere)
 *   name:     string                the new name (1..50 chars after trim)
 *
 * Response 200: { ok: true, name, scope }
 */

require_once __DIR__ . '/users_helpers.php';

mp_require_method('POST');
users_require_admin($mysqli);

$body    = mp_read_json_body();
$mode    = strtolower(trim((string) ($body['mode'] ?? '')));
$scope   = strtolower(trim((string) ($body['scope'] ?? 'entry')));
$scoreId = (int) ($body['score_id'] ?? 0);
$name    = trim((string) ($body['name'] ?? ''));

if (!in_array($mode, ['solo', 'mp'], true))        mp_error('mode must be solo or mp', 400);
if (!in_array($scope, ['entry', 'account'], true)) mp_error('scope must be entry or account', 400);
if ($scoreId <= 0)        mp_error('score_id is required', 400);
if ($name === '')         mp_error('Name cannot be empty', 400);
if (mb_strlen($name) > 50) mp_error('Name must be 50 characters or fewer', 400);

// ── Multiplayer: edit the snapshot name on the legacy Scores row. There is
//    no account behind an MP score, so 'account' scope does not apply. ──────
if ($mode === 'mp') {
  if ($scope === 'account') {
    mp_error('Multiplayer scores are not linked to an account — only this leaderboard entry can be renamed.', 400);
  }
  $stmt = $mysqli->prepare("UPDATE Scores SET player_name = ? WHERE idScore = ?");
  $stmt->bind_param('si', $name, $scoreId);
  $stmt->execute();
  $affected = $stmt->affected_rows;
  $stmt->close();
  if ($affected === 0) {
    // 0 rows could mean "no such row" or "value unchanged" — only error on the
    // former.
    $chk = $mysqli->prepare("SELECT 1 FROM Scores WHERE idScore = ?");
    $chk->bind_param('i', $scoreId);
    $chk->execute();
    $exists = $chk->get_result()->num_rows > 0;
    $chk->close();
    if (!$exists) mp_error('Score not found', 404);
  }
  mp_json(['ok' => true, 'name' => $name, 'scope' => 'entry']);
}

// ── Solo: the score is tied to a user account. ────────────────────────────
$stmt = $mysqli->prepare("SELECT user_id FROM user_scores WHERE score_id = ?");
$stmt->bind_param('i', $scoreId);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$row) mp_error('Score not found', 404);
$userId = (int) $row['user_id'];

if ($scope === 'entry') {
  // The per-score override needs migration 27. Guard with a clear message
  // rather than a raw SQL error if it hasn't been applied yet.
  $hasCol = false;
  if ($c = $mysqli->query("SHOW COLUMNS FROM user_scores LIKE 'display_name'")) {
    $hasCol = $c->num_rows > 0;
    $c->close();
  }
  if (!$hasCol) {
    mp_error('Per-entry rename needs database migration 27 (user_scores.display_name). Run it first, or use "Rename the account".', 409);
  }

  // Per-score override. If it equals the live username, store NULL so the
  // board falls back to the account name cleanly.
  $u = $mysqli->prepare("SELECT username FROM users WHERE user_id = ?");
  $u->bind_param('i', $userId);
  $u->execute();
  $urow = $u->get_result()->fetch_assoc();
  $u->close();
  $username = $urow['username'] ?? null;

  if ($username !== null && $name === $username) {
    $stmt = $mysqli->prepare("UPDATE user_scores SET display_name = NULL WHERE score_id = ?");
    $stmt->bind_param('i', $scoreId);
  } else {
    $stmt = $mysqli->prepare("UPDATE user_scores SET display_name = ? WHERE score_id = ?");
    $stmt->bind_param('si', $name, $scoreId);
  }
  $stmt->execute();
  $stmt->close();
  mp_json(['ok' => true, 'name' => $name, 'scope' => 'entry']);
}

// scope === 'account' — rename the user. This changes their login username
// everywhere. Usernames are unique, so handle the duplicate-key case.
$stmt = $mysqli->prepare("UPDATE users SET username = ? WHERE user_id = ?");
$stmt->bind_param('si', $name, $userId);
$ok = false;
try {
  $ok = $stmt->execute();
} catch (\Throwable $e) {
  $ok = false;
}
$errno = $mysqli->errno;
$stmt->close();
if (!$ok) {
  if ($errno === 1062) mp_error('That username is already taken.', 409);
  mp_error('Could not rename the account — the name may be invalid or already in use.', 500);
}
mp_json(['ok' => true, 'name' => $name, 'scope' => 'account', 'user_id' => $userId]);

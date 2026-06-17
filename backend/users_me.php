<?php
/**
 * users_me.php
 *
 * GET — returns the current signed-in user's info and settings.
 * Useful on app boot: client reads localStorage session_token, calls
 * this endpoint, gets back the user and stashes it in AuthContext.
 * If the token is invalid/expired, returns 401 and the client knows
 * to redirect to /login.
 *
 * Response 200:
 *   { user: <public user row>, settings: <user_settings row> }
 */

require_once __DIR__ . '/users_helpers.php';

mp_require_method('GET');

$auth = users_require_session($mysqli);
$userId = $auth['user']['user_id'];

// Fetch settings
$stmt = $mysqli->prepare("
  SELECT voip_enabled, notebook_collapsed, show_tags, tutorial_enabled, tutorials_dismissed, games_dismissed
  FROM user_settings WHERE user_id = ?
");
$stmt->bind_param('i', $userId);
$stmt->execute();
$res = $stmt->get_result();
$srow = $res->fetch_assoc();
$stmt->close();

$settings = $srow ? [
  'voip_enabled'        => (bool) $srow['voip_enabled'],
  'notebook_collapsed'  => (bool) $srow['notebook_collapsed'],
  'show_tags'           => (bool) $srow['show_tags'],
  'tutorial_enabled'    => (bool) $srow['tutorial_enabled'],
  'tutorials_dismissed' => $srow['tutorials_dismissed']
                            ? json_decode($srow['tutorials_dismissed'], true)
                            : [],
  'games_dismissed'     => $srow['games_dismissed']
                            ? json_decode($srow['games_dismissed'], true)
                            : [],
] : null;

mp_json([
  'user'     => users_public_user_row($mysqli, $userId),
  'settings' => $settings,
]);

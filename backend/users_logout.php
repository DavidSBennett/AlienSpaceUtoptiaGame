<?php
/**
 * users_logout.php
 *
 * POST — revoke the current session token. Client should also drop it
 * from localStorage. After logout the same token will return 401 on
 * any future request.
 *
 * Response 200: { ok: true }
 *
 * Note: this only revokes THE token attached to this request. If the
 * user has signed in from multiple devices, those sessions remain
 * alive. The account-settings page (Session 2) will list active
 * sessions and allow revoking individual ones or "log out everywhere."
 */

require_once __DIR__ . '/users_helpers.php';

mp_require_method('POST');

$auth = users_require_session($mysqli);
$sid = $auth['session']['session_id'];

$stmt = $mysqli->prepare("DELETE FROM user_sessions WHERE session_id = ?");
$stmt->bind_param('i', $sid);
$stmt->execute();
$stmt->close();

mp_json(['ok' => true]);

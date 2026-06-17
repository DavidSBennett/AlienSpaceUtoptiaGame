<?php
/**
 * users_updateSettings.php
 *
 * POST — partial update of the current user's settings row. Only the
 * fields included in the request body are touched; the rest stay as
 * they were. This lets the frontend save individual toggle changes
 * without round-tripping the whole settings object.
 *
 * Request body (all fields optional):
 *   {
 *     voip_enabled:        bool,
 *     notebook_collapsed:  bool,
 *     show_tags:           bool,
 *     tutorials_dismissed: string[]    (full replacement of the array)
 *   }
 *
 * Response 200:
 *   {
 *     ok: true,
 *     settings: { voip_enabled, notebook_collapsed, show_tags, tutorials_dismissed }
 *   }
 *
 * Doesn't return until the row is updated AND read back, so the
 * client gets the canonical state.
 */

require_once __DIR__ . '/users_helpers.php';

mp_require_method('POST');

$auth = users_require_session($mysqli);
$userId = (int) $auth['user']['user_id'];

$body = mp_read_json_body();

// Build a partial UPDATE based on which fields the body included.
// Any field NOT in the body is left untouched. We use a manual
// SET clause rather than UPDATE … COALESCE because we want
// distinguishability between "field set to false" and "field not
// included." A bool false is meaningful and shouldn't be skipped.
$setParts = [];
$params = [];
$types = '';

if (array_key_exists('voip_enabled', $body)) {
  $setParts[] = 'voip_enabled = ?';
  $types .= 'i';
  $params[] = $body['voip_enabled'] ? 1 : 0;
}
if (array_key_exists('notebook_collapsed', $body)) {
  $setParts[] = 'notebook_collapsed = ?';
  $types .= 'i';
  $params[] = $body['notebook_collapsed'] ? 1 : 0;
}
if (array_key_exists('show_tags', $body)) {
  $setParts[] = 'show_tags = ?';
  $types .= 'i';
  $params[] = $body['show_tags'] ? 1 : 0;
}
if (array_key_exists('tutorial_enabled', $body)) {
  $setParts[] = 'tutorial_enabled = ?';
  $types .= 'i';
  $params[] = $body['tutorial_enabled'] ? 1 : 0;
}
if (array_key_exists('tutorials_dismissed', $body)) {
  // Tutorials are stored as a JSON array of string keys. Validate
  // shape (array of strings); silently coerce anything else to empty.
  $td = $body['tutorials_dismissed'];
  if (!is_array($td)) $td = [];
  $clean = [];
  foreach ($td as $t) {
    if (is_string($t) && $t !== '') $clean[] = $t;
  }
  $clean = array_values(array_unique($clean));
  $setParts[] = 'tutorials_dismissed = ?';
  $types .= 's';
  $params[] = json_encode($clean);
}
if (array_key_exists('games_dismissed', $body)) {
  // Stored as a JSON array of integer game_ids the user has dismissed
  // from their "Your Games" list. Coerce to a clean int array.
  $gd = $body['games_dismissed'];
  if (!is_array($gd)) $gd = [];
  $cleanG = [];
  foreach ($gd as $g) {
    $gi = (int) $g;
    if ($gi > 0) $cleanG[] = $gi;
  }
  $cleanG = array_values(array_unique($cleanG));
  $setParts[] = 'games_dismissed = ?';
  $types .= 's';
  $params[] = json_encode($cleanG);
}

if (count($setParts) === 0) {
  mp_error('No settings provided to update', 400);
}

$sql = "UPDATE user_settings SET " . implode(', ', $setParts) . " WHERE user_id = ?";
$types .= 'i';
$params[] = $userId;

$stmt = $mysqli->prepare($sql);
$stmt->bind_param($types, ...$params);
$stmt->execute();
$stmt->close();

// Read back the canonical row
$stmt = $mysqli->prepare("
  SELECT voip_enabled, notebook_collapsed, show_tags, tutorial_enabled, tutorials_dismissed, games_dismissed
  FROM user_settings WHERE user_id = ?
");
$stmt->bind_param('i', $userId);
$stmt->execute();
$res = $stmt->get_result();
$srow = $res->fetch_assoc();
$stmt->close();

mp_json([
  'ok' => true,
  'settings' => [
    'voip_enabled'        => (bool) $srow['voip_enabled'],
    'notebook_collapsed'  => (bool) $srow['notebook_collapsed'],
    'show_tags'           => (bool) $srow['show_tags'],
    'tutorial_enabled'    => (bool) $srow['tutorial_enabled'],
    'tutorials_dismissed' => $srow['tutorials_dismissed']
                              ? json_decode($srow['tutorials_dismissed'], true) ?: []
                              : [],
    'games_dismissed'     => $srow['games_dismissed']
                              ? json_decode($srow['games_dismissed'], true) ?: []
                              : [],
  ],
]);

<?php
/**
 * mp_upgradeStat.php
 *
 * POST — consume a pending_upgrade flag by choosing one stat to level up.
 *
 * Pending upgrades are granted to:
 *   - Writers whose publications were approved (reason='publish')
 *   - Reviewers whose verdicts came in on approved publications (reason='review-approve')
 *   - Reviewers whose rejections stood (reason='review-reject')
 *
 * The player picks ONE stat to advance one level. Caps at 4 per stat.
 * Renown is Phase B and won't accept upgrades yet — frontend should hide it.
 *
 * Request body:
 *   {
 *     player_token: string,
 *     stat: 'research' | 'notebookCapacity' | 'influence' | 'workspaces' | 'reputation'
 *   }
 *
 * Response:
 *   {
 *     ok: true,
 *     stat: string,
 *     new_level: int,
 *     state_version: int
 *   }
 *
 * Errors:
 *   409 — no pending upgrade
 *   400 — unknown stat, or stat already at max
 */

require_once __DIR__ . '/mp_dbConfig.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

if (!$player['pending_upgrade']) {
  mp_error('No pending upgrade', 409);
}

$body = mp_read_json_body();
$stat = isset($body['stat']) ? (string) $body['stat'] : '';

// Map UI stat names to DB column names.
$columnMap = [
  'research'         => 'research_level',
  'notebookCapacity' => 'notebook_level',
  'influence'        => 'influence_level',
  'workspaces'       => 'workspaces_level',
  'reputation'       => 'reputation_level',
  'renown'           => 'renown_level',
];
if (!isset($columnMap[$stat])) {
  mp_error('Unknown stat', 400);
}
$col = $columnMap[$stat];

$pid = (int) $player['player_id'];
$currentLevel = (int) $player[$col];
if ($currentLevel >= 4) {
  mp_error('Stat already at max', 400);
}
$newLevel = $currentLevel + 1;

// Update level + clear pending flag atomically. We don't gate on
// pending_upgrade=1 in the WHERE because we already checked above; doing
// so in the UPDATE would race-protect but at the cost of a confusing
// "affected_rows=0" path. The auth fetch + the upgrade are close enough
// in time that a double-click would be the only realistic race, and the
// transaction below handles that.
$mysqli->begin_transaction();
try {
  // Re-read with a lock to avoid double-claim
  $stmt = $mysqli->prepare("
    SELECT pending_upgrade, $col AS lvl FROM mp_game_players
    WHERE player_id = ? FOR UPDATE
  ");
  $stmt->bind_param('i', $pid);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();
  if (!$row || !$row['pending_upgrade']) {
    throw new Exception('No pending upgrade');
  }
  if ((int) $row['lvl'] >= 4) {
    throw new Exception('Stat already at max');
  }

  // Decrement the upgrade counter. If multiple upgrades were stacked
  // (e.g., player earned publish + review-approve in the same year),
  // the counter goes from 2 → 1 here, the modal will re-pop on the
  // next state poll, and the player picks again. The reason is cleared
  // each consume; if a follow-up upgrade is still queued, the modal
  // falls back to its generic "you earned a stat upgrade" copy, since
  // we don't reliably track which reason corresponds to which queued
  // upgrade.
  $stmt = $mysqli->prepare("
    UPDATE mp_game_players
    SET $col = $col + 1,
        pending_upgrade = GREATEST(pending_upgrade - 1, 0),
        pending_upgrade_reason = NULL
    WHERE player_id = ?
  ");
  $stmt->bind_param('i', $pid);
  $stmt->execute();
  $stmt->close();

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 409);
}

mp_log_event($mysqli, (int) $game['game_id'], $pid, 'stat_upgraded', [
  'stat'      => $stat,
  'new_level' => $newLevel,
]);

$stateVersion = mp_bump_state_version($mysqli, (int) $game['game_id']);

mp_json([
  'ok' => true,
  'stat' => $stat,
  'new_level' => $newLevel,
  'state_version' => $stateVersion,
]);

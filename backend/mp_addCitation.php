<?php
/**
 * mp_addCitation.php
 *
 * POST — add a citation reference from one of caller's projects to a
 * published work.
 *
 * Phase B change: citations are NO LONGER gated by tag match at add
 * time. Any published book can be cited by any project. The
 * citation's tag is instead evaluated at PUBLICATION time alongside
 * the evidence cards:
 *
 *   - If the citation's tag matches the project's conclusion tag, the
 *     submission proceeds to peer review normally.
 *   - If the citation's tag does NOT match, the submission auto-fails
 *     during resolution (mp_resolve_submission_outcomes), regardless
 *     of any human reviewer approvals. The writer still gets the
 *     writer-upgrade ("learn from feedback") and consolation draw,
 *     and the evidence stays bound until reclaimed.
 *
 * This means citations now carry RISK: pull in a thematically related
 * book whose tag doesn't quite match your conclusion and the whole
 * submission auto-rejects.
 *
 * Validation still enforced here:
 *   1. Caller's project at slot_index must have a conclusion set.
 *   2. The work isn't already cited by this project (UNIQUE KEY).
 *
 * Request body:
 *   {
 *     player_token: string,
 *     slot_index:   int,    // 0..2
 *     cited_work_id: int    // mp_published_works.work_id
 *   }
 *
 * Response:
 *   { ok: true, citation_id: int, state_version: int }
 *
 * Errors:
 *   400 — bad params
 *   404 — project slot has no conclusion / cited work not found
 *   409 — already cited, or other constraint
 */

require_once __DIR__ . '/mp_dbConfig.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

$body  = mp_read_json_body();
$slot  = isset($body['slot_index']) ? (int) $body['slot_index'] : -1;
$wid   = isset($body['cited_work_id']) ? (int) $body['cited_work_id'] : 0;

if ($slot < 0 || $slot > 2)   mp_error('slot_index out of range (0..2)', 400);
if ($wid <= 0)                mp_error('cited_work_id required', 400);

$pid = (int) $player['player_id'];
$gid = (int) $game['game_id'];

$mysqli->begin_transaction();
try {
  // 1. Lock and read the project slot
  $stmt = $mysqli->prepare("
    SELECT conclusion_card_id FROM mp_projects
    WHERE player_id = ? AND slot_index = ?
    FOR UPDATE
  ");
  $stmt->bind_param('ii', $pid, $slot);
  $stmt->execute();
  $res = $stmt->get_result();
  $proj = $res->fetch_assoc();
  $stmt->close();
  if (!$proj || !$proj['conclusion_card_id']) {
    throw new Exception('That project has no conclusion yet');
  }

  // 2. Verify the cited work exists and belongs to this game
  $stmt = $mysqli->prepare("
    SELECT work_id, writer_player_id, game_id
    FROM mp_published_works WHERE work_id = ?
  ");
  $stmt->bind_param('i', $wid);
  $stmt->execute();
  $res = $stmt->get_result();
  $work = $res->fetch_assoc();
  $stmt->close();
  if (!$work) throw new Exception('Cited work not found');
  if ((int) $work['game_id'] !== $gid) {
    throw new Exception('Cannot cite a work from a different game');
  }

  // 3. Insert the citation. UNIQUE KEY enforces "cannot cite same work twice."
  $stmt = $mysqli->prepare("
    INSERT INTO mp_citations (player_id, slot_index, cited_work_id)
    VALUES (?, ?, ?)
  ");
  $stmt->bind_param('iii', $pid, $slot, $wid);
  try {
    $stmt->execute();
  } catch (Exception $e) {
    $stmt->close();
    if ($mysqli->errno === 1062) {
      throw new Exception('This work is already cited in that project');
    }
    throw $e;
  }
  $citationId = $mysqli->insert_id;
  $stmt->close();

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 409);
}

mp_log_event($mysqli, $gid, $pid, 'citation_added', [
  'slot_index'    => $slot,
  'cited_work_id' => $wid,
  'citation_id'   => $citationId,
]);

$stateVersion = mp_bump_state_version($mysqli, $gid);

mp_json([
  'ok' => true,
  'citation_id'   => $citationId,
  'state_version' => $stateVersion,
]);

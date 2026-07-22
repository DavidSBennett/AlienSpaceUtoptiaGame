<?php
/**
 * mp_spendObjection.php
 *
 * POST — writer spends one of their objection tokens to contest a
 * rejection of their manuscript.
 *
 * Mechanic (Phase B):
 *   1. Submission must be currently 'rejected' (peer-review reject —
 *      not auto-rejected; you can't object an auto-rejection because
 *      the system already validated the tags).
 *   2. Caller must be the writer.
 *   3. Caller must have objection_tokens_remaining > 0.
 *   4. Token is spent (decremented) regardless of outcome.
 *   5. System runs an algorithmic tag check:
 *        - Find a tag T such that T appears in EVERY evidence card's
 *          (argument or sub_argument) AND in the conclusion's argument.
 *        - Citations count too: a citation "has" its conclusion_tag.
 *        - If such T exists, the submission's rejection is overridden.
 *   6. Outcomes:
 *        - SUCCESS: submission becomes 'objection-won'. Writer gets
 *          full publication treatment (prestige, upgrade, published
 *          work record). Every rejecting reviewer LOSES 5 prestige
 *          (penalty for a rejection that the algorithm overruled).
 *        - FAILURE: submission becomes 'objection-lost'. Token spent.
 *          Rejection stands. Writer can still draw consolation /
 *          reclaim cards.
 *
 * Request body:
 *   { player_token: string, submission_id: int }
 *
 * Response:
 *   { ok: true, outcome: 'won' | 'lost', matched_tag: string | null,
 *     tokens_remaining: int, state_version: int }
 */

require_once __DIR__ . '/mp_dbConfig.php';
require_once __DIR__ . '/mp_resolveYear.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

$body = mp_read_json_body();
$sid  = isset($body['submission_id']) ? (int) $body['submission_id'] : 0;
if ($sid <= 0) mp_error('submission_id required', 400);

$pid = (int) $player['player_id'];
$gid = (int) $game['game_id'];

$mysqli->begin_transaction();
$matched = null;
$outcome = null;
try {
  // Lock the submission row
  $stmt = $mysqli->prepare("
    SELECT * FROM mp_submissions WHERE submission_id = ? FOR UPDATE
  ");
  $stmt->bind_param('i', $sid);
  $stmt->execute();
  $sub = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  if (!$sub)                                throw new Exception('Submission not found');
  if ((int) $sub['game_id'] !== $gid)       throw new Exception('Not your game');
  if ((int) $sub['writer_player_id'] !== $pid) throw new Exception('Not your submission');
  if ($sub['status'] !== 'rejected')        throw new Exception('Submission is not in a contestable state');

  // Objection tokens are disconnected. Objecting is no longer priced in a
  // separate currency — the consequence lives in prestige now (a successful
  // objection costs each rejecting reviewer 5). The column still exists and is
  // simply left alone; nothing reads it.
  $tokensRemaining = 0;

  // Run the tag check
  $evIds = json_decode($sub['evidence_card_ids'], true) ?: [];
  $citeIds = isset($sub['cited_work_ids']) && $sub['cited_work_ids']
              ? (json_decode($sub['cited_work_ids'], true) ?: [])
              : [];
  $concId = (int) $sub['conclusion_card_id'];

  $matched = mp_objection_find_common_tag($mysqli, $concId, $evIds, $citeIds);

  if ($matched === null) {
    // FAILURE — rejection stands, status flips to objection-lost
    $stmt = $mysqli->prepare("
      UPDATE mp_submissions SET status = 'objection-lost'
      WHERE submission_id = ?
    ");
    $stmt->bind_param('i', $sid);
    $stmt->execute();
    $stmt->close();
    $outcome = 'lost';
    mp_log_event($mysqli, $gid, $pid, 'objection_lost', [
      'submission_id' => $sid,
      'tokens_remaining' => $tokensRemaining,
    ]);
  } else {
    // SUCCESS — override the rejection.
    //
    // 1. Capture the rejecting reviewers BEFORE penalizing them, so we
    //    can log a per-reviewer penalty event (visible in each of their
    //    histories) and name them in the writer's objection_won event.
    $stmt = $mysqli->prepare("
      SELECT r.reviewer_player_id, p.player_name
      FROM mp_reviews r
      JOIN mp_game_players p ON p.player_id = r.reviewer_player_id
      WHERE r.submission_id = ? AND r.verdict = 'reject'
    ");
    $stmt->bind_param('i', $sid);
    $stmt->execute();
    $res = $stmt->get_result();
    $penalized = [];
    while ($r = $res->fetch_assoc()) {
      $penalized[] = [
        'player_id'   => (int) $r['reviewer_player_id'],
        'player_name' => $r['player_name'],
      ];
    }
    $stmt->close();

    // 2. Apply the prestige penalty (−5 each, floored at 0).
    $stmt = $mysqli->prepare("
      UPDATE mp_game_players p
      JOIN mp_reviews r ON r.reviewer_player_id = p.player_id
      SET p.prestige = GREATEST(p.prestige - 5, 0)
      WHERE r.submission_id = ? AND r.verdict = 'reject'
    ");
    $stmt->bind_param('i', $sid);
    $stmt->execute();
    $stmt->close();

    // (No token refund — nothing was spent. Objection tokens are disconnected.)

    // 4. Run the full approval flow. This grants writer-prestige,
    //    upgrade, published-work record, etc. — same as a normal
    //    approval. The submission's status is set to 'approved' inside
    //    mp_apply_approval; we'll flip it to 'objection-won' afterward
    //    so the frontend can distinguish.
    mp_apply_approval($mysqli, $gid, $sid, $pid, $sub['kind'], $evIds, $citeIds, $concId, (int) $game['current_year']);

    // Override the status that mp_apply_approval just set
    $stmt = $mysqli->prepare("
      UPDATE mp_submissions SET status = 'objection-won'
      WHERE submission_id = ?
    ");
    $stmt->bind_param('i', $sid);
    $stmt->execute();
    $stmt->close();

    // 5. Per-reviewer penalty events — these show up in each penalized
    //    reviewer's personal history, naming the prestige they lost AND
    //    their running total after the deduction.
    foreach ($penalized as $r) {
      $total = mp_fetch_prestige($mysqli, $r['player_id']);
      mp_log_event($mysqli, $gid, $r['player_id'], 'objection_penalty', [
        'submission_id'  => $sid,
        'prestige_lost'  => 5,
        'prestige_total' => $total,
      ]);
    }

    $outcome = 'won';
    mp_log_event($mysqli, $gid, $pid, 'objection_won', [
      'submission_id'     => $sid,
      'matched_tag'       => $matched,
      'tokens_remaining'  => $tokensRemaining,
      'token_refunded'    => true,
      'penalized_names'   => array_column($penalized, 'player_name'),
      'penalized_count'   => count($penalized),
    ]);
  }

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 400);
}

$stateVersion = mp_bump_state_version($mysqli, $gid);

mp_json([
  'ok'              => true,
  'outcome'         => $outcome,
  'matched_tag'     => $matched,
  'tokens_remaining'=> $tokensRemaining,
  'token_refunded'  => $outcome === 'won',
  'state_version'   => $stateVersion,
]);


/**
 * Look at the submission's evidence + citations and the conclusion's
 * argument. Return the first tag T such that:
 *   - T is in the conclusion's argument tags
 *   - Every evidence card has T in its (argument ∪ sub_argument)
 *   - Every citation has T as its conclusion_tag
 *
 * Returns the tag string, or null if no such tag exists.
 */
function mp_objection_find_common_tag($mysqli, $concId, $evIds, $citeIds) {
  // Conclusion tags
  $stmt = $mysqli->prepare("SELECT argument FROM Cards WHERE idCard = ?");
  $stmt->bind_param('i', $concId);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  if (!$row) return null;
  $concTags = array_filter(array_map('trim', explode(',', (string) $row['argument'])));
  if (count($concTags) === 0) return null;

  // Build per-card tag sets
  $cardTagSets = [];
  if (count($evIds) > 0) {
    $placeholders = implode(',', array_fill(0, count($evIds), '?'));
    $types = str_repeat('i', count($evIds));
    $stmt = $mysqli->prepare(
      "SELECT idCard, argument, sub_argument FROM Cards WHERE idCard IN ($placeholders)"
    );
    $stmt->bind_param($types, ...$evIds);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($r = $res->fetch_assoc()) {
      $tags = [];
      foreach (['argument', 'sub_argument'] as $f) {
        foreach (array_map('trim', explode(',', (string) $r[$f])) as $t) {
          if ($t !== '') $tags[$t] = true;
        }
      }
      $cardTagSets[] = $tags;
    }
    $stmt->close();
  }

  if (count($citeIds) > 0) {
    $placeholders = implode(',', array_fill(0, count($citeIds), '?'));
    $types = str_repeat('i', count($citeIds));
    $stmt = $mysqli->prepare(
      "SELECT conclusion_tag FROM mp_published_works WHERE work_id IN ($placeholders)"
    );
    $stmt->bind_param($types, ...$citeIds);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($r = $res->fetch_assoc()) {
      $t = trim((string) $r['conclusion_tag']);
      $cardTagSets[] = $t !== '' ? [$t => true] : [];
    }
    $stmt->close();
  }

  if (count($cardTagSets) === 0) return null;

  // For each conclusion tag, check if every card has it
  foreach ($concTags as $tag) {
    $allHave = true;
    foreach ($cardTagSets as $cardTags) {
      if (!isset($cardTags[$tag])) {
        $allHave = false;
        break;
      }
    }
    if ($allHave) return $tag;
  }
  return null;
}

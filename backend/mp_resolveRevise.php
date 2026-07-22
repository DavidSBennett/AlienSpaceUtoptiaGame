<?php
/**
 * mp_resolveRevise.php
 *
 * POST — the WRITER resolves a reviewer's Revise & Resubmit proposal on one
 * of their manuscripts (status 'revise-pending').
 *
 * decision:
 *   'accept'  — publish the revised manuscript (original minus the reviewer's
 *               flagged cards, plus the reviewer's added cards). Writer gets
 *               full prestige + upgrade as normal; the reviewer earns
 *               floor(prestige/3) as a contributor and their added cards are
 *               consumed.
 *   'object'  — costs 1 objection token (spent regardless). The ORIGINAL
 *               manuscript is judged by the tag algorithm alone: a common tag
 *               across conclusion + every evidence/citation → approved, else
 *               rejected. The reviewer earns no share.
 *   'rebuild' — decline the collaboration. The manuscript becomes a normal
 *               rejection so the writer can reclaim their own cards + draw
 *               consolation through the existing flow, then rebuild and
 *               resubmit (re-reviewed next year). The reviewer's added cards
 *               stay in their hand.
 *
 * Request body: { player_token, submission_id, decision }
 * Response:     { ok, decision, outcome?, matched_tag?, state_version }
 */

require_once __DIR__ . '/mp_dbConfig.php';
require_once __DIR__ . '/mp_resolveYear.php';   // mp_apply_approval / mp_apply_rejection

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

$pid  = (int) $player['player_id'];
$gid  = (int) $game['game_id'];
$year = (int) $game['current_year'];

$body     = mp_read_json_body();
$sid      = isset($body['submission_id']) ? (int) $body['submission_id'] : 0;
$decision = isset($body['decision']) ? (string) $body['decision'] : '';

if ($sid <= 0) mp_error('submission_id required', 400);
if (!in_array($decision, ['accept', 'object', 'rebuild'], true)) {
  mp_error('decision must be accept, object, or rebuild', 400);
}

$outcome    = null;
$matchedTag = null;

$mysqli->begin_transaction();
try {
  // Lock the submission.
  $stmt = $mysqli->prepare("SELECT * FROM mp_submissions WHERE submission_id = ? FOR UPDATE");
  $stmt->bind_param('i', $sid);
  $stmt->execute();
  $sub = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  if (!$sub)                                     throw new Exception('Submission not found');
  if ((int) $sub['game_id'] !== $gid)            throw new Exception('Not your game');
  if ((int) $sub['writer_player_id'] !== $pid)   throw new Exception('Not your submission');
  if ($sub['status'] !== 'revise-pending')       throw new Exception('This submission is not awaiting a revise decision');

  $kind    = $sub['kind'];
  $concId  = (int) $sub['conclusion_card_id'];
  $origEv  = $sub['evidence_card_ids'] ? (json_decode($sub['evidence_card_ids'], true) ?: []) : [];
  $origEv  = array_map('intval', $origEv);
  $citeIds = (isset($sub['cited_work_ids']) && $sub['cited_work_ids'])
               ? (json_decode($sub['cited_work_ids'], true) ?: [])
               : [];

  // Load the revise proposal (latest revise review for this submission).
  // SELECT * so a not-yet-migrated flagged_work_ids column doesn't break this.
  $stmt = $mysqli->prepare("
    SELECT *
    FROM mp_reviews
    WHERE submission_id = ? AND verdict = 'revise'
    ORDER BY review_id DESC
    LIMIT 1
  ");
  $stmt->bind_param('i', $sid);
  $stmt->execute();
  $rev = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  if (!$rev) throw new Exception('No revision proposal found for this submission');

  $reviewerId = (int) $rev['reviewer_player_id'];
  $flagged = $rev['flagged_card_ids'] ? (json_decode($rev['flagged_card_ids'], true) ?: []) : [];
  $added   = $rev['added_card_ids']   ? (json_decode($rev['added_card_ids'], true) ?: [])   : [];
  $flagged = array_map('intval', $flagged);
  $added   = array_map('intval', $added);
  // Cited works the reviewer flagged for removal (migration 31; absent → none).
  $flaggedWorks = (isset($rev['flagged_work_ids']) && $rev['flagged_work_ids'])
    ? array_map('intval', (json_decode($rev['flagged_work_ids'], true) ?: []))
    : [];
  $citeIds = array_map('intval', $citeIds);

  if ($decision === 'accept') {
    // Revised evidence = (original minus flagged) + (added cards still in the
    // reviewer's hand). Consume those added cards from the reviewer's hand.
    $flaggedSet = array_flip($flagged);
    $kept = array_values(array_filter($origEv, function ($c) use ($flaggedSet) {
      return !isset($flaggedSet[$c]);
    }));

    // The added cards were locked out of the reviewer's hand at propose time
    // (mp_submitReview), so on accept they're simply consumed into the
    // published manuscript — no hand check or removal needed here.
    $revisedEv = array_values(array_unique(array_merge($kept, $added)));

    // Revised citations = original citations minus any the reviewer flagged.
    $flaggedWorksSet = array_flip($flaggedWorks);
    $revisedCiteIds = array_values(array_filter($citeIds, function ($w) use ($flaggedWorksSet) {
      return !isset($flaggedWorksSet[$w]);
    }));

    // Persist the revised evidence + citations onto the submission so the
    // approval's snapshot/discard/prestige all operate on the final manuscript.
    $newEvJson = json_encode($revisedEv);
    $newCiteJson = json_encode($revisedCiteIds);
    $u = $mysqli->prepare("UPDATE mp_submissions SET evidence_card_ids = ?, cited_work_ids = ? WHERE submission_id = ?");
    $u->bind_param('ssi', $newEvJson, $newCiteJson, $sid);
    $u->execute();
    $u->close();

    // The citation-tag check moved behind the vote so a revise verdict could
    // survive a bad citation — the revision is how you fix one. That makes
    // this the point where it has to be enforced instead: accepting a revision
    // that still leaves a mismatched citation must not publish.
    if (count($revisedCiteIds) > 0
        && mp_submission_has_invalid_citation_tags($mysqli, $concId, $revisedCiteIds)) {
      mp_apply_auto_rejection($mysqli, $gid, $sid, $pid, 'invalid-citation', $year);
      mp_return_revise_added($mysqli, $gid, $sid, $year, 0);
      $stateVersion = mp_bump_state_version($mysqli, $gid);
      $mysqli->commit();
      mp_json([
        'ok'            => true,
        'decision'      => $decision,
        'outcome'       => 'auto-rejected',
        'reason'        => 'invalid-citation',
        'state_version' => $stateVersion,
      ]);
    }

    // Full approval (writer prestige + upgrade + published work + discard).
    mp_apply_approval($mysqli, $gid, $sid, $pid, $kind, $revisedEv, $revisedCiteIds, $concId, $year);

    // The flagged-out original cards aren't published; return them to the
    // writer's discard so they're not lost (recoverable after reshuffle).
    foreach ($flagged as $fc) {
      $d = $mysqli->prepare("INSERT IGNORE INTO mp_player_discards (player_id, idCard, discarded_year) VALUES (?, ?, ?)");
      $d->bind_param('iii', $pid, $fc, $year);
      $d->execute();
      $d->close();
    }

    // Reviewer's contributor share + credit. Best-effort and isolated: this
    // must NEVER roll back the core acceptance (which has already published the
    // manuscript above). If e.g. the contributor_player_id migration hasn't
    // run, we skip crediting rather than locking the writer in the modal.
    try {
      $g = $mysqli->prepare("SELECT prestige_granted FROM mp_submissions WHERE submission_id = ?");
      $g->bind_param('i', $sid);
      $g->execute();
      $g->bind_result($pg);
      $g->fetch();
      $g->close();
      $share = (int) floor(((int) $pg) / 3);
      if ($share > 0) {
        $up = $mysqli->prepare("UPDATE mp_game_players SET prestige = prestige + ? WHERE player_id = ?");
        $up->bind_param('ii', $share, $reviewerId);
        $up->execute();
        $up->close();
      }

      $cw = $mysqli->prepare("
        UPDATE mp_published_works
        SET contributor_player_id = ?
        WHERE writer_player_id = ?
        ORDER BY work_id DESC
        LIMIT 1
      ");
      $cw->bind_param('ii', $reviewerId, $pid);
      $cw->execute();
      $cw->close();

      $rTotal = mp_fetch_prestige($mysqli, $reviewerId);
      mp_log_event($mysqli, $gid, $reviewerId, 'revise_contribution', [
        'submission_id'        => $sid,
        'contributor_prestige' => $share,
        'prestige_total'       => $rTotal,
      ]);
    } catch (Throwable $te) {
      error_log('mp_resolveRevise: reviewer credit skipped: ' . $te->getMessage());
    }

    mp_log_event($mysqli, $gid, $pid, 'revise_accepted', [
      'submission_id'         => $sid,
      'contributor_player_id' => $reviewerId,
    ]);
    $outcome = 'accepted';

  } else if ($decision === 'object') {
    // Objection tokens are disconnected — objecting costs no separate currency.
    // The gamble is the price: you give up a guaranteed revised publication and
    // stake the manuscript on the tag check, so losing means rejection.

    // Judge the ORIGINAL manuscript purely by tags.
    $matchedTag = mp_revise_find_common_tag($mysqli, $concId, $origEv, $citeIds);
    if ($matchedTag !== null) {
      mp_apply_approval($mysqli, $gid, $sid, $pid, $kind, $origEv, $citeIds, $concId, $year);
      $outcome = 'approved';
    } else {
      mp_apply_rejection($mysqli, $gid, $sid, $pid, $origEv, $year);
      $outcome = 'rejected';
    }
    // The reviewer's contributed cards were declined — return them.
    mp_return_cards_to_player($mysqli, $gid, $reviewerId, $added, $year);

    mp_log_event($mysqli, $gid, $pid, 'revise_objected', [
      'submission_id' => $sid,
      'outcome'       => $outcome,
      'matched_tag'   => $matchedTag,
    ]);

  } else {
    // rebuild — decline the collaboration. Treat as a normal rejection so the
    // writer can reclaim their own cards + draw consolation via the existing
    // flow, then rebuild and resubmit for peer review next year.
    mp_apply_rejection($mysqli, $gid, $sid, $pid, $origEv, $year);

    // The reviewer's contributed cards were declined — return them.
    mp_return_cards_to_player($mysqli, $gid, $reviewerId, $added, $year);

    mp_log_event($mysqli, $gid, $pid, 'revise_rebuilt', ['submission_id' => $sid]);
    $outcome = 'rebuilt';
  }

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 400);
}

$stateVersion = mp_bump_state_version($mysqli, $gid);

mp_json([
  'ok'            => true,
  'decision'      => $decision,
  'outcome'       => $outcome,
  'matched_tag'   => $matchedTag,
  'state_version' => $stateVersion,
]);


/**
 * Returns the first tag common to the conclusion's argument AND every
 * evidence card (argument ∪ sub_argument) AND every citation's conclusion_tag,
 * or null if none. (Mirrors the check used by mp_spendObjection.php.)
 */
function mp_revise_find_common_tag($mysqli, $concId, $evIds, $citeIds) {
  $stmt = $mysqli->prepare("SELECT argument FROM Cards WHERE idCard = ?");
  $stmt->bind_param('i', $concId);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  if (!$row) return null;
  $concTags = array_filter(array_map('trim', explode(',', (string) $row['argument'])));
  if (count($concTags) === 0) return null;

  $cardTagSets = [];
  if (count($evIds) > 0) {
    $ph = implode(',', array_fill(0, count($evIds), '?'));
    $types = str_repeat('i', count($evIds));
    $stmt = $mysqli->prepare("SELECT argument, sub_argument FROM Cards WHERE idCard IN ($ph)");
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
    $ph = implode(',', array_fill(0, count($citeIds), '?'));
    $types = str_repeat('i', count($citeIds));
    $stmt = $mysqli->prepare("SELECT conclusion_tag FROM mp_published_works WHERE work_id IN ($ph)");
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

  foreach ($concTags as $tag) {
    $allHave = true;
    foreach ($cardTagSets as $cardTags) {
      if (!isset($cardTags[$tag])) { $allHave = false; break; }
    }
    if ($allHave) return $tag;
  }
  return null;
}

// mp_return_cards_to_player() now lives in mp_resolveYear.php (required above)
// so both the revise resolver and the review-phase tally can share it.

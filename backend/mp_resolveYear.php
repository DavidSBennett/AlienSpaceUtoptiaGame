<?php
/**
 * mp_resolveYear.php
 *
 * Shared year-resolution logic. Included by mp_getGameState.php (opportunistic
 * advance when polled) and mp_commitAction.php (could trigger advance when
 * the last player commits).
 *
 * Key function: mp_maybe_resolve_year($mysqli, $gameId)
 *   Checks whether the year can advance and, if so, advances it. Idempotent
 *   under concurrent calls (uses row locks).
 *
 * "Can advance" means one of:
 *   - Every non-ghost player has pending_action_committed = 1, OR
 *   - The timer has expired (year_started_at + appropriate timeout passed),
 *     in which case any uncommitted players are timed out (pass action +
 *     their consecutive_timeouts counter increments).
 *
 * Returns true if the year actually advanced; false if no change.
 *
 * Side effects on advance:
 *   1. Each player's pending_action is APPLIED:
 *      - draw    → draw N cards from archive (N = research stat); if archive
 *                  empty, reshuffle all discards back in
 *      - publish → create row in mp_submissions (status='pending')
 *      - review  → create row in mp_reviews referencing the submission
 *      - pass    → no effect (used by ghosts / timeouts)
 *   2. Reviews are resolved: any submission with ≥1 approve becomes
 *      'approved'; otherwise (if any reviews exist) becomes 'rejected'.
 *      Submissions with no reviews stay 'pending' to next year.
 *   3. Writers of resolved submissions get prestige + upgrade flags + (for
 *      rejected: a draw bonus) and books_published / articles_published
 *      increment.
 *   4. Reviewers get their rewards (upgrade flag, possibly draw on reject).
 *   5. current_year increments by 1. If > the game's total_years
 *      (short=10, medium=18, long=25), the game ends.
 *   6. Stage gate checks (failed comps at year 5, tenure denied at year 12)
 *      run per-player.
 *   7. year_started_at reset to now.
 *   8. state_version bumps.
 *
 * The ordering matters because actions interlock: a 'publish' creates a
 * submission, and a 'review' attaches to a submission. So we resolve in
 * this order: drawing first, then publishing (creating submissions for
 * next year), then reviewing (against submissions from prior years which
 * are now resolvable). The "publish this year creates submission visible
 * next year" timing is what your design specified.
 */

require_once __DIR__ . '/mp_dbConfig.php';

// Fixed publish thresholds (reputation no longer lowers them). A publication
// is a "book" at >= MP_BOOK_MIN real evidence cards, else an "article".
if (!defined('MP_BOOK_MIN'))    define('MP_BOOK_MIN', 6);
if (!defined('MP_ARTICLE_MIN')) define('MP_ARTICLE_MIN', 2);

/**
 * Top-level entry point — see file header for behavior.
 *
 * @return bool true if year advanced or game ended; false if no change.
 */
function mp_maybe_resolve_year($mysqli, $gameId) {
  // Lock the game row so two concurrent polls can't both run resolution.
  $mysqli->begin_transaction();

  try {
    $stmt = $mysqli->prepare("
      SELECT * FROM mp_games WHERE game_id = ? FOR UPDATE
    ");
    $stmt->bind_param('i', $gameId);
    $stmt->execute();
    $game = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$game || $game['status'] !== 'active') {
      $mysqli->commit();
      return false;
    }
    // Only the 'action' phase resolves here. During the 'review' phase the
    // year is held open while players review manuscripts; advancement happens
    // via mp_maybe_advance_review() instead.
    if (($game['phase'] ?? 'action') !== 'action') {
      $mysqli->commit();
      return false;
    }

    // ----- Fetch all players (live + ghost) -----
    $stmt = $mysqli->prepare("
      SELECT * FROM mp_game_players
      WHERE game_id = ?
      ORDER BY seat_index ASC
      FOR UPDATE
    ");
    $stmt->bind_param('i', $gameId);
    $stmt->execute();
    $res = $stmt->get_result();
    $players = [];
    while ($p = $res->fetch_assoc()) $players[] = $p;
    $stmt->close();

    // ----- Decide if year can resolve -----
    //
    // Year resolves when every non-ghost, non-game-over player has committed,
    // OR the timer has expired (in which case uncommitted players auto-pass
    // and their consecutive_timeouts increments).
    //
    // EDGE CASE: if there are NO live players at all (everyone is ghosted
    // or game-over'd from a stage gate), then "all committed" is vacuously
    // true — which would cause us to advance the year forever in a tight
    // loop. Detect that and end the game cleanly instead.
    $livePlayers = array_filter($players, function ($p) {
      return !$p['is_ghost'] && !$p['game_over_reason'];
    });
    if (count($livePlayers) === 0) {
      // No one alive — end the game immediately rather than running through
      // the rest of the resolve cycle. Mark game ended; bump version.
      $stmt = $mysqli->prepare("
        UPDATE mp_game_players
        SET game_over_reason = COALESCE(game_over_reason, 'retired')
        WHERE game_id = ?
      ");
      $stmt->bind_param('i', $gameId);
      $stmt->execute();
      $stmt->close();
      $stmt = $mysqli->prepare("
        UPDATE mp_games SET status = 'ended', ended_at = NOW() WHERE game_id = ?
      ");
      $stmt->bind_param('i', $gameId);
      $stmt->execute();
      $stmt->close();
      // Apply end-of-game renown bonuses BEFORE bumping state_version
      // so the next mp_getGameState fetch sees the updated prestige.
      mp_apply_renown_bonuses($mysqli, $gameId);
      $stmt = $mysqli->prepare("UPDATE mp_games SET state_version = state_version + 1 WHERE game_id = ?");
      $stmt->bind_param('i', $gameId);
      $stmt->execute();
      $stmt->close();
      mp_log_event($mysqli, $gameId, null, 'game_ended', ['reason' => 'no-live-players']);
      $mysqli->commit();
      return true;
    }
    $allCommitted = true;
    foreach ($livePlayers as $p) {
      if (!$p['pending_action_committed']) {
        $allCommitted = false;
        break;
      }
    }

    // TIMER REMOVED: years only advance when ALL live players have committed.
    // Previously a timer-expiry path auto-passed uncommitted players after
    // 60s/120s; that's gone. If a player walks away the game waits
    // indefinitely (host should kick them, future feature).
    if (!$allCommitted) {
      $mysqli->commit();
      return false;
    }

    // ----- We're resolving. (Timeout/ghost path removed — only get here
    // if every live player explicitly committed.) Reset any non-zero
    // consecutive_timeouts counter for committed players (defensive;
    // shouldn't accumulate now that nothing increments it).
    foreach ($players as $i => $p) {
      if ($p['is_ghost'] || $p['game_over_reason']) continue;
      if ((int) $p['consecutive_timeouts'] > 0) {
        $stmt = $mysqli->prepare("
          UPDATE mp_game_players SET consecutive_timeouts = 0 WHERE player_id = ?
        ");
        $pid = (int) $p['player_id'];
        $stmt->bind_param('i', $pid);
        $stmt->execute();
        $stmt->close();
      }
    }

    // ----- Resolve actions, in order: draw, publish, review -----

    foreach ($players as $p) {
      $pid = (int) $p['player_id'];
      $action = $p['pending_action'];
      $data = $p['pending_action_data'] ? json_decode($p['pending_action_data'], true) : null;

      // Audit log — what each player intended to do this year. Critical
      // for diagnosing "my action didn't take effect" reports. Logs even
      // pass/null so the history is complete.
      mp_log_event($mysqli, $gameId, $pid, 'action_dispatched', [
        'action' => $action,
        'data' => $data,
        'year' => (int) $game['current_year'],
      ]);

      if (!$action || $action === 'pass') continue;

      switch ($action) {
        case 'draw':
          // Draws no longer happen here. The player is given an allowance and
          // picks cards one at a time during the draw phase below.
          mp_seed_draw_allowance($mysqli, $gameId, $p);
          break;

        case 'publish':
          mp_resolve_publish($mysqli, $gameId, $p, $data);
          break;

        // 'review' is no longer a per-year action — peer review now happens
        // synchronously in the interstitial review phase (see below).
      }
    }

    // ----- Phase chain: draw → conference → review → finish -----
    // Anyone who chose 'draw' now picks cards one at a time from the four
    // archive piles, in round-robin seat order.
    if (mp_enter_draw_phase($mysqli, $gameId)) {
      $mysqli->commit();
      return true;
    }

    // Nobody drew → straight on to the conference / review steps.
    mp_after_draw_step($mysqli, $gameId, $game);

    $mysqli->commit();
    return true;
  } catch (Exception $e) {
    $mysqli->rollback();
    // We don't surface the error to clients since this is an opportunistic
    // background-ish operation. Log it for diagnostic purposes.
    mp_log_event($mysqli, $gameId, null, 'resolve_year_failed', [
      'error' => $e->getMessage(),
    ]);
    return false;
  }
}


// ============================================================================
// Review phase (synchronous interstitial)
// ============================================================================

/** Count manuscripts awaiting review (status='pending') in a game. */
function mp_count_pending_submissions($mysqli, $gameId) {
  $stmt = $mysqli->prepare("SELECT COUNT(*) AS n FROM mp_submissions WHERE game_id = ? AND status = 'pending'");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $n = (int) $stmt->get_result()->fetch_assoc()['n'];
  $stmt->close();
  return $n;
}

/** Ordered list (by submission_id) of the manuscripts under review this round. */
function mp_review_submission_ids($mysqli, $gameId) {
  $stmt = $mysqli->prepare("
    SELECT submission_id FROM mp_submissions
    WHERE game_id = ? AND status = 'pending'
    ORDER BY submission_id ASC
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $ids = [];
  while ($r = $res->fetch_assoc()) $ids[] = (int) $r['submission_id'];
  $stmt->close();
  return $ids;
}

/** Player ids still in the game (not ghosted, not game-over) — the barrier set. */
function mp_live_player_ids($mysqli, $gameId) {
  $stmt = $mysqli->prepare("
    SELECT player_id FROM mp_game_players
    WHERE game_id = ? AND is_ghost = 0 AND game_over_reason IS NULL
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $ids = [];
  while ($r = $res->fetch_assoc()) $ids[] = (int) $r['player_id'];
  $stmt->close();
  return $ids;
}

/**
 * Opportunistic review-phase advancement, mirroring mp_maybe_resolve_year.
 * Called from polls and after a player marks themselves ready. If every live
 * player is ready for the current manuscript, advance the review_index; once
 * past the last manuscript, finish the round (resolve outcomes + advance year).
 *
 * Idempotent under concurrent calls (locks the game row).
 */
function mp_maybe_advance_review($mysqli, $gameId) {
  $mysqli->begin_transaction();
  try {
    $stmt = $mysqli->prepare("SELECT * FROM mp_games WHERE game_id = ? FOR UPDATE");
    $stmt->bind_param('i', $gameId);
    $stmt->execute();
    $game = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$game || $game['status'] !== 'active' || ($game['phase'] ?? 'action') !== 'review') {
      $mysqli->commit();
      return false;
    }

    $subIds = mp_review_submission_ids($mysqli, $gameId);
    $index  = (int) $game['review_index'];

    // If the index has run past the available manuscripts (e.g. all resolved),
    // proceed to the conference step (or finish) defensively.
    if ($index >= count($subIds)) {
      // Review now runs LAST in the round, so finishing it finishes the round.
      mp_finish_round_tail($mysqli, $gameId, $game);
      $mysqli->commit();
      return true;
    }

    $currentSid = $subIds[$index];

    // The writer of the current manuscript is auto-ready — they only view their
    // own work, they don't vote or confirm. Mark them ready idempotently so the
    // barrier waits only on the reviewers.
    $wstmt = $mysqli->prepare("SELECT writer_player_id FROM mp_submissions WHERE submission_id = ?");
    $wstmt->bind_param('i', $currentSid);
    $wstmt->execute();
    $wrow = $wstmt->get_result()->fetch_assoc();
    $wstmt->close();
    if ($wrow) {
      $wid = (int) $wrow['writer_player_id'];
      $ins = $mysqli->prepare("INSERT INTO mp_review_progress (submission_id, player_id, ready) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE ready = 1");
      $ins->bind_param('ii', $currentSid, $wid);
      $ins->execute(); $ins->close();
    }

    $live = mp_live_player_ids($mysqli, $gameId);

    // How many live players are ready for the current manuscript?
    $stmt = $mysqli->prepare("SELECT player_id FROM mp_review_progress WHERE submission_id = ?");
    $stmt->bind_param('i', $currentSid);
    $stmt->execute();
    $res = $stmt->get_result();
    $ready = [];
    while ($r = $res->fetch_assoc()) $ready[(int) $r['player_id']] = true;
    $stmt->close();

    $allReady = true;
    foreach ($live as $lpid) {
      if (!isset($ready[$lpid])) { $allReady = false; break; }
    }
    if (!$allReady) {
      // Barrier not met — nothing to do.
      $mysqli->commit();
      return false;
    }

    // Advance to the next manuscript, or move on (conference / finish) if last.
    $nextIndex = $index + 1;
    if ($nextIndex >= count($subIds)) {
      // Review now runs LAST in the round, so finishing it finishes the round.
      mp_finish_round_tail($mysqli, $gameId, $game);
    } else {
      $stmt = $mysqli->prepare("
        UPDATE mp_games SET review_index = ?, state_version = state_version + 1 WHERE game_id = ?
      ");
      $stmt->bind_param('ii', $nextIndex, $gameId);
      $stmt->execute();
      $stmt->close();
      mp_log_event($mysqli, $gameId, null, 'review_advanced', ['index' => $nextIndex]);
    }

    $mysqli->commit();
    return true;
  } catch (Exception $e) {
    $mysqli->rollback();
    mp_log_event($mysqli, $gameId, null, 'advance_review_failed', ['error' => $e->getMessage()]);
    return false;
  }
}

/**
 * Finish a round: tally all pending manuscript outcomes (majority vote), then
 * advance the year (or end the game), reset per-player action state, and return
 * the game to the 'action' phase. Assumes the caller holds the game-row lock
 * and a transaction; does NOT commit. Reused by the no-manuscript path of
 * mp_maybe_resolve_year and the final barrier of mp_maybe_advance_review.
 */
function mp_finish_round_tail($mysqli, $gameId, $game) {
  // ----- Tally manuscript outcomes (majority; ties → revise) -----
  mp_resolve_submission_outcomes($mysqli, $gameId, (int) $game['current_year']);

  // ----- Advance year + apply stage gates -----
  // The game length is per-game (short=10, medium=18, long=25). The career
  // gate rounds below stay fixed (comps at 5 → year-6 gate, tenure at 12 →
  // year-13 gate); only the end-of-game round scales with the mode.
  $totalYears = (int) ($game['total_years'] ?? 15);
  $newYear = (int) $game['current_year'] + 1;

  if ($newYear > $totalYears) {
    // The game would end now. But if any LIVE writer still has an outstanding
    // response to a manuscript resolved this final round — a Revise & Resubmit
    // decision, or a peer rejection they could still contest with objection
    // tokens — we must NOT end yet. In a normal year that response happens
    // "next year"; on the final year there is no next year, so the writer was
    // silently denied their reply and the outcome stood. Instead, hold the
    // game open in an 'aftermath' phase. mp_maybe_finish_aftermath finalizes
    // it once no live writer is still blocking.
    if (mp_game_has_open_responses($mysqli, $gameId)) {
      mp_enter_aftermath_phase($mysqli, $gameId);
    } else {
      mp_finalize_game($mysqli, $gameId, $totalYears);
    }
  } else {
    // No mid-career deadlines — careers never end early (only at retirement).

    // Reset pending actions, anchor new year
    $stmt = $mysqli->prepare("
      UPDATE mp_game_players
      SET pending_action = NULL,
          pending_action_data = NULL,
          pending_action_committed = 0
      WHERE game_id = ?
    ");
    $stmt->bind_param('i', $gameId);
    $stmt->execute();
    $stmt->close();

    // Advance the year and return to the action phase.
    $stmt = $mysqli->prepare("
      UPDATE mp_games
      SET current_year = ?,
          year_started_at = NOW(),
          phase = 'action',
          review_index = 0
      WHERE game_id = ?
    ");
    $stmt->bind_param('ii', $newYear, $gameId);
    $stmt->execute();
    $stmt->close();

    // Upgrades are earned per-publication and per-conference now (see
    // mp_apply_approval and mp_finish_conference) — there is no longer a
    // regular every-third-year drip.

    // Per-player stage progression — promotions advance the rank (no bonus
    // upgrade; upgrades come only from publishing and conferences).
    mp_apply_stage_progression($mysqli, $gameId, $newYear);

    mp_log_event($mysqli, $gameId, null, 'year_advanced', ['new_year' => $newYear]);
  }

  // Bump state version once for the whole resolution batch.
  $stmt = $mysqli->prepare("UPDATE mp_games SET state_version = state_version + 1 WHERE game_id = ?");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $stmt->close();
}


// ============================================================================
// Aftermath phase (final-year writer-response window)
// ============================================================================

/**
 * End the game for good: mark every remaining player game-over ('retired'
 * unless already failed/denied), flip the game to 'ended', apply end-of-game
 * renown bonuses, and bump the state version. Assumes the caller holds the
 * game-row lock and an open transaction; does NOT commit.
 */
function mp_finalize_game($mysqli, $gameId, $finalYear = null) {
  $stmt = $mysqli->prepare("
    UPDATE mp_game_players
    SET game_over_reason = COALESCE(game_over_reason, 'retired')
    WHERE game_id = ?
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $stmt->close();

  $stmt = $mysqli->prepare("
    UPDATE mp_games SET status = 'ended', phase = 'action', review_index = 0, ended_at = NOW() WHERE game_id = ?
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $stmt->close();

  // End-of-game renown bonuses (citations × renown) inside the same transaction.
  mp_apply_renown_bonuses($mysqli, $gameId);

  mp_log_event($mysqli, $gameId, null, 'game_ended', ['final_year' => $finalYear]);

  $stmt = $mysqli->prepare("UPDATE mp_games SET state_version = state_version + 1 WHERE game_id = ?");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $stmt->close();
}

/**
 * Does any LIVE writer still have a manuscript awaiting their response?
 * Open response = a revise-pending decision, OR a peer rejection ('rejected')
 * they could still contest (they hold >=2 objection tokens). Auto-rejections
 * and already-spent objections (objection-lost) are NOT contestable.
 */
function mp_game_has_open_responses($mysqli, $gameId) {
  $stmt = $mysqli->prepare("
    SELECT COUNT(*) AS n
    FROM mp_submissions s
    JOIN mp_game_players p ON p.player_id = s.writer_player_id
    WHERE s.game_id = ?
      AND p.game_over_reason IS NULL AND p.is_ghost = 0
      AND (
        s.status = 'revise-pending'
        OR (s.status = 'rejected' AND p.objection_tokens_remaining >= 2)
      )
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $n = (int) $stmt->get_result()->fetch_assoc()['n'];
  $stmt->close();
  return $n > 0;
}

/**
 * How many live writers are still BLOCKING finalization: they have an open
 * response (above) AND haven't signed off (aftermath_ready = 0). When this hits
 * zero, the game can finalize.
 */
function mp_aftermath_blocking_count($mysqli, $gameId) {
  $stmt = $mysqli->prepare("
    SELECT COUNT(DISTINCT p.player_id) AS n
    FROM mp_game_players p
    JOIN mp_submissions s ON s.writer_player_id = p.player_id
    WHERE p.game_id = ?
      AND p.game_over_reason IS NULL AND p.is_ghost = 0
      AND p.aftermath_ready = 0
      AND (
        s.status = 'revise-pending'
        OR (s.status = 'rejected' AND p.objection_tokens_remaining >= 2)
      )
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $n = (int) $stmt->get_result()->fetch_assoc()['n'];
  $stmt->close();
  return $n;
}

/**
 * Hold the game open for final writer responses. Resets every player's
 * aftermath_ready flag and flips the phase to 'aftermath' (status stays
 * 'active'; the year is NOT advanced). Assumes the caller holds the game-row
 * lock and an open transaction.
 */
function mp_enter_aftermath_phase($mysqli, $gameId) {
  $stmt = $mysqli->prepare("UPDATE mp_game_players SET aftermath_ready = 0 WHERE game_id = ?");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $stmt->close();

  $stmt = $mysqli->prepare("UPDATE mp_games SET phase = 'aftermath', review_index = 0 WHERE game_id = ?");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $stmt->close();

  mp_log_event($mysqli, $gameId, null, 'aftermath_entered', []);
}

/**
 * Poll-time advancer for the aftermath phase: once no live writer is still
 * blocking (everyone has resolved or signed off), finalize the game. Opens its
 * own transaction + lock (mirrors mp_maybe_advance_review / _finish_conference).
 */
function mp_maybe_finish_aftermath($mysqli, $gameId) {
  $mysqli->begin_transaction();
  try {
    $stmt = $mysqli->prepare("SELECT * FROM mp_games WHERE game_id = ? FOR UPDATE");
    $stmt->bind_param('i', $gameId);
    $stmt->execute();
    $game = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$game || $game['status'] !== 'active' || ($game['phase'] ?? 'action') !== 'aftermath') {
      $mysqli->commit();
      return false;
    }

    if (mp_aftermath_blocking_count($mysqli, $gameId) === 0) {
      mp_finalize_game($mysqli, $gameId, (int) $game['current_year']);
      $mysqli->commit();
      return true;
    }

    $mysqli->commit();
    return false;
  } catch (Exception $e) {
    $mysqli->rollback();
    mp_log_event($mysqli, $gameId, null, 'aftermath_finish_failed', ['error' => $e->getMessage()]);
    return false;
  }
}


// ============================================================================
// Conference phase (Attend a Conference interstitial)
// ============================================================================

// Reputation → citation tokens granted, and fresh cards injected into the pool.
function mp_conf_citation_grant($repLevel) { $t = [1, 2, 3, 6]; return $t[max(0, min(3, $repLevel - 1))]; }

/** Count live players who committed Attend a Conference this round. */
function mp_count_conference_attendees($mysqli, $gameId) {
  $stmt = $mysqli->prepare("
    SELECT COUNT(*) AS n FROM mp_game_players
    WHERE game_id = ? AND pending_action = 'attend_conference'
      AND game_over_reason IS NULL AND is_ghost = 0
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $n = (int) $stmt->get_result()->fetch_assoc()['n'];
  $stmt->close();
  return $n;
}

/**
 * Build the conference: gather attendees in pick order (reputation desc, then
 * renown desc, then least prestige), build the card pool from their contributed
 * cards plus reputation fresh cards, and flip to the 'conference' phase.
 */
function mp_enter_conference_phase($mysqli, $gameId) {
  $stmt = $mysqli->prepare("
    SELECT player_id, pending_action_data, reputation_level, renown_level, prestige
    FROM mp_game_players
    WHERE game_id = ? AND pending_action = 'attend_conference'
      AND game_over_reason IS NULL AND is_ghost = 0
    ORDER BY reputation_level DESC, renown_level DESC, prestige ASC, player_id ASC
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $attendees = [];
  while ($r = $res->fetch_assoc()) $attendees[] = $r;
  $stmt->close();
  if (count($attendees) === 0) return false;

  $year   = (int) mp_current_year($mysqli, $gameId);
  $order  = 0;

  // Every attendee's staged cards go into the pool, and each takes back as many
  // as they contributed. Rank does not enter into either number — see the fresh
  // draw below.
  $firstPid = null;

  foreach ($attendees as $a) {
    $pid      = (int) $a['player_id'];
    $data     = $a['pending_action_data'] ? json_decode($a['pending_action_data'], true) : null;
    $slot     = (is_array($data) && isset($data['projectId'])) ? (int) $data['projectId'] : 0;

    // Contributed cards = the staged project slot's evidence.
    $cstmt = $mysqli->prepare("SELECT evidence_card_ids FROM mp_projects WHERE player_id = ? AND slot_index = ?");
    $cstmt->bind_param('ii', $pid, $slot);
    $cstmt->execute();
    $prow = $cstmt->get_result()->fetch_assoc();
    $cstmt->close();
    $contrib = ($prow && $prow['evidence_card_ids']) ? (json_decode($prow['evidence_card_ids'], true) ?: []) : [];
    $contrib = array_map('intval', $contrib);

    $takeLimit = count($contrib);
    if ($firstPid === null) $firstPid = $pid;

    // Clear the staged slot — the cards now live in the pool.
    $u = $mysqli->prepare("UPDATE mp_projects SET conclusion_card_id = NULL, evidence_card_ids = NULL WHERE player_id = ? AND slot_index = ?");
    $u->bind_param('ii', $pid, $slot);
    $u->execute(); $u->close();

    // Attendee row (fixes pick order + take limit).
    $ai = $mysqli->prepare("INSERT INTO mp_conference_attendees (game_id, player_id, take_limit, draft_order) VALUES (?, ?, ?, ?)");
    $ai->bind_param('iiii', $gameId, $pid, $takeLimit, $order);
    $ai->execute(); $ai->close();
    $order++;

    // Contributed cards go into the pool, ALWAYS tagged with who brought them.
    //
    // A lone attendee's cards used to go in untagged, so they could draft their
    // own back — there being nobody else to trade with. That can't stand now:
    // the contribution step derives its progress from the count of untagged
    // pool rows (they mark what the ARCHIVE supplied), so untagged staged cards
    // read as archive contributions. A single attendee staging three cards
    // would show 3 of 2 already contributed and skip the step entirely, never
    // getting to pick.
    //
    // Reclaiming your own is now allowed by attendee count instead, in
    // mp_conference_take — a rule about the table rather than about the data.
    foreach ($contrib as $cid) {
      $pi = $mysqli->prepare("INSERT INTO mp_conference_pool (game_id, idCard, contributor_player_id) VALUES (?, ?, ?)");
      $pi->bind_param('iii', $gameId, $cid, $pid);
      $pi->execute(); $pi->close();
    }
  }

  // The archive's two-per-attendee contribution is NOT drawn here any more.
  // Attendees choose it themselves, in turn, off the four face-up piles — see
  // mp_conference_contrib_state and mp_conferenceContribute.php. Drafting is
  // gated until that step finishes.
  //
  // Two per attendee is still what makes the rest hold together. Take limits
  // equal contributions, so every contributed card can be drafted away and the
  // leftovers ARE the archive's share — and leftovers become conference papers,
  // one per attendee. 2n leftovers for n attendees means nobody who attends
  // goes home without one, at any table size, with no floor or special case.
  //
  // (This is also why the rank bonus can't return to take limits: demand would
  // become sumContrib + sumBonus against a pool of sumContrib + 2n, and five
  // rank-4 players would be owed 20 bonus keeps from 10 fresh cards.)

  $u = $mysqli->prepare("UPDATE mp_games SET phase = 'conference', state_version = state_version + 1 WHERE game_id = ?");
  $u->bind_param('i', $gameId);
  $u->execute(); $u->close();
  mp_log_event($mysqli, $gameId, null, 'conference_started', ['attendees' => count($attendees)]);
  return true;
}

/** The attendee whose turn it is to draft (lowest draft_order, not done), or null. */
/**
 * How many cards each attendee adds to the pool off the face-up piles.
 * The archive's share of the floor, chosen rather than dealt.
 */
if (!defined('MP_CONF_CONTRIB_PER_ATTENDEE')) define('MP_CONF_CONTRIB_PER_ATTENDEE', 2);

/**
 * Prestige paid to the reviewer whose Revise & Resubmit carried the vote.
 * Revising is the most demanding verdict — it requires saying which specific
 * cards don't belong — and it paid nothing, so approving was strictly cheaper.
 */
if (!defined('MP_REVISE_REVIEWER_PRESTIGE')) define('MP_REVISE_REVIEWER_PRESTIGE', 5);

/**
 * Where the contribution step has got to.
 *
 * Progress is DERIVED rather than stored: a pool row with a NULL contributor
 * is one the archive supplied, and every attendee adds exactly the same number
 * in draft order. So the count of those rows says both how far along we are and
 * whose turn it is — no column, and nothing that can drift out of step with the
 * pool it describes.
 *
 * Returns ['done', 'contributed', 'needed', 'per', 'current' => attendee|null].
 */
function mp_conference_contrib_state($mysqli, $gameId) {
  $stmt = $mysqli->prepare("
    SELECT a.player_id, a.draft_order, p.player_name
    FROM mp_conference_attendees a
    JOIN mp_game_players p ON p.player_id = a.player_id
    WHERE a.game_id = ?
    ORDER BY a.draft_order ASC
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $attendees = [];
  while ($r = $res->fetch_assoc()) $attendees[] = $r;
  $stmt->close();

  $per    = MP_CONF_CONTRIB_PER_ATTENDEE;
  $needed = $per * count($attendees);

  $stmt = $mysqli->prepare("
    SELECT COUNT(*) AS n FROM mp_conference_pool
    WHERE game_id = ? AND contributor_player_id IS NULL
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $contributed = (int) $stmt->get_result()->fetch_assoc()['n'];
  $stmt->close();

  // If the archive and the discards are both empty there is nothing left to
  // contribute, and holding the phase open would wedge the round. Treat the
  // step as finished and let the draft run on whatever made it into the pool.
  $exhausted = false;
  if ($contributed < $needed) {
    $exhausted = (mp_conference_cards_available($mysqli, $gameId) === 0);
  }

  $done = ($contributed >= $needed) || $exhausted;
  $idx  = intdiv($contributed, $per);
  $current = (!$done && isset($attendees[$idx])) ? $attendees[$idx] : null;

  return [
    'done'        => $done,
    'contributed' => $contributed,
    'needed'      => $needed,
    'per'         => $per,
    'current'     => $current,
    'attendees'   => $attendees,
  ];
}

/** Cards still reachable for the conference: undrawn archive, else discards. */
function mp_conference_cards_available($mysqli, $gameId) {
  $stmt = $mysqli->prepare("
    SELECT COUNT(*) AS n FROM mp_game_archive
    WHERE game_id = ? AND drawn_by_player_id IS NULL
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $n = (int) $stmt->get_result()->fetch_assoc()['n'];
  $stmt->close();
  if ($n > 0) return $n;
  return mp_reshuffle_discards_into_archive($mysqli, $gameId);
}

function mp_conference_current_picker($mysqli, $gameId) {
  // Nobody drafts until the floor is stocked — otherwise the first player would
  // pick over a pool the later attendees haven't contributed to yet.
  $contrib = mp_conference_contrib_state($mysqli, $gameId);
  if (!$contrib['done']) return null;

  $stmt = $mysqli->prepare("
    SELECT player_id, take_limit, taken_count, draft_order
    FROM mp_conference_attendees
    WHERE game_id = ? AND done = 0
    ORDER BY draft_order ASC LIMIT 1
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  return $row ?: null;
}

/**
 * The calling attendee drafts the given pool cards (up to their take limit).
 * Validates it's their turn and the cards are eligible (available, not their
 * own). Marks them done afterward. Assumes a transaction + game-row lock held.
 */
function mp_conference_take($mysqli, $gameId, $playerId, $poolIds) {
  // Skip any attendees who dropped out so the turn can't wedge.
  mp_conference_skip_dead($mysqli, $gameId);

  $picker = mp_conference_current_picker($mysqli, $gameId);
  if (!$picker || (int) $picker['player_id'] !== (int) $playerId) {
    throw new Exception('It is not your turn to draft');
  }
  $takeLimit = (int) $picker['take_limit'];
  $poolIds = array_values(array_unique(array_map('intval', (array) $poolIds)));
  if (count($poolIds) > $takeLimit) {
    throw new Exception('You may take at most ' . $takeLimit . ' card(s)');
  }

  $year = (int) mp_current_year($mysqli, $gameId);
  $taken = 0;
  foreach ($poolIds as $poolId) {
    $stmt = $mysqli->prepare("SELECT idCard, contributor_player_id, taken_by_player_id FROM mp_conference_pool WHERE pool_id = ? AND game_id = ? FOR UPDATE");
    $stmt->bind_param('ii', $poolId, $gameId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$row) continue;
    if ($row['taken_by_player_id'] !== null) continue;  // already taken
    // Anyone may draft any untaken card, including one they contributed.
    //
    // The old rule blocked reclaiming your own, on the grounds that a
    // conference should be a trade. But a player takes only as many as they
    // brought, so taking your own back nets to keeping what you had — there is
    // nothing to exploit, and the rule mostly punished bringing a card you
    // actually needed. The choice of what to offer stays interesting because
    // someone else may take it first.
    $cid = (int) $row['idCard'];
    $u = $mysqli->prepare("UPDATE mp_conference_pool SET taken_by_player_id = ? WHERE pool_id = ?");
    $u->bind_param('ii', $playerId, $poolId); $u->execute(); $u->close();
    $h = $mysqli->prepare("INSERT IGNORE INTO mp_player_hands (player_id, idCard, added_year) VALUES (?, ?, ?)");
    $h->bind_param('iii', $playerId, $cid, $year); $h->execute(); $h->close();
    $a = $mysqli->prepare("UPDATE mp_game_archive SET drawn_by_player_id = ?, drawn_year = ? WHERE game_id = ? AND idCard = ?");
    $a->bind_param('iiii', $playerId, $year, $gameId, $cid); $a->execute(); $a->close();
    $taken++;
  }

  $u = $mysqli->prepare("UPDATE mp_conference_attendees SET taken_count = ?, done = 1 WHERE game_id = ? AND player_id = ?");
  $u->bind_param('iii', $taken, $gameId, $playerId); $u->execute(); $u->close();
  mp_log_event($mysqli, $gameId, $playerId, 'conference_drafted', ['taken' => $taken]);
}

/** Mark any attendee who is no longer live as done (so they don't block the draft). */
function mp_conference_skip_dead($mysqli, $gameId) {
  $stmt = $mysqli->prepare("
    UPDATE mp_conference_attendees a
    JOIN mp_game_players p ON p.player_id = a.player_id
    SET a.done = 1
    WHERE a.game_id = ? AND a.done = 0 AND (p.game_over_reason IS NOT NULL OR p.is_ghost = 1)
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $stmt->close();
}

/**
 * Opportunistic conference advance: if every attendee has drafted (or dropped
 * out), grant citations, clear the pool, and finish the round. Mirrors
 * mp_maybe_advance_review. Idempotent under concurrent calls (locks the game).
 */
function mp_maybe_finish_conference($mysqli, $gameId) {
  $mysqli->begin_transaction();
  try {
    $stmt = $mysqli->prepare("SELECT * FROM mp_games WHERE game_id = ? FOR UPDATE");
    $stmt->bind_param('i', $gameId);
    $stmt->execute();
    $game = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$game || $game['status'] !== 'active' || ($game['phase'] ?? 'action') !== 'conference') {
      $mysqli->commit();
      return false;
    }

    mp_conference_skip_dead($mysqli, $gameId);

    // The floor has to be stocked before we can read anything into an empty
    // picker slot. mp_conference_current_picker returns null during the
    // contribution step BY DESIGN — nobody drafts until every attendee has
    // added their cards — and this function treats a null picker as "everyone
    // has drafted". Without this guard the conference would finish instantly,
    // before a single card was contributed or taken.
    if (!mp_conference_contrib_state($mysqli, $gameId)['done']) {
      $mysqli->commit();
      return false;
    }

    if (mp_conference_current_picker($mysqli, $gameId)) {
      // Someone is still drafting.
      $mysqli->commit();
      return false;
    }

    mp_finish_conference($mysqli, $gameId, $game);
    $mysqli->commit();
    return true;
  } catch (Exception $e) {
    $mysqli->rollback();
    mp_log_event($mysqli, $gameId, null, 'finish_conference_failed', ['error' => $e->getMessage()]);
    return false;
  }
}

/**
 * Finish the conference: grant each attendee their reputation citations, dispose
 * of untaken pool cards, clear the conference tables, then finish the round.
 */
function mp_finish_conference($mysqli, $gameId, $game) {
  $year = (int) $game['current_year'];

  // Grant citation tokens = reputation level value.
  $stmt = $mysqli->prepare("
    SELECT a.player_id, p.reputation_level
    FROM mp_conference_attendees a
    JOIN mp_game_players p ON p.player_id = a.player_id
    WHERE a.game_id = ?
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $rows = [];
  while ($r = $res->fetch_assoc()) $rows[] = $r;
  $stmt->close();
  $attendeeIds = [];
  foreach ($rows as $r) {
    $pid = (int) $r['player_id'];
    $attendeeIds[] = $pid;
    // Citation tokens = reputation level value.
    $grant = mp_conf_citation_grant(max(1, min(4, (int) $r['reputation_level'])));
    $u = $mysqli->prepare("UPDATE mp_game_players SET citations_received_count = citations_received_count + ? WHERE player_id = ?");
    $u->bind_param('ii', $grant, $pid); $u->execute(); $u->close();
    mp_log_event($mysqli, $gameId, $pid, 'conference_citations', ['citations' => $grant]);

    // Attending a conference grants one stat upgrade (reason 'conference').
    $uu = $mysqli->prepare("UPDATE mp_game_players SET pending_upgrade = pending_upgrade + 1, pending_upgrade_reason = 'conference' WHERE player_id = ?");
    $uu->bind_param('i', $pid); $uu->execute(); $uu->close();
  }

  // Read the untaken (leftover) pool cards.
  $stmt = $mysqli->prepare("SELECT idCard, contributor_player_id FROM mp_conference_pool WHERE game_id = ? AND taken_by_player_id IS NULL");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $left = [];
  while ($r = $res->fetch_assoc()) $left[] = $r;
  $stmt->close();

  // Conference publications: award each attendee ONE random leftover card as a
  // single-evidence "conference paper" on their bookshelf. Each leftover is
  // awarded to at most one attendee (they're physical cards); if there are more
  // attendees than leftovers, the extras get none. The card is still disposed
  // below (the publication is a snapshot) — see mp_award_conference_paper.
  $shuffled = $left;
  // Seed mode: make the leftover-award order reproducible per (seed, year).
  $confSeed = mp_game_seed($mysqli, $gameId);
  if ($confSeed !== '') {
    mt_srand(crc32($confSeed . '|conf|' . $year));
  }
  shuffle($shuffled);
  $i = 0;
  foreach ($attendeeIds as $pid) {
    if ($i >= count($shuffled)) break;
    mp_award_conference_paper($mysqli, $gameId, $pid, (int) $shuffled[$i]['idCard'], $year);
    $i++;
  }

  // Dispose of untaken pool cards: contributed → contributor's discard; fresh →
  // back to the draw pile.
  foreach ($left as $r) {
    $cid = (int) $r['idCard'];
    if ($r['contributor_player_id'] !== null) {
      $cp = (int) $r['contributor_player_id'];
      $d = $mysqli->prepare("INSERT IGNORE INTO mp_player_discards (player_id, idCard, discarded_year) VALUES (?, ?, ?)");
      $d->bind_param('iii', $cp, $cid, $year); $d->execute(); $d->close();
    } else {
      $a = $mysqli->prepare("UPDATE mp_game_archive SET drawn_by_player_id = NULL, drawn_year = NULL WHERE game_id = ? AND idCard = ?");
      $a->bind_param('ii', $gameId, $cid); $a->execute(); $a->close();
    }
  }

  // Clear conference state.
  foreach (['mp_conference_pool', 'mp_conference_attendees'] as $tbl) {
    $d = $mysqli->prepare("DELETE FROM $tbl WHERE game_id = ?");
    $d->bind_param('i', $gameId); $d->execute(); $d->close();
  }

  mp_log_event($mysqli, $gameId, null, 'conference_ended', []);

  // Conference done → review any manuscripts, then finish the round.
  mp_after_conference_step($mysqli, $gameId, $game);
}


/**
 * Award one leftover conference card to a player as a "conference paper"
 * published work. The owner earns NO prestige from it, but it is citable by
 * opponents: citing it adds the card's bonus prestige to the citer's article
 * and mints the owner a citation token (same machinery as citing an article or
 * book — see mp_apply_approval). It does NOT count toward article/book totals.
 *
 * The publication is a snapshot, so the physical card is still disposed by the
 * caller's normal leftover-disposal loop.
 */
function mp_award_conference_paper($mysqli, $gameId, $playerId, $idCard, $year) {
  $card = mp_fetch_card_row($mysqli, $idCard);
  if (!$card) return;

  // First argument tag drives citation tag-matching (like a conclusion tag).
  $tag = '';
  foreach (array_map('trim', explode(',', (string) ($card['argument'] ?? ''))) as $t) {
    if ($t !== '') { $tag = $t; break; }
  }

  // Full tag list for the snapshot chip.
  $tags = [];
  foreach (['argument', 'sub_argument'] as $f) {
    foreach (array_map('trim', explode(',', (string) ($card[$f] ?? ''))) as $t) {
      if ($t !== '') $tags[] = $t;
    }
  }

  $snapshot = [[
    'kind'         => 'card',
    'idCard'       => (int) $card['idCard'],
    'title'        => $card['title'] ?? '',
    'author'       => $card['author'] ?? '',
    'tags'         => array_values(array_unique($tags)),
    'date'         => $card['date'] ?? '',
    'content'      => $card['content'] ?? '',
    'significance' => $card['significance'] ?? '',
    'citation'     => $card['citation'] ?? '',
  ]];

  $submissionId  = null;                                   // no submission
  $title         = (string) ($card['title'] ?? 'Conference paper');
  $concCardId    = (int) $card['idCard'];                  // itself, for the title JOIN
  $kind          = 'conference';
  $evCount       = 1;
  $snapJson      = json_encode($snapshot);
  // The attendee earns the card's bonus prestige for the paper, and the same
  // figure is what an opponent citing it pays out. Presenting at a conference
  // is a publication, so it scores like one.
  // A conference paper cites nothing, so it takes the ladder's first rung
  // (and a plain numeric bonus is unaffected either way).
  $bonus         = isset($card['bonus']) ? mp_bonus_at($card['bonus'], 0) : 0;
  $prestige      = $bonus;
  $citationValue = $bonus;

  // Best-effort: if the schema hasn't been migrated yet (kind enum / nullable
  // submission_id — see database/30_conference_publications.sql), skip the award
  // rather than aborting the whole conference resolution. A single failed INSERT
  // rolls back only itself, so the conference still finishes normally.
  try {
    $stmt = $mysqli->prepare("
      INSERT INTO mp_published_works
        (game_id, submission_id, writer_player_id, publication_title,
         conclusion_card_id, conclusion_tag, kind, evidence_count,
         evidence_snapshot, prestige_granted, citation_value, year_published)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->bind_param('iiisissisiii', $gameId, $submissionId, $playerId, $title,
      $concCardId, $tag, $kind, $evCount, $snapJson, $prestige, $citationValue, $year);
    $stmt->execute();
    $stmt->close();

    // prestige_granted on the work is only a record of what the paper was
    // worth; the player's running score is a separate column and has to be
    // moved explicitly, or the paper shows a value nobody ever banked.
    if ($prestige > 0) {
      $bump = $mysqli->prepare("
        UPDATE mp_game_players SET prestige = prestige + ? WHERE player_id = ?
      ");
      $bump->bind_param('ii', $prestige, $playerId);
      $bump->execute();
      $bump->close();
    }

    mp_log_event($mysqli, $gameId, $playerId, 'conference_paper_awarded', [
      'idCard'         => $concCardId,
      'title'          => $title,
      'prestige'       => $prestige,
      'citation_value' => $citationValue,
    ]);
  } catch (Exception $e) {
    mp_log_event($mysqli, $gameId, $playerId, 'conference_paper_award_failed', [
      'idCard' => $concCardId,
      'error'  => $e->getMessage(),
    ]);
  }
}


/**
 * Returns true if there's at least one submission in this game that's
 * pending and was submitted on a year before the current year (meaning
 * it's reviewable this year).
 */
function mp_has_reviewable_submission($mysqli, $gameId) {
  $stmt = $mysqli->prepare("
    SELECT s.submission_id
    FROM mp_submissions s
    JOIN mp_games g ON g.game_id = s.game_id
    WHERE s.game_id = ? AND s.status = 'pending' AND s.year_submitted < g.current_year
    LIMIT 1
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $found = $res->fetch_assoc();
  $stmt->close();
  return $found !== null;
}


// ============================================================================
// Draw phase (synchronous interstitial)
//
// The archive is dealt into ARCHIVE_PILES piles derived from archive_position
// (position % 4), so no extra column is needed. Each pile's "top" is its lowest
// undrawn position. Players who chose 'draw' take one card at a time in
// round-robin seat order until their allowance is spent.
// ============================================================================

const MP_ARCHIVE_PILES = 4;

/**
 * Give a player their draw allowance for this round (research stat, capped by
 * notebook room). The cards themselves are taken during the draw phase.
 */
function mp_seed_draw_allowance($mysqli, $gameId, $player) {
  $pid = (int) $player['player_id'];
  $researchLevel = (int) $player['research_level'];
  $notebookLevel = (int) $player['notebook_level'];

  // Lookup tables mirrored from frontend/src/lib/mpStats.js — keep in sync.
  $researchTable    = [3, 5, 7, 'capacity'];
  $notebookCapTable = [7, 9, 11, 15];
  $capacity = $notebookCapTable[max(0, min(3, $notebookLevel - 1))];
  $drawRaw  = $researchTable[max(0, min(3, $researchLevel - 1))];
  $drawCount = $drawRaw === 'capacity' ? $capacity : $drawRaw;

  $stmt = $mysqli->prepare("SELECT COUNT(*) AS n FROM mp_player_hands WHERE player_id = ?");
  $stmt->bind_param('i', $pid);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  $allowance = max(0, min($drawCount, $capacity - (int) $row['n']));

  $u = $mysqli->prepare("UPDATE mp_game_players SET draws_remaining = ?, draws_taken = 0 WHERE player_id = ?");
  $u->bind_param('ii', $allowance, $pid);
  $u->execute();
  $u->close();

  mp_log_event($mysqli, $gameId, $pid, 'draw_allowance', [
    'requested' => $drawCount,
    'allowance' => $allowance,
  ]);
}

/** Anyone still owed draws? */
function mp_draws_outstanding($mysqli, $gameId) {
  $stmt = $mysqli->prepare("
    SELECT COUNT(*) AS n FROM mp_game_players
    WHERE game_id = ? AND draws_remaining > 0
      AND game_over_reason IS NULL AND is_ghost = 0
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  return (int) ($row['n'] ?? 0);
}

/**
 * Whose turn is it? Round-robin: fewest cards taken so far, ties by seat. That
 * keeps it fair when players have different allowances — a research-4 player
 * simply keeps going after the others are done.
 */
function mp_draw_current_player($mysqli, $gameId) {
  $stmt = $mysqli->prepare("
    SELECT player_id, player_name, seat_index, draws_remaining, draws_taken
    FROM mp_game_players
    WHERE game_id = ? AND draws_remaining > 0
      AND game_over_reason IS NULL AND is_ghost = 0
    ORDER BY draws_taken ASC, seat_index ASC
    LIMIT 1
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  return $row ?: null;
}

/** Open the draw phase if anyone is owed cards. Returns true if we entered it. */
function mp_enter_draw_phase($mysqli, $gameId) {
  if (mp_draws_outstanding($mysqli, $gameId) === 0) return false;
  $u = $mysqli->prepare("
    UPDATE mp_games SET phase = 'draw', state_version = state_version + 1
    WHERE game_id = ?
  ");
  $u->bind_param('i', $gameId);
  $u->execute();
  $u->close();
  mp_log_event($mysqli, $gameId, null, 'draw_phase_started', []);
  return true;
}

/**
 * The top (lowest undrawn position) card of a pile, or null. Piles are
 * position % MP_ARCHIVE_PILES.
 */
function mp_draw_pile_top($mysqli, $gameId, $pile) {
  $stmt = $mysqli->prepare("
    SELECT idCard, archive_position FROM mp_game_archive
    WHERE game_id = ? AND drawn_by_player_id IS NULL
      AND (archive_position % " . MP_ARCHIVE_PILES . ") = ?
    ORDER BY archive_position ASC
    LIMIT 1
  ");
  $stmt->bind_param('ii', $gameId, $pile);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  return $row ?: null;
}

/** How many undrawn cards remain in each pile. */
function mp_draw_pile_counts($mysqli, $gameId) {
  $counts = array_fill(0, MP_ARCHIVE_PILES, 0);
  $stmt = $mysqli->prepare("
    SELECT (archive_position % " . MP_ARCHIVE_PILES . ") AS pile, COUNT(*) AS n
    FROM mp_game_archive
    WHERE game_id = ? AND drawn_by_player_id IS NULL
    GROUP BY pile
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  while ($r = $res->fetch_assoc()) {
    $counts[(int) $r['pile']] = (int) $r['n'];
  }
  $stmt->close();
  return $counts;
}

/**
 * Opportunistic draw-phase advance: once nobody is owed cards, close the phase
 * and move on. Mirrors mp_maybe_finish_conference — own lock + transaction.
 *
 * Safety valve: if the archive AND every discard pile are empty, nobody can
 * take anything, so clear the outstanding allowances rather than hang the phase.
 */
function mp_maybe_finish_draw_phase($mysqli, $gameId) {
  $mysqli->begin_transaction();
  try {
    $stmt = $mysqli->prepare("SELECT * FROM mp_games WHERE game_id = ? FOR UPDATE");
    $stmt->bind_param('i', $gameId);
    $stmt->execute();
    $game = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$game || $game['status'] !== 'active' || ($game['phase'] ?? '') !== 'draw') {
      $mysqli->rollback();
      return;
    }

    if (array_sum(mp_draw_pile_counts($mysqli, $gameId)) === 0) {
      if (mp_reshuffle_discards_into_archive($mysqli, $gameId) === 0) {
        $z = $mysqli->prepare("UPDATE mp_game_players SET draws_remaining = 0 WHERE game_id = ?");
        $z->bind_param('i', $gameId);
        $z->execute();
        $z->close();
        mp_log_event($mysqli, $gameId, null, 'draw_phase_exhausted', []);
      }
    }

    if (mp_draws_outstanding($mysqli, $gameId) > 0) {
      $mysqli->commit();
      return;   // still someone's turn
    }

    mp_log_event($mysqli, $gameId, null, 'draw_phase_ended', []);
    mp_after_draw_step($mysqli, $gameId, $game);
    $mysqli->commit();
  } catch (Exception $e) {
    $mysqli->rollback();
    mp_log_event($mysqli, $gameId, null, 'finish_draw_failed', ['error' => $e->getMessage()]);
  }
}

/**
 * After the draw phase (or when nobody drew): run the conference interstitial
 * if anyone attended, otherwise move on to review/finish.
 */
function mp_after_draw_step($mysqli, $gameId, $game) {
  if (mp_count_conference_attendees($mysqli, $gameId) > 0) {
    mp_enter_conference_phase($mysqli, $gameId);
    return;
  }
  mp_after_conference_step($mysqli, $gameId, $game);
}

/**
 * After the conference: review any manuscripts, otherwise finish the round.
 * (Review now runs LAST — the round is action → draw → conference → review.)
 */
function mp_after_conference_step($mysqli, $gameId, $game) {
  $pendingCount = mp_count_pending_submissions($mysqli, $gameId);
  if ($pendingCount > 0) {
    $stmt = $mysqli->prepare("
      UPDATE mp_games
      SET phase = 'review', review_index = 0, state_version = state_version + 1
      WHERE game_id = ?
    ");
    $stmt->bind_param('i', $gameId);
    $stmt->execute();
    $stmt->close();
    mp_log_event($mysqli, $gameId, null, 'review_phase_started', ['manuscripts' => $pendingCount]);
    return;
  }
  mp_finish_round_tail($mysqli, $gameId, $game);
}


/**
 * Reshuffle all players' discards back into the shared archive at fresh
 * positions. Returns the count of cards that ended up back in the archive.
 *
 * The reshuffle puts ALL discards back, not just one player's, mirroring
 * the design call that discards return to a shared pool.
 */
function mp_reshuffle_discards_into_archive($mysqli, $gameId) {
  // Gather all (player_id, idCard) from mp_player_discards within this game
  $stmt = $mysqli->prepare("
    SELECT d.idCard
    FROM mp_player_discards d
    JOIN mp_game_players p ON p.player_id = d.player_id
    WHERE p.game_id = ?
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $cards = [];
  while ($r = $res->fetch_assoc()) $cards[] = (int) $r['idCard'];
  $stmt->close();

  if (count($cards) === 0) return 0;

  // Shuffle the array
  $n = count($cards);
  for ($i = $n - 1; $i > 0; $i--) {
    $j = random_int(0, $i);
    $tmp = $cards[$i]; $cards[$i] = $cards[$j]; $cards[$j] = $tmp;
  }

  // Find current max archive_position so we append after it.
  $stmt = $mysqli->prepare("
    SELECT COALESCE(MAX(archive_position), -1) AS maxpos
    FROM mp_game_archive WHERE game_id = ?
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $maxpos = (int) $res->fetch_assoc()['maxpos'];
  $stmt->close();

  $nextPos = $maxpos + 1;

  // Clear the discard rows for these players.
  $stmt = $mysqli->prepare("
    DELETE d FROM mp_player_discards d
    JOIN mp_game_players p ON p.player_id = d.player_id
    WHERE p.game_id = ?
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $stmt->close();

  // Update each card's archive row: reset drawn_by, assign new position.
  // Note: a card may already exist in mp_game_archive (it's never deleted),
  // so we UPDATE rather than INSERT.
  foreach ($cards as $cid) {
    $stmt = $mysqli->prepare("
      UPDATE mp_game_archive
      SET drawn_by_player_id = NULL,
          drawn_year = NULL,
          archive_position = ?
      WHERE game_id = ? AND idCard = ?
    ");
    $stmt->bind_param('iii', $nextPos, $gameId, $cid);
    $stmt->execute();
    $stmt->close();
    $nextPos++;
  }

  mp_log_event($mysqli, $gameId, null, 'archive_reshuffled', [
    'card_count' => $n,
  ]);

  return $n;
}


/**
 * Resolve a 'publish' action — create a new mp_submissions row in 'pending'
 * status. Cards bind to the submission immediately, leaving the project
 * empty for new work.
 *
 * Lifecycle:
 *   - On submission: project slot empties, evidence + conclusion live in
 *     mp_submissions.evidence_card_ids and conclusion_card_id only.
 *   - On approve: evidence moves to discard, snapshot to mp_published_works.
 *   - On reject: cards stay bound to the submission row; writer can claim
 *     them back later via mp_reclaimManuscript.php.
 */
function mp_resolve_publish($mysqli, $gameId, $player, $data) {
  $pid = (int) $player['player_id'];
  if (!$data) {
    mp_log_event($mysqli, $gameId, $pid, 'action_resolved_publish_skipped', [
      'reason' => 'no_data',
    ]);
    return;
  }
  $projectId = isset($data['projectId']) ? (int) $data['projectId'] : -1;
  $argument  = isset($data['argumentText']) ? (string) $data['argumentText'] : '';

  if ($projectId < 0 || $projectId > 2) {
    mp_log_event($mysqli, $gameId, $pid, 'action_resolved_publish_skipped', [
      'reason' => 'invalid_projectId',
      'projectId' => $projectId,
    ]);
    return;
  }

  // Read the project's current contents.
  $stmt = $mysqli->prepare("
    SELECT conclusion_card_id, evidence_card_ids
    FROM mp_projects WHERE player_id = ? AND slot_index = ?
  ");
  $stmt->bind_param('ii', $pid, $projectId);
  $stmt->execute();
  $res = $stmt->get_result();
  $proj = $res->fetch_assoc();
  $stmt->close();
  if (!$proj || !$proj['conclusion_card_id']) {
    mp_log_event($mysqli, $gameId, $pid, 'action_resolved_publish_skipped', [
      'reason' => 'no_conclusion',
      'projectId' => $projectId,
    ]);
    return;
  }

  $concId = (int) $proj['conclusion_card_id'];
  $evIds  = $proj['evidence_card_ids'] ? json_decode($proj['evidence_card_ids'], true) : [];
  if (!is_array($evIds) || count($evIds) < 1) {
    mp_log_event($mysqli, $gameId, $pid, 'action_resolved_publish_skipped', [
      'reason' => 'no_evidence',
      'projectId' => $projectId,
    ]);
    return;
  }

  // Determine kind. Citations COUNT toward the book threshold (per design).
  // But the original-evidence-only minimum stays 1 — citation-only submissions
  // are not allowed.

  // Read the active citations for this project slot. We just need the work
  // ids — the citation's prestige bonus is read from each work's recorded
  // citation_value at approval time (mp_apply_approval).
  $citedWorkIds = [];
  $cstmt = $mysqli->prepare("
    SELECT c.cited_work_id
    FROM mp_citations c
    WHERE c.player_id = ? AND c.slot_index = ?
    ORDER BY c.added_at ASC
  ");
  $cstmt->bind_param('ii', $pid, $projectId);
  $cstmt->execute();
  $cres = $cstmt->get_result();
  while ($cr = $cres->fetch_assoc()) {
    $citedWorkIds[] = (int) $cr['cited_work_id'];
  }
  $cstmt->close();

  // Article vs book — based on the REAL evidence count only. Citations no
  // longer count as evidence; they add a flat prestige bonus instead. The
  // book threshold is a fixed constant (reputation no longer lowers it).
  $kind = (count($evIds) >= MP_BOOK_MIN) ? 'book' : 'article';

  $year = mp_current_year($mysqli, $gameId);

  // Insert submission. cited_work_ids is a JSON snapshot of the live
  // citations at submit time — the snapshot persists through review.
  $citedJson = json_encode($citedWorkIds);
  $stmt = $mysqli->prepare("
    INSERT INTO mp_submissions
      (game_id, writer_player_id, year_submitted, conclusion_card_id,
       evidence_card_ids, argument_text, kind, status, cited_work_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  ");
  $evJson = json_encode($evIds);
  $stmt->bind_param('iiiissss', $gameId, $pid, $year, $concId, $evJson, $argument, $kind, $citedJson);
  $stmt->execute();
  $sid = $mysqli->insert_id;
  $stmt->close();

  // Delete the project's live citation rows now that they're snapshotted
  // onto the submission. New citations to a new project at this slot will
  // start fresh.
  if (count($citedWorkIds) > 0) {
    $stmt = $mysqli->prepare("
      DELETE FROM mp_citations WHERE player_id = ? AND slot_index = ?
    ");
    $stmt->bind_param('ii', $pid, $projectId);
    $stmt->execute();
    $stmt->close();
  }

  // CARDS BIND TO MANUSCRIPT — empty the project slot. The cards are
  // now "in" the submission row (referenced by evidence_card_ids +
  // conclusion_card_id). They're not in hand, not in discard, not in
  // a project. They live there until approved (→ discard) or reclaimed
  // (→ back to hand, manuscript-by-manuscript via writer's choice).
  $stmt = $mysqli->prepare("
    UPDATE mp_projects
    SET conclusion_card_id = NULL, evidence_card_ids = NULL
    WHERE player_id = ? AND slot_index = ?
  ");
  $stmt->bind_param('ii', $pid, $projectId);
  $stmt->execute();
  $stmt->close();

  // Look up the conclusion title for the event log (the publication title
  // isn't picked until approval, but the conclusion's title is meaningful
  // for the action history).
  $concTitle = '';
  $stmt = $mysqli->prepare("SELECT title FROM Cards WHERE idCard = ?");
  $stmt->bind_param('i', $concId);
  $stmt->execute();
  $res = $stmt->get_result();
  $cr = $res->fetch_assoc();
  $stmt->close();
  if ($cr) $concTitle = $cr['title'];

  mp_log_event($mysqli, $gameId, $pid, 'submission_created', [
    'submission_id'    => $sid,
    'evidence_count'   => count($evIds),
    'kind'             => $kind,
    'conclusion_title' => $concTitle,
  ]);
}


/**
 * Record a reviewer's verdict in mp_reviews. The actual outcome tallying
 * happens later in mp_resolve_submission_outcomes.
 */
function mp_resolve_review_record($mysqli, $gameId, $player, $data) {
  if (!$data) return;
  $pid = (int) $player['player_id'];
  $sid = isset($data['submissionId']) ? (int) $data['submissionId'] : 0;
  $verdict = isset($data['verdict']) ? (string) $data['verdict'] : '';
  $flagged = isset($data['flaggedCardIds']) && is_array($data['flaggedCardIds']) ? $data['flaggedCardIds'] : [];
  $comment = isset($data['comment']) ? trim((string) $data['comment']) : null;
  if (!$sid || !in_array($verdict, ['approve','reject'], true)) return;

  // Reject requires at least one flag; approve has no requirement.
  if ($verdict === 'reject' && count($flagged) === 0) return;

  $year = mp_current_year($mysqli, $gameId);
  $flaggedJson = $flagged ? json_encode(array_map('intval', $flagged)) : null;

  $stmt = $mysqli->prepare("
    INSERT IGNORE INTO mp_reviews
      (submission_id, reviewer_player_id, verdict, flagged_card_ids, comment, reviewed_year)
    VALUES (?, ?, ?, ?, ?, ?)
  ");
  $stmt->bind_param('iisssi', $sid, $pid, $verdict, $flaggedJson, $comment, $year);
  $stmt->execute();
  $stmt->close();

  mp_log_event($mysqli, $gameId, $pid, 'review_recorded', [
    'submission_id'  => $sid,
    'verdict'        => $verdict,
    'flagged_count'  => count($flagged),
  ]);
}


/**
 * Look at every still-'pending' submission and decide its fate by MAJORITY
 * vote of the reviewers (ties lean to Revise & Resubmit):
 *   - approve wins → 'approved' (writer gets prestige + upgrade)
 *   - reject wins  → 'rejected'
 *   - revise wins (or any top tie) → 'revise-pending' (writer decides next year)
 *   - no verdicts at all → stays 'pending' (carries to next round)
 *
 * Runs at the end of the synchronous review phase (mp_finish_round_tail), so
 * by the time it runs every reviewer has voted on every manuscript.
 *
 * On approval, evidence cards are consumed (moved to discard), prestige is
 * awarded, the writer's upgrade flag is set, and a publication record is
 * written. On rejection, evidence stays bound for reclaim. On revise, a single
 * canonical proposal is kept and the others' locked cards are returned.
 */
function mp_resolve_submission_outcomes($mysqli, $gameId, $currentYear) {
  // $currentYear is the year that's just finished; resolved_year is set to it.

  $stmt = $mysqli->prepare("
    SELECT s.*,
      SUM(CASE WHEN r.verdict = 'approve' THEN 1 ELSE 0 END) AS approves,
      SUM(CASE WHEN r.verdict = 'reject'  THEN 1 ELSE 0 END) AS rejects,
      SUM(CASE WHEN r.verdict = 'revise'  THEN 1 ELSE 0 END) AS revises
    FROM mp_submissions s
    LEFT JOIN mp_reviews r ON r.submission_id = s.submission_id
    WHERE s.game_id = ? AND s.status = 'pending'
    GROUP BY s.submission_id
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $subs = [];
  while ($r = $res->fetch_assoc()) $subs[] = $r;
  $stmt->close();

  foreach ($subs as $s) {
    $approves = (int) $s['approves'];
    $rejects  = (int) $s['rejects'];
    $revises  = (int) $s['revises'];

    $sid     = (int) $s['submission_id'];
    $writer  = (int) $s['writer_player_id'];
    $kind    = $s['kind'];
    $evIds   = json_decode($s['evidence_card_ids'], true) ?: [];
    $citeIds = isset($s['cited_work_ids']) && $s['cited_work_ids']
                 ? (json_decode($s['cited_work_ids'], true) ?: [])
                 : [];
    $concId  = (int) $s['conclusion_card_id'];

    // A citation whose tag doesn't match the conclusion can't be published.
    $badCitation = count($citeIds) > 0
      && mp_submission_has_invalid_citation_tags($mysqli, $concId, $citeIds);

    // No verdicts at all (e.g. every reviewer ghosted) → leave pending so the
    // writer isn't auto-rejected; it'll be picked up next round.
    if ($approves === 0 && $rejects === 0 && $revises === 0) continue;

    // Majority vote across all reviewers; ties lean to Revise & Resubmit.
    $outcome = mp_majority_outcome($approves, $rejects, $revises);

    // The citation check used to run BEFORE this and auto-reject "regardless
    // of votes", discarding a Revise & Resubmit ruling entirely — the writer
    // was handed a rejection with reclaim and consolation buttons while the
    // reviewer's revision was thrown away. That is precisely backwards: a
    // mismatched citation is the textbook thing a revision fixes, and
    // reviewers can already flag cited works for removal. So a revise verdict
    // now takes precedence and the writer gets to drop the offending citation.
    //
    // It still overrides an APPROVAL, because a manuscript whose citations
    // don't hold can't go on the shelf however many people liked it.
    if ($badCitation && $outcome !== 'revise') {
      mp_apply_auto_rejection($mysqli, $gameId, $sid, $writer, 'invalid-citation', $currentYear);
      mp_return_revise_added($mysqli, $gameId, $sid, $currentYear, 0);
      continue;
    }

    if ($outcome === 'approve') {
      mp_apply_approval($mysqli, $gameId, $sid, $writer, $kind, $evIds, $citeIds, $concId, $currentYear);
      mp_return_revise_added($mysqli, $gameId, $sid, $currentYear, 0);
    } else if ($outcome === 'reject') {
      mp_apply_rejection($mysqli, $gameId, $sid, $writer, $evIds, $currentYear);
      mp_return_revise_added($mysqli, $gameId, $sid, $currentYear, 0);
    } else {
      // Revise wins. Ensure a single canonical revise proposal exists
      // (synthesizing one from a reject's flagged cards if nobody formally
      // proposed a revision), then transition to 'revise-pending' so the
      // writer decides next year via the existing ReviseDecisionDialog.
      $canonical = mp_ensure_revise_proposal($mysqli, $sid);
      if ($canonical === null) {
        // No proposal could be formed (no revise and no reject) — fall back
        // to a plain rejection rather than stranding the manuscript.
        mp_apply_rejection($mysqli, $gameId, $sid, $writer, $evIds, $currentYear);
        mp_return_revise_added($mysqli, $gameId, $sid, $currentYear, 0);
      } else {
        // Return every OTHER revise proposer's locked cards; keep the
        // canonical reviewer's locked until the writer resolves.
        mp_return_revise_added($mysqli, $gameId, $sid, $currentYear, $canonical);
        $u = $mysqli->prepare("UPDATE mp_submissions SET status = 'revise-pending', resolved_year = ? WHERE submission_id = ?");
        $u->bind_param('ii', $currentYear, $sid);
        $u->execute();
        $u->close();

        // The reviewer whose revision carried is paid for the work. Reading a
        // manuscript closely enough to say WHICH cards don't belong is the
        // most demanding thing a reviewer does here, and until now it earned
        // nothing at all — approving and revising paid the same, so there was
        // no reason to do the harder one.
        $rp = $mysqli->prepare("UPDATE mp_game_players SET prestige = prestige + ? WHERE player_id = ?");
        $reviseAward = MP_REVISE_REVIEWER_PRESTIGE;
        $rp->bind_param('ii', $reviseAward, $canonical);
        $rp->execute();
        $rp->close();

        mp_log_event($mysqli, $gameId, $canonical, 'revise_reviewer_paid', [
          'submission_id' => $sid,
          'prestige'      => $reviseAward,
        ]);
      }
    }
  }
}

/**
 * Decide a single manuscript outcome from the vote tallies.
 * Returns 'approve' | 'reject' | 'revise'. A unique maximum wins; any tie at
 * the top (including a top tie that doesn't involve revise) leans to 'revise'.
 */
function mp_majority_outcome($approves, $rejects, $revises) {
  $max = max($approves, $rejects, $revises);
  if ($approves === $max && $approves > $rejects && $approves > $revises) return 'approve';
  if ($rejects  === $max && $rejects  > $approves && $rejects  > $revises) return 'reject';
  return 'revise';
}

/**
 * Make sure exactly one usable revise proposal exists for a submission and
 * return its reviewer_player_id (the canonical proposer that mp_resolveRevise
 * will read — the latest revise review by review_id). If no formal revise
 * review exists, promote the latest reject review (its flagged cards become a
 * remove-only proposal). Returns null if neither a revise nor reject exists.
 */
function mp_ensure_revise_proposal($mysqli, $sid) {
  // Existing formal revise proposal? Use the latest (matches mp_resolveRevise).
  $stmt = $mysqli->prepare("
    SELECT reviewer_player_id FROM mp_reviews
    WHERE submission_id = ? AND verdict = 'revise'
    ORDER BY review_id DESC LIMIT 1
  ");
  $stmt->bind_param('i', $sid);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  if ($row) return (int) $row['reviewer_player_id'];

  // None — promote the latest reject (it carries flagged cards to remove).
  $stmt = $mysqli->prepare("
    SELECT review_id, reviewer_player_id FROM mp_reviews
    WHERE submission_id = ? AND verdict = 'reject'
    ORDER BY review_id DESC LIMIT 1
  ");
  $stmt->bind_param('i', $sid);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  if (!$row) return null;

  $reviewId = (int) $row['review_id'];
  $u = $mysqli->prepare("UPDATE mp_reviews SET verdict = 'revise' WHERE review_id = ?");
  $u->bind_param('i', $reviewId);
  $u->execute();
  $u->close();
  return (int) $row['reviewer_player_id'];
}

/**
 * Return locked cards from revise proposals on a submission back to their
 * proposers, EXCEPT the canonical reviewer (pass 0 to return all). Used when a
 * manuscript resolves to approve/reject (return all) or revise (keep the
 * winning proposer's cards locked, return the rest).
 */
function mp_return_revise_added($mysqli, $gameId, $sid, $year, $keepReviewerId) {
  $stmt = $mysqli->prepare("
    SELECT reviewer_player_id, added_card_ids FROM mp_reviews
    WHERE submission_id = ? AND verdict = 'revise' AND added_card_ids IS NOT NULL
  ");
  $stmt->bind_param('i', $sid);
  $stmt->execute();
  $res = $stmt->get_result();
  $rows = [];
  while ($r = $res->fetch_assoc()) $rows[] = $r;
  $stmt->close();

  foreach ($rows as $r) {
    $rid = (int) $r['reviewer_player_id'];
    if ($keepReviewerId !== 0 && $rid === (int) $keepReviewerId) continue;
    $added = $r['added_card_ids'] ? (json_decode($r['added_card_ids'], true) ?: []) : [];
    if (count($added) > 0) {
      mp_return_cards_to_player($mysqli, $gameId, $rid, array_map('intval', $added), $year);
    }
  }
}

/**
 * Return cards to a player's hand up to their notebook capacity; any that
 * don't fit are parked in mp_pending_card_returns for delivery at a later year
 * (drained by mp_maybe_resolve_year). Used to refund a reviewer's contributed
 * cards when a revise proposal doesn't win (or the writer objects/rebuilds).
 *
 * (Defined here — a library file — so both mp_resolveYear and mp_resolveRevise
 * can use it; mp_resolveRevise.php require_once's this file.)
 */
function mp_return_cards_to_player($mysqli, $gameId, $playerId, $cardIds, $year) {
  if (!is_array($cardIds) || count($cardIds) === 0) return;

  $stmt = $mysqli->prepare("SELECT notebook_level FROM mp_game_players WHERE player_id = ?");
  $stmt->bind_param('i', $playerId);
  $stmt->execute();
  $lvl = (int) ($stmt->get_result()->fetch_assoc()['notebook_level'] ?? 1);
  $stmt->close();

  $notebookTable = [7, 9, 11, 15];
  $capacity = $notebookTable[max(0, min(3, $lvl - 1))];

  $stmt = $mysqli->prepare("SELECT COUNT(*) AS n FROM mp_player_hands WHERE player_id = ?");
  $stmt->bind_param('i', $playerId);
  $stmt->execute();
  $handSize = (int) $stmt->get_result()->fetch_assoc()['n'];
  $stmt->close();

  $room = max(0, $capacity - $handSize);
  $i = 0;
  foreach ($cardIds as $cid) {
    $cidInt = (int) $cid;
    if ($i < $room) {
      $ins = $mysqli->prepare("INSERT IGNORE INTO mp_player_hands (player_id, idCard, added_year) VALUES (?, ?, ?)");
      $ins->bind_param('iii', $playerId, $cidInt, $year);
      $ins->execute();
      $ins->close();
    } else {
      $q = $mysqli->prepare("INSERT INTO mp_pending_card_returns (game_id, player_id, idCard, queued_year) VALUES (?, ?, ?, ?)");
      $q->bind_param('iiii', $gameId, $playerId, $cidInt, $year);
      $q->execute();
      $q->close();
    }
    $i++;
  }
}


/**
 * Return true if any citation's tag fails to match the conclusion's
 * argument tag. Per Phase B design, a citation whose `conclusion_tag`
 * doesn't appear in the conclusion's `argument` field auto-rejects the
 * submission.
 *
 * The conclusion's `argument` may be a single tag or comma-separated
 * tags; ANY match counts.
 */
function mp_submission_has_invalid_citation_tags($mysqli, $concCardId, $citedWorkIds) {
  if (count($citedWorkIds) === 0) return false;

  // Get conclusion argument tags
  $stmt = $mysqli->prepare("SELECT argument FROM Cards WHERE idCard = ?");
  $stmt->bind_param('i', $concCardId);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();
  if (!$row) return true;  // no conclusion = bad submission

  $concTags = array_filter(array_map('trim', explode(',', (string) $row['argument'])));
  if (count($concTags) === 0) return true;

  // For each citation, check its conclusion_tag matches
  $placeholders = implode(',', array_fill(0, count($citedWorkIds), '?'));
  $types = str_repeat('i', count($citedWorkIds));
  $sql = "SELECT conclusion_tag FROM mp_published_works WHERE work_id IN ($placeholders)";
  $stmt = $mysqli->prepare($sql);
  $stmt->bind_param($types, ...$citedWorkIds);
  $stmt->execute();
  $res = $stmt->get_result();
  while ($r = $res->fetch_assoc()) {
    $citeTag = (string) $r['conclusion_tag'];
    if ($citeTag === '' || !in_array($citeTag, $concTags, true)) {
      $stmt->close();
      return true;
    }
  }
  $stmt->close();
  return false;
}


/**
 * Auto-reject a submission without involving human reviewers. Used when
 * the citation-tag validator finds a mismatch. Differs from
 * mp_apply_rejection in two ways:
 *
 *   1. No reviewer upgrades are granted (no reviewers fired the
 *      verdict — the system did).
 *   2. The submission's auto-reject reason is logged in
 *      mp_event_log so the writer can see WHY it failed.
 *
 * The writer still gets the writer-upgrade and consolation draw,
 * matching the experience of a peer rejection.
 */
function mp_apply_auto_rejection($mysqli, $gameId, $sid, $writerPid, $reason, $currentYear) {
  $stmt = $mysqli->prepare("
    UPDATE mp_submissions
    SET status = 'rejected', resolved_year = ?
    WHERE submission_id = ?
  ");
  $stmt->bind_param('ii', $currentYear, $sid);
  $stmt->execute();
  $stmt->close();

  // (No writer upgrade — an auto-rejected submission is not published, and
  //  upgrades are earned only by publishing a manuscript or attending a
  //  conference.)

  mp_log_event($mysqli, $gameId, $writerPid, 'publication_auto_rejected', [
    'submission_id' => $sid,
    'reason'        => $reason,
  ]);
}


/**
 * Apply an approval outcome. Heavyweight — modifies several tables.
 *
 * Citation accounting (new rules — citations-as-effective-evidence):
 *   - Each citation contributes floor(N/2) effective evidence where N
 *     is the cited work's evidence_count at time of its own publication.
 *   - Effective evidence factors into base prestige AND influence L4
 *     per-card scaling.
 *   - Citations are EXCLUDED from the doubling-field check (handled
 *     inside mp_compute_prestige).
 *   - Each cited author (except the writer themselves) gets +1
 *     citations_received_count and a row in mp_citation_tokens. The
 *     citations_received_count then feeds end-of-game renown payouts.
 */
function mp_apply_approval($mysqli, $gameId, $sid, $writerPid, $kind, $evIds, $citedWorkIds, $concId, $currentYear) {
  $writer = mp_fetch_player($mysqli, $writerPid);
  $infLevel = (int) $writer['influence_level'];
  $infTable = [0, 1, 2, 4];   // per-card influence bonus by level

  // Fetch evidence cards with full fields (needed for prestige's
  // shared-context check AND for title relevance scoring).
  $evidenceCards = [];
  if (count($evIds) > 0) {
    $placeholders = implode(',', array_fill(0, count($evIds), '?'));
    $types = str_repeat('i', count($evIds));
    $sql = "SELECT idCard, title, content, location, author, date, source_type, citation, bonus, context_tags
            FROM Cards WHERE idCard IN ($placeholders)";
    $stmt = $mysqli->prepare($sql);
    $stmt->bind_param($types, ...$evIds);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($r = $res->fetch_assoc()) $evidenceCards[] = $r;
    $stmt->close();
  }

  // Citations pay through the CONCLUSION'S LADDER now (see $concBonus below),
  // not by summing a per-work value. One number, read off the conclusion card
  // by counting the citations attached — which is what makes this playable on
  // cardboard. The cost is that citing a landmark work scores the same as
  // citing a minor one; if that distinction is wanted back, it belongs as a
  // gate ("a book counts as two citations"), not as a sum.
  $citationBonus = 0;
  $citationCount = count($citedWorkIds);

  // Influence is a PER-CARD bonus, and a cited work counts as a card for it.
  //
  // It used to apply to real evidence only, which made the citation payout the
  // one quantity in the whole scorer that never grew: evidence scaled with
  // influence, arguments doubled for coherence, citation TOKENS scaled with the
  // owner's renown, but the citer's reward stayed a flat couple of points. By
  // the late game citing was worth noise while handing an opponent up to five,
  // so nobody did it. A citation is part of the argument's apparatus — the
  // literary agent sells it like anything else.
  $realEvidenceCount = count($evIds);
  $infBonus = $infTable[max(0, min(3, $infLevel - 1))]
            * ($realEvidenceCount + count($citedWorkIds));

  // Fetch the conclusion card up front so its bonus can feed the scorer.
  // The conclusion's worth is picked off its printed ladder by how many works
  // this manuscript cites — the whole reward for engaging with the field.
  $conc = mp_fetch_card_row($mysqli, $concId);
  $concBonus = ($conc && isset($conc['bonus'])) ? mp_bonus_at($conc['bonus'], $citationCount) : 0;

  // Base prestige — real evidence + bonuses + per-card influence, the lot
  // doubled if the argument's context coheres. The conclusion's ladder rung
  // is already inside $concBonus.
  $prestigeResult = mp_compute_prestige($evidenceCards, $infBonus, [], $concBonus, $citationBonus);
  $prestige = (int) $prestigeResult['total'];

  // citation_value is no longer read when scoring a citer — the conclusion's
  // ladder is. Still recorded, because it's a fair measure of how weighty this
  // work is and a "counts as two citations" gate would want it.
  $conclusionContribution = $concBonus * ($prestigeResult['doubled'] ? 2 : 1);
  $citationValue = (int) floor($conclusionContribution / 2);

  // 2. Look up conclusion title + tag, and pick a publication title using
  //    the full single-player-equivalent scorer.
  $concTag = '';
  if ($conc) {
    $argTags = array_map('trim', explode(',', (string) $conc['argument']));
    $argTags = array_filter($argTags, function ($t) { return $t !== ''; });
    $concTag = count($argTags) > 0 ? reset($argTags) : '';
  }

  $pubTitle = mp_pick_publication_title($mysqli, $gameId, $conc, $kind, $evidenceCards);

  // 3. Mark the submission approved and record prestige + title.
  $stmt = $mysqli->prepare("
    UPDATE mp_submissions
    SET status = 'approved', resolved_year = ?,
        prestige_granted = ?, publication_title = ?
    WHERE submission_id = ?
  ");
  $stmt->bind_param('iisi', $currentYear, $prestige, $pubTitle, $sid);
  $stmt->execute();
  $stmt->close();

  // 4. Move evidence to writer's discard. Cards are NOT in any project
  //    slot at this point — they bound to the submission when it was
  //    created (see mp_resolve_publish). Approval simply moves them from
  //    the manuscript into the writer's discard pile, where they'll be
  //    available again after the next archive reshuffle.
  foreach ($evIds as $ecid) {
    $stmt = $mysqli->prepare("
      INSERT IGNORE INTO mp_player_discards (player_id, idCard, discarded_year)
      VALUES (?, ?, ?)
    ");
    $stmt->bind_param('iii', $writerPid, $ecid, $currentYear);
    $stmt->execute();
    $stmt->close();
  }

  // 5. Update writer's stats. Publishing a manuscript grants prestige AND one
  //    stat upgrade (reviewers still earn none). Promotions and the old biennial
  //    drip no longer grant upgrades.
  $articleInc = ($kind === 'article') ? 1 : 0;
  $bookInc    = ($kind === 'book') ? 1 : 0;
  $stmt = $mysqli->prepare("
    UPDATE mp_game_players
    SET prestige = prestige + ?,
        articles_published = articles_published + ?,
        books_published = books_published + ?,
        pending_upgrade = pending_upgrade + 1,
        pending_upgrade_reason = 'publish'
    WHERE player_id = ?
  ");
  $stmt->bind_param('iiii', $prestige, $articleInc, $bookInc, $writerPid);
  $stmt->execute();
  $stmt->close();

  // Capture the writer's prestige AFTER the bump, so the history event
  // can show the running total alongside the +N delta. (A small extra
  // SELECT per approval is cheap and keeps the log self-describing.)
  $prestigeTotal = mp_fetch_prestige($mysqli, $writerPid);

  // 6. Snapshot evidence into mp_published_works for the library.
  //    Includes both original evidence cards AND citations (citations
  //    are marked with kind='citation' in the snapshot so the modal
  //    can render them distinctly).
  $snapshot = [];
  foreach ($evIds as $ecid) {
    $card = mp_fetch_card_row($mysqli, (int) $ecid);
    if (!$card) continue;
    $tags = [];
    foreach (['argument','sub_argument'] as $f) {
      foreach (array_map('trim', explode(',', (string) ($card[$f] ?? ''))) as $t) {
        if ($t !== '') $tags[] = $t;
      }
    }
    $snapshot[] = [
      'kind'   => 'card',
      'idCard' => (int) $card['idCard'],
      'title'  => $card['title'],
      'author' => $card['author'] ?? '',
      'tags'   => array_values(array_unique($tags)),
      // Full study-guide fields so the player can export "Collected Works"
      // as a print-ready review sheet. (Shown only to the work's author in
      // their own export; the in-game publication modal still hides these.)
      'date'         => $card['date'] ?? '',
      'content'      => $card['content'] ?? '',
      'significance' => $card['significance'] ?? '',
      'citation'     => $card['citation'] ?? '',
    ];
  }
  // Append citations to the snapshot
  foreach ($citedWorkIds as $wid) {
    $cstmt = $mysqli->prepare("
      SELECT w.work_id, w.publication_title, w.conclusion_tag, w.year_published,
             w.writer_player_id, p.player_name AS writer_name
      FROM mp_published_works w
      JOIN mp_game_players p ON p.player_id = w.writer_player_id
      WHERE w.work_id = ?
    ");
    $cstmt->bind_param('i', $wid);
    $cstmt->execute();
    $cres = $cstmt->get_result();
    $work = $cres->fetch_assoc();
    $cstmt->close();
    if (!$work) continue;
    $snapshot[] = [
      'kind'              => 'citation',
      'cited_work_id'     => (int) $work['work_id'],
      'title'             => $work['publication_title'],
      'author'            => $work['writer_name'],
      'cited_writer_id'   => (int) $work['writer_player_id'],
      'cited_year'        => (int) $work['year_published'],
      'tags'              => [$work['conclusion_tag']],
    ];
  }

  $stmt = $mysqli->prepare("
    INSERT IGNORE INTO mp_published_works
      (game_id, submission_id, writer_player_id, publication_title,
       conclusion_card_id, conclusion_tag, kind, evidence_count,
       evidence_snapshot, prestige_granted, citation_value, year_published)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ");
  $snapJson = json_encode($snapshot);
  // Real evidence count only — citations are no longer counted as evidence.
  $evCount  = count($evIds);
  $stmt->bind_param('iiisissisiii', $gameId, $sid, $writerPid, $pubTitle,
    $concId, $concTag, $kind, $evCount, $snapJson, $prestige, $citationValue, $currentYear);
  $stmt->execute();
  $newWorkId = $mysqli->insert_id;
  $stmt->close();

  // 6b. Citation rewards — for each cited author (other than the writer),
  //     issue a citation token + increment their citations_received_count.
  //     This is the cited author's currency for future objections (Phase B+).
  foreach ($citedWorkIds as $wid) {
    $cstmt = $mysqli->prepare("
      SELECT writer_player_id, conclusion_tag
      FROM mp_published_works WHERE work_id = ?
    ");
    $cstmt->bind_param('i', $wid);
    $cstmt->execute();
    $cres = $cstmt->get_result();
    $work = $cres->fetch_assoc();
    $cstmt->close();
    if (!$work) continue;
    $citedAuthor = (int) $work['writer_player_id'];
    if ($citedAuthor === $writerPid) continue;  // no self-payment

    // Increment received-count
    $stmt = $mysqli->prepare("
      UPDATE mp_game_players
      SET citations_received_count = citations_received_count + 1
      WHERE player_id = ?
    ");
    $stmt->bind_param('i', $citedAuthor);
    $stmt->execute();
    $stmt->close();

    // Mint a token (Phase B will let the cited author spend these)
    $stmt = $mysqli->prepare("
      INSERT INTO mp_citation_tokens
        (game_id, owner_player_id, source_work_id, tag, earned_year)
      VALUES (?, ?, ?, ?, ?)
    ");
    $tag = (string) $work['conclusion_tag'];
    $stmt->bind_param('iiisi', $gameId, $citedAuthor, $wid, $tag, $currentYear);
    $stmt->execute();
    $stmt->close();
  }

  // (Reviewers no longer earn upgrades — upgrades are a fixed biennial drip.)

  mp_log_event($mysqli, $gameId, $writerPid, 'publication_approved', [
    'submission_id' => $sid,
    'prestige'      => $prestige,
    'prestige_total' => $prestigeTotal,
    'prestige_base' => $prestigeResult['base'],
    'prestige_doubled' => $prestigeResult['doubled'],
    'prestige_context_field' => $prestigeResult['context_field'],
    'prestige_real_evidence' => $prestigeResult['real_evidence_count'],
    'prestige_citation_evidence' => $prestigeResult['citation_evidence'],
    'prestige_effective_evidence' => $prestigeResult['effective_evidence'],
    'kind'          => $kind,
    'title'         => $pubTitle,
  ]);
}


/**
 * Apply a rejection outcome. Lighter than approval since most things stay.
 *
 *   - status → 'rejected'
 *   - conclusion unsticks from project (evidence stays, player can revise)
 *   - writer gets draw bonus = research stat (next year, when they see the result)
 *   - each rejecting reviewer gets: free upgrade + draw bonus
 *
 * For Phase A: the writer's draw bonus and reviewers' draw bonus are
 * resolved on the NEXT year's first poll when they see the result — we
 * don't auto-draw here. Instead, we set pending_upgrade flags and flag
 * that they have a draw to collect.
 *
 * Actually, simpler approach for Phase A: just give the upgrade flag, and
 * the immediate stat-upgrade dialog handles the rest. Draw bonuses come
 * from a separate "claim reward" interaction triggered when the writer
 * opens the result dialog. We'll wire that up in the frontend.
 */
/**
 * Apply a rejection outcome. Lighter than approval since most things stay.
 *
 *   - status → 'rejected'
 *   - cards stay bound to the submission row (writer can reclaim later
 *     via mp_reclaimManuscript.php)
 *   - each rejecting reviewer gets a free upgrade
 *   - the writer ALSO gets a free upgrade — peer-review rejection is a
 *     learning experience too, and symmetric rewards keep rejection
 *     from feeling purely punitive
 *   - writer's consolation draw is claimed via mp_drawConsolation.php
 *     (triggered by clicking the consolation button in the result modal)
 */
function mp_apply_rejection($mysqli, $gameId, $sid, $writerPid, $evIds, $currentYear) {
  $stmt = $mysqli->prepare("
    UPDATE mp_submissions
    SET status = 'rejected', resolved_year = ?
    WHERE submission_id = ?
  ");
  $stmt->bind_param('ii', $currentYear, $sid);
  $stmt->execute();
  $stmt->close();

  // No project-clearing needed — the project was emptied when the
  // submission was created (see mp_resolve_publish). The cards remain
  // bound to mp_submissions.evidence_card_ids until the writer reclaims
  // them via the result modal.

  // (Neither the writer nor the rejecting reviewers earn upgrades anymore —
  //  upgrades are a fixed biennial drip, see mp_finish_round_tail.)

  mp_log_event($mysqli, $gameId, $writerPid, 'publication_rejected', [
    'submission_id' => $sid,
  ]);
}


/**
 * Career deadlines are DISABLED — a career never ends early, only at
 * retirement. Kept as a no-op so any lingering callers stay safe.
 */
function mp_apply_stage_gates($mysqli, $gameId, $newYear) {
  // Intentionally does nothing (no mid-career game-over gates).
}


/**
 * Recompute each live player's career stage from their publications. Stages
 * only ever rise, so any change IS a promotion: advance the stage, grant a
 * bonus upgrade (reason 'promotion'), and log a 'rank_up' event the client
 * turns into a narrative beat.
 */
function mp_apply_stage_progression($mysqli, $gameId, $newYear) {
  $stmt = $mysqli->prepare("
    SELECT player_id, articles_published, books_published, game_over_reason, stage
    FROM mp_game_players WHERE game_id = ?
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $rows = [];
  while ($p = $res->fetch_assoc()) $rows[] = $p;
  $stmt->close();

  foreach ($rows as $p) {
    if ($p['game_over_reason']) continue;
    $articles = (int) $p['articles_published'];
    $books    = (int) $p['books_published'];
    $newStage = mp_compute_stage($articles, $books);
    if ($newStage === $p['stage']) continue;

    $pid = (int) $p['player_id'];
    // Promotions advance the rank only — no bonus upgrade. Upgrades come from
    // publishing manuscripts and attending conferences.
    $u = $mysqli->prepare("
      UPDATE mp_game_players
      SET stage = ?
      WHERE player_id = ?
    ");
    $u->bind_param('si', $newStage, $pid);
    $u->execute();
    $u->close();

    mp_log_event($mysqli, $gameId, $pid, 'rank_up', ['stage' => $newStage]);
  }
}


// ============================================================================
// Helpers
// ============================================================================

function mp_current_year($mysqli, $gameId) {
  $stmt = $mysqli->prepare("SELECT current_year FROM mp_games WHERE game_id = ?");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $r = $res->fetch_assoc();
  $stmt->close();
  return $r ? (int) $r['current_year'] : 1;
}

function mp_fetch_player($mysqli, $playerId) {
  $stmt = $mysqli->prepare("SELECT * FROM mp_game_players WHERE player_id = ?");
  $stmt->bind_param('i', $playerId);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();
  return $row;
}

/**
 * Tiny helper — return the current prestige total for a player.
 * Used by event logs that record prestige changes so the history
 * modal can show a running total ("+5 → 42") next to the delta.
 */
function mp_fetch_prestige($mysqli, $playerId) {
  $stmt = $mysqli->prepare("SELECT prestige FROM mp_game_players WHERE player_id = ?");
  $stmt->bind_param('i', $playerId);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();
  return $row ? (int) $row['prestige'] : 0;
}

function mp_fetch_card_row($mysqli, $idCard) {
  $stmt = $mysqli->prepare("SELECT * FROM Cards WHERE idCard = ? LIMIT 1");
  $stmt->bind_param('i', $idCard);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();
  return $row ?: null;
}

function mp_reputation_book_min($level) {
  // Mirrors useGameState.js reputationThresholds()
  switch ($level) {
    case 1: return 6;
    case 2: return 6;
    case 3: return 5;
    case 4: return 3;
    default: return 6;
  }
}

function mp_compute_stage($articles, $books) {
  // Publication-driven career ladder. Start as Visiting Assistant Professor;
  // first article → Assistant Professor (tenure track); first book → Associate
  // Professor (tenured); then Full at 4 books, Endowed at 7. Mirrors
  // lib/career.js computeStage.
  if ($books >= 7) return 'endowed-professor';
  if ($books >= 4) return 'full-professor';
  if ($books >= 1) return 'associate-professor';   // first book → tenure
  if ($articles >= 1) return 'assistant-professor'; // first article → tenure track
  return 'visiting-assistant-professor';            // start
}

function mp_array_set_equal($a, $b) {
  if (!is_array($a) || !is_array($b)) return false;
  if (count($a) !== count($b)) return false;
  $aa = array_map('intval', $a); sort($aa);
  $bb = array_map('intval', $b); sort($bb);
  return $aa === $bb;
}

/**
 * ─── Phase B: full pickPublicationTitle port from single-player ────
 *
 * Picks a title from the conclusion's pool based on word-overlap
 * relevance to the evidence cards used in this submission. Tracks
 * which titles have already been used (looking at mp_published_works
 * for prior publications of the same game+conclusion+kind) to avoid
 * repeats, falling back to "Pt. N" suffixes when the pool is exhausted.
 *
 * Mirrors src/hooks/useGameState.js pickPublicationTitle so MP and SP
 * give consistent titles for identical inputs (modulo random tiebreak).
 */
function mp_pick_publication_title($mysqli, $gameId, $conclusion, $kind, $evidenceCards) {
  if (!$conclusion) return 'Untitled';

  $field = ($kind === 'book') ? 'book_titles' : 'article_titles';
  $raw = $conclusion[$field] ?? '';
  $pool = mp_parse_title_pool($raw);

  if (count($pool) === 0) {
    return $conclusion['title'] ?? "Untitled $kind";
  }

  // Look up what's already been used for this game+conclusion+kind
  $concId = (int) $conclusion['idCard'];
  $stmt = $mysqli->prepare("
    SELECT publication_title FROM mp_published_works
    WHERE game_id = ? AND conclusion_card_id = ? AND kind = ?
  ");
  $stmt->bind_param('iis', $gameId, $concId, $kind);
  $stmt->execute();
  $res = $stmt->get_result();
  $used = [];
  while ($r = $res->fetch_assoc()) $used[] = $r['publication_title'];
  $stmt->close();

  // Build evidence-word vocabulary
  $evidenceWords = [];
  foreach ($evidenceCards as $card) {
    foreach (mp_title_tokenize($card['title'] ?? '') as $w) $evidenceWords[$w] = true;
    foreach (mp_title_tokenize($card['content'] ?? '') as $w) $evidenceWords[$w] = true;
  }

  // Score every pool title against the evidence vocabulary
  $scored = [];
  foreach ($pool as $title) {
    $tokens = mp_title_tokenize($title);
    $s = 0;
    foreach ($tokens as $w) if (isset($evidenceWords[$w])) $s++;
    $scored[] = ['title' => $title, 'score' => $s];
  }
  // Sort by score desc; PHP's usort is stable enough here
  usort($scored, function ($a, $b) { return $b['score'] - $a['score']; });

  $unused = array_values(array_filter($scored, function ($e) use ($used) {
    return !in_array($e['title'], $used, true);
  }));

  // Best unused title with score > 0
  if (count($unused) > 0 && $unused[0]['score'] > 0) {
    $topScore = $unused[0]['score'];
    $tied = array_filter($unused, function ($e) use ($topScore) {
      return $e['score'] === $topScore;
    });
    $tied = array_values($tied);
    return $tied[array_rand($tied)]['title'];
  }

  // No unused title scored — see if a USED title scores higher
  $usedScored = array_values(array_filter($scored, function ($e) use ($used) {
    return in_array($e['title'], $used, true);
  }));
  $bestUsed = count($usedScored) > 0 ? $usedScored[0]['score'] : 0;
  $bestUnused = count($unused) > 0 ? $unused[0]['score'] : 0;

  if ($bestUsed > $bestUnused && $bestUsed > 0) {
    $tiedUsed = array_values(array_filter($usedScored, function ($e) use ($bestUsed) {
      return $e['score'] === $bestUsed;
    }));
    $base = $tiedUsed[array_rand($tiedUsed)]['title'];
    return mp_next_part_title($base, $used);
  }

  // Fallback: pick a random unused title (all score zero)
  if (count($unused) > 0) {
    return $unused[array_rand($unused)]['title'];
  }

  // Final fallback: every title used; append Pt. N to a random one
  $base = $pool[array_rand($pool)];
  return mp_next_part_title($base, $used);
}


function mp_parse_title_pool($raw) {
  if (is_array($raw)) {
    return array_values(array_filter($raw, function ($t) {
      return is_string($t) && trim($t) !== '';
    }));
  }
  if (!is_string($raw)) return [];
  $s = trim($raw);
  if ($s === '') return [];

  // Try JSON if it looks like an array
  if (str_starts_with($s, '[') && str_ends_with($s, ']')) {
    $tmp = json_decode($s, true);
    if (is_array($tmp)) {
      $pool = array_values(array_filter($tmp, function ($t) {
        return is_string($t) && trim($t) !== '';
      }));
      if (count($pool) > 0) return $pool;
    }
  }
  // Pipe-separated fallback
  return array_values(array_filter(array_map('trim', explode('|', $s)), function ($t) {
    return $t !== '';
  }));
}


/**
 * Generate the next "X, Pt. N" suffix for a base title given the list
 * of previously-used titles. Looks for existing "Pt. K" usages of the
 * same base and returns the next number.
 */
function mp_next_part_title($base, $usedTitles) {
  $maxPart = 1;
  $escapedBase = preg_quote($base, '/');
  foreach ($usedTitles as $u) {
    if ($u === $base) continue;
    if (preg_match('/^' . $escapedBase . ', Pt\. (\d+)$/', $u, $m)) {
      $n = (int) $m[1];
      if ($n > $maxPart) $maxPart = $n;
    }
  }
  return $base . ', Pt. ' . ($maxPart + 1);
}


/**
 * Stopwords used by the title-relevance scorer. Mirrors the single-
 * player TITLE_MATCH_STOPWORDS set in useGameState.js so MP and SP
 * tokenize identically.
 */
function mp_title_stopwords() {
  static $set = null;
  if ($set !== null) return $set;
  $list = [
    'the','a','an','and','or','but','of','in','on','at','to','for',
    'with','by','from','as','is','was','were','be','been','being',
    'are','am','has','have','had','do','does','did','will','would',
    'could','should','this','that','these','those','his','her','their',
    'its','it','they','them','we','us','our','you','your','he','she',
    'who','what','where','when','why','how','not','no','s','t','ll',
    've','re','d','m','about','against','between','into','through',
    'during','before','after','above','below','up','down','over',
    'under','than','so','such','only','own','same','too','very','can',
    'just','also','while','because','until','if','each','some','all',
    'any','most','more','less','many','few','one','two','three',
  ];
  $set = array_flip($list);
  return $set;
}


/**
 * Tokenize text into significant lower-case words. Strips punctuation,
 * apostrophes, drops stopwords and tokens of length <= 2.
 */
function mp_title_tokenize($text) {
  if (!is_string($text) || $text === '') return [];
  $s = strtolower($text);
  $s = str_replace(["'", "\u{2019}", "\u{2018}"], '', $s);
  $s = preg_replace('/[^a-z0-9\s]/', ' ', $s);
  $parts = preg_split('/\s+/', trim($s));
  if (!$parts) return [];
  $stopwords = mp_title_stopwords();
  $out = [];
  foreach ($parts as $w) {
    if (strlen($w) > 2 && !isset($stopwords[$w])) $out[] = $w;
  }
  return $out;
}


/**
 * ─── Phase B: full computePrestige port from single-player ─────────
 *
 * Mirrors src/lib/validation.js computePrestige:
 *
 *   base = evidence_count + sum(card.bonus) + influence_bonus
 *
 * If all evidence cards share a non-empty value in ANY of these
 * context fields — location, author, date, source_type, citation —
 * prestige doubles. The first matching field is recorded so we can
 * log/explain WHY it doubled.
 *
 * Citations (cited works) contribute floor(N/2) prestige separately —
 * this is added AFTER the doubling check so citation count alone
 * doesn't trigger the bonus.
 */
/**
 * mp_compute_prestige
 *
 * Computes the prestige a publication is worth at the moment it's
 * approved. The shape of the formula:
 *
 *   citationEvidence = sum(floor(N / 2)) for each cited work,
 *                      where N = the cited work's evidence_count at
 *                      time of its own publication
 *   effectiveEvidence = real_evidence_count + citationEvidence
 *   base              = effectiveEvidence + bonus_sum + influenceBonus
 *   doubled           = TRUE if all REAL evidence cards share a
 *                       context field (location/author/date/source_type/citation)
 *                       — citations are EXCLUDED from this check
 *   total             = doubled ? base × 2 : base
 *
 * Notes on the rules:
 *   • Citations contribute evidence-equivalents at half rate. A 6-card
 *     cited book = 3 effective evidence; a 1-card cited article = 0.
 *   • Citations do NOT participate in the doubling-field check.
 *     "Ignore books and articles when determining if your argument
 *     is focused on a single location/author/date."
 *   • Citations DO factor into the article/book classification
 *     threshold (handled by the caller, in mp_resolveYear).
 *   • Citations DO NOT bring their bonus_sum through — only raw count
 *     gets divided.
 *   • At influence L4 (per-card scaling) the caller pre-multiplies
 *     against effective evidence count, not just real cards.
 *
 * @param array $evidenceCards   the writer's REAL evidence card rows
 *                               (with bonus / location / author / etc.)
 * @param int   $influenceBonus  pre-computed flat bonus (caller handles L4 scaling)
 * @param array $citedEvidenceCounts  array of evidence_counts of each
 *                                    cited work (e.g., [6, 4, 3] for
 *                                    three citations citing 6-, 4-,
 *                                    and 3-evidence works)
 */
/**
 * mp_bonus_at — read a card's printed bonus, which may be a citation ladder.
 *
 * A conclusion's `bonus` column is a VARCHAR, so it holds either a single
 * number or a pipe-separated ladder keyed to the manuscript's citation count:
 *
 *   "3"          → 3, whatever the citation count
 *   "3|6|10|15"  → 3 with none, 6 with one, 10 with two, 15 with three or more
 *
 * Hard gates printed on the card, so a table playing this on cardboard counts
 * its citations and reads the number off — no multiplying, and nothing to look
 * up on the cited cards. Counts past the end of the ladder take the last rung,
 * which is what makes the top tier "3+" rather than a cliff.
 *
 * Existing decks all store a plain number and are unaffected. Note that a bare
 * (int) cast of "3|6|10|15" yields 3 in PHP, so any path that misses this
 * helper degrades to the no-citation tier rather than breaking.
 */
function mp_bonus_at($raw, $citationCount = 0) {
  if ($raw === null || $raw === '') return 0;
  $parts = array_values(array_filter(
    array_map(function ($p) { return trim($p); }, explode('|', (string) $raw)),
    function ($p) { return $p !== '' && is_numeric($p); }
  ));
  if (count($parts) === 0) return 0;
  $n = max(0, (int) $citationCount);
  $i = min($n, count($parts) - 1);
  return (int) $parts[$i];
}


function mp_compute_prestige($evidenceCards, $influenceBonus, $citedEvidenceCounts = [], $conclusionBonus = 0, $citationBonus = 0) {
  $evCount = count($evidenceCards);

  // Citation evidence: each cited work contributes floor(N/2) where N
  // is its evidence_count. A 6-card book = 3 effective evidence, a
  // 1-card article = 0.
  $citationEvidence = 0;
  foreach ($citedEvidenceCounts as $n) {
    $citationEvidence += (int) floor((int) $n / 2);
  }

  $bonusSum = 0;
  foreach ($evidenceCards as $card) {
    $b = isset($card['bonus']) ? (int) $card['bonus'] : 0;
    $bonusSum += $b;
  }

  $concBonus = (int) $conclusionBonus;

  $effectiveEvidence = $evCount + $citationEvidence;
  // The citation bonus is part of the base, so a coherent argument doubles it
  // along with everything else. It used to be bolted on after the doubling,
  // which meant the one reward for engaging with other players' work was also
  // the one reward that a well-built manuscript couldn't amplify.
  $base = $effectiveEvidence + $bonusSum + $concBonus
        + (int) $influenceBonus + (int) $citationBonus;

  // Doubling rule — checked AGAINST REAL EVIDENCE ONLY. Citations are
  // ignored when asking "is this argument focused on one location?"
  // because the cited works might span many contexts.
  $contextFields = ['location', 'author', 'date', 'source_type', 'citation'];
  $doubled = false;
  $contextField = null;
  if ($evCount > 0) {
    foreach ($contextFields as $f) {
      $firstVal = isset($evidenceCards[0][$f]) ? trim((string) $evidenceCards[0][$f]) : '';
      if ($firstVal === '') continue;
      $allMatch = true;
      foreach ($evidenceCards as $c) {
        $v = isset($c[$f]) ? trim((string) $c[$f]) : '';
        if ($v !== $firstVal) { $allMatch = false; break; }
      }
      if ($allMatch) {
        $doubled = true;
        $contextField = $f;
        break;
      }
    }
  }

  // Multi-valued context_tags (pipe-separated, like the title pools): also
  // doubles when every REAL evidence card shares at least one common tag.
  if (!$doubled && $evCount > 0) {
    $parseTags = function ($c) {
      $raw = isset($c['context_tags']) ? (string) $c['context_tags'] : '';
      $out = [];
      foreach (explode('|', $raw) as $t) {
        $t = strtolower(trim($t));
        if ($t !== '') $out[$t] = true;
      }
      return $out;
    };
    $inter = $parseTags($evidenceCards[0]);
    for ($i = 1; $i < $evCount && count($inter) > 0; $i++) {
      $s = $parseTags($evidenceCards[$i]);
      foreach (array_keys($inter) as $t) {
        if (!isset($s[$t])) unset($inter[$t]);
      }
    }
    if (count($inter) > 0) {
      $doubled = true;
      $contextField = 'context tags';
    }
  }

  $total = $doubled ? $base * 2 : $base;

  return [
    'base'                => $base,
    'doubled'             => $doubled,
    'context_field'       => $contextField,
    'real_evidence_count' => $evCount,
    'citation_evidence'   => $citationEvidence,
    'effective_evidence'  => $effectiveEvidence,
    'conclusion_bonus'    => $concBonus,
    'total'               => $total,
  ];
}


/**
 * mp_apply_renown_bonuses
 *
 * Run at game-end. For every player, compute their renown bonus —
 * citations received × renown multiplier — and add it to their
 * prestige. Logs a per-player event so the result screen and
 * action-history modal can surface the breakdown.
 *
 * Renown bonus formula (matches schema comment):
 *
 *   bonus = citations_received_count × renown_table[level - 1]
 *   table = [1, 2, 3, 6]
 *
 * Example: a player whose books were cited 7 times across the game,
 * with renown at level 3 (×3), earns +21 prestige at end-of-game.
 *
 * Idempotency: this function MUTATES prestige. Callers must ensure
 * it's called exactly once per game (when status flips lobby/active
 * → ended, inside the same transaction). It will not detect a
 * second call; calling it twice will double-apply the bonus. Both
 * existing game-end transition points (year > max, all-conceded)
 * already commit atomically — the call slot is inside that transaction.
 */
function mp_apply_renown_bonuses($mysqli, $gameId) {
  $renownTable = [1, 2, 3, 5];

  $stmt = $mysqli->prepare("
    SELECT player_id, player_name, renown_level,
           citations_received_count, prestige
    FROM mp_game_players
    WHERE game_id = ?
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $players = [];
  $res = $stmt->get_result();
  while ($r = $res->fetch_assoc()) $players[] = $r;
  $stmt->close();

  foreach ($players as $p) {
    $received = (int) $p['citations_received_count'];
    $level    = max(1, min(4, (int) $p['renown_level']));
    $mult     = $renownTable[$level - 1];
    $bonus    = $received * $mult;
    if ($bonus <= 0) continue;  // skip players who received no citations

    $pid = (int) $p['player_id'];
    $up = $mysqli->prepare("
      UPDATE mp_game_players
      SET prestige = prestige + ?
      WHERE player_id = ?
    ");
    $up->bind_param('ii', $bonus, $pid);
    $up->execute();
    $up->close();

    $newTotal = (int) $p['prestige'] + $bonus;
    mp_log_event($mysqli, $gameId, $pid, 'renown_bonus_awarded', [
      'citations_received' => $received,
      'renown_level'       => $level,
      'renown_multiplier'  => $mult,
      'bonus'              => $bonus,
      'prestige_total'     => $newTotal,
    ]);
  }
}

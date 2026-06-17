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
          mp_resolve_draw($mysqli, $gameId, $p);
          break;

        case 'publish':
          mp_resolve_publish($mysqli, $gameId, $p, $data);
          break;

        case 'review':
          // Reviews resolved together after this loop, since multiple
          // players can review the same submission and we want all
          // verdicts in the DB before we tally.
          mp_resolve_review_record($mysqli, $gameId, $p, $data);
          break;
      }
    }

    // ----- Tally reviews: any submission with at least one approval is
    //       approved; any with all-rejects is rejected; no-reviews stays pending
    mp_resolve_submission_outcomes($mysqli, $gameId, (int) $game['current_year']);

    // ----- Advance year + apply stage gates -----
    // The game length is per-game (short=10, medium=18, long=25). The career
    // gate rounds below stay fixed (comps at 5 → year-6 gate, tenure at 12 →
    // year-13 gate); only the end-of-game round scales with the mode.
    $totalYears = (int) ($game['total_years'] ?? 25);
    $newYear = (int) $game['current_year'] + 1;
    $gameEnded = false;

    if ($newYear > $totalYears) {
      // Game ends — mark all players game-over with reason 'retired' if not
      // already game-over from a stage gate.
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
      // Apply end-of-game renown bonuses inside the same transaction.
      // After this, mp_game_players.prestige reflects the final value
      // including the citations-received reward.
      mp_apply_renown_bonuses($mysqli, $gameId);
      $gameEnded = true;
      mp_log_event($mysqli, $gameId, null, 'game_ended', ['final_year' => $totalYears]);
    } else {
      // Apply hard stage gates (year 5 failed comps, year 12 tenure denied).
      mp_apply_stage_gates($mysqli, $gameId, $newYear);

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

      $stmt = $mysqli->prepare("
        UPDATE mp_games
        SET current_year = ?,
            year_started_at = NOW()
        WHERE game_id = ?
      ");
      $stmt->bind_param('ii', $newYear, $gameId);
      $stmt->execute();
      $stmt->close();

      // Per-player stage progression (positive transitions): compute updated
      // stage label from year + book count. Note we do this AFTER the gates.
      mp_apply_stage_progression($mysqli, $gameId, $newYear);

      mp_log_event($mysqli, $gameId, null, 'year_advanced', ['new_year' => $newYear]);
    }

    // Bump state version once for the whole resolution batch.
    $stmt = $mysqli->prepare("UPDATE mp_games SET state_version = state_version + 1 WHERE game_id = ?");
    $stmt->bind_param('i', $gameId);
    $stmt->execute();
    $stmt->close();

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


/**
 * Draw N cards for the given player from the shared archive. If the archive
 * empties mid-draw, reshuffle all players' discards back in. N = research
 * stat (capped by notebook room).
 */
function mp_resolve_draw($mysqli, $gameId, $player) {
  $pid = (int) $player['player_id'];
  $researchLevel = (int) $player['research_level'];
  $notebookLevel = (int) $player['notebook_level'];

  // Lookup tables mirrored from useGameState.js — keep these in sync.
  $researchTable    = [3, 5, 7, 'capacity'];
  $notebookCapTable = [7, 11, 15, 25];
  $capacity = $notebookCapTable[$notebookLevel - 1];
  $drawRaw  = $researchTable[$researchLevel - 1];
  $drawCount = $drawRaw === 'capacity' ? $capacity : $drawRaw;

  // Current hand size
  $stmt = $mysqli->prepare("SELECT COUNT(*) AS n FROM mp_player_hands WHERE player_id = ?");
  $stmt->bind_param('i', $pid);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();
  $room = $capacity - (int) $row['n'];
  $target = min($drawCount, $room);
  // Tracking — we want the event log to record how many cards actually
  // got drawn so the action history modal can show e.g. "drew 3 cards"
  // or "tried to draw but hand was full."
  if ($target <= 0) {
    mp_log_event($mysqli, $gameId, $pid, 'action_resolved_draw', [
      'requested' => $drawCount,
      'drawn'     => 0,
      'reason'    => 'hand_full',
    ]);
    return;
  }

  $year = mp_current_year($mysqli, $gameId);
  $drawn = 0;

  $remaining = $target;
  while ($remaining > 0) {
    // Pull the next N undrawn cards by position.
    $stmt = $mysqli->prepare("
      SELECT idCard FROM mp_game_archive
      WHERE game_id = ? AND drawn_by_player_id IS NULL
      ORDER BY archive_position ASC
      LIMIT ?
    ");
    $stmt->bind_param('ii', $gameId, $remaining);
    $stmt->execute();
    $res = $stmt->get_result();
    $cardIds = [];
    while ($r = $res->fetch_assoc()) $cardIds[] = (int) $r['idCard'];
    $stmt->close();

    if (count($cardIds) === 0) {
      // Archive empty — reshuffle discards.
      $reshuffled = mp_reshuffle_discards_into_archive($mysqli, $gameId);
      if ($reshuffled === 0) break;  // truly empty, can't draw any more
      continue;
    }

    // Mark drawn + insert into hand. We do these together per card.
    foreach ($cardIds as $cid) {
      $stmt = $mysqli->prepare("
        UPDATE mp_game_archive
        SET drawn_by_player_id = ?, drawn_year = ?
        WHERE game_id = ? AND idCard = ? AND drawn_by_player_id IS NULL
      ");
      $stmt->bind_param('iiii', $pid, $year, $gameId, $cid);
      $stmt->execute();
      $affected = $stmt->affected_rows;
      $stmt->close();
      if ($affected !== 1) continue;  // race lost this card; try the next

      $stmt = $mysqli->prepare("
        INSERT IGNORE INTO mp_player_hands (player_id, idCard, added_year)
        VALUES (?, ?, ?)
      ");
      $stmt->bind_param('iii', $pid, $cid, $year);
      $stmt->execute();
      $stmt->close();

      $remaining--;
      $drawn++;
      if ($remaining <= 0) break;
    }
  }

  mp_log_event($mysqli, $gameId, $pid, 'action_resolved_draw', [
    'requested' => $drawCount,
    'drawn'     => $drawn,
    'year'      => $year,
  ]);
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

  // Read the active citations for this project slot. We pull each
  // cited work's evidence_count alongside the citation row — that's
  // what feeds the new citation-as-evidence rule (each cited work
  // contributes floor(N/2) effective evidence to this submission).
  $citedWorkIds = [];
  $citedEvidenceCounts = [];
  $cstmt = $mysqli->prepare("
    SELECT c.cited_work_id, w.evidence_count
    FROM mp_citations c
    JOIN mp_published_works w ON w.work_id = c.cited_work_id
    WHERE c.player_id = ? AND c.slot_index = ?
    ORDER BY c.added_at ASC
  ");
  $cstmt->bind_param('ii', $pid, $projectId);
  $cstmt->execute();
  $cres = $cstmt->get_result();
  while ($cr = $cres->fetch_assoc()) {
    $citedWorkIds[] = (int) $cr['cited_work_id'];
    $citedEvidenceCounts[] = (int) $cr['evidence_count'];
  }
  $cstmt->close();

  // Citations contribute floor(N/2) effective evidence each, where N
  // is the cited work's evidence_count. A 6-card cited book = 3
  // effective evidence; a 1-card cited article = 0.
  $citationEvidence = 0;
  foreach ($citedEvidenceCounts as $n) {
    $citationEvidence += (int) floor($n / 2);
  }
  $effectiveEvidence = count($evIds) + $citationEvidence;

  // Article vs book — checked against EFFECTIVE evidence so a 2-card
  // article citing a heavy book can cross the book threshold.
  $repLevel = (int) $player['reputation_level'];
  $bookMin  = mp_reputation_book_min($repLevel);
  $kind = ($effectiveEvidence >= $bookMin) ? 'book' : 'article';

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
 * Look at every still-'pending' submission this year and decide its fate.
 *   - Any approve → 'approved' (writer gets prestige + upgrade)
 *   - All rejects with no approves → 'rejected'
 *   - No reviews at all → stays 'pending' (carries to next year)
 *
 * On approval, evidence cards are consumed (moved from project to discard),
 * the project slot empties, prestige is awarded, the writer's upgrade flag
 * is set, and a publication record is written into mp_published_works.
 *
 * On rejection, evidence stays in the project, conclusion unsticks, and
 * the writer gets the consolation rewards (draw, no prestige).
 */
function mp_resolve_submission_outcomes($mysqli, $gameId, $currentYear) {
  // The "review year" is the year we're resolving INTO — i.e. submissions
  // submitted at year Y can be reviewed at year Y+1 and resolved at the
  // end of Y+1. Since this function runs at year-end, $currentYear is the
  // year that's just finished. We resolve any submission with status='pending'
  // and at least one review for it.

  $stmt = $mysqli->prepare("
    SELECT s.*,
      SUM(CASE WHEN r.verdict = 'approve' THEN 1 ELSE 0 END) AS approves,
      SUM(CASE WHEN r.verdict = 'reject'  THEN 1 ELSE 0 END) AS rejects
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

    $sid     = (int) $s['submission_id'];
    $writer  = (int) $s['writer_player_id'];
    $kind    = $s['kind'];
    $evIds   = json_decode($s['evidence_card_ids'], true) ?: [];
    $citeIds = isset($s['cited_work_ids']) && $s['cited_work_ids']
                 ? (json_decode($s['cited_work_ids'], true) ?: [])
                 : [];
    $concId  = (int) $s['conclusion_card_id'];

    // ── PHASE B: citation-tag pre-validation ───────────────────────
    // Citations are tag-checked at PUBLICATION time, not at add time.
    // If any cited work's tag doesn't match the conclusion's argument
    // tag, the submission auto-rejects regardless of any approve votes.
    // No reviewer upgrades granted (no human did the rejecting), but
    // the writer still gets the writer-upgrade and consolation draw
    // via mp_apply_auto_rejection below.
    if (count($citeIds) > 0 && mp_submission_has_invalid_citation_tags($mysqli, $concId, $citeIds)) {
      mp_apply_auto_rejection($mysqli, $gameId, $sid, $writer, 'invalid-citation', $currentYear);
      continue;
    }

    if ($approves === 0 && $rejects === 0) continue;  // no reviews → keep pending

    if ($approves >= 1) {
      mp_apply_approval($mysqli, $gameId, $sid, $writer, $kind, $evIds, $citeIds, $concId, $currentYear);
    } else {
      mp_apply_rejection($mysqli, $gameId, $sid, $writer, $evIds, $currentYear);
    }
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

  // Writer-upgrade (learn-from-feedback)
  $stmt = $mysqli->prepare("
    UPDATE mp_game_players
    SET pending_upgrade = pending_upgrade + 1,
        pending_upgrade_reason = 'reject-writer'
    WHERE player_id = ?
  ");
  $stmt->bind_param('i', $writerPid);
  $stmt->execute();
  $stmt->close();

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
  $infTable = [0, 1, 2, 3];

  // Fetch evidence cards with full fields (needed for prestige's
  // shared-context check AND for title relevance scoring).
  $evidenceCards = [];
  if (count($evIds) > 0) {
    $placeholders = implode(',', array_fill(0, count($evIds), '?'));
    $types = str_repeat('i', count($evIds));
    $sql = "SELECT idCard, title, content, location, author, date, source_type, citation, bonus
            FROM Cards WHERE idCard IN ($placeholders)";
    $stmt = $mysqli->prepare($sql);
    $stmt->bind_param($types, ...$evIds);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($r = $res->fetch_assoc()) $evidenceCards[] = $r;
    $stmt->close();
  }

  // Pull evidence_count for each cited work. The snapshot was stored
  // on the submission as cited_work_ids JSON; mp_published_works
  // retains the authoritative evidence_count column.
  $citedEvidenceCounts = [];
  if (count($citedWorkIds) > 0) {
    $placeholders = implode(',', array_fill(0, count($citedWorkIds), '?'));
    $types = str_repeat('i', count($citedWorkIds));
    $sql = "SELECT evidence_count FROM mp_published_works WHERE work_id IN ($placeholders)";
    $stmt = $mysqli->prepare($sql);
    $stmt->bind_param($types, ...$citedWorkIds);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($r = $res->fetch_assoc()) $citedEvidenceCounts[] = (int) $r['evidence_count'];
    $stmt->close();
  }

  // Effective evidence used by two places downstream:
  //  1. Influence L4 — multiplier scales by effective evidence count,
  //     so a publication with citations gets more per-card influence.
  //  2. mp_compute_prestige (passed the citedEvidenceCounts array
  //     directly, derives the same number internally).
  $citationEvidence = 0;
  foreach ($citedEvidenceCounts as $n) {
    $citationEvidence += (int) floor($n / 2);
  }
  $effectiveEvidenceCount = count($evIds) + $citationEvidence;

  // Influence bonus — L4 is per-card against EFFECTIVE evidence; L1-3
  // are flat. This means citing heavy works at influence L4 stacks
  // hard, which is the design intent ("citations count as evidence").
  $infBonus = $infLevel >= 4
    ? 3 * $effectiveEvidenceCount
    : $infTable[$infLevel - 1];

  // Fetch the conclusion card up front so its bonus can feed the scorer.
  // The conclusion tile now carries a bonus, applied like an evidence bonus.
  $conc = mp_fetch_card_row($mysqli, $concId);
  $concBonus = ($conc && isset($conc['bonus'])) ? (int) $conc['bonus'] : 0;

  // Full computePrestige — handles base (real + citation evidence) +
  // doubling (real-evidence-only) + bonus_sum (real-evidence-only) +
  // the conclusion's own bonus. Renown applies at GAME END not
  // per-publication; see mp_apply_renown_bonuses().
  $prestigeResult = mp_compute_prestige($evidenceCards, $infBonus, $citedEvidenceCounts, $concBonus);
  $prestige = (int) $prestigeResult['total'];

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

  // 5. Update writer's stats. The pending_upgrade column is treated
  //    as a COUNTER (not a boolean) so that if a player earns multiple
  //    upgrades in the same year resolution (publish AND a review
  //    approval, say), they get one modal per upgrade rather than
  //    losing the extras.
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
       evidence_snapshot, prestige_granted, year_published)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ");
  $snapJson = json_encode($snapshot);
  // Total counted evidence INCLUDES citations (per design — citations
  // count toward kind threshold and toward the published-work display).
  $evCount  = count($evIds) + count($citedWorkIds);
  $stmt->bind_param('iiisissisii', $gameId, $sid, $writerPid, $pubTitle,
    $concId, $concTag, $kind, $evCount, $snapJson, $prestige, $currentYear);
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

  // 7. Reward each approving reviewer: free stat upgrade choice.
  //    (Tokens are Phase B; here we just flag the upgrade.) Increment
  //    rather than set so multiple stacked upgrades aren't lost.
  $stmt = $mysqli->prepare("
    UPDATE mp_game_players p
    JOIN mp_reviews r ON r.reviewer_player_id = p.player_id
    SET p.pending_upgrade = p.pending_upgrade + 1,
        p.pending_upgrade_reason = 'review-approve'
    WHERE r.submission_id = ? AND r.verdict = 'approve'
  ");
  $stmt->bind_param('i', $sid);
  $stmt->execute();
  $stmt->close();

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

  // Writer also gets an upgrade — they learned from the feedback even
  // though their argument didn't carry. Incremented (not set) so it
  // stacks with any other upgrades earned the same year.
  $stmt = $mysqli->prepare("
    UPDATE mp_game_players
    SET pending_upgrade = pending_upgrade + 1,
        pending_upgrade_reason = 'reject-writer'
    WHERE player_id = ?
  ");
  $stmt->bind_param('i', $writerPid);
  $stmt->execute();
  $stmt->close();

  // Reviewers who rejected get the upgrade flag. Increment rather than
  // set so multiple stacked upgrades aren't lost.
  $stmt = $mysqli->prepare("
    UPDATE mp_game_players p
    JOIN mp_reviews r ON r.reviewer_player_id = p.player_id
    SET p.pending_upgrade = p.pending_upgrade + 1,
        p.pending_upgrade_reason = 'review-reject'
    WHERE r.submission_id = ? AND r.verdict = 'reject'
  ");
  $stmt->bind_param('i', $sid);
  $stmt->execute();
  $stmt->close();

  mp_log_event($mysqli, $gameId, $writerPid, 'publication_rejected', [
    'submission_id' => $sid,
  ]);
}


/**
 * Apply hard stage gates at year boundaries.
 *   Year 6 (just finished year 5): each player must have published at least
 *     one article or book, OR have at least one submission still under review,
 *     else game-over with reason 'failed-comps'.
 *   Year 13 (just finished year 12): each player must have published at
 *     least one book, OR have at least one book-kind submission still under
 *     review, else game-over with reason 'tenure-denied'.
 *
 * The "or pending submission" clause is essential. A player who submits at
 * year 5 will not be credited for the publication until a peer reviewer
 * approves it (the soonest possible review is year 6), so without this
 * clause the year-6 gate would fail anyone who submitted in year 5 and
 * was waiting on review. Same logic at year 12 for books.
 */
function mp_apply_stage_gates($mysqli, $gameId, $newYear) {
  if ($newYear === 6) {
    $stmt = $mysqli->prepare("
      UPDATE mp_game_players p
      SET game_over_reason = 'failed-comps', stage = 'failed-comps'
      WHERE p.game_id = ?
        AND p.game_over_reason IS NULL
        AND p.articles_published = 0
        AND p.books_published = 0
        AND NOT EXISTS (
          SELECT 1 FROM mp_submissions s
          WHERE s.writer_player_id = p.player_id
            AND s.status IN ('pending','approved','auto-approved','objection-won')
        )
    ");
    $stmt->bind_param('i', $gameId);
    $stmt->execute();
    $stmt->close();
  }
  if ($newYear === 13) {
    $stmt = $mysqli->prepare("
      UPDATE mp_game_players p
      SET game_over_reason = 'tenure-denied', stage = 'tenure-denied'
      WHERE p.game_id = ?
        AND p.game_over_reason IS NULL
        AND p.books_published = 0
        AND NOT EXISTS (
          SELECT 1 FROM mp_submissions s
          WHERE s.writer_player_id = p.player_id
            AND s.kind = 'book'
            AND s.status IN ('pending','approved','auto-approved','objection-won')
        )
    ");
    $stmt->bind_param('i', $gameId);
    $stmt->execute();
    $stmt->close();
  }
}


/**
 * Update each player's stage label based on current year + books.
 * Also fires the year-3 comps event for any player who hasn't seen it.
 */
function mp_apply_stage_progression($mysqli, $gameId, $newYear) {
  // Compute new stages
  $stmt = $mysqli->prepare("
    SELECT player_id, books_published, comps_event_fired, game_over_reason, stage
    FROM mp_game_players WHERE game_id = ?
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  while ($p = $res->fetch_assoc()) {
    if ($p['game_over_reason']) continue;
    $books = (int) $p['books_published'];
    $newStage = mp_compute_stage($newYear, $books);

    $updates = [];
    $values  = [];
    $types   = '';

    if ($newStage !== $p['stage']) {
      $updates[] = 'stage = ?';
      $values[]  = $newStage;
      $types    .= 's';
    }
    if ($newYear === 3 && !$p['comps_event_fired']) {
      $updates[] = 'comps_event_fired = 1';
    }
    if (count($updates) > 0) {
      $pid = (int) $p['player_id'];
      $values[] = $pid;
      $types   .= 'i';
      $sql = "UPDATE mp_game_players SET " . implode(',', $updates) . " WHERE player_id = ?";
      $stmt2 = $mysqli->prepare($sql);
      $stmt2->bind_param($types, ...$values);
      $stmt2->execute();
      $stmt2->close();
    }
  }
  // Note: $stmt is the SELECT statement here, but we've already iterated
  // its result set. No close-then-prepare collision since $stmt2 is a
  // separate handle.
  $stmt->close();
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

function mp_compute_stage($year, $books) {
  if ($year <= 2) return 'graduate-student';
  if ($year <= 5) return 'abd';
  if ($year <= 12) return 'assistant-professor';
  if ($books >= 5) return 'endowed-professor';
  if ($books >= 3) return 'full-professor';
  return 'associate-professor';
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
function mp_compute_prestige($evidenceCards, $influenceBonus, $citedEvidenceCounts = [], $conclusionBonus = 0) {
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
  $base = $effectiveEvidence + $bonusSum + $concBonus + (int) $influenceBonus;

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
  $renownTable = [1, 2, 3, 6];

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

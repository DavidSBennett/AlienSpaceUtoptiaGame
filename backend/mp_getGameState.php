<?php
/**
 * mp_getGameState.php
 *
 * GET — returns the full game state from one player's perspective.
 *
 * This is the polling endpoint. Clients hit it every 3 seconds while a
 * game is active. To keep load manageable we support an optional
 * `since_version` query param: if the game's state_version hasn't changed,
 * we return a minimal "no changes" response.
 *
 * Query params:
 *   player_token   (required) authenticates the caller
 *   since_version  (optional) last state_version the client has seen
 *
 * Full response shape (when state has changed):
 *   {
 *     state_version: int,
 *     game: { game_id, idDeck, status, current_year, year_started_at,
 *             timer_seconds_default, timer_seconds_review,
 *             timer_deadline_at, host_player_id, max_players },
 *     you: { ... full player record, including hand cards (with content),
 *            projects, pending action, pending upgrade, stat levels },
 *     opponents: [ { player_id, player_name, seat_index, year, prestige,
 *                    stage, articles_published, books_published,
 *                    is_ghost, has_committed,
 *                    stat_levels, hand_size, tag_visible_cards_in_hand
 *                    (Phase B placeholder) }, ... ],
 *     archive_remaining: int,
 *     pending_submissions: [ ...visible to you for review or as writer ],
 *     resolved_submissions_for_you: [ ...your submissions that resolved
 *                                      since last poll, ready to claim ],
 *     published_works: [ ... Library; Phase B feature but data starts
 *                              populating from day 1 ]
 *   }
 *
 * Minimal "no change" response (when since_version matches current):
 *   {
 *     state_version: int,    (same as since_version)
 *     unchanged: true
 *   }
 *
 * IMPORTANT — opponent info masking:
 *   The caller sees their OWN hand cards in full (with content, tags, etc.)
 *   but only sees opponent SUMMARY info (counts, stats, year). Specifically:
 *     - Opponents' hand card contents: HIDDEN
 *     - Opponents' project contents: HIDDEN
 *     - Opponents' tags on held cards: HIDDEN (Phase A; will become VISIBLE
 *       in Phase B per the tag-inversion design)
 *
 *   What IS visible about opponents: name, seat, prestige, year, stage,
 *   publication counts, stat levels, has_committed flag, hand size.
 *
 * Because the polling endpoint must be cheap, we also opportunistically
 * advance the year here if all live players have committed — see the
 * "year resolution" section at the bottom. This means clients don't need
 * a separate "advance year" call; the year ticks naturally when conditions
 * are met during any player's next poll.
 */

require_once __DIR__ . '/mp_dbConfig.php';
require_once __DIR__ . '/mp_resolveYear.php';   // shared year-advance logic

mp_require_method('GET');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

$gameId   = (int) $game['game_id'];

// Host-controlled, table-wide display toggles. Read tolerantly so a deploy
// that lands before the 15_game_toggles.sql migration doesn't break state
// loading — they simply read as off until the columns exist.
$forceShowTags = 0;
$forceShowSignificance = 0;
try {
  $fsStmt = $mysqli->prepare("SELECT force_show_tags, force_show_significance FROM mp_games WHERE game_id = ?");
  $fsStmt->bind_param('i', $gameId);
  $fsStmt->execute();
  $fsRow = $fsStmt->get_result()->fetch_assoc();
  $fsStmt->close();
  if ($fsRow) {
    $forceShowTags = (int) $fsRow['force_show_tags'];
    $forceShowSignificance = (int) $fsRow['force_show_significance'];
  }
} catch (Throwable $e) {
  // columns not migrated yet — leave both off
}
$playerId = (int) $player['player_id'];

// ----- Possibly advance the year if conditions are met -----
// This is a no-op if not all players have committed yet, or if the game is
// not 'active'. Runs on every poll so the first poll after the last
// commitment triggers the year-end resolution.
// Each of these opens a `FOR UPDATE` transaction on the game row, so we run
// ONLY the one matching the current phase — running all three every poll
// caused lock contention (intermittent 500s / "lost connection") with several
// players polling at once. A phase transition is picked up by the next poll.
if ($game['status'] === 'active') {
  $curPhase = $game['phase'] ?? 'action';
  if ($curPhase === 'action') {
    // Resolve the year once everyone has committed (may flip into review).
    mp_maybe_resolve_year($mysqli, $gameId);
  } elseif ($curPhase === 'review') {
    // Advance the review barrier (also recovers from a concede mid-phase).
    mp_maybe_advance_review($mysqli, $gameId);
  } elseif ($curPhase === 'conference') {
    // Finish the conference once every attendee has drafted (or dropped).
    mp_maybe_finish_conference($mysqli, $gameId);
  } elseif ($curPhase === 'aftermath') {
    // Final-year writer-response window: finalize once no writer is blocking.
    mp_maybe_finish_aftermath($mysqli, $gameId);
  }
}

// ----- ALWAYS re-fetch the current game row before building state. -----
$stmt = $mysqli->prepare("SELECT * FROM mp_games WHERE game_id = ?");
$stmt->bind_param('i', $gameId);
$stmt->execute();
$res = $stmt->get_result();
$gameRow = $res->fetch_assoc();
$stmt->close();
if ($gameRow) {
  $game['current_year']    = (int) $gameRow['current_year'];
  $game['status']          = $gameRow['status'];
  $game['phase']           = $gameRow['phase'] ?? 'action';
  $game['review_index']    = (int) ($gameRow['review_index'] ?? 0);
  $game['year_started_at'] = $gameRow['year_started_at'];
  $game['state_version']   = (int) $gameRow['state_version'];
}

// NOTE: The since_version short-circuit (returning {unchanged: true}) has
// been removed. We were seeing client desync where one player's UI was
// stuck on a stale year and force-refresh was needed to recover. The
// version comparison was subtly returning unchanged when it shouldn't.
// For 2-5 player games on shared hosting, the bandwidth cost of always
// returning full state is negligible compared to the user experience
// cost of a frozen UI. We can revisit this optimization later if the
// game scales beyond Phase A.
//
// (The since_version query param is still accepted but ignored.)

// ----- Build the full state -----

// 1. Your full player record (including hand cards with content) -----
$you = mp_build_you($mysqli, $playerId);

// 2. Opponents — summary view only.
$opponents = mp_build_opponents($mysqli, $gameId, $playerId);

// 3. Archive remaining (how many cards left to draw)
$stmt = $mysqli->prepare("
  SELECT COUNT(*) AS n FROM mp_game_archive
  WHERE game_id = ? AND drawn_by_player_id IS NULL
");
$stmt->bind_param('i', $gameId);
$stmt->execute();
$res = $stmt->get_result();
$archiveRemaining = (int) $res->fetch_assoc()['n'];
$stmt->close();

// 4. Pending submissions — submissions you can review or are awaiting verdict on.
$pendingSubmissions = mp_build_pending_submissions($mysqli, $gameId, $playerId);

// 5. Resolved submissions where YOU were the writer and haven't seen the
//    verdict yet. These show as the "publication result" panel for you.
$resolvedForYou = mp_build_resolved_for_you($mysqli, $playerId);

// 5b. Your Submissions — for the "Out for Review" panel in the left column.
//     Includes both pending (awaiting review) and rejected (manuscripts
//     with bound cards you might want to reclaim). Excludes 'reclaimed'
//     (gone entirely) and 'approved' (now on the bookshelf).
$yourSubmissions = mp_build_your_submissions($mysqli, $playerId);

// Revise & Resubmit proposals awaiting THIS writer's decision.
$reviseDecisions = mp_build_revise_decisions($mysqli, $playerId);

// 6. Published works library (Phase B feature, data populated from Phase A on)
$publishedWorks = mp_build_published_works($mysqli, $gameId);

// 6b. Review phase — when the game is in the synchronous review interstitial,
//     the context-sensitive walk-through of every manuscript under review.
$reviewPhase = (($game['phase'] ?? 'action') === 'review')
  ? mp_build_review_phase($mysqli, $gameId, $playerId, (int) $game['review_index'])
  : null;

// 6c. Conference phase — the card-draft pool, pick order, and whose turn it is.
$conference = (($game['phase'] ?? 'action') === 'conference')
  ? mp_build_conference($mysqli, $gameId, $playerId)
  : null;

// 6d. Aftermath phase — final-year writer-response window. Lists this player's
//     manuscripts still awaiting a decision and who the table is waiting on.
$aftermath = (($game['phase'] ?? 'action') === 'aftermath')
  ? mp_build_aftermath($mysqli, $gameId, $playerId)
  : null;

// 7. Timer deadline — when does the current year auto-resolve?
//    Mirroring the fix in mp_resolveYear.php, we do this arithmetic in
//    MySQL rather than in PHP, so MySQL's clock and PHP's clock don't
//    have to agree on timezone. We return TWO numbers:
//      timer_deadline_unix — Unix epoch (seconds) of the deadline
//      timer_seconds_remaining — already-computed remaining seconds,
//        a convenience so the client doesn't even need to know the
//        deadline. Client just renders this count down each tick.
//    Both are based on the MySQL server's clock so there's no ambiguity.
$timerDeadlineUnix = null;
$timerSecondsRemaining = null;
$reviewActive  = count(array_filter($pendingSubmissions, function ($s) use ($playerId) {
  // "Review-active" = there's a submission you could review (not yours)
  return $s['writer_player_id'] !== $playerId && $s['status'] === 'pending';
})) > 0;

if ($game['year_started_at']) {
  $seconds = $reviewActive
    ? (int) $game['timer_seconds_review']
    : (int) $game['timer_seconds_default'];

  $stmt = $mysqli->prepare("
    SELECT
      UNIX_TIMESTAMP(year_started_at) + ? AS deadline_unix,
      ? - TIMESTAMPDIFF(SECOND, year_started_at, NOW()) AS remaining
    FROM mp_games WHERE game_id = ?
  ");
  $stmt->bind_param('iii', $seconds, $seconds, $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  if ($r = $res->fetch_assoc()) {
    $timerDeadlineUnix = (int) $r['deadline_unix'];
    $timerSecondsRemaining = max(0, (int) $r['remaining']);
  }
  $stmt->close();
}

// Recent events for the toast watcher. We cap at 30 — that's plenty
// to drive notifications without bloating every poll response, since
// the client only cares about events newer than what it's already
// shown. Sorted descending by event_id so the newest are first.
$recentEvents = [];
$evStmt = $mysqli->prepare("
  SELECT e.event_id, e.player_id, e.event_type, e.event_data, e.occurred_at AS created_at,
         p.player_name
  FROM mp_event_log e
  LEFT JOIN mp_game_players p ON p.player_id = e.player_id
  WHERE e.game_id = ?
  ORDER BY e.event_id DESC
  LIMIT 30
");
$evStmt->bind_param('i', $gameId);
$evStmt->execute();
$evRes = $evStmt->get_result();
while ($er = $evRes->fetch_assoc()) {
  $recentEvents[] = [
    'event_id'   => (int) $er['event_id'],
    'player_id'  => $er['player_id'] !== null ? (int) $er['player_id'] : null,
    'player_name'=> $er['player_name'],
    'event_type' => $er['event_type'],
    'event_data' => $er['event_data'] ? json_decode($er['event_data'], true) : null,
    'created_at' => $er['created_at'],
  ];
}
$evStmt->close();

// Recent chat messages — last 50, oldest-first (so the client just
// appends them to the chat panel without reversing). 500-char cap on
// content keeps this cheap to serve.
$chatMessages = [];
$cmStmt = $mysqli->prepare("
  SELECT message_id, player_id, player_name, content, created_at
  FROM (
    SELECT message_id, player_id, player_name, content, created_at
    FROM mp_chat_messages
    WHERE game_id = ?
    ORDER BY message_id DESC
    LIMIT 50
  ) AS recent
  ORDER BY message_id ASC
");
$cmStmt->bind_param('i', $gameId);
$cmStmt->execute();
$cmRes = $cmStmt->get_result();
while ($cm = $cmRes->fetch_assoc()) {
  $chatMessages[] = [
    'message_id'  => (int) $cm['message_id'],
    'player_id'   => $cm['player_id'] !== null ? (int) $cm['player_id'] : null,
    'player_name' => $cm['player_name'],
    'content'     => $cm['content'],
    'created_at'  => $cm['created_at'],
  ];
}
$cmStmt->close();

mp_json([
  'state_version' => (int) $game['state_version'],
  'game'          => [
    'game_id'       => $gameId,
    'idDeck'        => (int) $game['idDeck'],
    'status'        => $game['status'],
    'phase'         => $game['phase'] ?? 'action',
    'review_index'  => (int) ($game['review_index'] ?? 0),
    'current_year'  => (int) $game['current_year'],
    'total_years'   => (int) $game['total_years'],
    'year_started_at' => $game['year_started_at'],
    'timer_seconds_default' => (int) $game['timer_seconds_default'],
    'timer_seconds_review'  => (int) $game['timer_seconds_review'],
    'timer_deadline_unix'    => $timerDeadlineUnix,
    'timer_seconds_remaining' => $timerSecondsRemaining,
    'host_player_id' => $game['host_player_id'],
    'force_show_tags' => $forceShowTags,
    'force_show_significance' => $forceShowSignificance,
  ],
  'you'                          => $you,
  'opponents'                    => $opponents,
  'archive_remaining'            => $archiveRemaining,
  'pending_submissions'          => $pendingSubmissions,
  'review_phase'                 => $reviewPhase,
  'conference'                   => $conference,
  'aftermath'                    => $aftermath,
  'resolved_submissions_for_you' => $resolvedForYou,
  'your_submissions'             => $yourSubmissions,
  'revise_decisions_for_you'     => $reviseDecisions,
  'published_works'              => $publishedWorks,
  'recent_events'                => $recentEvents,
  'chat_messages'                => $chatMessages,
]);


// ============================================================================
// Builder functions — keep mp_json call site readable
// ============================================================================

/**
 * Build "you" — the calling player's full state, including hand cards (which
 * are fetched with full content because they're THEIR cards).
 */
function mp_build_you($mysqli, $playerId) {
  // Player row
  $stmt = $mysqli->prepare("SELECT * FROM mp_game_players WHERE player_id = ?");
  $stmt->bind_param('i', $playerId);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();
  if (!$row) mp_error('Player not found', 500);

  // Hand cards with full content
  $stmt = $mysqli->prepare("
    SELECT c.*
    FROM mp_player_hands h
    JOIN Cards c ON c.idCard = h.idCard
    WHERE h.player_id = ?
    ORDER BY h.added_year ASC, c.idCard ASC
  ");
  $stmt->bind_param('i', $playerId);
  $stmt->execute();
  $res = $stmt->get_result();
  $hand = [];
  while ($r = $res->fetch_assoc()) $hand[] = mp_card_for_you($r);
  $stmt->close();

  // Projects — fetch with conclusion + evidence resolved to full card rows
  $stmt = $mysqli->prepare("
    SELECT slot_index, conclusion_card_id, evidence_card_ids
    FROM mp_projects
    WHERE player_id = ?
    ORDER BY slot_index ASC
  ");
  $stmt->bind_param('i', $playerId);
  $stmt->execute();
  $res = $stmt->get_result();
  $projects = [];
  while ($r = $res->fetch_assoc()) {
    $evIds = $r['evidence_card_ids'] ? json_decode($r['evidence_card_ids'], true) : [];
    if (!is_array($evIds)) $evIds = [];

    $conclusion = null;
    if ($r['conclusion_card_id']) {
      $conclusion = mp_fetch_card($mysqli, (int) $r['conclusion_card_id']);
    }
    $evidence = [];
    foreach ($evIds as $ecid) {
      $card = mp_fetch_card($mysqli, (int) $ecid);
      if ($card) $evidence[] = mp_card_for_you($card);
    }

    // Load citations for this slot — they sit alongside evidence, with
    // their own visual rendering and prestige math.
    $slotIdx = (int) $r['slot_index'];
    $citations = [];
    $cstmt = $mysqli->prepare("
      SELECT c.citation_id, c.cited_work_id, c.added_at,
             w.publication_title, w.conclusion_tag, w.year_published, w.kind AS work_kind,
             w.evidence_count AS cited_evidence_count, w.citation_value,
             w.writer_player_id, p.player_name AS writer_name, p.seat_index AS writer_seat
      FROM mp_citations c
      JOIN mp_published_works w ON w.work_id = c.cited_work_id
      JOIN mp_game_players p ON p.player_id = w.writer_player_id
      WHERE c.player_id = ? AND c.slot_index = ?
      ORDER BY c.added_at ASC
    ");
    $cstmt->bind_param('ii', $playerId, $slotIdx);
    $cstmt->execute();
    $cres = $cstmt->get_result();
    while ($cr = $cres->fetch_assoc()) {
      $citedEv = (int) $cr['cited_evidence_count'];
      $citations[] = [
        'citation_id'      => (int) $cr['citation_id'],
        'cited_work_id'    => (int) $cr['cited_work_id'],
        'title'            => $cr['publication_title'],
        'conclusion_tag'   => $cr['conclusion_tag'],
        'year_published'   => (int) $cr['year_published'],
        'work_kind'        => $cr['work_kind'],
        // The cited work's evidence count, and the FLAT prestige bonus this
        // citation brings to the citing manuscript (its recorded citation_value
        // = half the cited work's conclusion prestige contribution).
        'cited_evidence_count'        => $citedEv,
        'prestige_contrib'            => (int) $cr['citation_value'],
        'writer_player_id' => (int) $cr['writer_player_id'],
        'writer_name'      => $cr['writer_name'],
        'writer_seat'      => (int) $cr['writer_seat'],
      ];
    }
    $cstmt->close();

    $projects[] = [
      'slot_index' => $slotIdx,
      'conclusion' => $conclusion ? mp_card_for_you($conclusion) : null,
      'evidence'   => $evidence,
      'citations'  => $citations,
    ];
  }
  $stmt->close();

  // Pending action data is JSON; decode it for the client
  $pendingActionData = null;
  if (!empty($row['pending_action_data'])) {
    $pendingActionData = json_decode($row['pending_action_data'], true);
  }

  return [
    'player_id'         => (int) $row['player_id'],
    'player_name'       => $row['player_name'],
    'seat_index'        => (int) $row['seat_index'],
    'is_ghost'          => (bool) $row['is_ghost'],
    'consecutive_timeouts' => (int) $row['consecutive_timeouts'],
    'prestige'          => (int) $row['prestige'],
    'articles_published'=> (int) $row['articles_published'],
    'books_published'   => (int) $row['books_published'],
    'stage'             => $row['stage'],
    'comps_event_fired' => (bool) $row['comps_event_fired'],
    'game_over_reason'  => $row['game_over_reason'],
    'stat_levels'       => [
      'research'         => (int) $row['research_level'],
      'notebookCapacity' => (int) $row['notebook_level'],
      'influence'        => (int) $row['influence_level'],
      'workspaces'       => (int) $row['workspaces_level'],
      'reputation'       => (int) $row['reputation_level'],
      'renown'           => (int) $row['renown_level'],
    ],
    'citations_received_count'   => (int) $row['citations_received_count'],
    'objection_tokens_remaining' => (int) $row['objection_tokens_remaining'],
    'pending_action'             => $row['pending_action'],
    'pending_action_data'        => $pendingActionData,
    'pending_action_committed'   => (bool) $row['pending_action_committed'],
    'pending_upgrade'            => (bool) $row['pending_upgrade'],
    'pending_upgrade_reason'     => $row['pending_upgrade_reason'],
    'hand'                       => $hand,
    'projects'                   => $projects,
  ];
}


/**
 * Build opponents — summary view, NO card contents leaked.
 */
function mp_build_opponents($mysqli, $gameId, $playerId) {
  $stmt = $mysqli->prepare("
    SELECT p.*, (SELECT COUNT(*) FROM mp_player_hands h WHERE h.player_id = p.player_id) AS hand_size
    FROM mp_game_players p
    WHERE p.game_id = ? AND p.player_id != ?
    ORDER BY p.seat_index ASC
  ");
  $stmt->bind_param('ii', $gameId, $playerId);
  $stmt->execute();
  $res = $stmt->get_result();
  $opponents = [];
  while ($row = $res->fetch_assoc()) {
    $opponents[] = [
      'player_id'         => (int) $row['player_id'],
      'player_name'       => $row['player_name'],
      'seat_index'        => (int) $row['seat_index'],
      'is_ghost'          => (bool) $row['is_ghost'],
      'prestige'          => (int) $row['prestige'],
      'articles_published'=> (int) $row['articles_published'],
      'books_published'   => (int) $row['books_published'],
      'citations_received_count' => (int) $row['citations_received_count'],
      'stage'             => $row['stage'],
      'game_over_reason'  => $row['game_over_reason'],
      'stat_levels' => [
        'research'         => (int) $row['research_level'],
        'notebookCapacity' => (int) $row['notebook_level'],
        'influence'        => (int) $row['influence_level'],
        'workspaces'       => (int) $row['workspaces_level'],
        'reputation'       => (int) $row['reputation_level'],
        'renown'           => (int) $row['renown_level'],
      ],
      'hand_size'              => (int) $row['hand_size'],
      'has_committed'          => (bool) $row['pending_action_committed'],
      // Phase B: this will become a count of which-tags-are-on-opponent-cards.
      // Phase A returns null so clients can render a placeholder.
      'tag_visible_cards_in_hand' => null,
    ];
  }
  $stmt->close();
  return $opponents;
}


/**
 * Submissions awaiting review — the "manuscript inbox" of OTHER players'
 * pending submissions that the caller can choose to review. Caller's own
 * pending submissions are returned by mp_build_your_submissions, not here.
 *
 * Reviewer-side info-leak control: we strip card contents and return only
 * title + author + tags per design. The reviewer judges by titles + tags
 * + the prose argument, never by reading the actual source content.
 */
function mp_build_pending_submissions($mysqli, $gameId, $youId) {
  $stmt = $mysqli->prepare("
    SELECT s.*, p.player_name AS writer_name, p.seat_index AS writer_seat
    FROM mp_submissions s
    JOIN mp_game_players p ON p.player_id = s.writer_player_id
    WHERE s.game_id = ? AND s.status = 'pending' AND s.writer_player_id != ?
    ORDER BY s.year_submitted ASC, s.submission_id ASC
  ");
  $stmt->bind_param('ii', $gameId, $youId);
  $stmt->execute();
  $res = $stmt->get_result();
  $submissions = [];
  while ($row = $res->fetch_assoc()) {
    $evIds = json_decode($row['evidence_card_ids'], true) ?: [];

    // Look up which players have already reviewed this submission so we
    // don't double-volunteer (reviews are unique per submission+reviewer).
    $reviewStmt = $mysqli->prepare("
      SELECT reviewer_player_id, verdict
      FROM mp_reviews WHERE submission_id = ?
    ");
    $sid = (int) $row['submission_id'];
    $reviewStmt->bind_param('i', $sid);
    $reviewStmt->execute();
    $reviewRes = $reviewStmt->get_result();
    $reviewersSoFar = [];
    while ($rr = $reviewRes->fetch_assoc()) {
      $reviewersSoFar[] = [
        'reviewer_player_id' => (int) $rr['reviewer_player_id'],
        'verdict'            => $rr['verdict'],
      ];
    }
    $reviewStmt->close();

    // Evidence — reviewer-safe view: title + author + tags only.
    // Content / significance / date / location are intentionally omitted.
    $evidence = [];
    foreach ($evIds as $eid) {
      $card = mp_fetch_card($mysqli, (int) $eid);
      if (!$card) continue;
      $evidence[] = [
        'idCard'    => (int) $card['idCard'],
        'title'     => $card['title'],
        'author'    => $card['author'] ?? null,
        'argument'  => $card['argument'] ?? null,
        'sub_argument' => $card['sub_argument'] ?? null,
      ];
    }

    // Citations — Phase B: reviewers also see the works this submission
    // cites, so they can judge whether the cited tags fit the conclusion.
    // Citations are shown alongside evidence in the review dialog.
    $citedWorkIds = isset($row['cited_work_ids']) && $row['cited_work_ids']
                      ? (json_decode($row['cited_work_ids'], true) ?: [])
                      : [];
    $citations = [];
    if (count($citedWorkIds) > 0) {
      $placeholders = implode(',', array_fill(0, count($citedWorkIds), '?'));
      $types = str_repeat('i', count($citedWorkIds));
      $sql = "SELECT w.work_id, w.publication_title, w.conclusion_tag, w.kind,
                     w.writer_player_id, w.year_published,
                     p.player_name AS writer_name, p.seat_index AS writer_seat
              FROM mp_published_works w
              JOIN mp_game_players p ON p.player_id = w.writer_player_id
              WHERE w.work_id IN ($placeholders)";
      $cstmt = $mysqli->prepare($sql);
      $cstmt->bind_param($types, ...$citedWorkIds);
      $cstmt->execute();
      $cres = $cstmt->get_result();
      while ($cr = $cres->fetch_assoc()) {
        $citations[] = [
          'work_id'           => (int) $cr['work_id'],
          'publication_title' => $cr['publication_title'],
          'conclusion_tag'    => $cr['conclusion_tag'],
          'kind'              => $cr['kind'],
          'writer_name'       => $cr['writer_name'],
          'writer_seat'       => (int) $cr['writer_seat'],
          'year_published'    => (int) $cr['year_published'],
        ];
      }
      $cstmt->close();
    }

    // Conclusion is from the public shelf — visible to everyone.
    $conclusion = mp_fetch_card($mysqli, (int) $row['conclusion_card_id']);

    $submissions[] = [
      'submission_id'    => (int) $row['submission_id'],
      'writer_player_id' => (int) $row['writer_player_id'],
      'writer_name'      => $row['writer_name'],
      'writer_seat'      => (int) $row['writer_seat'],
      'year_submitted'   => (int) $row['year_submitted'],
      'kind'             => $row['kind'],
      'conclusion'       => $conclusion ? mp_card_for_you($conclusion) : null,
      'evidence'         => $evidence,
      'citations'        => $citations,
      'argument_text'    => $row['argument_text'],
      'status'           => $row['status'],
      'reviewers_so_far' => $reviewersSoFar,
    ];
  }
  $stmt->close();
  return $submissions;
}


/**
 * Build the review-phase payload: the ordered manuscripts under review, each
 * with context-sensitive content (the writer sees full evidence; everyone else
 * sees the reviewer-safe view of title/author/tags), plus the caller's recorded
 * verdict and per-manuscript readiness (who has clicked Continue). Drives the
 * synchronous ReviewPhaseModal on the client.
 */
function mp_build_review_phase($mysqli, $gameId, $youId, $reviewIndex) {
  // Live roster (the barrier set) — name + seat for the "waiting on …" strip.
  $stmt = $mysqli->prepare("
    SELECT player_id, player_name, seat_index
    FROM mp_game_players
    WHERE game_id = ? AND is_ghost = 0 AND game_over_reason IS NULL
    ORDER BY seat_index ASC
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $livePlayers = [];
  while ($r = $res->fetch_assoc()) {
    $livePlayers[] = [
      'player_id'   => (int) $r['player_id'],
      'player_name' => $r['player_name'],
      'seat_index'  => (int) $r['seat_index'],
    ];
  }
  $stmt->close();

  // Ordered manuscripts (same order as mp_review_submission_ids()).
  $stmt = $mysqli->prepare("
    SELECT s.*, p.player_name AS writer_name, p.seat_index AS writer_seat
    FROM mp_submissions s
    JOIN mp_game_players p ON p.player_id = s.writer_player_id
    WHERE s.game_id = ? AND s.status = 'pending'
    ORDER BY s.submission_id ASC
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $rows = [];
  while ($r = $res->fetch_assoc()) $rows[] = $r;
  $stmt->close();

  $manuscripts = [];
  foreach ($rows as $row) {
    $sid      = (int) $row['submission_id'];
    $writerId = (int) $row['writer_player_id'];
    $isWriter = ($writerId === $youId);
    $evIds    = json_decode($row['evidence_card_ids'], true) ?: [];

    // Evidence — writer sees full content/significance; reviewers see the
    // reviewer-safe subset (title/author/tags only).
    $evidence = [];
    foreach ($evIds as $eid) {
      $card = mp_fetch_card($mysqli, (int) $eid);
      if (!$card) continue;
      if ($isWriter) {
        $evidence[] = mp_card_for_you($card);
      } else {
        $evidence[] = [
          'idCard'       => (int) $card['idCard'],
          'title'        => $card['title'],
          'author'       => $card['author'] ?? null,
          'argument'     => $card['argument'] ?? null,
          'sub_argument' => $card['sub_argument'] ?? null,
        ];
      }
    }

    // Citations (reviewer-visible shape, same as the review dialog).
    $citedWorkIds = isset($row['cited_work_ids']) && $row['cited_work_ids']
                      ? (json_decode($row['cited_work_ids'], true) ?: [])
                      : [];
    $citations = [];
    if (count($citedWorkIds) > 0) {
      $ph = implode(',', array_fill(0, count($citedWorkIds), '?'));
      $types = str_repeat('i', count($citedWorkIds));
      $sql = "SELECT w.work_id, w.publication_title, w.conclusion_tag, w.kind,
                     w.writer_player_id, w.year_published,
                     p.player_name AS writer_name, p.seat_index AS writer_seat
              FROM mp_published_works w
              JOIN mp_game_players p ON p.player_id = w.writer_player_id
              WHERE w.work_id IN ($ph)";
      $cstmt = $mysqli->prepare($sql);
      $cstmt->bind_param($types, ...$citedWorkIds);
      $cstmt->execute();
      $cres = $cstmt->get_result();
      while ($cr = $cres->fetch_assoc()) {
        $citations[] = [
          'work_id'           => (int) $cr['work_id'],
          'publication_title' => $cr['publication_title'],
          'conclusion_tag'    => $cr['conclusion_tag'],
          'kind'              => $cr['kind'],
          'writer_name'       => $cr['writer_name'],
          'writer_seat'       => (int) $cr['writer_seat'],
          'year_published'    => (int) $cr['year_published'],
        ];
      }
      $cstmt->close();
    }

    $conclusion = mp_fetch_card($mysqli, (int) $row['conclusion_card_id']);

    // Your recorded verdict on this manuscript (reviewers only).
    $yourVerdict = null;
    if (!$isWriter) {
      $vstmt = $mysqli->prepare("SELECT verdict, flagged_card_ids, added_card_ids, comment FROM mp_reviews WHERE submission_id = ? AND reviewer_player_id = ?");
      $vstmt->bind_param('ii', $sid, $youId);
      $vstmt->execute();
      $vr = $vstmt->get_result()->fetch_assoc();
      $vstmt->close();
      if ($vr) {
        $yourVerdict = [
          'verdict'          => $vr['verdict'],
          'flagged_card_ids' => $vr['flagged_card_ids'] ? (json_decode($vr['flagged_card_ids'], true) ?: []) : [],
          'added_card_ids'   => $vr['added_card_ids'] ? (json_decode($vr['added_card_ids'], true) ?: []) : [],
          'comment'          => $vr['comment'],
        ];
      }
    }

    // Readiness — who has clicked Continue for this manuscript.
    $rstmt = $mysqli->prepare("SELECT player_id FROM mp_review_progress WHERE submission_id = ?");
    $rstmt->bind_param('i', $sid);
    $rstmt->execute();
    $rres = $rstmt->get_result();
    $readyIds = [];
    while ($rr = $rres->fetch_assoc()) $readyIds[] = (int) $rr['player_id'];
    $rstmt->close();

    $manuscripts[] = [
      'submission_id'    => $sid,
      'writer_player_id' => $writerId,
      'writer_name'      => $row['writer_name'],
      'writer_seat'      => (int) $row['writer_seat'],
      'year_submitted'   => (int) $row['year_submitted'],
      'kind'             => $row['kind'],
      'is_writer'        => $isWriter,
      'conclusion'       => $conclusion ? mp_card_for_you($conclusion) : null,
      'evidence'         => $evidence,
      'citations'        => $citations,
      'argument_text'    => $row['argument_text'],
      'your_verdict'     => $yourVerdict,
      'ready_player_ids' => $readyIds,
    ];
  }

  return [
    'current_index' => $reviewIndex,
    'total'         => count($manuscripts),
    'manuscripts'   => $manuscripts,
    'live_players'  => $livePlayers,
  ];
}


/**
 * Build the conference payload: the attendees in pick order, whose turn it is,
 * and the pool of cards you may draft (untaken, and not ones you contributed).
 * Pool cards carry full content/tags/significance so attendees can choose well.
 */
function mp_build_conference($mysqli, $gameId, $youId) {
  $stmt = $mysqli->prepare("
    SELECT a.player_id, a.take_limit, a.taken_count, a.done, a.draft_order,
           p.player_name, p.seat_index
    FROM mp_conference_attendees a
    JOIN mp_game_players p ON p.player_id = a.player_id
    WHERE a.game_id = ?
    ORDER BY a.draft_order ASC
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $attendees = [];
  $currentPickerId = null;
  $you = null;
  while ($r = $res->fetch_assoc()) {
    $pid = (int) $r['player_id'];
    $done = (int) $r['done'] === 1;
    if ($currentPickerId === null && !$done) $currentPickerId = $pid;
    $entry = [
      'player_id'   => $pid,
      'player_name' => $r['player_name'],
      'seat_index'  => (int) $r['seat_index'],
      'take_limit'  => (int) $r['take_limit'],
      'taken_count' => (int) $r['taken_count'],
      'done'        => $done,
    ];
    $attendees[] = $entry;
    if ($pid === $youId) $you = $entry;
  }
  $stmt->close();

  // Pool you may draft from: untaken and not contributed by you.
  $stmt = $mysqli->prepare("
    SELECT pool_id, idCard
    FROM mp_conference_pool
    WHERE game_id = ? AND taken_by_player_id IS NULL
      AND (contributor_player_id IS NULL OR contributor_player_id <> ?)
    ORDER BY pool_id ASC
  ");
  $stmt->bind_param('ii', $gameId, $youId);
  $stmt->execute();
  $res = $stmt->get_result();
  $pool = [];
  while ($r = $res->fetch_assoc()) {
    $card = mp_fetch_card($mysqli, (int) $r['idCard']);
    if (!$card) continue;
    $entry = mp_card_for_you($card);
    $entry['pool_id'] = (int) $r['pool_id'];
    $pool[] = $entry;
  }
  $stmt->close();

  return [
    'attendees'         => $attendees,
    'current_picker_id' => $currentPickerId,
    'is_your_turn'      => ($currentPickerId !== null && $currentPickerId === $youId),
    'you'               => $you,   // null if you didn't attend
    'pool'              => $pool,
  ];
}


/**
 * Resolved submissions where YOU were the writer and you haven't yet
 * dismissed the result. Shown to the writer as the publication result
 * dialog (the four-button modal with Dismiss/Consolation/Reclaim/Object).
 *
 * Also returns the still-active rejected manuscripts whose dialog has
 * been dismissed but still have cards bound — these are re-openable from
 * the "Out for Review" list. We mark them with already_dismissed=true so
 * the client knows whether to auto-pop or wait for a click.
 *
 * Includes consolation_drawn (to grey out the button), current
 * evidence_card_ids and conclusion (so the modal can show what's
 * recoverable), and the reviewer verdicts/flagged cards.
 */
function mp_build_resolved_for_you($mysqli, $youId) {
  $stmt = $mysqli->prepare("
    SELECT s.*
    FROM mp_submissions s
    WHERE s.writer_player_id = ?
      AND s.status IN ('approved','rejected','auto-approved','auto-rejected',
                       'objection-won','objection-lost')
    ORDER BY s.resolved_year ASC
  ");
  $stmt->bind_param('i', $youId);
  $stmt->execute();
  $res = $stmt->get_result();
  $resolved = [];
  while ($row = $res->fetch_assoc()) {
    // For resolved subs, fetch the reviewer's verdicts and flagged cards.
    $rStmt = $mysqli->prepare("
      SELECT r.*, p.player_name AS reviewer_name
      FROM mp_reviews r
      JOIN mp_game_players p ON p.player_id = r.reviewer_player_id
      WHERE r.submission_id = ?
    ");
    $sid = (int) $row['submission_id'];
    $rStmt->bind_param('i', $sid);
    $rStmt->execute();
    $rRes = $rStmt->get_result();
    $reviews = [];
    while ($rr = $rRes->fetch_assoc()) {
      $flagged = $rr['flagged_card_ids'] ? json_decode($rr['flagged_card_ids'], true) : [];
      $reviews[] = [
        'reviewer_player_id' => (int) $rr['reviewer_player_id'],
        'reviewer_name'      => $rr['reviewer_name'],
        'verdict'            => $rr['verdict'],
        'flagged_card_ids'   => $flagged,
        'comment'            => $rr['comment'],
        'reviewed_year'      => (int) $rr['reviewed_year'],
      ];
    }
    $rStmt->close();

    // Decode the remaining bound evidence (relevant for rejections).
    $evIds = $row['evidence_card_ids'] ? json_decode($row['evidence_card_ids'], true) : [];
    if (!is_array($evIds)) $evIds = [];

    // For rejections, include full card details so the modal can show
    // what's recoverable. (Writer is allowed to see their own evidence.)
    $boundEvidence = [];
    foreach ($evIds as $cid) {
      $card = mp_fetch_card($mysqli, (int) $cid);
      if ($card) $boundEvidence[] = mp_card_for_you($card);
    }
    $conclusionCard = mp_fetch_card($mysqli, (int) $row['conclusion_card_id']);

    $isRejection = in_array($row['status'], ['rejected','auto-rejected','objection-lost'], true);
    // Auto-pop the result modal whenever the writer hasn't dismissed it
    // yet — regardless of whether it's an approval or rejection. The
    // modal handles approvals (Continue button) and rejections (4-button
    // set-aside / consolation / reclaim / object) differently. We MUST
    // pop on every fresh resolution so the writer sees the result and,
    // for approvals, gets the upgrade chooser unblocked.
    $autoPop = !((bool) $row['writer_seen_result']);

    $resolved[] = [
      'submission_id'     => (int) $row['submission_id'],
      'status'            => $row['status'],
      'year_submitted'    => (int) $row['year_submitted'],
      'resolved_year'     => (int) $row['resolved_year'],
      'kind'              => $row['kind'],
      'prestige_granted'  => $row['prestige_granted'] !== null ? (int) $row['prestige_granted'] : null,
      'publication_title' => $row['publication_title'],
      'reviews'           => $reviews,
      'conclusion_card_id'=> (int) $row['conclusion_card_id'],
      'conclusion'        => $conclusionCard ? mp_card_for_you($conclusionCard) : null,
      'bound_evidence'    => $boundEvidence,
      'consolation_drawn' => (bool) $row['consolation_drawn'],
      'writer_seen_result'=> (bool) $row['writer_seen_result'],
      'is_rejection'      => $isRejection,
      'auto_pop'          => $autoPop,
    ];
  }
  $stmt->close();
  return $resolved;
}


/**
 * Your in-flight submissions — shown in the "Out for Review" panel on
 * the left column. Includes:
 *   - status='pending'  (awaiting peer review)
 *   - status='rejected' or 'auto-rejected' or 'objection-lost' AND
 *     evidence is still bound (not all reclaimed)
 *
 * Excludes:
 *   - 'approved' family — those become books on the bookshelf
 *   - 'reclaimed' — manuscript is gone, no need to display
 *
 * For pending entries, returns title (from conclusion) for display in
 * the spine. Rejected entries also have flagged_card_ids from the most
 * recent rejection so the modal can show "these cards didn't work."
 */
/**
 * Revise & Resubmit proposals awaiting THIS writer's decision (submissions
 * in 'revise-pending'). Bundles the conclusion, the surviving vs. flagged
 * original evidence, the reviewer's proposed additions (with content — the
 * writer is entitled to see their own manuscript in full), and the reviewer's
 * name, so the frontend can pop the accept / object / rebuild decision modal.
 */
function mp_build_revise_decisions($mysqli, $youId) {
  $stmt = $mysqli->prepare("
    SELECT * FROM mp_submissions
    WHERE writer_player_id = ? AND status = 'revise-pending'
    ORDER BY submission_id ASC
  ");
  $stmt->bind_param('i', $youId);
  $stmt->execute();
  $res = $stmt->get_result();
  $out = [];
  while ($row = $res->fetch_assoc()) {
    $sid = (int) $row['submission_id'];

    $rStmt = $mysqli->prepare("
      SELECT r.*, p.player_name AS reviewer_name
      FROM mp_reviews r
      JOIN mp_game_players p ON p.player_id = r.reviewer_player_id
      WHERE r.submission_id = ? AND r.verdict = 'revise'
      ORDER BY r.review_id DESC LIMIT 1
    ");
    $rStmt->bind_param('i', $sid);
    $rStmt->execute();
    $rev = $rStmt->get_result()->fetch_assoc();
    $rStmt->close();
    if (!$rev) continue;

    $flagged = $rev['flagged_card_ids'] ? (json_decode($rev['flagged_card_ids'], true) ?: []) : [];
    $added   = $rev['added_card_ids']   ? (json_decode($rev['added_card_ids'], true) ?: [])   : [];
    $flagged = array_map('intval', $flagged);
    $added   = array_map('intval', $added);

    $origEv = $row['evidence_card_ids'] ? (json_decode($row['evidence_card_ids'], true) ?: []) : [];
    $origEv = array_map('intval', $origEv);
    $flaggedSet = array_flip($flagged);

    $keptCards = [];
    $removedCards = [];
    foreach ($origEv as $cid) {
      $card = mp_fetch_card($mysqli, $cid);
      if (!$card) continue;
      $c = mp_card_for_you($card);
      if (isset($flaggedSet[$cid])) $removedCards[] = $c;
      else $keptCards[] = $c;
    }
    $addedCards = [];
    foreach ($added as $cid) {
      $card = mp_fetch_card($mysqli, $cid);
      if ($card) $addedCards[] = mp_card_for_you($card);
    }

    $conc = mp_fetch_card($mysqli, (int) $row['conclusion_card_id']);

    $out[] = [
      'submission_id'    => $sid,
      'kind'             => $row['kind'],
      'year_submitted'   => (int) $row['year_submitted'],
      'reviewer_name'    => $rev['reviewer_name'],
      'reviewer_comment' => $rev['comment'],
      'conclusion'       => $conc ? [
        'title'       => $conc['title'] ?? 'Untitled',
        'description' => $conc['description'] ?? '',
      ] : null,
      'kept_cards'    => $keptCards,
      'removed_cards' => $removedCards,
      'added_cards'   => $addedCards,
      'auto_pop'      => !((bool) $row['writer_seen_result']),
    ];
  }
  $stmt->close();
  return $out;
}


/**
 * Aftermath phase payload (final-year writer-response window). Returns this
 * player's manuscripts still awaiting a decision (revise-pending, plus
 * rejections they can still contest if they hold >=2 objection tokens), their
 * sign-off flag, and the live writers the table is still waiting on. The actual
 * resolution reuses the normal Revise & Resubmit / result dialogs, which the
 * frontend pops from revise_decisions_for_you / resolved_submissions_for_you.
 */
function mp_build_aftermath($mysqli, $gameId, $youId) {
  $stmt = $mysqli->prepare("
    SELECT objection_tokens_remaining, aftermath_ready
    FROM mp_game_players WHERE player_id = ?
  ");
  $stmt->bind_param('i', $youId);
  $stmt->execute();
  $me = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  $tokens   = $me ? (int) $me['objection_tokens_remaining'] : 0;
  $youReady = $me ? (bool) $me['aftermath_ready'] : false;

  // Your open responses.
  $open = [];
  $stmt = $mysqli->prepare("
    SELECT s.submission_id, s.kind, s.status, c.title AS conclusion_title
    FROM mp_submissions s
    LEFT JOIN Cards c ON c.idCard = s.conclusion_card_id
    WHERE s.writer_player_id = ?
      AND (s.status = 'revise-pending' OR s.status = 'rejected')
    ORDER BY s.submission_id ASC
  ");
  $stmt->bind_param('i', $youId);
  $stmt->execute();
  $res = $stmt->get_result();
  while ($r = $res->fetch_assoc()) {
    // A plain rejection is only actionable if you can afford to contest it.
    if ($r['status'] === 'rejected' && $tokens < 2) continue;
    $open[] = [
      'submission_id'    => (int) $r['submission_id'],
      'kind'             => $r['kind'],
      'conclusion_title' => $r['conclusion_title'] ?? 'Untitled',
      'resp_type'        => $r['status'] === 'revise-pending' ? 'revise' : 'objectable',
    ];
  }
  $stmt->close();

  // Live writers the table is still waiting on (not resolved, not signed off).
  $waiting = [];
  $stmt = $mysqli->prepare("
    SELECT DISTINCT p.player_name
    FROM mp_game_players p
    JOIN mp_submissions s ON s.writer_player_id = p.player_id
    WHERE p.game_id = ?
      AND p.game_over_reason IS NULL AND p.is_ghost = 0
      AND p.aftermath_ready = 0
      AND (
        s.status = 'revise-pending'
        OR (s.status = 'rejected' AND p.objection_tokens_remaining >= 2)
      )
    ORDER BY p.player_name ASC
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  while ($r = $res->fetch_assoc()) $waiting[] = $r['player_name'];
  $stmt->close();

  return [
    'you_ready'  => $youReady,
    'your_open'  => $open,
    'waiting_on' => $waiting,
  ];
}


function mp_build_your_submissions($mysqli, $youId) {
  $stmt = $mysqli->prepare("
    SELECT s.* FROM mp_submissions s
    WHERE s.writer_player_id = ?
      AND (
        s.status IN ('pending', 'revise-pending')
        OR (
          s.status IN ('rejected','auto-rejected','objection-lost')
          AND JSON_LENGTH(IFNULL(s.evidence_card_ids, '[]')) > 0
        )
      )
    ORDER BY s.year_submitted ASC, s.submission_id ASC
  ");
  $stmt->bind_param('i', $youId);
  $stmt->execute();
  $res = $stmt->get_result();
  $out = [];
  while ($row = $res->fetch_assoc()) {
    $conc = mp_fetch_card($mysqli, (int) $row['conclusion_card_id']);
    $evIds = $row['evidence_card_ids'] ? json_decode($row['evidence_card_ids'], true) : [];
    if (!is_array($evIds)) $evIds = [];

    $isRejection = in_array($row['status'], ['rejected','auto-rejected','objection-lost'], true);
    $out[] = [
      'submission_id'    => (int) $row['submission_id'],
      'status'           => $row['status'],
      'kind'             => $row['kind'],
      'year_submitted'   => (int) $row['year_submitted'],
      'resolved_year'    => $row['resolved_year'] ? (int) $row['resolved_year'] : null,
      'conclusion_title' => $conc ? ($conc['title'] ?? 'Untitled') : 'Untitled',
      'evidence_count'   => count($evIds),
      'is_rejection'     => $isRejection,
      'consolation_drawn'=> (bool) $row['consolation_drawn'],
      'writer_seen_result' => (bool) $row['writer_seen_result'],
    ];
  }
  $stmt->close();
  return $out;
}


/**
 * Library of all published works in this game. Phase B feature; Phase A
 * still populates the table so clients can show a basic Library readout.
 */
function mp_build_published_works($mysqli, $gameId) {
  // JOIN to Cards to get the conclusion's title text (the actual thesis
  // the book argues), so the publication modal can show it to players
  // as a context clue. The conclusion's argument tag CODE is still
  // returned in the payload because client logic uses it for warnings
  // (the auto-reject mismatch ribbon on your own cited spines) and the
  // end-game Broadest-Scholar award needs the per-evidence tags. The
  // UI is responsible for not surfacing tag codes during the
  // decide-whether-to-cite flow — players gamble on titles, authors,
  // and the prose thesis, not bureaucratic letters.
  $stmt = $mysqli->prepare("
    SELECT w.*, p.player_name AS writer_name, p.seat_index AS writer_seat,
           c.title AS conclusion_title
    FROM mp_published_works w
    JOIN mp_game_players p ON p.player_id = w.writer_player_id
    LEFT JOIN Cards c ON c.idCard = w.conclusion_card_id
    WHERE w.game_id = ?
    ORDER BY w.year_published ASC, w.work_id ASC
  ");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $works = [];
  while ($row = $res->fetch_assoc()) {
    $snapshot = $row['evidence_snapshot'] ? json_decode($row['evidence_snapshot'], true) : [];
    $works[] = [
      'work_id'           => (int) $row['work_id'],
      'writer_player_id'  => (int) $row['writer_player_id'],
      'writer_name'       => $row['writer_name'],
      'writer_seat'       => (int) $row['writer_seat'],
      'publication_title' => $row['publication_title'],
      'conclusion_tag'    => $row['conclusion_tag'],
      'conclusion_title'  => $row['conclusion_title'],
      'kind'              => $row['kind'],
      'evidence_count'    => (int) $row['evidence_count'],
      'evidence_snapshot' => $snapshot,
      'prestige_granted'  => (int) $row['prestige_granted'],
      'citation_value'    => (int) ($row['citation_value'] ?? 0),
      'year_published'    => (int) $row['year_published'],
    ];
  }
  $stmt->close();
  return $works;
}


/**
 * Fetch a single card row from Cards table.
 * Returns associative array or null.
 */
function mp_fetch_card($mysqli, $idCard) {
  $stmt = $mysqli->prepare("SELECT * FROM Cards WHERE idCard = ? LIMIT 1");
  $stmt->bind_param('i', $idCard);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();
  return $row ?: null;
}


/**
 * Format a card row for "you can see this fully" contexts (your own hand,
 * your own projects, the conclusion shelf). The format matches what the
 * existing single-player listCards.php returns so the React Card.jsx
 * component can render it without changes.
 */
function mp_card_for_you($card) {
  return [
    'idCard'          => isset($card['idCard']) ? (int) $card['idCard'] : null,
    // The React code uses `id` in some places — match listCards.php which
    // returns idCard. Keep both for backward compat. Card.jsx reads .id.
    'id'              => isset($card['idCard']) ? (int) $card['idCard'] : null,
    'idDeck'          => isset($card['idDeck']) ? (int) $card['idDeck'] : null,
    'title'           => $card['title'] ?? '',
    'source_type'     => $card['source_type'] ?? '',
    'sequence_number' => isset($card['sequence_number']) ? (int) $card['sequence_number'] : null,
    'content'         => $card['content'] ?? '',
    'date'            => $card['date'] ?? '',
    'author'          => $card['author'] ?? '',
    'location'        => $card['location'] ?? '',
    'significance'    => $card['significance'] ?? '',
    'image_url'       => $card['image_url'] ?? '',
    'argument'        => $card['argument'] ?? '',
    'sub_argument'    => $card['sub_argument'] ?? '',
    'citation'        => $card['citation'] ?? '',
    'bonus'           => isset($card['bonus']) ? (int) $card['bonus'] : 0,
    // Archive/conclusion flag — renamed `type` → `card_identifier` (migration
    // 26). Read whichever column exists and surface it under both names.
    'card_identifier' => $card['card_identifier'] ?? $card['type'] ?? '',
    'type'            => $card['card_identifier'] ?? $card['type'] ?? '',
    'contributor'     => $card['contributor'] ?? '',
    // Conclusion-specific fields
    'description'     => $card['description'] ?? '',
    'article_titles'  => $card['article_titles'] ?? '',
    'book_titles'     => $card['book_titles'] ?? '',
    // Pipe-separated context tags — feeds the prestige doubling check.
    'context_tags'    => $card['context_tags'] ?? '',
  ];
}

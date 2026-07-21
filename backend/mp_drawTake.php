<?php
/**
 * mp_drawTake.php
 *
 * POST — during the DRAW phase, the player whose turn it is takes the top card
 * off one of the four archive piles into their hand. Turns are round-robin in
 * seat order (fewest taken first), so nobody sweeps the market.
 *
 * When the last outstanding draw is spent the phase closes and the round moves
 * on (conference → review).
 *
 * Request body:  { player_token, pile: 0..3 }
 * Response:      { ok: true, idCard, draws_remaining, state_version }
 *
 * Errors:
 *   400 — bad pile
 *   409 — not in the draw phase / not your turn / pile empty
 */

require_once __DIR__ . '/mp_dbConfig.php';
require_once __DIR__ . '/mp_resolveYear.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

$gameId = (int) $game['game_id'];
$pid    = (int) $player['player_id'];

if ($game['status'] !== 'active') {
  mp_error('Game is not active', 409);
}
if (($game['phase'] ?? 'action') !== 'draw') {
  mp_error('Not in the draw phase', 409);
}

$body = mp_read_json_body();
$pile = isset($body['pile']) ? (int) $body['pile'] : -1;
if ($pile < 0 || $pile >= MP_ARCHIVE_PILES) {
  mp_error('pile must be 0..' . (MP_ARCHIVE_PILES - 1), 400);
}

$idCard = null;
$remaining = 0;

$mysqli->begin_transaction();
try {
  // Lock the game row so two players can't claim the same card.
  $stmt = $mysqli->prepare("SELECT phase FROM mp_games WHERE game_id = ? FOR UPDATE");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $g = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  if (!$g || $g['phase'] !== 'draw') {
    throw new Exception('The draw phase has ended');
  }

  // Is it actually this player's turn?
  $current = mp_draw_current_player($mysqli, $gameId);
  if (!$current || (int) $current['player_id'] !== $pid) {
    throw new Exception('It is not your turn to draw');
  }

  // Top of the chosen pile. If the whole archive is spent, reshuffle the
  // discards back in and look again.
  $top = mp_draw_pile_top($mysqli, $gameId, $pile);
  if (!$top) {
    if (array_sum(mp_draw_pile_counts($mysqli, $gameId)) === 0) {
      mp_reshuffle_discards_into_archive($mysqli, $gameId);
      $top = mp_draw_pile_top($mysqli, $gameId, $pile);
    }
    if (!$top) throw new Exception('That pile is empty — choose another');
  }

  $idCard = (int) $top['idCard'];
  $year   = (int) mp_current_year($mysqli, $gameId);

  // Claim the card. The IS NULL guard makes the race safe.
  $u = $mysqli->prepare("
    UPDATE mp_game_archive
    SET drawn_by_player_id = ?, drawn_year = ?
    WHERE game_id = ? AND idCard = ? AND drawn_by_player_id IS NULL
  ");
  $u->bind_param('iiii', $pid, $year, $gameId, $idCard);
  $u->execute();
  $claimed = $u->affected_rows;
  $u->close();
  if ($claimed !== 1) throw new Exception('That card was just taken — try again');

  $h = $mysqli->prepare("
    INSERT IGNORE INTO mp_player_hands (player_id, idCard, added_year) VALUES (?, ?, ?)
  ");
  $h->bind_param('iii', $pid, $idCard, $year);
  $h->execute();
  $h->close();

  // Spend the draw and advance the round-robin.
  $d = $mysqli->prepare("
    UPDATE mp_game_players
    SET draws_remaining = GREATEST(draws_remaining - 1, 0),
        draws_taken = draws_taken + 1
    WHERE player_id = ?
  ");
  $d->bind_param('i', $pid);
  $d->execute();
  $d->close();

  $r = $mysqli->prepare("SELECT draws_remaining FROM mp_game_players WHERE player_id = ?");
  $r->bind_param('i', $pid);
  $r->execute();
  $r->bind_result($remaining);
  $r->fetch();
  $r->close();

  mp_log_event($mysqli, $gameId, $pid, 'draw_took_card', [
    'pile'   => $pile,
    'idCard' => $idCard,
    'left'   => (int) $remaining,
  ]);

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 409);
}

// Close the phase if that was the last outstanding draw.
mp_maybe_finish_draw_phase($mysqli, $gameId);

$stateVersion = mp_bump_state_version($mysqli, $gameId);

mp_json([
  'ok'              => true,
  'idCard'          => $idCard,
  'draws_remaining' => (int) $remaining,
  'state_version'   => $stateVersion,
]);

<?php
/**
 * mp_conferenceContribute.php
 *
 * POST — during the CONFERENCE phase's opening step, the attendee whose turn it
 * is takes the face-up top card of one of the four archive piles and puts it on
 * the conference floor.
 *
 * The archive's share of the pool used to be dealt blind at year resolution.
 * Attendees now choose it, two each, in draft order. Value in this game is
 * relational — a card is strong only next to the other cards in a hand — so
 * stocking the floor is a real decision rather than a donation: what you add
 * may be worth far more to you than to anyone else at the table, or the
 * reverse.
 *
 * The card goes in with a NULL contributor, exactly as the dealt cards did, so
 * anyone may draft it — including the player who chose it. The contributor
 * field marks cards that came out of a player's HAND, which is what the
 * can't-draft-your-own rule is about.
 *
 * Drafting is gated until every attendee has contributed (see
 * mp_conference_current_picker).
 *
 * Request body:  { player_token, pile: 0..3 }
 * Response:      { ok, idCard, contributed, needed, state_version }
 *
 * Errors:
 *   400 — bad pile
 *   409 — not the conference phase / contributions already done / not your turn
 *         / that pile is empty
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
if (($game['phase'] ?? 'action') !== 'conference') {
  mp_error('Not in the conference phase', 409);
}

$body = mp_read_json_body();
$pile = isset($body['pile']) ? (int) $body['pile'] : -1;
if ($pile < 0 || $pile >= MP_ARCHIVE_PILES) {
  mp_error('pile must be 0..' . (MP_ARCHIVE_PILES - 1), 400);
}

$idCard = null;
$state  = null;

$mysqli->begin_transaction();
try {
  // Lock the game row so two attendees can't claim the same top card.
  $stmt = $mysqli->prepare("SELECT phase FROM mp_games WHERE game_id = ? FOR UPDATE");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $g = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  if (!$g || ($g['phase'] ?? '') !== 'conference') {
    throw new Exception('The conference has moved on');
  }

  $state = mp_conference_contrib_state($mysqli, $gameId);
  if ($state['done']) {
    throw new Exception('The floor is already stocked — the draft has begun');
  }
  if (!$state['current'] || (int) $state['current']['player_id'] !== $pid) {
    $who = $state['current'] ? $state['current']['player_name'] : 'another attendee';
    throw new Exception('It is ' . $who . "'s turn to add to the floor");
  }

  // Claim the pile's top card, guarding on it still being undrawn so a race
  // resolves to exactly one winner.
  $top = mp_draw_pile_top($mysqli, $gameId, $pile);
  if (!$top) {
    throw new Exception('That pile is empty');
  }
  $idCard = (int) $top['idCard'];

  $u = $mysqli->prepare("
    UPDATE mp_game_archive SET drawn_by_player_id = ?, drawn_year = ?
    WHERE game_id = ? AND idCard = ? AND drawn_by_player_id IS NULL
  ");
  $year = (int) mp_current_year($mysqli, $gameId);
  $u->bind_param('iiii', $pid, $year, $gameId, $idCard);
  $u->execute();
  $claimed = $u->affected_rows;
  $u->close();
  if ($claimed !== 1) {
    throw new Exception('That card was just taken — pick another');
  }

  // NULL contributor: this came from the archive, not from anyone's hand, so
  // it is draftable by everyone including the attendee who chose it.
  $pi = $mysqli->prepare("
    INSERT INTO mp_conference_pool (game_id, idCard, contributor_player_id)
    VALUES (?, ?, NULL)
  ");
  $pi->bind_param('ii', $gameId, $idCard);
  $pi->execute();
  $pi->close();

  mp_log_event($mysqli, $gameId, $pid, 'conference_contributed', [
    'idCard' => $idCard,
    'pile'   => $pile,
  ]);

  $state = mp_conference_contrib_state($mysqli, $gameId);
  $stateVersion = mp_bump_state_version($mysqli, $gameId);
  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 409);
}

mp_json([
  'ok'            => true,
  'idCard'        => $idCard,
  'contributed'   => $state['contributed'],
  'needed'        => $state['needed'],
  'done'          => $state['done'],
  'state_version' => $stateVersion,
]);

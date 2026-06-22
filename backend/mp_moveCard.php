<?php
/**
 * mp_moveCard.php
 *
 * POST — move a card between zones (hand ↔ project conclusion / evidence,
 * or shelf conclusion → project conclusion). Card movement is FREE — it
 * does not consume the player's year action.
 *
 * Mirrors the single-player MOVE_CARD reducer: each move is a remove-from-source
 * + add-to-destination pair.
 *
 * Request body:
 *   {
 *     player_token: string,
 *     card_id:      int,
 *     from:         { kind, projectId? },
 *     to:           { kind, projectId? }
 *   }
 *
 * Zone kinds:
 *   'hand'                  — your notebook
 *   'conclusionShelf'       — read-only library of all conclusions (never removes)
 *   'projectConclusion'     — the conclusion slot of a project (replaces whatever's there)
 *   'projectEvidence'       — the evidence array of a project (appended; cards
 *                              are not in hand while in a project)
 *
 * Response:
 *   {
 *     ok: true,
 *     state_version: int
 *   }
 *
 * Constraints enforced:
 *   - Cannot move conclusion-type cards into hand or evidence
 *   - Cannot move archive-type cards into projectConclusion
 *   - Cannot drop a card you don't own (only your hand / your projects)
 *   - Cannot move cards in a project for which a submission is pending
 *     (would let you change the evidence after submitting)
 *
 * Phase A note: hand cards have NO tag visibility from your perspective.
 * The frontend handles displaying "tag hidden" — the backend just relays
 * the card data and the client renders accordingly.
 */

require_once __DIR__ . '/mp_dbConfig.php';

mp_require_method('POST');

$auth   = mp_authenticate($mysqli);
$player = $auth['player'];
$game   = $auth['game'];

if ($game['status'] !== 'active') mp_error('Game is not active', 409);
if ($player['game_over_reason'])  mp_error('You are out of the game', 409);

$body = mp_read_json_body();
$cardId = isset($body['card_id']) ? (int) $body['card_id'] : 0;
$from   = isset($body['from']) && is_array($body['from']) ? $body['from'] : null;
$to     = isset($body['to'])   && is_array($body['to'])   ? $body['to']   : null;
if ($cardId <= 0 || !$from || !$to) mp_error('card_id, from, to all required', 400);

$pid = (int) $player['player_id'];

// Fetch the card to know whether it is archive or conclusion. SELECT * so we
// read whichever the identifier column is currently named — `card_identifier`
// (after migration 26) or the older `type`.
$stmt = $mysqli->prepare("SELECT * FROM Cards WHERE idCard = ? LIMIT 1");
$stmt->bind_param('i', $cardId);
$stmt->execute();
$res = $stmt->get_result();
$card = $res->fetch_assoc();
$stmt->close();
if (!$card) mp_error('Card not found', 404);
$cardType = $card['card_identifier'] ?? $card['type'] ?? '';

// Reject illegal type/zone combinations early
if ($cardType === 'conclusion' && in_array($to['kind'], ['hand','projectEvidence'], true)) {
  mp_error('Cannot put a conclusion in the hand or evidence', 400);
}
if ($cardType === 'archive' && $to['kind'] === 'projectConclusion') {
  mp_error('Cannot put an archive card in the conclusion slot', 400);
}

// Determine the project IDs involved and lock them so concurrent moves are safe.
$mysqli->begin_transaction();
try {
  // ----- REMOVE from source -----
  switch ($from['kind']) {
    case 'hand':
      // Ensure the card is in the player's hand
      $stmt = $mysqli->prepare("DELETE FROM mp_player_hands WHERE player_id = ? AND idCard = ?");
      $stmt->bind_param('ii', $pid, $cardId);
      $stmt->execute();
      $aff = $stmt->affected_rows;
      $stmt->close();
      if ($aff === 0) throw new Exception('Card not in hand');
      break;

    case 'projectConclusion': {
      $slot = isset($from['projectId']) ? (int) $from['projectId'] : -1;
      if ($slot < 0 || $slot > 2) throw new Exception('Invalid from projectId');
      // Block move if the project has a pending submission with the same evidence
      mp_assert_project_movable($mysqli, $pid, $slot);
      $stmt = $mysqli->prepare("
        UPDATE mp_projects SET conclusion_card_id = NULL
        WHERE player_id = ? AND slot_index = ? AND conclusion_card_id = ?
      ");
      $stmt->bind_param('iii', $pid, $slot, $cardId);
      $stmt->execute();
      $aff = $stmt->affected_rows;
      $stmt->close();
      if ($aff === 0) throw new Exception('Card not in that project conclusion');

      // Removing the conclusion invalidates the project's citations (they
      // were gated to this conclusion's tag). Clear them — player can
      // re-add citations once a new conclusion is set.
      $stmt = $mysqli->prepare("
        DELETE FROM mp_citations
        WHERE player_id = ? AND slot_index = ?
      ");
      $stmt->bind_param('ii', $pid, $slot);
      $stmt->execute();
      $stmt->close();
      break;
    }

    case 'projectEvidence': {
      $slot = isset($from['projectId']) ? (int) $from['projectId'] : -1;
      if ($slot < 0 || $slot > 2) throw new Exception('Invalid from projectId');
      mp_assert_project_movable($mysqli, $pid, $slot);
      // Read current evidence array, remove the card, write back
      $stmt = $mysqli->prepare("
        SELECT evidence_card_ids FROM mp_projects
        WHERE player_id = ? AND slot_index = ? FOR UPDATE
      ");
      $stmt->bind_param('ii', $pid, $slot);
      $stmt->execute();
      $res = $stmt->get_result();
      $row = $res->fetch_assoc();
      $stmt->close();
      $ev = ($row && $row['evidence_card_ids']) ? json_decode($row['evidence_card_ids'], true) : [];
      if (!is_array($ev) || !in_array($cardId, array_map('intval', $ev), true)) {
        throw new Exception('Card not in that project evidence');
      }
      $ev = array_values(array_filter($ev, function ($e) use ($cardId) {
        return (int) $e !== $cardId;
      }));
      $evJson = count($ev) > 0 ? json_encode($ev) : null;
      $stmt = $mysqli->prepare("
        UPDATE mp_projects SET evidence_card_ids = ?
        WHERE player_id = ? AND slot_index = ?
      ");
      $stmt->bind_param('sii', $evJson, $pid, $slot);
      $stmt->execute();
      $stmt->close();
      break;
    }

    case 'conclusionShelf':
      // Read-only: nothing to remove
      // BUT enforce that the card is actually a conclusion in this deck
      if ($cardType !== 'conclusion') throw new Exception('Card on shelf must be conclusion type');
      break;

    default:
      throw new Exception('Unknown from.kind');
  }

  // ----- ADD to destination -----
  switch ($to['kind']) {
    case 'hand': {
      $year = (int) $game['current_year'];
      $stmt = $mysqli->prepare("
        INSERT IGNORE INTO mp_player_hands (player_id, idCard, added_year)
        VALUES (?, ?, ?)
      ");
      $stmt->bind_param('iii', $pid, $cardId, $year);
      $stmt->execute();
      $stmt->close();
      break;
    }

    case 'projectConclusion': {
      $slot = isset($to['projectId']) ? (int) $to['projectId'] : -1;
      if ($slot < 0 || $slot > 2) throw new Exception('Invalid to projectId');
      mp_assert_project_movable($mysqli, $pid, $slot);
      $stmt = $mysqli->prepare("
        UPDATE mp_projects SET conclusion_card_id = ?
        WHERE player_id = ? AND slot_index = ?
      ");
      $stmt->bind_param('iii', $cardId, $pid, $slot);
      $stmt->execute();
      $stmt->close();
      break;
    }

    case 'projectEvidence': {
      $slot = isset($to['projectId']) ? (int) $to['projectId'] : -1;
      if ($slot < 0 || $slot > 2) throw new Exception('Invalid to projectId');
      mp_assert_project_movable($mysqli, $pid, $slot);
      $stmt = $mysqli->prepare("
        SELECT evidence_card_ids FROM mp_projects
        WHERE player_id = ? AND slot_index = ? FOR UPDATE
      ");
      $stmt->bind_param('ii', $pid, $slot);
      $stmt->execute();
      $res = $stmt->get_result();
      $row = $res->fetch_assoc();
      $stmt->close();
      $ev = ($row && $row['evidence_card_ids']) ? json_decode($row['evidence_card_ids'], true) : [];
      if (!is_array($ev)) $ev = [];
      $evInts = array_map('intval', $ev);
      if (!in_array($cardId, $evInts, true)) {
        $evInts[] = $cardId;
      }
      $evJson = json_encode($evInts);
      $stmt = $mysqli->prepare("
        UPDATE mp_projects SET evidence_card_ids = ?
        WHERE player_id = ? AND slot_index = ?
      ");
      $stmt->bind_param('sii', $evJson, $pid, $slot);
      $stmt->execute();
      $stmt->close();
      break;
    }

    case 'conclusionShelf':
      // Read-only: cannot add to shelf via move
      break;

    default:
      throw new Exception('Unknown to.kind');
  }

  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 400);
}

$stateVersion = mp_bump_state_version($mysqli, (int) $game['game_id']);

mp_json([
  'ok' => true,
  'state_version' => $stateVersion,
]);


/**
 * Assert that the project isn't currently in a state where its cards can't
 * be moved (e.g. there's a pending submission referencing it). Throws on
 * violation.
 */
function mp_assert_project_movable($mysqli, $playerId, $slotIndex) {
  // Read the project's evidence
  $stmt = $mysqli->prepare("
    SELECT evidence_card_ids FROM mp_projects
    WHERE player_id = ? AND slot_index = ?
  ");
  $stmt->bind_param('ii', $playerId, $slotIndex);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();
  if (!$row) return;

  $ev = $row['evidence_card_ids'] ? json_decode($row['evidence_card_ids'], true) : [];
  if (!is_array($ev) || count($ev) === 0) return;

  // Look for any pending submission whose evidence matches
  $stmt = $mysqli->prepare("
    SELECT evidence_card_ids
    FROM mp_submissions
    WHERE writer_player_id = ? AND status = 'pending'
  ");
  $stmt->bind_param('i', $playerId);
  $stmt->execute();
  $res = $stmt->get_result();
  while ($s = $res->fetch_assoc()) {
    $sev = $s['evidence_card_ids'] ? json_decode($s['evidence_card_ids'], true) : [];
    if (is_array($sev) && count($sev) === count($ev)) {
      $a = array_map('intval', $sev); sort($a);
      $b = array_map('intval', $ev);  sort($b);
      if ($a === $b) {
        $stmt->close();
        throw new Exception('Cannot move cards in a project that has a pending submission');
      }
    }
  }
  $stmt->close();
}

<?php
/**
 * admin_deleteDeck.php — POST (JSON) — admin only.
 *
 * Permanently deletes a deck and all of its cards, removes the uploaded
 * spreadsheet from disk, and then drops the AUTO_INCREMENT on both tables
 * back to (max existing id + 1) so repeated deletions don't push new deck
 * ids absurdly high.
 *
 * Body: { idDeck: <int> }
 * Response 200: { deleted: true, idDeck, decks_next_id, cards_next_id }
 */

require_once __DIR__ . '/users_helpers.php';   // $mysqli + helpers
require_once __DIR__ . '/dbConfig.php';          // MyDatabase (PDO)

mp_require_method('POST');
users_require_admin($mysqli);

$body = mp_read_json_body();
$idDeck = isset($body['idDeck']) ? (int) $body['idDeck'] : 0;
if ($idDeck <= 0) mp_error('A valid idDeck is required', 400);

$SQL = new MyDatabase();

// Confirm it exists + grab the file path so we can clean it off disk.
$SQL->query("SELECT deckFile FROM Decks WHERE idDeck = ?");
$SQL->execute([$idDeck]);
$deck = $SQL->single();
if (!$deck) mp_error('Deck not found', 404);

// Delete cards first, then the deck, inside a transaction.
$SQL->beginTransaction();
try {
  $SQL->query("DELETE FROM Cards WHERE idDeck = ?");
  $SQL->execute([$idDeck]);
  $SQL->query("DELETE FROM Decks WHERE idDeck = ?");
  $SQL->execute([$idDeck]);
  $SQL->endTransaction();
} catch (\Throwable $e) {
  $SQL->cancelTransaction();
  mp_error('Delete failed: ' . $e->getMessage(), 500);
}

// Best-effort removal of the uploaded spreadsheet.
if (!empty($deck['deckFile'])) {
  $f = __DIR__ . '/' . ltrim($deck['deckFile'], '/');
  if (is_file($f)) @unlink($f);
}

// Reclaim numbering. NOTE: ALTER is DDL (implicit commit), so it runs only
// after the delete transaction has closed.
$decksNext = deck_admin_reset_ai($SQL, 'Decks', 'idDeck');
$cardsNext = deck_admin_reset_ai($SQL, 'Cards', 'idCard');

mp_json([
  'deleted'        => true,
  'idDeck'         => $idDeck,
  'decks_next_id'  => $decksNext,
  'cards_next_id'  => $cardsNext,
]);

/**
 * Set $table's AUTO_INCREMENT to (max $idCol + 1). $table and $idCol are
 * hardcoded literals at the call sites (never user input), and $next is an
 * integer we computed — so the interpolation below is injection-safe.
 */
function deck_admin_reset_ai($SQL, $table, $idCol) {
  $SQL->query("SELECT IFNULL(MAX($idCol), 0) + 1 AS nextid FROM $table");
  $SQL->execute();
  $row = $SQL->single();
  $next = (int) ($row['nextid'] ?? 1);
  $SQL->query("ALTER TABLE $table AUTO_INCREMENT = $next");
  $SQL->execute();
  return $next;
}

<?php
/**
 * admin_listDecks.php — GET — admin only.
 *
 * Returns every deck with its card count, for the in-app Deck Manager.
 * (The public listDecks.php is the lean version the game's deck picker
 * uses; this one is richer and locked to admins.)
 *
 * Auth: Authorization: Bearer <session token>, and the user must have
 * is_admin = 1 (enforced by users_require_admin).
 *
 * Response 200: { decks: [ { idDeck, nameDeck, nameFirst, nameLast,
 *                            timeStamp, deckFile, card_count } ] }
 */

require_once __DIR__ . '/users_helpers.php';   // $mysqli + mp_json/mp_error/mp_require_method
require_once __DIR__ . '/dbConfig.php';          // MyDatabase (PDO) for the deck tables

mp_require_method('GET');
users_require_admin($mysqli);

$SQL = new MyDatabase();
$SQL->query("
  SELECT d.idDeck, d.nameDeck, d.nameFirst, d.nameLast, d.timeStamp, d.deckFile,
         (SELECT COUNT(*) FROM Cards c WHERE c.idDeck = d.idDeck) AS card_count
  FROM Decks d
  ORDER BY d.idDeck ASC
");
$rows = $SQL->resultset() ?: [];

$decks = array_map(function ($r) {
  return [
    'idDeck'     => (int) $r['idDeck'],
    'nameDeck'   => $r['nameDeck'],
    'nameFirst'  => $r['nameFirst'],
    'nameLast'   => $r['nameLast'],
    'timeStamp'  => $r['timeStamp'],
    'deckFile'   => $r['deckFile'],
    'card_count' => (int) $r['card_count'],
  ];
}, $rows);

mp_json(['decks' => $decks]);

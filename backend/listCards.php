<?php
/**
 * listCards.php — public GET — returns card rows for the React app.
 *
 *   GET /listCards.php            → every card across all decks
 *   GET /listCards.php?deck=:id   → only cards in deck :id
 *
 * Returns a bare JSON array of card rows (the front end does
 * `Array.isArray(data) ? data : []`). Each row carries every Cards column
 * plus a few normalized aliases the client expects:
 *   - id              alias of idCard (the solo reducer keys cards by `id`)
 *   - card_identifier the archive/conclusion flag (was the `type` column)
 *   - type            kept as a copy of card_identifier for backward compat
 *
 * The card_identifier/type normalization lets this endpoint work both before
 * and after the `type` → `card_identifier` column rename (migration 26):
 * `SELECT *` returns whichever column the database currently has, and we
 * surface the value under both names.
 *
 * Historically this file lived only on the server and was not in source
 * control; it was reconstructed here so the deploy manages it.
 */

ini_set('display_errors', '1');
require ("dbConfig.php");

// CORS + JSON, matching the other public read endpoints (listDecks.php).
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

$SQL = new MyDatabase;

// Optional deck filter. Cast to int so it is safe to inline (no user string
// reaches the query); mirrors the simple query/resultset pattern used by
// listDecks.php.
$where = '';
if (isset($_GET['deck']) && $_GET['deck'] !== '') {
  $deck = (int) $_GET['deck'];
  $where = " WHERE idDeck = $deck";
}

$SQL->query("SELECT * FROM Cards{$where} ORDER BY idDeck, idCard");
$rows = $SQL->resultset();

// Normalize identity + identifier fields the client relies on.
if (is_array($rows)) {
  foreach ($rows as &$r) {
    if (isset($r['idCard']) && !isset($r['id'])) {
      $r['id'] = $r['idCard'];
    }
    // Surface the archive/conclusion flag under both the new and old names,
    // whichever the column is currently called.
    $ident = $r['card_identifier'] ?? $r['type'] ?? null;
    $r['card_identifier'] = $ident;
    $r['type'] = $ident;
  }
  unset($r);
}

echo json_encode($rows);

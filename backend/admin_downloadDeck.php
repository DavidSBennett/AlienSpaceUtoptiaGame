<?php
/**
 * admin_downloadDeck.php — GET — admin only.
 *
 * Export a deck that's already in the game back out as a CSV, in the EXACT
 * column order admin_uploadDeck.php expects, so a downloaded deck can be
 * edited and re-uploaded without remapping anything.
 *
 * Column map (mirrors admin_uploadDeck.php — keep the two in sync):
 *   A sequence_number  B date     C source_type  D title       E content
 *   F significance     G author   H location     I argument    J sub_argument
 *   K bonus            L citation M image_url    N contributor O card_identifier
 *   P description      Q article_titles          R book_titles
 *   S context_tags     T image_front  U image_back
 *   V image_article_front  W image_article_back
 *   X image_book_front     Y image_book_back
 *
 * The file is written UTF-8 with a BOM (Excel-friendly); the importer detects
 * that BOM and reads it back as UTF-8 rather than CP1252.
 *
 * Deliberately uses only $mysqli — no dbConfig.php (PDO) and no
 * vendor/ (PhpSpreadsheet) — so it works on any installation.
 *
 * Query: ?idDeck=N
 * Response: text/csv attachment, or JSON error.
 */

require_once __DIR__ . '/users_helpers.php';   // $mysqli + helpers

mp_require_method('GET');
users_require_admin($mysqli);

$idDeck = isset($_GET['idDeck']) ? (int) $_GET['idDeck'] : 0;
if ($idDeck <= 0) mp_error('idDeck required', 400);

// ----- Deck name (for the filename) -----
$stmt = $mysqli->prepare("SELECT nameDeck FROM Decks WHERE idDeck = ? LIMIT 1");
$stmt->bind_param('i', $idDeck);
$stmt->execute();
$stmt->bind_result($nameDeck);
$found = $stmt->fetch();
$stmt->close();
if (!$found) mp_error('Deck not found', 404);

// ----- The archive/conclusion column was renamed `type` → `card_identifier`
//       (migration 26). Support whichever this database has. -----
$identCol = 'type';
$res = $mysqli->query("SHOW COLUMNS FROM Cards LIKE 'card_identifier'");
if ($res && $res->num_rows > 0) $identCol = 'card_identifier';
if ($res) $res->close();

// ----- Pull the cards in deck order -----
$sql = "SELECT sequence_number, `date`, source_type, title, content,
               significance, author, location, argument, sub_argument,
               bonus, citation, image_url, contributor, `{$identCol}` AS ident,
               description, article_titles, book_titles, context_tags,
               image_front, image_back,
               image_article_front, image_article_back,
               image_book_front, image_book_back
        FROM Cards
        WHERE idDeck = ?
        ORDER BY (sequence_number IS NULL), sequence_number ASC, idCard ASC";
$stmt = $mysqli->prepare($sql);
if (!$stmt) mp_error('Failed to read deck: ' . $mysqli->error, 500);
$stmt->bind_param('i', $idDeck);
$stmt->execute();
$rows = $stmt->get_result();

// ----- Stream the CSV -----
$safeName = preg_replace('/[^A-Za-z0-9._-]+/', '_', (string) $nameDeck);
if ($safeName === '') $safeName = 'deck';
$filename = $safeName . '-deck-' . $idDeck . '.csv';

// Nothing may have been echoed before this point.
if (function_exists('ob_get_level')) { while (ob_get_level() > 0) ob_end_clean(); }
header('Content-Type: text/csv; charset=UTF-8');
header('Content-Disposition: attachment; filename="' . $filename . '"');
header('Cache-Control: no-store');

$out = fopen('php://output', 'w');
fwrite($out, "\xEF\xBB\xBF");   // UTF-8 BOM

// Header row — the importer skips row 1 and maps by POSITION, so these labels
// are for humans; the ORDER is what matters.
fputcsv($out, [
  'sequence_number', 'date', 'source_type', 'title', 'content',
  'significance', 'author', 'location', 'argument', 'sub_argument',
  'bonus', 'citation', 'image_url', 'contributor', 'card_identifier',
  'description', 'article_titles', 'book_titles', 'context_tags',
  'image_front', 'image_back',
  'image_article_front', 'image_article_back',
  'image_book_front', 'image_book_back',
]);

while ($r = $rows->fetch_assoc()) {
  fputcsv($out, [
    $r['sequence_number'], $r['date'], $r['source_type'], $r['title'], $r['content'],
    $r['significance'], $r['author'], $r['location'], $r['argument'], $r['sub_argument'],
    $r['bonus'], $r['citation'], $r['image_url'], $r['contributor'], $r['ident'],
    $r['description'], $r['article_titles'], $r['book_titles'], $r['context_tags'],
    $r['image_front'], $r['image_back'],
    $r['image_article_front'], $r['image_article_back'],
    $r['image_book_front'], $r['image_book_back'],
  ]);
}
fclose($out);
$stmt->close();
exit;

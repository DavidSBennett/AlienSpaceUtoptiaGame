<?php
/**
 * admin_uploadDeck.php — POST (multipart/form-data) — admin only.
 *
 * Creates a new deck and bulk-imports its cards from an uploaded
 * spreadsheet. This is the JSON/admin-gated replacement for the old
 * unguarded uploadDeck.php HTML page.
 *
 * Form fields:
 *   nameFirst, nameLast — author name (optional)
 *   nameDeck            — required
 *   deckFile           — required; .csv, .xlsx, or .xls
 *
 * Column map (letter-keyed, header row skipped):
 *   A sequence_number  B date     C source_type  D title       E content
 *   F significance     G author   H location     I argument    J sub_argument
 *   K bonus            L citation M image_url     N contributor O type
 *   P description      Q article_titles          R book_titles
 *   S context_tags    (pipe-separated, like the title pools)
 *   T image_front     U image_back   (whole-card image URLs for the viewer)
 *
 * Response 200: { idDeck, card_count, nameDeck }
 */

require_once __DIR__ . '/users_helpers.php';   // $mysqli + helpers
require_once __DIR__ . '/dbConfig.php';          // MyDatabase (PDO)
require_once __DIR__ . '/vendor/autoload.php';   // PhpSpreadsheet

mp_require_method('POST');
users_require_admin($mysqli);

$nameFirst = trim($_POST['nameFirst'] ?? '');
$nameLast  = trim($_POST['nameLast'] ?? '');
$nameDeck  = trim($_POST['nameDeck'] ?? '');

if ($nameDeck === '') mp_error('Deck name is required', 400);

$err = $_FILES['deckFile']['error'] ?? UPLOAD_ERR_NO_FILE;
if (!isset($_FILES['deckFile']) || $err !== UPLOAD_ERR_OK || ($_FILES['deckFile']['size'] ?? 0) <= 0) {
  mp_error('A deck file (.csv, .xlsx, or .xls) is required', 400);
}

$ext = strtolower(pathinfo($_FILES['deckFile']['name'], PATHINFO_EXTENSION));
if (!in_array($ext, ['csv', 'xlsx', 'xls'], true)) {
  mp_error('File must be .csv, .xlsx, or .xls', 400);
}

$SQL = new MyDatabase();

// 1) Insert the deck row.
$SQL->query("INSERT INTO Decks (nameFirst, nameLast, nameDeck, timeStamp) VALUES (?, ?, ?, NOW())");
$SQL->execute([$nameFirst, $nameLast, $nameDeck]);
$idDeck = (int) $SQL->lastInsertId();
if ($idDeck <= 0) mp_error('Failed to create the deck row', 500);

// 2) Move the uploaded file into uploads/decks/ (create the dir if needed).
$destDir = __DIR__ . '/uploads/decks';
if (!is_dir($destDir)) @mkdir($destDir, 0755, true);
$relPath = 'uploads/decks/deck.' . $idDeck . '.' . $ext;
$absPath = __DIR__ . '/' . $relPath;

if (!@move_uploaded_file($_FILES['deckFile']['tmp_name'], $absPath)) {
  // Roll back so we don't leave an empty deck behind.
  $SQL->query("DELETE FROM Decks WHERE idDeck = ?");
  $SQL->execute([$idDeck]);
  mp_error('Could not save the uploaded file — check that uploads/decks/ exists and is writable', 500);
}
$SQL->query("UPDATE Decks SET deckFile = ? WHERE idDeck = ?");
$SQL->execute([$relPath, $idDeck]);

// 3) Read the spreadsheet.
try {
  $readerType = ucfirst($ext); // Csv | Xlsx | Xls
  $reader = \PhpOffice\PhpSpreadsheet\IOFactory::createReader($readerType);
  if ($readerType === 'Csv') $reader->setInputEncoding('CP1252');
  $reader->setReadDataOnly(true);
  $spreadsheet = $reader->load($absPath);
  $sheetData = $spreadsheet->getActiveSheet()->toArray(null, true, true, true);
} catch (\Throwable $e) {
  mp_error('Could not read the spreadsheet: ' . $e->getMessage(), 400);
}

// 4) Bulk-insert cards (skip the header row, skip empty rows).
$insert = "INSERT INTO Cards
  (idDeck, sequence_number, title, source_type, content, date, author, location,
   significance, image_url, argument, sub_argument, citation, type, bonus,
   contributor, description, article_titles, book_titles, context_tags,
   image_front, image_back)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";

$SQL->beginTransaction();
$SQL->query($insert);
$count = 0;
$first = true;
foreach ($sheetData as $row) {
  if ($first) { $first = false; continue; }  // header row
  $title = trim((string) ($row['D'] ?? ''));
  $seq   = trim((string) ($row['A'] ?? ''));
  if ($title === '' && $seq === '') continue;  // blank trailing row
  $SQL->execute([
    $idDeck,
    $row['A'] ?? null, $row['D'] ?? null, $row['C'] ?? null, $row['E'] ?? null,
    $row['B'] ?? null, $row['G'] ?? null, $row['H'] ?? null, $row['F'] ?? null,
    $row['M'] ?? null, $row['I'] ?? null, $row['J'] ?? null, $row['L'] ?? null,
    $row['O'] ?? null, $row['K'] ?? null, $row['N'] ?? null, $row['P'] ?? null,
    $row['Q'] ?? null, $row['R'] ?? null, $row['S'] ?? null,
    $row['T'] ?? null, $row['U'] ?? null,
  ]);
  $count++;
}
$SQL->endTransaction();

mp_json(['idDeck' => $idDeck, 'card_count' => $count, 'nameDeck' => $nameDeck]);

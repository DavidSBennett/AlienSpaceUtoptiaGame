<?php
/**
 * admin_schemaCheck.php
 *
 * GET — ADMIN ONLY. Reports which schema migrations have actually been applied
 * to THIS installation's database.
 *
 * Code deploys automatically; migrations do not. With two installations (live
 * and seed) pointed at two separate databases, it is very easy to end up with
 * new code running against an old schema — and the failure is often silent
 * rather than loud (see the ENUM note below). This endpoint answers "did that
 * migration actually run here?" without opening phpMyAdmin and eyeballing
 * table structures.
 *
 * Hit it on each subdomain in turn; it only ever reports on the database that
 * that installation's config.secret.php points at.
 *
 * Response:
 *   { ok, seed_mode, database, all_applied,
 *     migrations: [ { id, name, applied, detail } ] }
 *
 * Read-only: every query is INFORMATION_SCHEMA. Nothing is altered.
 */

require_once __DIR__ . '/users_helpers.php';   // loads mp_dbConfig.php → $mysqli + helpers

mp_require_method('GET');
users_require_admin($mysqli);

/** Does $table.$column exist in the current database? */
function sc_has_column(mysqli $mysqli, string $table, string $column): bool {
  $sql = "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = ?
             AND COLUMN_NAME  = ?
           LIMIT 1";
  $stmt = $mysqli->prepare($sql);
  $stmt->bind_param('ss', $table, $column);
  $stmt->execute();
  $found = (bool) $stmt->get_result()->fetch_row();
  $stmt->close();
  return $found;
}

/** The full COLUMN_TYPE string, e.g. "enum('action','draw',...)", or null. */
function sc_column_type(mysqli $mysqli, string $table, string $column): ?string {
  $sql = "SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = ?
             AND COLUMN_NAME  = ?
           LIMIT 1";
  $stmt = $mysqli->prepare($sql);
  $stmt->bind_param('ss', $table, $column);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_row();
  $stmt->close();
  return $row ? (string) $row[0] : null;
}

/** Is $column nullable? Null if the column doesn't exist. */
function sc_is_nullable(mysqli $mysqli, string $table, string $column): ?bool {
  $sql = "SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME   = ?
             AND COLUMN_NAME  = ?
           LIMIT 1";
  $stmt = $mysqli->prepare($sql);
  $stmt->bind_param('ss', $table, $column);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_row();
  $stmt->close();
  return $row ? ($row[0] === 'YES') : null;
}

$checks = [];

// --- 30: conference publications -------------------------------------------
$kindType    = sc_column_type($mysqli, 'mp_published_works', 'kind');
$subNullable = sc_is_nullable($mysqli, 'mp_published_works', 'submission_id');
$has30 = $kindType !== null
      && stripos($kindType, "'conference'") !== false
      && $subNullable === true;
$checks[] = [
  'id'      => 30,
  'name'    => 'Conference publications',
  'applied' => $has30,
  'detail'  => $kindType === null
      ? 'mp_published_works.kind is missing'
      : sprintf(
          "kind = %s; submission_id nullable = %s",
          $kindType,
          $subNullable === null ? 'missing' : ($subNullable ? 'yes' : 'NO — still NOT NULL')
        ),
];

// --- 31: reviewer can flag cited works --------------------------------------
$has31 = sc_has_column($mysqli, 'mp_reviews', 'flagged_work_ids');
$checks[] = [
  'id'      => 31,
  'name'    => 'Review: flag cited works',
  'applied' => $has31,
  'detail'  => $has31
      ? 'mp_reviews.flagged_work_ids present'
      : 'mp_reviews.flagged_work_ids MISSING — reviewers cannot flag citations',
];

// --- 32: seed input (only meaningful on the seed installation) ---------------
$has32 = sc_has_column($mysqli, 'mp_games', 'seed_input');
$seedMode = defined('SEED_MODE') && SEED_MODE;
$checks[] = [
  'id'      => 32,
  'name'    => 'Seed input (seed installation only)',
  // Harmless-but-unused on live, so don't report its absence there as a failure.
  'applied' => $seedMode ? $has32 : true,
  'detail'  => $has32
      ? 'mp_games.seed_input present'
      : ($seedMode
          ? 'mp_games.seed_input MISSING — seeded multiplayer games will not be reproducible'
          : 'not present, and not needed on the live installation'),
];

// --- 33: draw phase ----------------------------------------------------------
// NOTE: an unmigrated phase ENUM fails SILENTLY on a non-strict server — MySQL
// coerces the rejected 'draw' to '' instead of erroring, so the draw phase just
// never appears and nothing surfaces in the logs. That is exactly why this
// check reports the enum's actual contents rather than a bare yes/no.
$phaseType = sc_column_type($mysqli, 'mp_games', 'phase');
$hasDrawEnum   = $phaseType !== null && stripos($phaseType, "'draw'") !== false;
$hasRemaining  = sc_has_column($mysqli, 'mp_game_players', 'draws_remaining');
$hasTaken      = sc_has_column($mysqli, 'mp_game_players', 'draws_taken');
$has33 = $hasDrawEnum && $hasRemaining && $hasTaken;
$checks[] = [
  'id'      => 33,
  'name'    => 'Draw phase',
  'applied' => $has33,
  'detail'  => sprintf(
      "phase = %s%s; draws_remaining = %s; draws_taken = %s",
      $phaseType ?? 'MISSING',
      $hasDrawEnum ? '' : "  <-- no 'draw' value: the draw phase can never start",
      $hasRemaining ? 'present' : 'MISSING',
      $hasTaken ? 'present' : 'MISSING'
    ),
];

$dbRow = $mysqli->query('SELECT DATABASE()')->fetch_row();

$allApplied = true;
foreach ($checks as $c) { if (!$c['applied']) { $allApplied = false; break; } }

mp_json([
  'ok'          => true,
  'seed_mode'   => $seedMode,
  'database'    => $dbRow ? $dbRow[0] : null,
  'all_applied' => $allApplied,
  'migrations'  => $checks,
]);

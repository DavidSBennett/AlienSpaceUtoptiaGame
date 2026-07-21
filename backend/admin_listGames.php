<?php
/**
 * admin_listGames.php
 *
 * GET — ADMIN ONLY. Every multiplayer game across every account, newest first:
 * which deck it uses, its status and phase, the year it's on, who's in it, and
 * when it last did anything.
 *
 * There was previously no way to SEE a game. /admin/games could count games
 * older than N days and delete them, which meant purging blind and — more
 * dangerously — deleting a deck with no way to check whether a live game was
 * still using it. Cards cascade with their deck, and the mp_* tables hold bare
 * idCard integers with no foreign key, so that delete doesn't fail loudly: it
 * leaves games running against cards that no longer exist.
 *
 * Query params:
 *   status?  — 'lobby' | 'active' | 'ended' (omit for all)
 *   idDeck?  — restrict to one deck, which is what the delete guard uses
 *   limit?   — default 200
 *
 * Response:
 *   { ok: true, games: [ { game_id, deck_name, idDeck, status, phase,
 *       current_year, total_years, player_count, players[], host,
 *       created_at, last_activity_at, is_live } ] }
 */

require_once __DIR__ . '/users_helpers.php';   // loads mp_dbConfig.php → $mysqli + helpers

mp_require_method('GET');
users_require_admin($mysqli);

$status = isset($_GET['status']) ? trim((string) $_GET['status']) : '';
$idDeck = isset($_GET['idDeck']) ? (int) $_GET['idDeck'] : 0;
$limit  = isset($_GET['limit']) ? max(1, min(1000, (int) $_GET['limit'])) : 200;

$where = [];
$params = [];
$types = '';

if ($status !== '' && in_array($status, ['lobby', 'active', 'ended'], true)) {
  $where[] = 'g.status = ?';
  $params[] = $status;
  $types .= 's';
}
if ($idDeck > 0) {
  $where[] = 'g.idDeck = ?';
  $params[] = $idDeck;
  $types .= 'i';
}
$whereSql = count($where) > 0 ? ('WHERE ' . implode(' AND ', $where)) : '';

// Last activity mirrors admin_purgeGames' definition, so the list and the
// purge tool agree about how old a game is.
$sql = "
  SELECT g.game_id, g.idDeck, g.status, g.current_year, g.created_at, g.ended_at,
         g.year_started_at, g.max_players,
         d.nameDeck AS deck_name,
         COALESCE(g.ended_at, g.year_started_at, g.created_at) AS last_activity_at
  FROM mp_games g
  LEFT JOIN Decks d ON d.idDeck = g.idDeck
  $whereSql
  ORDER BY last_activity_at DESC
  LIMIT $limit
";

$stmt = $mysqli->prepare($sql);
if (count($params) > 0) $stmt->bind_param($types, ...$params);
$stmt->execute();
$res = $stmt->get_result();

$games = [];
$ids = [];
while ($r = $res->fetch_assoc()) {
  $gid = (int) $r['game_id'];
  $ids[] = $gid;
  $games[$gid] = [
    'game_id'          => $gid,
    'idDeck'           => (int) $r['idDeck'],
    'deck_name'        => $r['deck_name'],   // null when the deck is already gone
    'status'           => $r['status'],
    'current_year'     => (int) $r['current_year'],
    'max_players'      => (int) $r['max_players'],
    'created_at'       => $r['created_at'],
    'ended_at'         => $r['ended_at'],
    'last_activity_at' => $r['last_activity_at'],
    // "live" = would be damaged by deleting its deck out from under it.
    'is_live'          => $r['status'] !== 'ended',
    'players'          => [],
    'player_count'     => 0,
  ];
}
$stmt->close();

// Players, in one query rather than one per game.
if (count($ids) > 0) {
  $ph = implode(',', array_fill(0, count($ids), '?'));
  $t  = str_repeat('i', count($ids));
  $pstmt = $mysqli->prepare("
    SELECT game_id, player_id, player_name, seat_index, is_ghost, game_over_reason
    FROM mp_game_players
    WHERE game_id IN ($ph)
    ORDER BY game_id, seat_index ASC
  ");
  $pstmt->bind_param($t, ...$ids);
  $pstmt->execute();
  $pres = $pstmt->get_result();
  while ($p = $pres->fetch_assoc()) {
    $gid = (int) $p['game_id'];
    if (!isset($games[$gid])) continue;
    $games[$gid]['players'][] = [
      'player_id'   => (int) $p['player_id'],
      'player_name' => $p['player_name'],
      'seat_index'  => (int) $p['seat_index'],
      'is_ghost'    => (bool) $p['is_ghost'],
      'is_out'      => !empty($p['game_over_reason']),
    ];
    $games[$gid]['player_count']++;
  }
  $pstmt->close();
}

// Phase lives on mp_games only if migration 33 has run; read it defensively so
// this page still works on a database that hasn't been migrated yet.
$hasPhase = false;
$chk = $mysqli->query("SHOW COLUMNS FROM mp_games LIKE 'phase'");
if ($chk && $chk->num_rows > 0) $hasPhase = true;

if ($hasPhase && count($ids) > 0) {
  $ph = implode(',', array_fill(0, count($ids), '?'));
  $t  = str_repeat('i', count($ids));
  $fstmt = $mysqli->prepare("SELECT game_id, phase FROM mp_games WHERE game_id IN ($ph)");
  $fstmt->bind_param($t, ...$ids);
  $fstmt->execute();
  $fres = $fstmt->get_result();
  while ($f = $fres->fetch_assoc()) {
    $gid = (int) $f['game_id'];
    if (isset($games[$gid])) $games[$gid]['phase'] = $f['phase'];
  }
  $fstmt->close();
}

mp_json([
  'ok'    => true,
  'games' => array_values($games),
]);

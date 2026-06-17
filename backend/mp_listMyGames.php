<?php
/**
 * mp_listMyGames.php
 *
 * GET — list every game the signed-in user has a seat in, regardless
 * of status. Used by the multiplayer lobby's "Your Games" section so
 * a returning player can resume in-progress games or revisit ended
 * ones.
 *
 * Response 200:
 *   {
 *     ok: true,
 *     games: [
 *       {
 *         game_id, status, current_year, max_year, started_at,
 *         deck: { idDeck, label },
 *         seat_index, player_id, player_token,
 *         player_count, host_name,
 *         is_your_turn: bool,  (true if it's a sync-action year and
 *                               you haven't committed yet)
 *       },
 *       ...
 *     ]
 *   }
 *
 * Sorted: in-progress first (most recently updated), then lobby,
 * then ended.
 */

require_once __DIR__ . '/users_helpers.php';

mp_require_method('GET');

$auth = users_require_session($mysqli);
$userId = (int) $auth['user']['user_id'];

// Pull all rows in one query. Joining mp_games and Decks for the
// metadata; computing host_name via a correlated lookup.
$stmt = $mysqli->prepare("
  SELECT
    g.game_id, g.status, g.current_year, 25 AS max_year,
    g.created_at, g.idDeck,
    d.nameDeck AS deck_label,
    p.player_id, p.player_token, p.seat_index, p.pending_action_committed AS has_committed_action,
    (SELECT COUNT(*) FROM mp_game_players p2 WHERE p2.game_id = g.game_id) AS player_count,
    (SELECT player_name FROM mp_game_players ph WHERE ph.player_id = g.host_player_id) AS host_name
  FROM mp_game_players p
  JOIN mp_games g ON g.game_id = p.game_id
  LEFT JOIN Decks d ON d.idDeck = g.idDeck
  WHERE p.user_id = ?
  ORDER BY
    FIELD(g.status, 'active', 'lobby', 'ended'),
    g.current_year DESC,
    g.created_at DESC
");
$stmt->bind_param('i', $userId);
$stmt->execute();
$res = $stmt->get_result();

$games = [];
while ($row = $res->fetch_assoc()) {
  $isYourTurn = false;
  if ($row['status'] === 'active') {
    // "Your turn" = you haven't committed for the current year yet.
    // The flag has_committed_action is reset to 0 at the start of
    // each year (see mp_resolveYear); if it's still 0, action is on
    // the player.
    $isYourTurn = ((int) $row['has_committed_action']) === 0;
  }
  $games[] = [
    'game_id'      => (int) $row['game_id'],
    'status'       => $row['status'],
    'current_year' => (int) $row['current_year'],
    'max_year'     => (int) $row['max_year'],
    'created_at'   => $row['created_at'],
    'deck'         => [
      'idDeck' => (int) $row['idDeck'],
      'label'  => $row['deck_label'],
    ],
    'seat_index'   => (int) $row['seat_index'],
    'player_id'    => (int) $row['player_id'],
    'player_token' => $row['player_token'],
    'player_count' => (int) $row['player_count'],
    'host_name'    => $row['host_name'],
    'is_your_turn' => $isYourTurn,
  ];
}
$stmt->close();

mp_json([
  'ok'    => true,
  'games' => $games,
]);

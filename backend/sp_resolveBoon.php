<?php
/**
 * sp_resolveBoon.php — POST. Resolve a pending one-shot triggered boon.
 *
 * Body: { player_token, pending: <index>, card: '<key>' | null }
 * card null = decline the effect (the boon is spent either way).
 *
 * Currently the only triggered boon is Severance Authority: fire one
 * card from your hand or discard permanently for an immediate refund
 * (SP_FIRE_REFUND + 1 per 3 positive chaos). Reset crew can't be fired.
 * Resolving costs no turn and is allowed off-turn.
 */
require_once __DIR__ . '/sp_engine.php';

mp_require_method('POST');
$me = sp_authenticate($mysqli);
$gameId = (int)$me['game_id'];
$body = mp_read_json_body();

$idx = (int)($body['pending'] ?? 0);
$cardKey = isset($body['card']) && is_string($body['card']) ? $body['card'] : null;

$mysqli->begin_transaction();
try {
  $game = sp_load_game($mysqli, $gameId, true);
  if (!$game) throw new Exception('Game not found');
  if ($game['status'] !== 'active') throw new Exception('Game is not active');
  $players = sp_load_players($mysqli, $gameId);
  $seat = (int)$me['seat'];
  $p = &$players[$seat];

  $pending = sp_player_pending($p);
  if (!isset($pending[$idx])) throw new Exception('No such pending boon');
  $boon = $pending[$idx];
  if (($boon['type'] ?? '') !== 'severance') throw new Exception('Unknown triggered boon');

  if ($cardKey !== null) {
    $cards = sp_cards();
    if (!isset($cards[$cardKey])) throw new Exception('Unknown card');
    if ($cards[$cardKey]['action'] === 'reset') {
      throw new Exception('Reset crew cannot be fired');
    }
    $zone = null;
    $pos = array_search($cardKey, $p['hand'], true);
    if ($pos !== false) { array_splice($p['hand'], $pos, 1); $zone = 'hand'; }
    else {
      $pos = array_search($cardKey, $p['discard'], true);
      if ($pos !== false) { array_splice($p['discard'], $pos, 1); $zone = 'discard'; }
    }
    if ($zone === null) throw new Exception('That card is not in your hand or discard');

    $refund = SP_FIRE_REFUND + max(0, sp_chaos_mod($game['board_state']['chaos']));
    $p['credits'] += $refund;
    $msg = $p['player_name'] . ' exercised ' . $boon['name'] . ': fired '
         . $cards[$cardKey]['name'] . " (+{$refund}c)";
  } else {
    $msg = $p['player_name'] . ' declined ' . $boon['name'];
  }

  array_splice($pending, $idx, 1);
  $p['tracks']['pending'] = $pending;
  // The spent boon is still remembered: a tainted boon counts toward the
  // collapse penalty even after its one-shot effect is used (or declined).
  $boon['spent'] = true;
  $p['tracks']['boons'][] = $boon;

  sp_log($mysqli, $gameId, $seat, 'boon', $msg, ['boon' => $boon['type']]);
  sp_save_game($mysqli, $game);
  foreach ($players as $pl) sp_save_player($mysqli, $pl);
  $mysqli->commit();
} catch (Exception $e) {
  $mysqli->rollback();
  mp_error($e->getMessage(), 400);
}

sp_bump($mysqli, $gameId);
mp_json(['ok' => true, 'message' => $msg]);

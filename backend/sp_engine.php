<?php
/**
 * sp_engine.php — the SPACE GAME rules engine (server-authoritative), v3.
 *
 * v3 model ("one ship, many occupations"):
 *  - Hand cards are CREW OCCUPATIONS. Each player pilots ONE ship token
 *    that sits at a planet; its system is the player's current REGION.
 *  - The ship is the player board: installed upgrade modules give it
 *    military / political / negotiating power (+ cargo & speed systems).
 *    Modules are bought with credits during a reset, or granted free from
 *    the upgrade stack when a track reaches an even step.
 *  - RAID (pirate): ship military + card Military vs planet military +
 *    local bounty. Loot = production + bounty (goods); bounty then rises —
 *    harder and richer each time.
 *  - DIPLOMATIC CONTRACT: ship political + card Diplomacy vs planet
 *    political − local reputation. Payout = 2 × production − rep
 *    (credits); rep then rises — easier and poorer each time.
 *  - TRADE: no opposed roll. Sell what the planet WANTS at list + 2, buy
 *    its own goods at list, capacity 2 + card Trade + negotiating; any
 *    trade moving ≥1 unit advances the Merchant track.
 *  - Tracks: Pirate / Diplomat / Merchant (internal keys unchanged:
 *    military / diplomacy / trade). 12 steps, ring gates at 5 and 9,
 *    free matching module at every even step, step 12 triggers endgame.
 *
 * NOT an endpoint — require_once'd by every sp_*.php endpoint. All rules
 * live here; the client is presentation only.
 */

require_once __DIR__ . '/mp_dbConfig.php';
require_once __DIR__ . '/sp_cards_data.php';
require_once __DIR__ . '/sp_map_data.php';

// ─────────────────────────────────────────────────────────────────────────
// Tuning constants
// ─────────────────────────────────────────────────────────────────────────

const SP_RESOURCES      = ['O', 'B', 'C', 'N', 'A'];
const SP_PRICES         = ['O' => 3, 'B' => 4, 'C' => 5, 'N' => 6, 'A' => 7];
const SP_FACTION_NAMES  = [
  'O' => 'Krath Combine',    'B' => 'Verdani Symbiosis',
  'C' => 'Mekkari Assembly', 'N' => 'Aurelian Court', 'A' => 'Umbral Choir',
];
const SP_RESOURCE_NAMES = [
  'O' => 'Ore', 'B' => 'Biomass', 'C' => 'Components', 'N' => 'Nectar', 'A' => 'Aether',
];

const SP_STARTING_CREDITS = 5;
const SP_STARTING_CARGO   = ['O' => 1, 'B' => 1, 'C' => 0, 'N' => 0, 'A' => 0];
const SP_CARGO_CAPACITY   = 12;
const SP_MARKET_DISPLAY   = 7;
const SP_UPGRADE_DISPLAY  = 4;
const SP_TROPHY_VP        = 7;
const SP_SELL_MARKUP      = 3;    // wanted goods sell at list + this (+ negotiating per unit)
const SP_TRADE_BASE_CAP   = 3;    // + card Trade stat + ship negotiating
const SP_REP_CAP          = 4;    // at rep 4 a region is SETTLED — no contracts remain

const SP_TRACK_MAX  = 12;
const SP_TIER_STEPS = 4;
const SP_GATE_RING  = [1 => 0, 2 => 2, 3 => 3];   // tier => min ring to enter

const SP_POSITION_COST = [[], [], ['?'], ['?'], ['?', '?'], ['?', '?'], ['?', '?', '?']];

const SP_ENGINEERING_VP_PER_UPGRADE = 2;

// Track key → module type granted at even steps.
const SP_TRACK_MODULE_TYPE = [
  'military' => 'weapon', 'diplomacy' => 'diplomatic', 'trade' => 'trade',
];

// ─────────────────────────────────────────────────────────────────────────
// State load / save
// ─────────────────────────────────────────────────────────────────────────

function sp_j($v, $fallback) {
  if ($v === null || $v === '') return $fallback;
  $d = json_decode($v, true);
  return is_array($d) ? $d : $fallback;
}

function sp_load_game($mysqli, $gameId, $forUpdate = false) {
  $sql = "SELECT * FROM sp_games WHERE game_id = ?" . ($forUpdate ? ' FOR UPDATE' : '');
  $stmt = $mysqli->prepare($sql);
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  if (!$row) return null;
  $row['market_display'] = sp_j($row['market_display'], []);
  $row['market_stack']   = sp_j($row['market_stack'], []);
  $row['board_state']    = sp_j($row['board_state'],
    ['ships' => [], 'upgrade_display' => [], 'upgrade_stack' => [], 'meta' => []]);
  // Pre-v3 games (drone/control boards) cannot be migrated to the ship
  // model — flag them so the state endpoint can sunset them gracefully.
  $row['legacy_ruleset'] = ($row['status'] !== 'lobby')
    && !isset($row['board_state']['ships']);
  if (!isset($row['board_state']['meta'])) $row['board_state']['meta'] = [];
  return $row;
}

function sp_load_players($mysqli, $gameId) {
  $stmt = $mysqli->prepare("SELECT * FROM sp_game_players WHERE game_id = ? ORDER BY seat ASC");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $players = [];
  while ($row = $res->fetch_assoc()) {
    $row['cargo']    = sp_j($row['cargo'], ['O'=>0,'B'=>0,'C'=>0,'N'=>0,'A'=>0]);
    $row['hand']     = sp_j($row['hand'], []);
    $row['discard']  = sp_j($row['discard'], []);
    $row['tracks']   = sp_j($row['tracks'], []);
    foreach (['military', 'diplomacy', 'trade'] as $t) {
      if (!isset($row['tracks'][$t])) $row['tracks'][$t] = ['step' => 0];
    }
    if (!isset($row['tracks']['bounty']))  $row['tracks']['bounty'] = [];
    if (!isset($row['tracks']['rep']))     $row['tracks']['rep'] = [];
    if (!isset($row['tracks']['visited'])) $row['tracks']['visited'] = [];
    $row['intel']    = sp_j($row['intel'], []);
    $row['upgrades'] = sp_j($row['upgrades'], []);
    $players[(int)$row['seat']] = $row;
  }
  $stmt->close();
  return $players;
}

function sp_save_game($mysqli, $game) {
  $stmt = $mysqli->prepare("
    UPDATE sp_games SET status=?, current_seat=?, turn_number=?, boon_seat=?,
      market_display=?, market_stack=?, board_state=?,
      endgame_trigger=?, trigger_seat=?, final_turns_remaining=?, winner_seat=?
    WHERE game_id=?");
  $display = json_encode($game['market_display']);
  $stack   = json_encode($game['market_stack']);
  $board   = json_encode($game['board_state']);
  $stmt->bind_param('siiissssiiii',
    $game['status'], $game['current_seat'], $game['turn_number'], $game['boon_seat'],
    $display, $stack, $board,
    $game['endgame_trigger'], $game['trigger_seat'], $game['final_turns_remaining'],
    $game['winner_seat'], $game['game_id']);
  if (!$stmt->execute()) { $err = $stmt->error; $stmt->close(); throw new Exception("save_game: $err"); }
  $stmt->close();
}

function sp_save_player($mysqli, $p) {
  $stmt = $mysqli->prepare("
    UPDATE sp_game_players SET credits=?, cargo=?, cargo_capacity=?, drones_reserve=?,
      hand=?, discard=?, tracks=?, intel=?, upgrades=?,
      vp_current=?, first_reset_done=?, intermediate_score=?, trophy=?,
      final_score=?, score_breakdown=?, conceded=?
    WHERE player_id=?");
  $cargo = json_encode($p['cargo']);
  $hand = json_encode($p['hand']);
  $discard = json_encode($p['discard']);
  $tracks = json_encode($p['tracks']);
  $intel = json_encode(array_values($p['intel']));
  $upgrades = json_encode(array_values($p['upgrades']));
  $breakdown = $p['score_breakdown'] === null ? null :
    (is_string($p['score_breakdown']) ? $p['score_breakdown'] : json_encode($p['score_breakdown']));
  $stmt->bind_param('isiisssssiiiiisii',
    $p['credits'], $cargo, $p['cargo_capacity'], $p['drones_reserve'],
    $hand, $discard, $tracks, $intel, $upgrades,
    $p['vp_current'], $p['first_reset_done'], $p['intermediate_score'], $p['trophy'],
    $p['final_score'], $breakdown, $p['conceded'], $p['player_id']);
  if (!$stmt->execute()) { $err = $stmt->error; $stmt->close(); throw new Exception("save_player: $err"); }
  $stmt->close();
}

function sp_log($mysqli, $gameId, $seat, $type, $message, $data = null) {
  $stmt = $mysqli->prepare("
    INSERT INTO sp_event_log (game_id, seat, event_type, message, event_data)
    VALUES (?, ?, ?, ?, ?)");
  if (!$stmt) return;
  $json = $data ? json_encode($data) : null;
  $stmt->bind_param('iisss', $gameId, $seat, $type, $message, $json);
  @$stmt->execute();
  $stmt->close();
}

function sp_bump($mysqli, $gameId) {
  $stmt = $mysqli->prepare("UPDATE sp_games SET state_version = state_version + 1 WHERE game_id = ?");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $stmt->close();
}

// ─────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────

function sp_authenticate($mysqli, $tokenOverride = null) {
  $token = $tokenOverride;
  if ($token === null) {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
      $body = json_decode(file_get_contents('php://input'), true);
      if (is_array($body) && isset($body['player_token'])) $token = $body['player_token'];
    }
    if (!$token && isset($_GET['player_token'])) $token = $_GET['player_token'];
  }
  if (!$token || !is_string($token) || !preg_match('/^[a-f0-9]{32,64}$/', $token)) {
    mp_error('player_token required', 401);
  }
  $stmt = $mysqli->prepare("SELECT * FROM sp_game_players WHERE player_token = ? LIMIT 1");
  $stmt->bind_param('s', $token);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  if (!$row) mp_error('Unknown player_token', 401);

  if ($row['user_id'] !== null) {
    require_once __DIR__ . '/users_helpers.php';
    $sessAuth = users_optional_session($mysqli);
    if (!$sessAuth) mp_error('Not signed in', 401);
    if ((int)$sessAuth['user']['user_id'] !== (int)$row['user_id']) {
      mp_error('Session does not match this player_token', 403);
    }
  }
  $touch = $mysqli->prepare("UPDATE sp_game_players SET last_seen_at = NOW() WHERE player_id = ?");
  $touch->bind_param('i', $row['player_id']);
  $touch->execute();
  $touch->close();
  return $row;
}

// ─────────────────────────────────────────────────────────────────────────
// Ship, cargo, region helpers
// ─────────────────────────────────────────────────────────────────────────

/** Derived ship stats from installed modules. */
function sp_ship_stats($player) {
  $u = sp_upgrade_cards();
  $s = ['military' => 0, 'political' => 0, 'negotiating' => 0,
        'cargo_bonus' => 0, 'speed_bonus' => 0];
  foreach ($player['upgrades'] as $key) {
    $mod = $u[$key] ?? null;
    if (!$mod) continue;
    if ($mod['type'] === 'weapon')     $s['military']    += $mod['bonus'];
    if ($mod['type'] === 'diplomatic') $s['political']   += $mod['bonus'];
    if ($mod['type'] === 'trade')      $s['negotiating'] += $mod['bonus'];
    if ($mod['type'] === 'system') {
      if ($mod['name'] === 'Cargo Pods')   $s['cargo_bonus'] += 4;
      if ($mod['name'] === 'Afterburners') $s['speed_bonus'] += 1;
    }
  }
  return $s;
}

function sp_cargo_used($p) {
  return array_sum($p['cargo']);
}
function sp_cargo_free($p) {
  return max(0, (int)$p['cargo_capacity'] - sp_cargo_used($p));
}
function sp_cargo_add(&$p, $letter, $units) {
  $add = min($units, sp_cargo_free($p));
  if ($add > 0) $p['cargo'][$letter] += $add;
  return $add;
}

/** The system id of the player's ship (their current region). */
function sp_ship_region($board, $seat) {
  $pid = $board['ships'][(string)$seat] ?? null;
  if ($pid === null) return null;
  return sp_map()['planets'][$pid]['system'] ?? null;
}

function sp_bounty_at(&$player, $sysId) {
  return (int)($player['tracks']['bounty'][$sysId] ?? 0);
}
function sp_rep_at(&$player, $sysId) {
  return (int)($player['tracks']['rep'][$sysId] ?? 0);
}

/** Reveal intel around a planet (that planet + lane neighbors). */
function sp_reveal_around(&$player, $pid) {
  $known = array_flip($player['intel']);
  $known[$pid] = true;
  foreach (sp_lanes_of_planet($pid) as $other) $known[$other] = true;
  $player['intel'] = array_keys($known);
}

/** Record a region visit (Explorers Guild scoring). */
function sp_visit(&$player, $sysId) {
  if ($sysId !== null && !in_array($sysId, $player['tracks']['visited'], true)) {
    $player['tracks']['visited'][] = $sysId;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Tracks & the upgrade dock
// ─────────────────────────────────────────────────────────────────────────

/** Install a module by key onto a player (stat effects are derived; only
 *  cargo pods touch a stored column). */
function sp_install_module(&$player, $key) {
  $mod = sp_upgrade_cards()[$key] ?? null;
  if (!$mod) throw new Exception('Unknown module');
  $player['upgrades'][] = $key;
  if ($mod['type'] === 'system' && $mod['name'] === 'Cargo Pods') {
    $player['cargo_capacity'] = (int)$player['cargo_capacity'] + 4;
  }
  return $mod['name'];
}

function sp_upgrade_dock_refill(&$game) {
  $b = &$game['board_state'];
  while (count($b['upgrade_display']) < SP_UPGRADE_DISPLAY && count($b['upgrade_stack']) > 0) {
    $b['upgrade_display'][] = array_shift($b['upgrade_stack']);
  }
}

/**
 * Advance a track by 1 (ring-gated). Even steps grant a free module of the
 * matching type from the upgrade stack. Step 12 triggers the endgame.
 * Returns a suffix string for the event message ('' if no advance).
 */
function sp_track_advance(&$game, &$players, $seat, $trackKey, $planetRing) {
  $p = &$players[$seat];
  $step = (int)$p['tracks'][$trackKey]['step'];
  if ($step >= SP_TRACK_MAX) return '';
  $nextStep = $step + 1;
  $nextTier = intdiv($nextStep - 1, SP_TIER_STEPS) + 1;
  $minRing = SP_GATE_RING[$nextTier] ?? 0;
  if ($planetRing < $minRing) return '';
  $p['tracks'][$trackKey]['step'] = $nextStep;
  $label = ['military' => 'Pirate', 'diplomacy' => 'Diplomat', 'trade' => 'Merchant'][$trackKey];
  $suffix = " ($label +1)";

  // Even steps: free module of the matching type, drawn from the stack.
  if ($nextStep % 2 === 0) {
    $wantType = SP_TRACK_MODULE_TYPE[$trackKey];
    $stack = &$game['board_state']['upgrade_stack'];
    foreach ($stack as $i => $key) {
      if ((sp_upgrade_cards()[$key]['type'] ?? '') === $wantType) {
        array_splice($stack, $i, 1);
        $name = sp_install_module($p, $key);
        $suffix .= " — free module: $name";
        break;
      }
    }
  }
  if ($nextStep >= SP_TRACK_MAX) {
    sp_trigger_endgame($game, $players, $seat, 'track_mastery');
    $suffix .= ' — TRACK MASTERED';
  }
  return $suffix;
}

// ─────────────────────────────────────────────────────────────────────────
// Payments (market recruiting)
// ─────────────────────────────────────────────────────────────────────────

function sp_validate_payment($player, $cost, $payment) {
  $need = [];
  $wild = 0;
  foreach ($cost as $c) {
    if ($c === '?') $wild++;
    else $need[$c] = ($need[$c] ?? 0) + 1;
  }
  $paid = 0;
  foreach ($payment as $letter => $n) {
    $n = (int)$n;
    if ($n < 0 || !in_array($letter, SP_RESOURCES, true)) throw new Exception('Bad payment');
    if (($player['cargo'][$letter] ?? 0) < $n) {
      throw new Exception('Not enough ' . SP_RESOURCE_NAMES[$letter] . ' in cargo');
    }
    $paid += $n;
  }
  foreach ($need as $letter => $n) {
    if ((int)($payment[$letter] ?? 0) < $n) {
      throw new Exception('Cost requires ' . $n . '× ' . SP_RESOURCE_NAMES[$letter]);
    }
  }
  if ($paid !== count($cost)) {
    throw new Exception('Payment must total exactly ' . count($cost) . ' resources');
  }
}

function sp_apply_payment(&$player, $payment) {
  foreach ($payment as $letter => $n) $player['cargo'][$letter] -= (int)$n;
}

// ─────────────────────────────────────────────────────────────────────────
// Game setup
// ─────────────────────────────────────────────────────────────────────────

function sp_setup_game(&$game, &$players) {
  // Crew market: shuffle within each stage, concatenate I→V.
  // Solo games strip copy-action crew (Spy line) — dead cards with no
  // opponents to intercept.
  $solo = count($players) === 1;
  $cards = sp_cards();
  $stack = [];
  foreach (sp_market_stages() as $stage => $keys) {
    if ($solo) {
      $filtered = [];
      foreach ($keys as $k) {
        if ($cards[$k]['action'] !== 'copy') $filtered[] = $k;
      }
      $keys = $filtered;
    }
    shuffle($keys);
    foreach ($keys as $k) $stack[] = $k;
  }
  $game['market_display'] = array_splice($stack, 0, SP_MARKET_DISPLAY);
  $game['market_stack'] = $stack;

  // Upgrade dock: full shuffled module deck, 4 on display.
  $upgradeStack = array_keys(sp_upgrade_cards());
  shuffle($upgradeStack);
  $board = ['ships' => [], 'upgrade_display' => [], 'upgrade_stack' => $upgradeStack, 'meta' => []];

  foreach ($players as $seat => &$p) {
    $home = "H{$seat}a";
    $board['ships'][(string)$seat] = $home;
    $p['hand'] = sp_starter_keys();
    $p['discard'] = [];
    $p['credits'] = SP_STARTING_CREDITS;
    $p['cargo'] = SP_STARTING_CARGO;
    $p['cargo_capacity'] = SP_CARGO_CAPACITY;
    $p['drones_reserve'] = 0;
    $p['tracks'] = [
      'military' => ['step' => 0], 'diplomacy' => ['step' => 0], 'trade' => ['step' => 0],
      'bounty' => [], 'rep' => [], 'visited' => ["H{$seat}"],
    ];
    $p['intel'] = [];
    $p['upgrades'] = [];
    sp_reveal_around($p, $home);
  }
  unset($p);

  $game['board_state'] = $board;
  sp_upgrade_dock_refill($game);
  $game['status'] = 'active';
  $game['current_seat'] = 0;
  $game['turn_number'] = 1;
  $game['boon_seat'] = count($players) - 1;   // retained only as the tie-break anchor
}

// ─────────────────────────────────────────────────────────────────────────
// Action executors
// ─────────────────────────────────────────────────────────────────────────

function sp_exec_move(&$game, &$players, $seat, $cardKey, $params, $asCard) {
  $map = sp_map();
  $board = &$game['board_state'];
  $p = &$players[$seat];
  $cards = sp_cards();
  $path = $params['path'] ?? [];
  if (!is_array($path) || count($path) === 0) throw new Exception('No flight path given');

  $ship = sp_ship_stats($p);
  $allowed = (int)($cards[$asCard]['steps'] ?? 3) + $ship['speed_bonus'];
  if (count($path) > $allowed) throw new Exception("Flight path too long (max $allowed hops)");

  $at = $board['ships'][(string)$seat];
  foreach ($path as $to) {
    $to = (string)$to;
    if (!isset($map['planets'][$to])) throw new Exception('Unknown planet: ' . $to);
    if (!isset($map['lanes'][sp_lane_key($at, $to)])) {
      throw new Exception('No star-lane connects ' . $at . ' and ' . $to);
    }
    $at = $to;
    sp_reveal_around($p, $at);
    sp_visit($p, $map['planets'][$at]['system']);
  }
  $board['ships'][(string)$seat] = $at;
  return $p['player_name'] . ' flew to ' . $map['planets'][$at]['name'];
}

/** RAID — harder and richer with every success in the region. */
function sp_exec_strike(&$game, &$players, $seat, $cardKey, $params, $asCard) {
  $map = sp_map();
  $board = &$game['board_state'];
  $p = &$players[$seat];
  $cards = sp_cards();
  $planetId = (string)($params['planet'] ?? '');
  $planet = $map['planets'][$planetId] ?? null;
  if (!$planet) throw new Exception('Unknown planet');
  $region = sp_ship_region($board, $seat);
  if ($planet['system'] !== $region) throw new Exception('Your ship must be in that region to raid');

  $bounty = sp_bounty_at($p, $region);
  $ship = sp_ship_stats($p);
  $total = $ship['military'] + (int)$cards[$asCard]['stats'][0];
  $need = (int)$planet['military'] + $bounty;
  sp_reveal_around($p, $planetId);

  if ($total >= $need) {
    // Yield scales with bounty on BOTH axes: goods (cargo-capped) and
    // plundered credits (always paid, even with a full hold).
    $yield = (int)$planet['production'] + $bounty;
    $got = sp_cargo_add($p, $planet['faction'], $yield);
    $p['credits'] += $yield;
    $p['tracks']['bounty'][$region] = $bounty + 1;
    $suffix = sp_track_advance($game, $players, $seat, 'military', $planet['ring']);
    return $p['player_name'] . ' raided ' . $planet['name'] . " ($total vs $need) — looted $got "
         . SP_RESOURCE_NAMES[$planet['faction']] . " and $yield credits, bounty now " . ($bounty + 1) . $suffix;
  }
  return $p['player_name'] . '\'s raid on ' . $planet['name'] . " was repelled ($total vs $need)";
}

/**
 * DIPLOMATIC CONTRACT — easier and poorer with every success in the region.
 * The diplomat's unique lever: DISCARD other crew members (+1 political
 * each) — crew become commodities for political power. Discards are spent
 * win or lose (tempo cost; they return on the next Regroup).
 * Payout: 3 × production − 2 × rep, floored at production.
 */
function sp_exec_diplomacy(&$game, &$players, $seat, $cardKey, $params, $asCard) {
  $map = sp_map();
  $board = &$game['board_state'];
  $p = &$players[$seat];
  $cards = sp_cards();
  $planetId = (string)($params['planet'] ?? '');
  $planet = $map['planets'][$planetId] ?? null;
  if (!$planet) throw new Exception('Unknown planet');
  $region = sp_ship_region($board, $seat);
  if ($planet['system'] !== $region) throw new Exception('Your ship must be in that region to negotiate');

  // Validate discarded crew: in hand, unique, not the played card itself.
  $commits = is_array($params['commits'] ?? null) ? $params['commits'] : [];
  $seen = [];
  foreach ($commits as $k) {
    if (!is_string($k) || $k === $cardKey || isset($seen[$k])) {
      throw new Exception('Invalid crew selection');
    }
    $seen[$k] = true;
    if (!in_array($k, $p['hand'], true)) throw new Exception('Crew not in hand: ' . $k);
  }

  $rep = sp_rep_at($p, $region);
  if ($rep >= SP_REP_CAP) {
    throw new Exception('Your reputation here is settled (rep ' . SP_REP_CAP
      . ') — nothing left to solve in this region. Fly on to new problems.');
  }
  $ship = sp_ship_stats($p);
  $total = $ship['political'] + (int)$cards[$asCard]['stats'][1] + count($commits);
  $need = max(1, (int)$planet['political'] - $rep);
  sp_reveal_around($p, $planetId);

  // Crew are bargained away win or lose.
  foreach ($commits as $k) {
    $pos = array_search($k, $p['hand'], true);
    array_splice($p['hand'], $pos, 1);
    $p['discard'][] = $k;
  }
  $crewNote = count($commits) > 0 ? (', ' . count($commits) . ' crew bargained') : '';

  if ($total >= $need) {
    $prod = (int)$planet['production'];
    $payout = max($prod, 3 * $prod - 2 * $rep);
    $p['credits'] += $payout;
    $p['tracks']['rep'][$region] = $rep + 1;
    $suffix = sp_track_advance($game, $players, $seat, 'diplomacy', $planet['ring']);
    return $p['player_name'] . ' resolved a crisis on ' . $planet['name']
         . " ($total vs $need$crewNote) — paid $payout credits, rep now " . ($rep + 1) . $suffix;
  }
  return $p['player_name'] . '\'s envoys were turned away at ' . $planet['name']
       . " ($total vs $need$crewNote)";
}

/** TRADE — demand-matched, no opposed roll. */
function sp_exec_trade(&$game, &$players, $seat, $cardKey, $params, $asCard) {
  $map = sp_map();
  $board = &$game['board_state'];
  $p = &$players[$seat];
  $cards = sp_cards();
  $planetId = (string)($params['planet'] ?? '');
  $planet = $map['planets'][$planetId] ?? null;
  if (!$planet) throw new Exception('Unknown planet');
  $region = sp_ship_region($board, $seat);
  if ($planet['system'] !== $region) throw new Exception('Your ship must be in that region to trade');

  $ship = sp_ship_stats($p);
  $capacity = SP_TRADE_BASE_CAP + (int)$cards[$asCard]['stats'][2] + $ship['negotiating'];
  $sell = is_array($params['sell'] ?? null) ? $params['sell'] : [];
  $buy  = is_array($params['buy'] ?? null) ? $params['buy'] : [];

  $units = 0;
  foreach ([$sell, $buy] as $side) {
    foreach ($side as $letter => $n) {
      if (!in_array($letter, SP_RESOURCES, true)) throw new Exception('Bad resource');
      if ((int)$n < 0) throw new Exception('Bad amount');
      $units += (int)$n;
    }
  }
  if ($units === 0) throw new Exception('Trade at least one unit');
  if ($units > $capacity) throw new Exception("Over trade capacity (max $capacity units)");

  $earned = 0; $spent = 0; $soldUnits = 0;
  // Sell: only what this planet WANTS, at list + markup + negotiating/unit.
  foreach ($sell as $letter => $n) {
    $n = (int)$n;
    if ($n <= 0) continue;
    if (!in_array($letter, $planet['wants'], true)) {
      $wantNames = [];
      foreach ($planet['wants'] as $w) $wantNames[] = SP_RESOURCE_NAMES[$w];
      throw new Exception($planet['name'] . ' does not want ' . SP_RESOURCE_NAMES[$letter]
        . ' (wants: ' . implode(', ', $wantNames) . ')');
    }
    if (($p['cargo'][$letter] ?? 0) < $n) throw new Exception('Not enough ' . SP_RESOURCE_NAMES[$letter] . ' to sell');
    $p['cargo'][$letter] -= $n;
    $earned += $n * (SP_PRICES[$letter] + SP_SELL_MARKUP + $ship['negotiating']);
    $soldUnits += $n;
  }
  // Buy: only the planet's own goods, at list, at most its production per visit.
  foreach ($buy as $letter => $n) {
    $n = (int)$n;
    if ($n <= 0) continue;
    if ($letter !== $planet['faction']) {
      throw new Exception($planet['name'] . ' only sells ' . SP_RESOURCE_NAMES[$planet['faction']]);
    }
    if ($n > (int)$planet['production']) {
      throw new Exception($planet['name'] . ' sells at most ' . $planet['production'] . ' units per visit');
    }
    $price = $n * SP_PRICES[$letter];
    if ($p['credits'] + $earned < $price + $spent) throw new Exception('Not enough credits');
    if (sp_cargo_free($p) < $n) throw new Exception('Not enough cargo space');
    $p['cargo'][$letter] += $n;
    $spent += $price;
  }

  $rider = (int)$cards[$asCard]['rider_credits'];
  $p['credits'] += $earned - $spent + $rider;
  sp_reveal_around($p, $planetId);
  // Merchant rank comes from FULFILLING DEMAND: only a trade that SELLS
  // wanted goods advances the track (buying alone is just logistics).
  $suffix = $soldUnits > 0
    ? sp_track_advance($game, $players, $seat, 'trade', $planet['ring']) : '';
  $net = $earned - $spent + $rider;
  return $p['player_name'] . ' traded at ' . $planet['name']
       . " ($units units, " . ($net >= 0 ? '+' : '') . "$net credits)" . $suffix;
}

function sp_market_refill(&$game) {
  while (count($game['market_display']) < SP_MARKET_DISPLAY && count($game['market_stack']) > 0) {
    $game['market_display'][] = array_shift($game['market_stack']);
  }
}

function sp_exec_recruit(&$game, &$players, $seat, $cardKey, $params, $freeMode) {
  $p = &$players[$seat];
  $cards = sp_cards();
  $picks = $params['picks'] ?? [];
  if (!is_array($picks) || count($picks) === 0) throw new Exception('No cards picked');
  $maxPicks = $freeMode ? 1 : 2;
  if (count($picks) > $maxPicks) throw new Exception("At most $maxPicks card(s)");

  $names = [];
  foreach ($picks as $pick) {
    $key = (string)($pick['card'] ?? '');
    $payment = is_array($pick['payment'] ?? null) ? $pick['payment'] : [];
    $pos = array_search($key, $game['market_display'], true);
    if ($pos === false) throw new Exception('Card not in the market display');
    $cost = $cards[$key]['cost'];
    if (!$freeMode) $cost = array_merge($cost, SP_POSITION_COST[$pos] ?? []);
    sp_validate_payment($p, $cost, $payment);
    sp_apply_payment($p, $payment);
    array_splice($game['market_display'], $pos, 1);
    $p['hand'][] = $key;
    $names[] = $cards[$key]['name'];
  }
  sp_market_refill($game);

  if (count($game['market_display']) === 0 && count($game['market_stack']) === 0) {
    sp_trigger_endgame($game, $players, $seat, 'market_exhausted');
  }
  return $p['player_name'] . ' hired ' . implode(', ', $names);
}

function sp_exec_reset(&$game, &$players, $seat, $cardKey, $params, $asCard) {
  $p = &$players[$seat];
  $cards = sp_cards();

  $p['hand'] = array_merge($p['hand'], $p['discard']);
  $p['discard'] = [];
  $msg = $p['player_name'] . ' regrouped and recovered their cards';

  // Reset riders (Bosun / First Mate pocket credits).
  $rider = (int)($cards[$asCard]['rider_credits'] ?? 0);
  if ($rider > 0) {
    $p['credits'] += $rider;
    $msg .= " (+$rider credits)";
  }

  // Module purchases from the upgrade dock (credits).
  $wanted = $params['upgrades'] ?? [];
  if (is_array($wanted)) {
    foreach ($wanted as $key) {
      $pos = array_search($key, $game['board_state']['upgrade_display'], true);
      if ($pos === false) throw new Exception('Module not in the upgrade dock');
      $mod = sp_upgrade_cards()[$key];
      if ($p['credits'] < $mod['cost']) throw new Exception('Not enough credits for ' . $mod['name']);
      $p['credits'] -= $mod['cost'];
      array_splice($game['board_state']['upgrade_display'], $pos, 1);
      $name = sp_install_module($p, $key);
      $msg .= ' — installed ' . $name;
    }
    sp_upgrade_dock_refill($game);
  }

  // Intermediate scoring on each player's FIRST reset.
  if (!(int)$p['first_reset_done']) {
    $p['first_reset_done'] = 1;
    $score = sp_compute_score($game, $players, $seat, false);
    $p['intermediate_score'] = $score['total'];
    $p['vp_current'] = $score['total'];
    $msg .= ' (intermediate score: ' . $score['total'] . ' VP)';
    sp_maybe_pay_intermediate($game, $players);
  }
  return $msg;
}

/**
 * One-time rescue kept from the v1 era (reset cards stranded in discards).
 * Harmless for new games; still referenced by sp_getGameState.
 */
function sp_heal_stranded_resets(&$game, &$players) {
  if (!empty($game['board_state']['meta']['reset_healed'])) return false;
  $cards = sp_cards();
  foreach ($players as $seat => &$p) {
    for ($i = count($p['discard']) - 1; $i >= 0; $i--) {
      $k = $p['discard'][$i];
      if (isset($cards[$k]) && $cards[$k]['action'] === 'reset') {
        array_splice($p['discard'], $i, 1);
        $p['hand'][] = $k;
      }
    }
  }
  unset($p);
  $game['board_state']['meta']['reset_healed'] = true;
  return true;
}

function sp_maybe_pay_intermediate(&$game, &$players) {
  if (!empty($game['board_state']['meta']['intermediate_paid'])) return;
  foreach ($players as $p) {
    if (!(int)$p['conceded'] && !(int)$p['first_reset_done']) return;
  }
  $scores = [];
  foreach ($players as $seat => $p) {
    if (!(int)$p['conceded']) $scores[$seat] = (int)$p['intermediate_score'];
  }
  if (count($scores) === 0) return;
  $max = max($scores);
  $rest = array_filter($scores, function ($v) use ($max) { return $v < $max; });
  $second = count($rest) ? max($rest) : null;
  foreach ($scores as $seat => $v) {
    if ($v === $max) $players[$seat]['credits'] += 2;
    elseif ($second !== null && $v === $second) $players[$seat]['credits'] += 1;
  }
  $game['board_state']['meta']['intermediate_paid'] = true;
}

function sp_exec_copy(&$game, &$players, $seat, $cardKey, $params) {
  $target = (int)($params['target_seat'] ?? -1);
  if (!isset($players[$target]) || $target === $seat) throw new Exception('Invalid copy target');
  $their = $players[$target]['discard'];
  if (count($their) === 0) throw new Exception('That player has no discard to copy');
  $copied = $their[count($their) - 1];
  $action = sp_cards()[$copied]['action'];
  if ($action === 'reset' || $action === 'copy') {
    throw new Exception('Resets and copy cards cannot be copied');
  }
  $inner = is_array($params['params'] ?? null) ? $params['params'] : [];
  $msg = sp_dispatch_action($game, $players, $seat, $cardKey, $action, $inner, $copied);
  return $msg . ' (via ' . sp_cards()[$cardKey]['name'] . ')';
}

function sp_dispatch_action(&$game, &$players, $seat, $cardKey, $action, $params, $asCard) {
  switch ($action) {
    case 'move':         return sp_exec_move($game, $players, $seat, $cardKey, $params, $asCard);
    case 'strike':       return sp_exec_strike($game, $players, $seat, $cardKey, $params, $asCard);
    case 'diplomacy':    return sp_exec_diplomacy($game, $players, $seat, $cardKey, $params, $asCard);
    case 'trade':        return sp_exec_trade($game, $players, $seat, $cardKey, $params, $asCard);
    case 'recruit':      return sp_exec_recruit($game, $players, $seat, $cardKey, $params, false);
    case 'recruit_free': return sp_exec_recruit($game, $players, $seat, $cardKey, $params, true);
    case 'reset':        return sp_exec_reset($game, $players, $seat, $cardKey, $params, $asCard);
    case 'copy':         return sp_exec_copy($game, $players, $seat, $cardKey, $params);
    default: throw new Exception('Unknown action: ' . $action);
  }
}

function sp_play_card(&$game, &$players, $seat, $cardKey, $params, $mysqli) {
  if ($game['status'] !== 'active') throw new Exception('Game is not active');
  if ((int)$game['current_seat'] !== $seat) throw new Exception('Not your turn');
  $p = &$players[$seat];
  if ((int)$p['conceded']) throw new Exception('You have conceded');
  if (!in_array($cardKey, $p['hand'], true)) throw new Exception('Card not in hand');

  $cards = sp_cards();
  $action = $cards[$cardKey]['action'];

  if ($action === 'reset') {
    $pos = array_search($cardKey, $p['hand'], true);
    array_splice($p['hand'], $pos, 1);
    $msg = sp_exec_reset($game, $players, $seat, $cardKey, $params, $cardKey);
    // The reset card returns with everything else (Concordia Tribune).
    $p['hand'][] = $cardKey;
  } else {
    $msg = sp_dispatch_action($game, $players, $seat, $cardKey, $action, $params, $cardKey);
    $pos = array_search($cardKey, $p['hand'], true);
    if ($pos !== false) {
      array_splice($p['hand'], $pos, 1);
      $p['discard'][] = $cardKey;
    }
  }

  sp_log($mysqli, (int)$game['game_id'], $seat, 'action', $msg,
    ['card' => $cardKey, 'action' => $action]);
  sp_advance_turn($game, $players, $mysqli);
  return $msg;
}

// ─────────────────────────────────────────────────────────────────────────
// Turn advancement, endgame, scoring
// ─────────────────────────────────────────────────────────────────────────

function sp_active_seats($players) {
  $out = [];
  foreach ($players as $seat => $p) if (!(int)$p['conceded']) $out[] = $seat;
  return $out;
}

function sp_trigger_endgame(&$game, &$players, $seat, $reason) {
  if ($game['endgame_trigger'] !== null) return;
  $game['endgame_trigger'] = $reason;
  $game['trigger_seat'] = $seat;
  $players[$seat]['trophy'] = 1;
  $game['final_turns_remaining'] = count(sp_active_seats($players)) - 1;
}

function sp_advance_turn(&$game, &$players, $mysqli) {
  if ($game['endgame_trigger'] !== null) {
    if ((int)$game['final_turns_remaining'] <= 0) {
      sp_end_game($game, $players, $mysqli);
      return;
    }
    $game['final_turns_remaining'] = (int)$game['final_turns_remaining'] - 1;
  }

  $seats = sp_active_seats($players);
  if (count($seats) === 0) { sp_end_game($game, $players, $mysqli); return; }
  $n = count($players);
  $next = (int)$game['current_seat'];
  for ($i = 0; $i < $n; $i++) {
    $next = ($next + 1) % $n;
    if (!(int)$players[$next]['conceded']) break;
  }
  if ($next <= (int)$game['current_seat']) $game['turn_number'] = (int)$game['turn_number'] + 1;
  $game['current_seat'] = $next;

  if ($game['endgame_trigger'] !== null && (int)$game['final_turns_remaining'] <= 0
      && count($seats) <= 1) {
    sp_end_game($game, $players, $mysqli);
  }
}

function sp_compute_score($game, $players, $seat, $final = true) {
  $cards = sp_cards();
  $p = $players[$seat];

  $owned = array_merge($p['hand'], $p['discard']);
  $counts = ['wealth'=>0,'diplomatic_corps'=>0,'alliances'=>0,
             'trade_guild'=>0,'war_college'=>0,'engineering'=>0];
  foreach ($owned as $k) {
    if (isset($cards[$k])) $counts[$cards[$k]['affiliation']]++;
  }

  $cargoValue = 0;
  foreach ($p['cargo'] as $letter => $n) $cargoValue += $n * SP_PRICES[$letter];
  $visited = count($p['tracks']['visited'] ?? []);

  $b = [];
  $b['wealth']           = intdiv((int)$p['credits'] + $cargoValue, 10);
  $b['diplomatic_corps'] = $counts['diplomatic_corps'] * (int)$p['tracks']['diplomacy']['step'];
  $b['trade_guild']      = $counts['trade_guild'] * (int)$p['tracks']['trade']['step'];
  $b['war_college']      = $counts['war_college'] * (int)$p['tracks']['military']['step'];
  $b['alliances']        = $counts['alliances'] * $visited;
  // Engineering scores the ship itself: flat VP per installed module (the
  // v3 deck has no engineering-affiliation cards — the board IS the card).
  $b['engineering']      = SP_ENGINEERING_VP_PER_UPGRADE * count($p['upgrades']);
  $b['trophy']           = ($final && (int)$p['trophy']) ? SP_TROPHY_VP : 0;

  return ['total' => array_sum($b), 'breakdown' => $b, 'card_counts' => $counts];
}

function sp_end_game(&$game, &$players, $mysqli) {
  $game['status'] = 'ended';
  foreach ($players as $seat => &$p) {
    $score = sp_compute_score($game, $players, $seat, true);
    $p['final_score'] = $score['total'];
    $p['score_breakdown'] = $score['breakdown'];
    $p['vp_current'] = $score['total'];
  }
  unset($p);
  $maxScore = null;
  foreach ($players as $seat => $p) {
    if ((int)$p['conceded']) continue;
    if ($maxScore === null || (int)$p['final_score'] > $maxScore) $maxScore = (int)$p['final_score'];
  }
  $tied = [];
  foreach ($players as $seat => $p) {
    if (!(int)$p['conceded'] && (int)$p['final_score'] === $maxScore) $tied[] = $seat;
  }
  $bestSeat = null;
  if (count($tied) === 1) {
    $bestSeat = $tied[0];
  } elseif (count($tied) > 1) {
    $n = count($players);
    $anchor = $game['boon_seat'] !== null ? (int)$game['boon_seat'] : 0;
    $bestSeat = $tied[0];
    $bestDist = PHP_INT_MAX;
    foreach ($tied as $s) {
      $dist = ($anchor - $s + $n) % $n;
      if ($dist < $bestDist) { $bestDist = $dist; $bestSeat = $s; }
    }
  }
  $game['winner_seat'] = $bestSeat;
  sp_log($mysqli, (int)$game['game_id'], $bestSeat, 'game_ended',
    'Game over — winner: ' . ($bestSeat !== null ? $players[$bestSeat]['player_name'] : 'nobody'));
}

// ─────────────────────────────────────────────────────────────────────────
// Public (masked) state
// ─────────────────────────────────────────────────────────────────────────

function sp_public_state($mysqli, $game, $players, $yourSeat) {
  $map = sp_map();
  $cards = sp_cards();
  $you = $players[$yourSeat];
  $board = $game['board_state'];

  $catalog = [];
  foreach ($cards as $key => $c) {
    $catalog[$key] = [
      'key' => $key, 'name' => $c['name'], 'action' => $c['action'],
      'stats' => $c['stats'], 'affiliation' => $c['affiliation'],
      'stage' => $c['stage'], 'cost' => $c['cost'],
      'rider_credits' => $c['rider_credits'], 'text' => $c['text'],
      'steps' => $c['steps'] ?? null, 'kind' => $c['kind'],
    ];
  }

  $planets = [];
  foreach ($map['planets'] as $pid => $pl) {
    $planets[$pid] = [
      'id' => $pid, 'system' => $pl['system'], 'name' => $pl['name'],
      'faction' => $pl['faction'], 'ring' => $pl['ring'],
      'production' => $pl['production'], 'wants' => $pl['wants'],
      'x' => $pl['x'], 'y' => $pl['y'], 'home_seat' => $pl['home_seat'],
    ];
  }
  $intel = [];
  foreach ($you['intel'] as $pid) {
    if (isset($map['planets'][$pid])) {
      $intel[$pid] = [
        'm' => $map['planets'][$pid]['military'],
        'p' => $map['planets'][$pid]['political'],
      ];
    }
  }

  $pubPlayers = [];
  foreach ($players as $seat => $p) {
    $ship = sp_ship_stats($p);
    $pubPlayers[] = [
      'seat' => $seat, 'name' => $p['player_name'],
      'user_id' => $p['user_id'] !== null ? (int)$p['user_id'] : null,
      'credits' => (int)$p['credits'], 'cargo' => $p['cargo'],
      'cargo_capacity' => (int)$p['cargo_capacity'],
      'tracks' => [
        'military' => $p['tracks']['military'], 'diplomacy' => $p['tracks']['diplomacy'],
        'trade' => $p['tracks']['trade'],
      ],
      'bounty' => $p['tracks']['bounty'], 'rep' => $p['tracks']['rep'],
      'visited_count' => count($p['tracks']['visited'] ?? []),
      'upgrades' => $p['upgrades'],
      'ship' => $ship,
      'ship_at' => $board['ships'][(string)$seat] ?? null,
      'hand_count' => count($p['hand']),
      'discard_count' => count($p['discard']),
      'discard_top' => count($p['discard']) ? $p['discard'][count($p['discard']) - 1] : null,
      'first_reset_done' => (int)$p['first_reset_done'],
      'trophy' => (int)$p['trophy'], 'conceded' => (int)$p['conceded'],
      'final_score' => $p['final_score'] !== null ? (int)$p['final_score'] : null,
      'score_breakdown' => is_string($p['score_breakdown'])
        ? sp_j($p['score_breakdown'], null) : $p['score_breakdown'],
      'is_you' => $seat === $yourSeat,
    ];
  }

  $events = [];
  $stmt = $mysqli->prepare("
    SELECT event_id, seat, event_type, message FROM sp_event_log
    WHERE game_id = ? ORDER BY event_id DESC LIMIT 40");
  $gid = (int)$game['game_id'];
  $stmt->bind_param('i', $gid);
  $stmt->execute();
  $res = $stmt->get_result();
  while ($row = $res->fetch_assoc()) $events[] = $row;
  $stmt->close();
  $events = array_reverse($events);

  $yourShipAt = $board['ships'][(string)$yourSeat] ?? null;
  $yourRegion = $yourShipAt !== null ? ($map['planets'][$yourShipAt]['system'] ?? null) : null;

  return [
    'game' => [
      'game_id' => (int)$game['game_id'], 'status' => $game['status'],
      'map_key' => $game['map_key'], 'deck_key' => $game['deck_key'],
      'max_players' => (int)$game['max_players'],
      'current_seat' => (int)$game['current_seat'],
      'turn_number' => (int)$game['turn_number'],
      'endgame_trigger' => $game['endgame_trigger'],
      'trigger_seat' => $game['trigger_seat'] !== null ? (int)$game['trigger_seat'] : null,
      'final_turns_remaining' => $game['final_turns_remaining'] !== null ? (int)$game['final_turns_remaining'] : null,
      'winner_seat' => $game['winner_seat'] !== null ? (int)$game['winner_seat'] : null,
      'state_version' => (int)$game['state_version'],
      'host_player_id' => $game['host_player_id'] !== null ? (int)$game['host_player_id'] : null,
    ],
    'cards' => $catalog,
    'upgrades_catalog' => sp_upgrade_cards(),
    'upgrade_dock' => [
      'display' => $board['upgrade_display'] ?? [],
      'stack_count' => count($board['upgrade_stack'] ?? []),
    ],
    'prices' => SP_PRICES,
    'sell_markup' => SP_SELL_MARKUP,
    'trade_base_cap' => SP_TRADE_BASE_CAP,
    'resource_names' => SP_RESOURCE_NAMES,
    'faction_names' => SP_FACTION_NAMES,
    'position_costs' => SP_POSITION_COST,
    'map' => [
      'key' => $map['key'], 'name' => $map['name'],
      'systems' => $map['systems'], 'planets' => $planets, 'lanes' => $map['lanes'],
    ],
    'board' => ['ships' => $board['ships'] ?? []],
    'market' => [
      'display' => $game['market_display'],
      'stack_count' => count($game['market_stack']),
    ],
    'you' => [
      'seat' => $yourSeat, 'hand' => $you['hand'], 'discard' => $you['discard'],
      'credits' => (int)$you['credits'], 'cargo' => $you['cargo'],
      'cargo_capacity' => (int)$you['cargo_capacity'],
      'tracks' => [
        'military' => $you['tracks']['military'], 'diplomacy' => $you['tracks']['diplomacy'],
        'trade' => $you['tracks']['trade'],
      ],
      'bounty' => $you['tracks']['bounty'], 'rep' => $you['tracks']['rep'],
      'visited' => $you['tracks']['visited'],
      'upgrades' => $you['upgrades'],
      'ship' => sp_ship_stats($you),
      'ship_at' => $yourShipAt, 'region' => $yourRegion,
      'intel' => $intel,
      'first_reset_done' => (int)$you['first_reset_done'],
      'intermediate_score' => $you['intermediate_score'] !== null ? (int)$you['intermediate_score'] : null,
      'trophy' => (int)$you['trophy'],
    ],
    'players' => $pubPlayers,
    'events' => $events,
  ];
}

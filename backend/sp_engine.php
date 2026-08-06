<?php
/**
 * sp_engine.php — the SPACE GAME rules engine (server-authoritative).
 *
 * NOT an endpoint. require_once'd by every sp_*.php endpoint. This is the
 * single source of truth for the rules — there is deliberately no client
 * mirror (docs/SPACE_REDESIGN.md §8). Solo is a 1-player game through the
 * exact same code path.
 *
 * Engine model: sequential turns (Concordia). Every mutation happens inside
 * a transaction holding SELECT ... FOR UPDATE on the sp_games row, so the
 * JSON-blob state columns are single-writer safe.
 *
 * Rules source: docs/SPACE_REDESIGN.md + docs/FACTIONS_AND_CARDS_V1.md.
 */

require_once __DIR__ . '/mp_dbConfig.php';   // $mysqli + mp_json/mp_error/etc.
require_once __DIR__ . '/sp_cards_data.php';
require_once __DIR__ . '/sp_map_data.php';

// ─────────────────────────────────────────────────────────────────────────
// Tuning constants (the sync map lives HERE and nowhere else)
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

const SP_STARTING_CREDITS   = 5;
const SP_STARTING_CARGO     = ['O' => 1, 'B' => 1, 'C' => 0, 'N' => 0, 'A' => 0];
const SP_CARGO_CAPACITY     = 12;
const SP_TOTAL_DRONES       = 6;   // 2 start docked at home, 4 in cargo
const SP_DRONE_COST         = ['O' => 1, 'B' => 1];
const SP_STRIKE_YIELD       = 2;   // units seized on a successful strike
const SP_MARKET_DISPLAY     = 7;
const SP_TREATY_TRIGGER     = 10;  // Nth treaty ends the game (Concordia's 15 houses)
const SP_TROPHY_VP          = 7;

// Track tiers: 4 steps per tier, 3 tiers (12 steps). Crossing a gate needs
// a win at a planet of at least that ring (medium ring 2, hard ring 3).
const SP_TRACK_MAX          = 12;
const SP_TIER_STEPS         = 4;
const SP_GATE_RING          = [1 => 0, 2 => 2, 3 => 3]; // tier => min ring to enter

// Market position surcharge (extra '?' resources by display position 0..6).
const SP_POSITION_COST = [[], [], ['?'], ['?'], ['?', '?'], ['?', '?'], ['?', '?', '?']];

// Ship upgrades (Engineering scoring target: 2 VP per upgrade per envoy card).
const SP_ENGINEERING_VP_PER_UPGRADE = 2;
function sp_upgrades_catalog() {
  return [
    'cargo_pods'    => ['name' => 'Cargo Pods',    'credits' => 10, 'resources' => [],
                        'text' => '+4 cargo capacity.'],
    'nav_thrusters' => ['name' => 'Nav Thrusters', 'credits' => 8,  'resources' => ['C'],
                        'text' => '+2 movement steps on every move action.'],
    'deep_scanners' => ['name' => 'Deep Scanners', 'credits' => 6,  'resources' => [],
                        'text' => 'Your drones also scout planets two lanes away.'],
    'drone_foundry' => ['name' => 'Drone Foundry', 'credits' => 8,  'resources' => ['C'],
                        'text' => 'Immediately gain 1 extra drone in reserve.'],
    'trade_rig'     => ['name' => 'Trade Rig',     'credits' => 6,  'resources' => [],
                        'text' => '+2 credits on every trade mission.'],
  ];
}

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
    ['drones' => [], 'treaties' => [], 'markers' => [], 'meta' => []]);
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
    $row['tracks']   = sp_j($row['tracks'],
      ['military'=>['step'=>0], 'diplomacy'=>['step'=>0], 'trade'=>['step'=>0]]);
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
// Auth — sp_ mirror of mp_authenticate (player_token + optional Bearer match)
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
  return $row; // raw row; caller loads full decoded state via sp_load_*
}

// ─────────────────────────────────────────────────────────────────────────
// Geometry, cargo, intel helpers
// ─────────────────────────────────────────────────────────────────────────

function sp_cargo_used($p) {
  return array_sum($p['cargo']) + (int)$p['drones_reserve'];
}
function sp_cargo_free($p) {
  return max(0, (int)$p['cargo_capacity'] - sp_cargo_used($p));
}
/** Add units of a resource, truncating at capacity. Returns units added. */
function sp_cargo_add(&$p, $letter, $units) {
  $add = min($units, sp_cargo_free($p));
  if ($add > 0) $p['cargo'][$letter] += $add;
  return $add;
}

/** All drones of a seat from board state, with their array indices. */
function sp_seat_drones($board, $seat) {
  $out = [];
  foreach ($board['drones'] as $i => $d) {
    if ((int)$d['seat'] === (int)$seat) $out[$i] = $d;
  }
  return $out;
}

/** Planets adjacent to a seat's drones (mission/treaty targets). */
function sp_adjacent_planets($board, $seat) {
  $map = sp_map();
  $set = [];
  foreach (sp_seat_drones($board, $seat) as $d) {
    if ($d['type'] === 'docked') {
      $set[$d['at']] = true;
      foreach (sp_lanes_of_planet($d['at']) as $other) $set[$other] = true;
    } else {
      $pair = $map['lanes'][$d['at']] ?? null;
      if ($pair) { $set[$pair[0]] = true; $set[$pair[1]] = true; }
    }
  }
  return array_keys($set);
}

/** Is any drone (any seat) on this lane? */
function sp_lane_occupied($board, $laneKey, $exceptIndex = -1) {
  foreach ($board['drones'] as $i => $d) {
    if ($i === $exceptIndex) continue;
    if ($d['type'] === 'lane' && $d['at'] === $laneKey) return true;
  }
  return false;
}

/** Grant intel: every planet adjacent to the seat's drones (+2 lanes with scanners). */
function sp_auto_intel(&$player, $board) {
  $near = sp_adjacent_planets($board, (int)$player['seat']);
  $known = array_flip($player['intel']);
  foreach ($near as $pid) $known[$pid] = true;
  if (in_array('deep_scanners', $player['upgrades'], true)) {
    foreach ($near as $pid) {
      foreach (sp_lanes_of_planet($pid) as $other) $known[$other] = true;
    }
  }
  $player['intel'] = array_keys($known);
}

// ─────────────────────────────────────────────────────────────────────────
// Missions & tracks
// ─────────────────────────────────────────────────────────────────────────

const SP_STAT_INDEX = ['military' => 0, 'diplomacy' => 1, 'trade' => 2];

/**
 * Resolve an opposed mission. Commits must already be validated as in-hand.
 * Returns ['success'=>bool,'total'=>int,'opposition'=>int].
 * Side effects handled by caller (discarding, rewards, track advance).
 */
function sp_mission_total($missionType, $baseCardKey, $commitKeys) {
  $cards = sp_cards();
  $idx = SP_STAT_INDEX[$missionType];
  $total = $cards[$baseCardKey]['stats'][$idx];
  foreach ($commitKeys as $k) $total += $cards[$k]['stats'][$idx];
  return $total;
}

/** Advance a track by 1 win at a planet of the given ring, honoring tier gates. */
function sp_track_advance(&$player, $missionType, $planetRing) {
  $step = (int)$player['tracks'][$missionType]['step'];
  if ($step >= SP_TRACK_MAX) return false;
  $nextStep = $step + 1;
  $nextTier = intdiv($nextStep - 1, SP_TIER_STEPS) + 1;   // 1..3
  $minRing = SP_GATE_RING[$nextTier] ?? 0;
  if ($planetRing < $minRing) return false;               // gate holds
  $player['tracks'][$missionType]['step'] = $nextStep;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// Payments
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validate that $payment ({letter: count}) exactly covers $cost (array of
 * letters, '?' = any) and that the player owns it. Throws on mismatch.
 */
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

/** Deduct a fixed resource cost {letter: n}; throws if unaffordable. */
function sp_deduct(&$player, $cost, $what) {
  foreach ($cost as $letter => $n) {
    if (($player['cargo'][$letter] ?? 0) < $n) {
      throw new Exception("Not enough " . SP_RESOURCE_NAMES[$letter] . " for $what");
    }
  }
  foreach ($cost as $letter => $n) $player['cargo'][$letter] -= $n;
}

// ─────────────────────────────────────────────────────────────────────────
// Game setup
// ─────────────────────────────────────────────────────────────────────────

function sp_setup_game(&$game, &$players) {
  $map = sp_map();

  // Build the market stack: shuffle within each stage, concatenate I→V.
  $stack = [];
  foreach (sp_market_stages() as $stage => $keys) {
    shuffle($keys);
    foreach ($keys as $k) $stack[] = $k;
  }
  $game['market_display'] = array_splice($stack, 0, SP_MARKET_DISPLAY);
  $game['market_stack'] = $stack;

  // Board: markers unflipped; 2 drones docked at each player's home planet.
  $board = ['drones' => [], 'treaties' => [], 'markers' => [], 'meta' => []];
  foreach ($map['systems'] as $sysId => $sys) {
    $board['markers'][$sysId] = ['flipped' => false];
  }
  foreach ($players as $seat => &$p) {
    $home = "H{$seat}a";
    $board['drones'][] = ['seat' => $seat, 'type' => 'docked', 'at' => $home];
    $board['drones'][] = ['seat' => $seat, 'type' => 'docked', 'at' => $home];
    $p['hand'] = sp_starter_keys();
    $p['discard'] = [];
    $p['credits'] = SP_STARTING_CREDITS;
    $p['cargo'] = SP_STARTING_CARGO;
    $p['cargo_capacity'] = SP_CARGO_CAPACITY;
    $p['drones_reserve'] = SP_TOTAL_DRONES - 2;
    $p['tracks'] = ['military'=>['step'=>0], 'diplomacy'=>['step'=>0], 'trade'=>['step'=>0]];
    $p['intel'] = [];
    $p['upgrades'] = [];
    sp_auto_intel($p, $board);
  }
  unset($p);

  $game['board_state'] = $board;
  $game['status'] = 'active';
  $game['current_seat'] = 0;
  $game['turn_number'] = 1;
  // Concordia: the LAST player starts with the Praefectus Magnus.
  $game['boon_seat'] = count($players) - 1;
}

// ─────────────────────────────────────────────────────────────────────────
// Action executors — each mutates $game/$players and returns an event message
// ─────────────────────────────────────────────────────────────────────────

/** Common: take commits + played card out of hand, into discard (played on top). */
function sp_spend_cards(&$player, $cardKey, $commitKeys) {
  $hand = $player['hand'];
  foreach (array_merge($commitKeys, [$cardKey]) as $k) {
    $pos = array_search($k, $hand, true);
    if ($pos === false) throw new Exception('Card not in hand: ' . $k);
    array_splice($hand, $pos, 1);
  }
  $player['hand'] = $hand;
  foreach ($commitKeys as $k) $player['discard'][] = $k;
  $player['discard'][] = $cardKey;   // played card ends on top
}

function sp_validate_commits($player, $cardKey, $commitKeys) {
  if (!is_array($commitKeys)) throw new Exception('commits must be an array');
  $seen = [];
  foreach ($commitKeys as $k) {
    if (!is_string($k) || $k === $cardKey || isset($seen[$k])) {
      throw new Exception('Invalid commit list');
    }
    $seen[$k] = true;
    if (!in_array($k, $player['hand'], true)) throw new Exception('Commit not in hand: ' . $k);
  }
}

function sp_exec_move(&$game, &$players, $seat, $cardKey, $params, $asCard) {
  $map = sp_map();
  $board = &$game['board_state'];
  $p = &$players[$seat];
  $steps = $params['steps'] ?? [];
  if (!is_array($steps)) throw new Exception('steps must be an array');

  $mine = sp_seat_drones($board, $seat);
  $myIndices = array_keys($mine);
  $allowed = count($mine);
  if (in_array('nav_thrusters', $p['upgrades'], true)) $allowed += 2;
  if (count($steps) > $allowed) throw new Exception("Too many movement steps (max $allowed)");

  foreach ($steps as $s) {
    $di = (int)($s['drone'] ?? -1);
    $to = (string)($s['to'] ?? '');
    if (!in_array($di, $myIndices, true)) throw new Exception('Not your drone');
    if (!isset($map['lanes'][$to])) throw new Exception('Unknown lane: ' . $to);
    $d = $board['drones'][$di];
    $pair = $map['lanes'][$to];
    if ($d['type'] === 'docked') {
      if ($d['at'] !== $pair[0] && $d['at'] !== $pair[1]) {
        throw new Exception('First step must leave the docked planet onto an adjacent lane');
      }
    } else {
      $cur = $map['lanes'][$d['at']];
      $shared = array_intersect($cur, $pair);
      if (count($shared) === 0) throw new Exception('Lanes are not connected');
    }
    $board['drones'][$di] = ['seat' => $seat, 'type' => 'lane', 'at' => $to];
  }
  // End-of-movement occupancy: no lane may hold 2 drones.
  $seen = [];
  foreach ($board['drones'] as $i => $d) {
    if ($d['type'] !== 'lane') continue;
    if (isset($seen[$d['at']])) throw new Exception('A lane may only hold one drone at the end of movement');
    $seen[$d['at']] = $i;
  }

  sp_auto_intel($p, $board);
  $msg = $p['player_name'] . ' maneuvered drones';

  // Optional treaty attempt (Diplomacy mission).
  if (!empty($params['treaty']) && is_array($params['treaty'])) {
    $t = $params['treaty'];
    $planetId = (string)($t['planet'] ?? '');
    $commits = $t['commits'] ?? [];
    $planet = $map['planets'][$planetId] ?? null;
    if (!$planet) throw new Exception('Unknown planet');
    if (!in_array($planetId, sp_adjacent_planets($board, $seat), true)) {
      throw new Exception('No drone adjacent to that planet');
    }
    $holders = $board['treaties'][$planetId] ?? [];
    if (in_array($seat, $holders, true)) throw new Exception('You already hold a treaty there');
    sp_validate_commits($p, $cardKey, $commits);

    // Affordability first — a mission you can't pay for is an error, not a loss.
    $nAfter = count($holders) + 1;
    // Treaty cost mirrors Concordia house costs: Krath (ore) planets are the
    // cheap build (1 Biomass + 1 credit × treaties-after); everywhere else
    // 1 Ore + 1 local resource + (value-2) credits × treaties-after.
    if ($planet['faction'] === 'O') {
      $resCost = ['B' => 1];
      $creditCost = 1 * $nAfter;
    } else {
      $resCost = ['O' => 1, $planet['faction'] => 1];
      $creditCost = (SP_PRICES[$planet['faction']] - 2) * $nAfter;
    }
    foreach ($resCost as $letter => $n) {
      if (($p['cargo'][$letter] ?? 0) < $n) throw new Exception('Cannot afford the treaty cost');
    }
    if ($p['credits'] < $creditCost) throw new Exception('Cannot afford the treaty cost');

    $total = sp_mission_total('diplomacy', $asCard, $commits);
    $opp = $planet['opposition'];
    // Attempting reveals the opposition either way.
    if (!in_array($planetId, $p['intel'], true)) $p['intel'][] = $planetId;

    // Commits are spent (to discard) win or lose — that's the tempo cost.
    foreach ($commits as $k) {
      $pos = array_search($k, $p['hand'], true);
      array_splice($p['hand'], $pos, 1);
      $p['discard'][] = $k;
    }

    if ($total >= $opp) {
      sp_deduct($p, $resCost, 'the treaty');
      $p['credits'] -= $creditCost;
      $board['treaties'][$planetId] = array_merge($holders, [$seat]);
      $advanced = sp_track_advance($p, 'diplomacy', $planet['ring']);
      $msg .= ' and signed a treaty at ' . $planet['name']
            . ($advanced ? ' (Diplomacy +1)' : '');
      sp_check_treaty_trigger($game, $players, $seat);
    } else {
      $msg .= ' but the treaty attempt at ' . $planet['name']
            . " failed ($total vs $opp)";
    }
  }
  return $msg;
}

function sp_exec_strike(&$game, &$players, $seat, $cardKey, $params, $asCard) {
  $map = sp_map();
  $board = &$game['board_state'];
  $p = &$players[$seat];
  $planetId = (string)($params['planet'] ?? '');
  $commits = $params['commits'] ?? [];
  $planet = $map['planets'][$planetId] ?? null;
  if (!$planet) throw new Exception('Unknown planet');
  if (!in_array($planetId, sp_adjacent_planets($board, $seat), true)) {
    throw new Exception('No drone adjacent to that planet');
  }
  sp_validate_commits($p, $cardKey, $commits);

  $total = sp_mission_total('military', $asCard, $commits);
  $opp = $planet['opposition'];
  if (!in_array($planetId, $p['intel'], true)) $p['intel'][] = $planetId;
  foreach ($commits as $k) {
    $pos = array_search($k, $p['hand'], true);
    array_splice($p['hand'], $pos, 1);
    $p['discard'][] = $k;
  }
  if ($total >= $opp) {
    $got = sp_cargo_add($p, $planet['faction'], SP_STRIKE_YIELD);
    $advanced = sp_track_advance($p, 'military', $planet['ring']);
    return $p['player_name'] . ' raided ' . $planet['name'] . " — seized $got "
         . SP_RESOURCE_NAMES[$planet['faction']] . ($advanced ? ' (Military +1)' : '');
  }
  return $p['player_name'] . ' raided ' . $planet['name'] . " and was repelled ($total vs $opp)";
}

function sp_exec_trade(&$game, &$players, $seat, $cardKey, $params, $asCard) {
  $map = sp_map();
  $board = &$game['board_state'];
  $p = &$players[$seat];
  $cards = sp_cards();
  $planetId = (string)($params['planet'] ?? '');
  $commits = $params['commits'] ?? [];
  $planet = $map['planets'][$planetId] ?? null;
  if (!$planet) throw new Exception('Unknown planet');
  if (!in_array($planetId, sp_adjacent_planets($board, $seat), true)) {
    throw new Exception('No drone adjacent to that planet');
  }
  sp_validate_commits($p, $cardKey, $commits);

  $total = sp_mission_total('trade', $asCard, $commits);
  $opp = $planet['opposition'];
  if (!in_array($planetId, $p['intel'], true)) $p['intel'][] = $planetId;
  foreach ($commits as $k) {
    $pos = array_search($k, $p['hand'], true);
    array_splice($p['hand'], $pos, 1);
    $p['discard'][] = $k;
  }
  if ($total < $opp) {
    return $p['player_name'] . ' sought trade at ' . $planet['name'] . " and was refused ($total vs $opp)";
  }

  $rider = (int)$cards[$asCard]['rider_credits'];
  if (in_array('trade_rig', $p['upgrades'], true)) $rider += 2;
  $p['credits'] += $rider;

  // Buy/sell at list prices — at most two distinct resource types total.
  $sell = is_array($params['sell'] ?? null) ? $params['sell'] : [];
  $buy  = is_array($params['buy'] ?? null) ? $params['buy'] : [];
  $types = [];
  foreach ([$sell, $buy] as $side) {
    foreach ($side as $letter => $n) {
      if ((int)$n > 0) $types[$letter] = true;
      if (!in_array($letter, SP_RESOURCES, true)) throw new Exception('Bad resource');
    }
  }
  if (count($types) > 2) throw new Exception('Trade at most two resource types');
  foreach ($sell as $letter => $n) {
    $n = (int)$n;
    if ($n <= 0) continue;
    if (($p['cargo'][$letter] ?? 0) < $n) throw new Exception('Not enough ' . SP_RESOURCE_NAMES[$letter] . ' to sell');
    $p['cargo'][$letter] -= $n;
    $p['credits'] += $n * SP_PRICES[$letter];
  }
  foreach ($buy as $letter => $n) {
    $n = (int)$n;
    if ($n <= 0) continue;
    $price = $n * SP_PRICES[$letter];
    if ($p['credits'] < $price) throw new Exception('Not enough credits');
    if (sp_cargo_free($p) < $n) throw new Exception('Not enough cargo space');
    $p['credits'] -= $price;
    $p['cargo'][$letter] += $n;
  }
  $advanced = sp_track_advance($p, 'trade', $planet['ring']);
  return $p['player_name'] . ' concluded trade at ' . $planet['name']
       . " (+$rider credits)" . ($advanced ? ' (Trade +1)' : '');
}

function sp_exec_produce(&$game, &$players, $seat, $cardKey, $params) {
  $map = sp_map();
  $board = &$game['board_state'];
  $p = &$players[$seat];
  $mode = (string)($params['mode'] ?? 'production');

  if ($mode === 'levy') {
    $coins = 0;
    foreach ($board['markers'] as $sysId => $m) {
      if (!empty($m['flipped'])) { $coins++; $board['markers'][$sysId]['flipped'] = false; }
    }
    $p['credits'] += $coins;
    return $p['player_name'] . " collected the levy (+$coins credits)";
  }

  $sysId = (string)($params['system'] ?? '');
  $sys = $map['systems'][$sysId] ?? null;
  if (!$sys) throw new Exception('Unknown system');
  $marker = $board['markers'][$sysId] ?? ['flipped' => false];
  if (!empty($marker['flipped'])) {
    throw new Exception('That system has already produced (marker spent) — choose another or collect the levy');
  }

  // Chooser bonus: 1 unit of the system's marker resource (2 with the boon).
  $bonusUnits = ($game['boon_seat'] !== null && (int)$game['boon_seat'] === $seat) ? 2 : 1;
  $gotBonus = sp_cargo_add($p, $sys['marker'], $bonusUnits);
  $usedBoon = ($bonusUnits === 2);
  $board['markers'][$sysId]['flipped'] = true;

  // All treaty holders on the system's planets produce, regardless of owner.
  foreach ($sys['planets'] as $pid) {
    $holders = $board['treaties'][$pid] ?? [];
    foreach ($holders as $hSeat) {
      sp_cargo_add($players[$hSeat], $map['planets'][$pid]['faction'], 1);
    }
  }

  // The boon must be used when able, then passes to the right.
  if ($usedBoon) {
    $n = count($players);
    $game['boon_seat'] = ((int)$game['boon_seat'] - 1 + $n) % $n;
  }

  return $p['player_name'] . ' ran production in ' . $sys['name']
       . " (+$gotBonus " . SP_RESOURCE_NAMES[$sys['marker']] . ' bonus'
       . ($usedBoon ? ', boon doubled' : '') . ')';
}

function sp_exec_deploy(&$game, &$players, $seat, $cardKey, $params) {
  $map = sp_map();
  $board = &$game['board_state'];
  $p = &$players[$seat];
  $mode = (string)($params['mode'] ?? 'place');

  if ($mode === 'credits') {
    $gain = 5 + count(sp_seat_drones($board, $seat));
    $p['credits'] += $gain;
    return $p['player_name'] . " recalled logistics (+$gain credits)";
  }

  $placements = $params['placements'] ?? [];
  if (!is_array($placements) || count($placements) === 0) throw new Exception('No placements');
  foreach ($placements as $pl) {
    if ((int)$p['drones_reserve'] <= 0) throw new Exception('No drones in reserve');
    $pid = (string)($pl['planet'] ?? '');
    $planet = $map['planets'][$pid] ?? null;
    if (!$planet) throw new Exception('Unknown planet');
    $isHome = ($planet['home_seat'] !== null && (int)$planet['home_seat'] === $seat);
    $hasTreaty = in_array($seat, $board['treaties'][$pid] ?? [], true);
    if (!$isHome && !$hasTreaty) {
      throw new Exception('Drones launch at your home planet or planets where you hold a treaty');
    }
    sp_deduct($p, SP_DRONE_COST, 'a drone');
    $p['drones_reserve'] = (int)$p['drones_reserve'] - 1;
    $board['drones'][] = ['seat' => $seat, 'type' => 'docked', 'at' => $pid];
  }
  sp_auto_intel($p, $board);
  return $p['player_name'] . ' launched ' . count($placements) . ' drone(s)';
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

  // Endgame trigger: the market is exhausted.
  if (count($game['market_display']) === 0 && count($game['market_stack']) === 0) {
    sp_trigger_endgame($game, $players, $seat, 'market_exhausted');
  }
  return $p['player_name'] . ' installed ' . implode(', ', $names);
}

function sp_exec_envoy(&$game, &$players, $seat, $cardKey, $asCard) {
  $map = sp_map();
  $board = $game['board_state'];
  $p = &$players[$seat];
  $faction = sp_cards()[$asCard]['faction'];
  $count = 0;
  foreach ($board['treaties'] as $pid => $holders) {
    if ($map['planets'][$pid]['faction'] !== $faction) continue;
    foreach ($holders as $h) if ((int)$h === $seat) $count++;
  }
  $got = sp_cargo_add($p, $faction, $count);
  return $p['player_name'] . ' activated ' . sp_cards()[$asCard]['name']
       . " (+$got " . SP_RESOURCE_NAMES[$faction] . ')';
}

function sp_exec_reset(&$game, &$players, $seat, $cardKey, $params, $asCard) {
  $map = sp_map();
  $board = &$game['board_state'];
  $p = &$players[$seat];

  // Recover: everything previously played returns; the reset card alone
  // remains face-up on the discard (Concordia Tribune).
  $p['hand'] = array_merge($p['hand'], $p['discard']);
  $p['discard'] = [];
  $recovered = true;
  $msg = $p['player_name'] . ' regrouped and recovered their cards';

  // Optional drone build (free with Maintenance Bay Mk II).
  if (!empty($params['build_drone'])) {
    if ((int)$p['drones_reserve'] <= 0) throw new Exception('No drones in reserve');
    $pid = (string)($params['drone_planet'] ?? "H{$seat}a");
    $planet = $map['planets'][$pid] ?? null;
    if (!$planet) throw new Exception('Unknown planet');
    $isHome = ($planet['home_seat'] !== null && (int)$planet['home_seat'] === $seat);
    $hasTreaty = in_array($seat, $board['treaties'][$pid] ?? [], true);
    if (!$isHome && !$hasTreaty) throw new Exception('Drones launch at home or treaty planets');
    if ($asCard !== 'maintenance_bay_2') sp_deduct($p, SP_DRONE_COST, 'a drone');
    $p['drones_reserve'] = (int)$p['drones_reserve'] - 1;
    $board['drones'][] = ['seat' => $seat, 'type' => 'docked', 'at' => $pid];
    sp_auto_intel($p, $board);
    $msg .= ' and built a drone';
  }

  // Optional upgrade purchases.
  $catalog = sp_upgrades_catalog();
  $wanted = $params['upgrades'] ?? [];
  if (is_array($wanted)) {
    foreach ($wanted as $key) {
      if (!isset($catalog[$key])) throw new Exception('Unknown upgrade');
      if (in_array($key, $p['upgrades'], true)) throw new Exception('Upgrade already installed');
      $u = $catalog[$key];
      if ($p['credits'] < $u['credits']) throw new Exception('Not enough credits for ' . $u['name']);
      $fixed = [];
      foreach ($u['resources'] as $letter) $fixed[$letter] = ($fixed[$letter] ?? 0) + 1;
      sp_deduct($p, $fixed, $u['name']);
      $p['credits'] -= $u['credits'];
      $p['upgrades'][] = $key;
      if ($key === 'cargo_pods') $p['cargo_capacity'] += 4;
      if ($key === 'drone_foundry') $p['drones_reserve'] += 1;
      $msg .= ' — installed ' . $u['name'];
    }
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

/** Once every active player has reset once: pay 2/1 credits, once per game. */
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
  // Execute the copied card's action AS that card (its stats, its rider),
  // but the physical card played/discarded is the copy card itself.
  $msg = sp_dispatch_action($game, $players, $seat, $cardKey, $action, $inner, $copied);
  return $msg . ' (via ' . sp_cards()[$cardKey]['name'] . ')';
}

/**
 * Dispatch on action type. $asCard = the card whose stats/rider apply
 * (differs from $cardKey only for copy).
 */
function sp_dispatch_action(&$game, &$players, $seat, $cardKey, $action, $params, $asCard) {
  switch ($action) {
    case 'move':         return sp_exec_move($game, $players, $seat, $cardKey, $params, $asCard);
    case 'strike':       return sp_exec_strike($game, $players, $seat, $cardKey, $params, $asCard);
    case 'trade':        return sp_exec_trade($game, $players, $seat, $cardKey, $params, $asCard);
    case 'produce':      return sp_exec_produce($game, $players, $seat, $cardKey, $params);
    case 'deploy':       return sp_exec_deploy($game, $players, $seat, $cardKey, $params);
    case 'recruit':      return sp_exec_recruit($game, $players, $seat, $cardKey, $params, false);
    case 'recruit_free': return sp_exec_recruit($game, $players, $seat, $cardKey, $params, true);
    case 'envoy':        return sp_exec_envoy($game, $players, $seat, $cardKey, $asCard);
    case 'reset':        return sp_exec_reset($game, $players, $seat, $cardKey, $params, $asCard);
    case 'copy':         return sp_exec_copy($game, $players, $seat, $cardKey, $params);
    default: throw new Exception('Unknown action: ' . $action);
  }
}

/**
 * THE turn entry point. Validates turn ownership + card, executes, spends
 * the card, advances the turn. Called by sp_playCard.php inside the
 * game-row lock.
 */
function sp_play_card(&$game, &$players, $seat, $cardKey, $params, $mysqli) {
  if ($game['status'] !== 'active') throw new Exception('Game is not active');
  if ((int)$game['current_seat'] !== $seat) throw new Exception('Not your turn');
  $p = &$players[$seat];
  if ((int)$p['conceded']) throw new Exception('You have conceded');
  if (!in_array($cardKey, $p['hand'], true)) throw new Exception('Card not in hand');

  $cards = sp_cards();
  $action = $cards[$cardKey]['action'];

  // Reset recovers BEFORE the played card is discarded (handled inside);
  // everything else discards commits+card inside their executors or here.
  if ($action === 'reset') {
    // Remove the reset card from hand first so it isn't duplicated by recovery.
    $pos = array_search($cardKey, $p['hand'], true);
    array_splice($p['hand'], $pos, 1);
    $msg = sp_exec_reset($game, $players, $seat, $cardKey, $params, $cardKey);
    $p['discard'][] = $cardKey;   // reset card alone remains face-up
  } else {
    $msg = sp_dispatch_action($game, $players, $seat, $cardKey, $action, $params, $cardKey);
    // Mission executors already moved commits to discard; now the played card.
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

function sp_check_treaty_trigger(&$game, &$players, $seat) {
  $count = 0;
  foreach ($game['board_state']['treaties'] as $holders) {
    foreach ($holders as $h) if ((int)$h === $seat) $count++;
  }
  if ($count >= SP_TREATY_TRIGGER) {
    sp_trigger_endgame($game, $players, $seat, 'treaty_network');
  }
}

function sp_trigger_endgame(&$game, &$players, $seat, $reason) {
  if ($game['endgame_trigger'] !== null) return;   // already triggered
  $game['endgame_trigger'] = $reason;
  $game['trigger_seat'] = $seat;
  $players[$seat]['trophy'] = 1;
  $game['final_turns_remaining'] = count(sp_active_seats($players)) - 1;
}

function sp_advance_turn(&$game, &$players, $mysqli) {
  // Endgame countdown: the triggering player's turn is done; every other
  // player gets exactly one more turn.
  if ($game['endgame_trigger'] !== null) {
    if ((int)$game['final_turns_remaining'] <= 0) {
      sp_end_game($game, $players, $mysqli);
      return;
    }
    $game['final_turns_remaining'] = (int)$game['final_turns_remaining'] - 1;
    // Note: decremented for the turn ABOUT to be granted below. When it was
    // just set by the trigger, this grants exactly (players-1) further turns.
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

  // Endgame fully consumed? (single survivor edge: trigger with 0 remaining)
  if ($game['endgame_trigger'] !== null && (int)$game['final_turns_remaining'] <= 0
      && count($seats) <= 1) {
    sp_end_game($game, $players, $mysqli);
  }
}

/**
 * Compute a player's score. $final=true includes the trophy.
 * Breakdown keys mirror the six affiliations (docs/SPACE_REDESIGN.md §6).
 */
function sp_compute_score($game, $players, $seat, $final = true) {
  $map = sp_map();
  $cards = sp_cards();
  $p = $players[$seat];
  $board = $game['board_state'];

  // All owned cards score — hand + discard (pure Concordia).
  $owned = array_merge($p['hand'], $p['discard']);
  $counts = ['wealth'=>0,'diplomatic_corps'=>0,'alliances'=>0,
             'trade_guild'=>0,'war_college'=>0,'engineering'=>0];
  foreach ($owned as $k) $counts[$cards[$k]['affiliation']]++;

  // Multiplicands
  $systemsWithTreaty = [];
  foreach ($board['treaties'] as $pid => $holders) {
    if (in_array($seat, $holders, true)) {
      $systemsWithTreaty[$map['planets'][$pid]['system']] = true;
    }
  }
  $cargoValue = 0;
  foreach ($p['cargo'] as $letter => $n) $cargoValue += $n * SP_PRICES[$letter];

  $b = [];
  $b['wealth']           = intdiv((int)$p['credits'] + $cargoValue, 10);
  $b['diplomatic_corps'] = $counts['diplomatic_corps'] * (int)$p['tracks']['diplomacy']['step'];
  $b['trade_guild']      = $counts['trade_guild'] * (int)$p['tracks']['trade']['step'];
  $b['war_college']      = $counts['war_college'] * (int)$p['tracks']['military']['step'];
  $b['alliances']        = $counts['alliances'] * count($systemsWithTreaty);
  $b['engineering']      = $counts['engineering'] * SP_ENGINEERING_VP_PER_UPGRADE * count($p['upgrades']);
  $b['trophy']           = ($final && (int)$p['trophy']) ? SP_TROPHY_VP : 0;

  return ['total' => array_sum($b), 'breakdown' => $b, 'card_counts' => $counts];
}

function sp_end_game(&$game, &$players, $mysqli) {
  $game['status'] = 'ended';
  $best = null; $bestSeat = null;
  foreach ($players as $seat => &$p) {
    $score = sp_compute_score($game, $players, $seat, true);
    $p['final_score'] = $score['total'];
    $p['score_breakdown'] = $score['breakdown'];
    $p['vp_current'] = $score['total'];
  }
  unset($p);
  // Winner: highest score among non-conceded; ties go to the boon holder,
  // else the tied seat the boon would reach first moving right.
  $maxScore = null;
  foreach ($players as $seat => $p) {
    if ((int)$p['conceded']) continue;
    if ($maxScore === null || (int)$p['final_score'] > $maxScore) $maxScore = (int)$p['final_score'];
  }
  $tied = [];
  foreach ($players as $seat => $p) {
    if (!(int)$p['conceded'] && (int)$p['final_score'] === $maxScore) $tied[] = $seat;
  }
  if (count($tied) === 1) {
    $bestSeat = $tied[0];
  } elseif (count($tied) > 1) {
    $n = count($players);
    $boon = $game['boon_seat'] !== null ? (int)$game['boon_seat'] : 0;
    $bestSeat = $tied[0];
    $bestDist = PHP_INT_MAX;
    foreach ($tied as $s) {
      $dist = ($boon - $s + $n) % $n;   // boon passes right (decreasing seat)
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

  // Card catalog — static, no secrets, lets the client render everything.
  $catalog = [];
  foreach ($cards as $key => $c) {
    $catalog[$key] = [
      'key' => $key, 'name' => $c['name'], 'action' => $c['action'],
      'stats' => $c['stats'], 'affiliation' => $c['affiliation'],
      'stage' => $c['stage'], 'cost' => $c['cost'],
      'rider_credits' => $c['rider_credits'], 'text' => $c['text'],
      'faction' => $c['faction'] ?? null,
    ];
  }

  // Map WITHOUT opposition; your intel carries the revealed values.
  $planets = [];
  foreach ($map['planets'] as $pid => $pl) {
    $planets[$pid] = [
      'id' => $pid, 'system' => $pl['system'], 'name' => $pl['name'],
      'faction' => $pl['faction'], 'ring' => $pl['ring'],
      'x' => $pl['x'], 'y' => $pl['y'], 'home_seat' => $pl['home_seat'],
    ];
  }
  $intel = [];
  foreach ($you['intel'] as $pid) {
    if (isset($map['planets'][$pid])) $intel[$pid] = $map['planets'][$pid]['opposition'];
  }

  $pubPlayers = [];
  foreach ($players as $seat => $p) {
    $pubPlayers[] = [
      'seat' => $seat, 'name' => $p['player_name'],
      'user_id' => $p['user_id'] !== null ? (int)$p['user_id'] : null,
      'credits' => (int)$p['credits'], 'cargo' => $p['cargo'],
      'cargo_capacity' => (int)$p['cargo_capacity'],
      'drones_reserve' => (int)$p['drones_reserve'],
      'tracks' => $p['tracks'], 'upgrades' => $p['upgrades'],
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

  // Recent events
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

  return [
    'game' => [
      'game_id' => (int)$game['game_id'], 'status' => $game['status'],
      'map_key' => $game['map_key'], 'deck_key' => $game['deck_key'],
      'max_players' => (int)$game['max_players'],
      'current_seat' => (int)$game['current_seat'],
      'turn_number' => (int)$game['turn_number'],
      'boon_seat' => $game['boon_seat'] !== null ? (int)$game['boon_seat'] : null,
      'endgame_trigger' => $game['endgame_trigger'],
      'trigger_seat' => $game['trigger_seat'] !== null ? (int)$game['trigger_seat'] : null,
      'final_turns_remaining' => $game['final_turns_remaining'] !== null ? (int)$game['final_turns_remaining'] : null,
      'winner_seat' => $game['winner_seat'] !== null ? (int)$game['winner_seat'] : null,
      'state_version' => (int)$game['state_version'],
      'host_player_id' => $game['host_player_id'] !== null ? (int)$game['host_player_id'] : null,
      'treaty_trigger_count' => SP_TREATY_TRIGGER,
    ],
    'cards' => $catalog,
    'upgrades_catalog' => sp_upgrades_catalog(),
    'prices' => SP_PRICES,
    'resource_names' => SP_RESOURCE_NAMES,
    'faction_names' => SP_FACTION_NAMES,
    'position_costs' => SP_POSITION_COST,
    'map' => [
      'key' => $map['key'], 'name' => $map['name'],
      'systems' => $map['systems'], 'planets' => $planets, 'lanes' => $map['lanes'],
    ],
    'board' => $game['board_state'],
    'market' => [
      'display' => $game['market_display'],
      'stack_count' => count($game['market_stack']),
    ],
    'you' => [
      'seat' => $yourSeat, 'hand' => $you['hand'], 'discard' => $you['discard'],
      'credits' => (int)$you['credits'], 'cargo' => $you['cargo'],
      'cargo_capacity' => (int)$you['cargo_capacity'],
      'drones_reserve' => (int)$you['drones_reserve'],
      'tracks' => $you['tracks'], 'upgrades' => $you['upgrades'],
      'intel' => $intel,
      'first_reset_done' => (int)$you['first_reset_done'],
      'intermediate_score' => $you['intermediate_score'] !== null ? (int)$you['intermediate_score'] : null,
      'trophy' => (int)$you['trophy'],
    ],
    'players' => $pubPlayers,
    'events' => $events,
  ];
}

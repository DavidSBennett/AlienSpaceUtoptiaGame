<?php
/**
 * sp_engine.php — the ICC rules engine (server-authoritative), v4.
 *
 * "The Interstellar Cultural Council": players lead research teams of one
 * of three schools of thought — Xenogeology (engineer the world),
 * Xenoanthropology (understand the culture), Exobiology (engineer life) —
 * racing to resolve cultural crises from a shared MISSION DOCKET. Each
 * mission offers three competing solutions; the first solve writes that
 * culture's story permanently, moves the shared CHAOS/ORDER track, and may
 * chain follow-up missions into the deck.
 *
 *  - No map, no movement, no resources, no modules. Credits are the only
 *    currency (research funding); crew are hired with credits.
 *  - Chaos (−10 order … +10 collapse): every point of |chaos| ÷ 3 shifts
 *    ALL mission difficulties (harder in chaos, easier in order). At +10
 *    the ICC COLLAPSES: the game ends at once and everyone loses 10 VP.
 *  - Tracks (internal keys unchanged): military=Xenogeology,
 *    diplomacy=Xenoanthropology, trade=Exobiology. 12 steps; entering
 *    step 5 requires a MAJOR-tier solve, step 9 a CRITICAL-tier solve;
 *    breaking those gates grants research grants (+10c / +15c). Step 12
 *    triggers the endgame (trophy +7).
 *
 * NOT an endpoint — require_once'd by every sp_*.php endpoint.
 */

require_once __DIR__ . '/mp_dbConfig.php';
require_once __DIR__ . '/sp_cards_data.php';
require_once __DIR__ . '/sp_missions_data.php';

// ─────────────────────────────────────────────────────────────────────────
// Tuning constants
// ─────────────────────────────────────────────────────────────────────────

const SP_STARTING_CREDITS = 12;
const SP_MARKET_DISPLAY   = 7;
const SP_DOCKET_SIZE      = 4;
const SP_TROPHY_VP        = 7;
const SP_BASE_CREW_CAP    = 9;

const SP_CHAOS_MIN        = -10;
const SP_CHAOS_MAX        = 10;   // collapse
const SP_COLLAPSE_PENALTY = 10;   // VP lost by everyone on collapse

const SP_TRACK_MAX  = 12;
const SP_TIER_STEPS = 4;
// Gate tiers: entering step 5 needs a solve of at least 'major';
// entering step 9 needs 'critical'.
const SP_GATE_TIER  = [1 => 'minor', 2 => 'major', 3 => 'critical'];
const SP_GATE_GRANT = [5 => 10, 9 => 15];   // credits on gate break

const SP_GEO_CREDITS_PER_POINT = 2;   // charter equipment: 2c per +1

// Market position surcharge, in credits, by display position 0..6.
const SP_POSITION_COST = [0, 0, 1, 1, 2, 2, 3];

// discipline key → [action, stat index, track key, label]
const SP_DISCIPLINES = [
  'geo'    => ['survey',      0, 'military',  'Xenogeology'],
  'anthro' => ['ethnography', 1, 'diplomacy', 'Xenoanthropology'],
  'bio'    => ['biology',     2, 'trade',     'Exobiology'],
];
const SP_TIER_RANK = ['minor' => 1, 'major' => 2, 'critical' => 3];

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
    ['docket' => [], 'mission_stack' => [], 'chaos' => 0, 'solved' => [], 'cultures' => [], 'meta' => []]);
  foreach (['docket' => [], 'mission_stack' => [], 'solved' => [], 'cultures' => [], 'meta' => []] as $k => $d) {
    if (!isset($row['board_state'][$k])) $row['board_state'][$k] = $d;
  }
  if (!isset($row['board_state']['chaos'])) $row['board_state']['chaos'] = 0;
  // Pre-v4 games (ship/map or older boards) can't run under the ICC
  // ruleset — flag for graceful sunset on the poll path.
  $row['legacy_ruleset'] = ($row['status'] !== 'lobby')
    && !isset($row['board_state']['docket']);
  // (docket default was just added above, so detect legacy via ships/drones)
  if (($row['status'] !== 'lobby')
      && (isset($row['board_state']['ships']) || isset($row['board_state']['drones']))) {
    $row['legacy_ruleset'] = true;
  }
  return $row;
}

function sp_load_players($mysqli, $gameId) {
  $stmt = $mysqli->prepare("SELECT * FROM sp_game_players WHERE game_id = ? ORDER BY seat ASC");
  $stmt->bind_param('i', $gameId);
  $stmt->execute();
  $res = $stmt->get_result();
  $players = [];
  while ($row = $res->fetch_assoc()) {
    $row['cargo']    = sp_j($row['cargo'], []);
    $row['hand']     = sp_j($row['hand'], []);
    $row['discard']  = sp_j($row['discard'], []);
    $row['tracks']   = sp_j($row['tracks'], []);
    foreach (['military', 'diplomacy', 'trade'] as $t) {
      if (!isset($row['tracks'][$t])) $row['tracks'][$t] = ['step' => 0];
    }
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
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function sp_roster_size($p) {
  return count($p['hand']) + count($p['discard']);
}

function sp_chaos_mod($chaos) {
  return intdiv((int)$chaos, 3);   // truncates toward zero for both signs
}

/** Count a seat's solved missions for one discipline. */
function sp_solve_count($board, $seat, $discipline) {
  $n = 0;
  foreach ($board['solved'] as $entry) {
    if ((int)$entry['seat'] === (int)$seat && $entry['discipline'] === $discipline) $n++;
  }
  return $n;
}

function sp_discipline_of_action($action) {
  foreach (SP_DISCIPLINES as $key => $def) {
    if ($def[0] === $action) return $key;
  }
  return null;
}

function sp_docket_refill(&$game) {
  $b = &$game['board_state'];
  while (count($b['docket']) < SP_DOCKET_SIZE && count($b['mission_stack']) > 0) {
    $b['docket'][] = array_shift($b['mission_stack']);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Game setup
// ─────────────────────────────────────────────────────────────────────────

function sp_setup_game(&$game, &$players) {
  // Crew market: shuffle within stage, concatenate I→V. Solo strips copy.
  $solo = count($players) === 1;
  $cards = sp_cards();
  $stack = [];
  foreach (sp_market_stages() as $stage => $keys) {
    if ($solo) {
      $filtered = [];
      foreach ($keys as $k) if ($cards[$k]['action'] !== 'copy') $filtered[] = $k;
      $keys = $filtered;
    }
    shuffle($keys);
    foreach ($keys as $k) $stack[] = $k;
  }
  $game['market_display'] = array_splice($stack, 0, SP_MARKET_DISPLAY);
  $game['market_stack'] = $stack;

  // Mission deck: minors, then majors, then criticals (shuffled per tier).
  $tiers = sp_mission_tiers();
  $missionStack = [];
  foreach (['minor', 'major', 'critical'] as $tier) {
    $keys = $tiers[$tier];
    shuffle($keys);
    foreach ($keys as $k) $missionStack[] = $k;
  }
  $board = [
    'docket' => array_splice($missionStack, 0, SP_DOCKET_SIZE),
    'mission_stack' => $missionStack,
    'chaos' => 0, 'solved' => [], 'cultures' => [], 'meta' => [],
  ];

  foreach ($players as $seat => &$p) {
    $p['hand'] = sp_starter_keys();
    $p['discard'] = [];
    $p['credits'] = SP_STARTING_CREDITS;
    $p['cargo'] = [];
    $p['cargo_capacity'] = 0;
    $p['drones_reserve'] = 0;
    $p['tracks'] = [
      'military' => ['step' => 0], 'diplomacy' => ['step' => 0], 'trade' => ['step' => 0],
    ];
    $p['intel'] = [];
    $p['upgrades'] = [];
  }
  unset($p);

  $game['board_state'] = $board;
  $game['status'] = 'active';
  $game['current_seat'] = 0;
  $game['turn_number'] = 1;
  $game['boon_seat'] = count($players) - 1;   // tie-break anchor only
}

// ─────────────────────────────────────────────────────────────────────────
// Tracks
// ─────────────────────────────────────────────────────────────────────────

/**
 * Advance a track by 1, gated by the solved mission's tier. Gate breaks
 * (steps 5 and 9) grant research-grant credits. Step 12 triggers endgame.
 * Returns a message suffix ('' if the gate held).
 */
function sp_track_advance(&$game, &$players, $seat, $trackKey, $solvedTier) {
  $p = &$players[$seat];
  $step = (int)$p['tracks'][$trackKey]['step'];
  if ($step >= SP_TRACK_MAX) return '';
  $nextStep = $step + 1;
  $nextTier = intdiv($nextStep - 1, SP_TIER_STEPS) + 1;   // 1..3
  $needTier = SP_GATE_TIER[$nextTier] ?? 'minor';
  if (SP_TIER_RANK[$solvedTier] < SP_TIER_RANK[$needTier]) return '';
  $p['tracks'][$trackKey]['step'] = $nextStep;
  $labels = ['military' => 'Xenogeology', 'diplomacy' => 'Xenoanthropology', 'trade' => 'Exobiology'];
  $suffix = ' (' . $labels[$trackKey] . ' +1)';

  if (isset(SP_GATE_GRANT[$nextStep])) {
    $grant = SP_GATE_GRANT[$nextStep];
    $p['credits'] += $grant;
    $suffix .= " — gate broken: +{$grant}c research grant";
  }
  if ($nextStep >= SP_TRACK_MAX) {
    sp_trigger_endgame($game, $players, $seat, 'track_mastery');
    $suffix .= ' — FIELD MASTERED';
  }
  return $suffix;
}

// ─────────────────────────────────────────────────────────────────────────
// THE SOLVE — one executor for all three disciplines
// ─────────────────────────────────────────────────────────────────────────

function sp_exec_solve(&$game, &$players, $seat, $cardKey, $params, $asCard, $discipline) {
  $board = &$game['board_state'];
  $p = &$players[$seat];
  $cards = sp_cards();
  $missions = sp_missions();

  $missionKey = (string)($params['mission'] ?? '');
  $pos = array_search($missionKey, $board['docket'], true);
  if ($pos === false) throw new Exception('That mission is not on the docket');
  $mission = $missions[$missionKey] ?? null;
  if (!$mission) throw new Exception('Unknown mission');
  $solution = $mission['solutions'][$discipline] ?? null;
  if (!$solution) throw new Exception('No ' . SP_DISCIPLINES[$discipline][3] . ' approach exists for this crisis');

  $statIdx = SP_DISCIPLINES[$discipline][1];
  $total = (int)$cards[$asCard]['stats'][$statIdx];
  $spentNote = '';

  // Discipline levers.
  if ($discipline === 'geo') {
    $spend = (int)($params['charter_credits'] ?? 0);
    if ($spend < 0) throw new Exception('Bad charter amount');
    if ($spend > 0) {
      if ($spend % SP_GEO_CREDITS_PER_POINT !== 0) {
        throw new Exception('Equipment charters cost ' . SP_GEO_CREDITS_PER_POINT . ' credits per +1');
      }
      if ($p['credits'] < $spend) throw new Exception('Not enough credits to charter equipment');
      $p['credits'] -= $spend;   // spent win or lose — the rig was rented
      $boost = intdiv($spend, SP_GEO_CREDITS_PER_POINT);
      $total += $boost;
      $spentNote = ", {$spend}c chartered";
    }
  } elseif ($discipline === 'anthro') {
    $commits = is_array($params['commits'] ?? null) ? $params['commits'] : [];
    $seen = [];
    foreach ($commits as $k) {
      if (!is_string($k) || $k === $cardKey || isset($seen[$k])) {
        throw new Exception('Invalid colleague selection');
      }
      $seen[$k] = true;
      if (!in_array($k, $p['hand'], true)) throw new Exception('Colleague not in hand: ' . $k);
      if (($cards[$k]['action'] ?? '') === 'reset') {
        throw new Exception($cards[$k]['name'] . ' cannot be consulted away (reset crew never can be)');
      }
    }
    foreach ($commits as $k) {
      $cpos = array_search($k, $p['hand'], true);
      array_splice($p['hand'], $cpos, 1);
      $p['discard'][] = $k;
    }
    $total += count($commits);
    if (count($commits) > 0) $spentNote = ', ' . count($commits) . ' colleagues consulted';
  } else { // bio
    // Cultures: every prior bio attempt on THIS mission matured your lab
    // cultures — a permanent +1 each, for you, on this crisis.
    $cult = (int)($board['cultures'][$missionKey][(string)$seat] ?? 0);
    $total += $cult;
    if ($cult > 0) $spentNote = ", +$cult cultures";
  }

  $chaosMod = sp_chaos_mod($board['chaos']);
  $need = max(1, (int)$solution['difficulty'] + $chaosMod);

  if ($total < $need) {
    if ($discipline === 'bio') {
      $grown = (int)($board['cultures'][$missionKey][(string)$seat] ?? 0) + 1;
      $board['cultures'][$missionKey][(string)$seat] = $grown;
      return $p['player_name'] . '\'s Exobiology trial on "' . $mission['title']
           . "\" fell short ($total vs $need$spentNote) — but the cultures matured: +$grown there from now on";
    }
    return $p['player_name'] . '\'s ' . SP_DISCIPLINES[$discipline][3]
         . ' proposal for "' . $mission['title'] . "\" was rejected ($total vs $need"
         . $spentNote . ')';
  }

  // ── Success: this culture's story is written, permanently. ──
  array_splice($board['docket'], $pos, 1);
  unset($board['cultures'][$missionKey]);
  $p['credits'] += (int)$solution['credits'];
  $board['chaos'] = max(SP_CHAOS_MIN, min(SP_CHAOS_MAX, (int)$board['chaos'] + (int)$solution['chaos']));
  $board['solved'][] = [
    'mission' => $missionKey, 'title' => $mission['title'], 'culture' => $mission['culture'],
    'discipline' => $discipline, 'seat' => $seat, 'text' => $solution['text'],
    'chaos' => (int)$solution['chaos'],
  ];

  // The story branches: chained consequences enter the deck next.
  $followNote = '';
  if (!empty($solution['follow']) && isset($missions[$solution['follow']])) {
    array_unshift($board['mission_stack'], $solution['follow']);
    $followNote = ' — consequences will follow';
  }
  sp_docket_refill($game);

  $suffix = sp_track_advance($game, $players, $seat, SP_DISCIPLINES[$discipline][2], $mission['tier']);

  $chaosDelta = (int)$solution['chaos'];
  $chaosNote = $chaosDelta === 0 ? ''
    : ($chaosDelta > 0 ? ", chaos +$chaosDelta" : ', order ' . abs($chaosDelta));

  // Collapse check.
  if ((int)$board['chaos'] >= SP_CHAOS_MAX) {
    sp_end_game($game, $players, null, 'chaos_collapse');
    return $p['player_name'] . ' resolved "' . $mission['title'] . '" the '
         . SP_DISCIPLINES[$discipline][3] . " way ($total vs $need$spentNote)"
         . ' — AND THE ICC COLLAPSED IN THE AFTERMATH';
  }

  // Missions exhausted → every story is written.
  if (count($board['docket']) === 0 && count($board['mission_stack']) === 0) {
    sp_trigger_endgame($game, $players, $seat, 'missions_complete');
  }

  return $p['player_name'] . ' resolved "' . $mission['title'] . '" the '
       . SP_DISCIPLINES[$discipline][3] . " way ($total vs $need$spentNote) — +"
       . (int)$solution['credits'] . 'c' . $chaosNote . $suffix . $followNote;
}

// ─────────────────────────────────────────────────────────────────────────
// Support actions
// ─────────────────────────────────────────────────────────────────────────

function sp_market_refill(&$game) {
  while (count($game['market_display']) < SP_MARKET_DISPLAY && count($game['market_stack']) > 0) {
    $game['market_display'][] = array_shift($game['market_stack']);
  }
}

function sp_exec_recruit(&$game, &$players, $seat, $cardKey, $params, $freeMode) {
  $p = &$players[$seat];
  $cards = sp_cards();
  $picks = $params['picks'] ?? [];
  if (!is_array($picks) || count($picks) === 0) throw new Exception('No researchers picked');
  $maxPicks = $freeMode ? 1 : 2;
  if (count($picks) > $maxPicks) throw new Exception("At most $maxPicks hire(s)");

  if (sp_roster_size($p) + count($picks) > SP_BASE_CREW_CAP) {
    throw new Exception('Team roster full (' . SP_BASE_CREW_CAP . ' max)');
  }

  $names = [];
  foreach ($picks as $pick) {
    $key = is_array($pick) ? (string)($pick['card'] ?? '') : (string)$pick;
    $pos = array_search($key, $game['market_display'], true);
    if ($pos === false) throw new Exception('Researcher not in the market display');
    $cost = (int)$cards[$key]['cost_credits'];
    if (!$freeMode) $cost += (int)(SP_POSITION_COST[$pos] ?? 0);
    if ($p['credits'] < $cost) throw new Exception('Not enough credits for ' . $cards[$key]['name'] . " ({$cost}c)");
    $p['credits'] -= $cost;
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
  $msg = $p['player_name'] . ' regrouped the team and recovered their cards';

  $rider = (int)($cards[$asCard]['rider_credits'] ?? 0);
  if ($rider > 0) {
    $p['credits'] += $rider;
    $msg .= " (+{$rider}c)";
  }

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

/** Legacy shim kept for sp_getGameState's poll-path maintenance. */
function sp_heal_stranded_resets(&$game, &$players) {
  if (!empty($game['board_state']['meta']['reset_healed'])) return false;
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
  $discipline = sp_discipline_of_action($action);
  if ($discipline !== null) {
    return sp_exec_solve($game, $players, $seat, $cardKey, $params, $asCard, $discipline);
  }
  switch ($action) {
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
    $p['hand'][] = $cardKey;   // the reset card returns with everything else
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
  if ($game['status'] === 'active') {
    sp_advance_turn($game, $players, $mysqli);
  }
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
  if ($reason === 'track_mastery' && $seat !== null) {
    $players[$seat]['trophy'] = 1;
  }
  $game['final_turns_remaining'] = count(sp_active_seats($players)) - 1;
}

function sp_advance_turn(&$game, &$players, $mysqli) {
  if ($game['endgame_trigger'] !== null) {
    if ((int)$game['final_turns_remaining'] <= 0) {
      sp_end_game($game, $players, $mysqli, $game['endgame_trigger']);
      return;
    }
    $game['final_turns_remaining'] = (int)$game['final_turns_remaining'] - 1;
  }

  $seats = sp_active_seats($players);
  if (count($seats) === 0) { sp_end_game($game, $players, $mysqli, 'all_conceded'); return; }
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
    sp_end_game($game, $players, $mysqli, $game['endgame_trigger']);
  }
}

function sp_compute_score($game, $players, $seat, $final = true) {
  $cards = sp_cards();
  $p = $players[$seat];

  $owned = array_merge($p['hand'], $p['discard']);
  $counts = ['wealth'=>0,'diplomatic_corps'=>0,'trade_guild'=>0,'war_college'=>0];
  foreach ($owned as $k) {
    if (isset($cards[$k]) && isset($counts[$cards[$k]['affiliation']])) {
      $counts[$cards[$k]['affiliation']]++;
    }
  }

  $b = [];
  $b['wealth']           = intdiv((int)$p['credits'], 10);
  $b['war_college']      = $counts['war_college'] * (int)$p['tracks']['military']['step'];
  $b['diplomatic_corps'] = $counts['diplomatic_corps'] * (int)$p['tracks']['diplomacy']['step'];
  $b['trade_guild']      = $counts['trade_guild'] * (int)$p['tracks']['trade']['step'];
  $b['trophy']           = ($final && (int)$p['trophy']) ? SP_TROPHY_VP : 0;
  if ($final && ($game['endgame_trigger'] ?? null) === 'chaos_collapse') {
    $b['collapse'] = -SP_COLLAPSE_PENALTY;
  }

  return ['total' => array_sum($b), 'breakdown' => $b, 'card_counts' => $counts];
}

function sp_end_game(&$game, &$players, $mysqli, $reason = null) {
  if ($reason !== null && $game['endgame_trigger'] === null) {
    $game['endgame_trigger'] = $reason;
  }
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
  if ($mysqli !== null) {
    sp_log($mysqli, (int)$game['game_id'], $bestSeat, 'game_ended',
      ($game['endgame_trigger'] === 'chaos_collapse'
        ? 'THE ICC HAS COLLAPSED. Final tally under the ruins — '
        : 'The Council adjourns — ')
      . 'winner: ' . ($bestSeat !== null ? $players[$bestSeat]['player_name'] : 'nobody'));
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public state
// ─────────────────────────────────────────────────────────────────────────

function sp_public_state($mysqli, $game, $players, $yourSeat) {
  $cards = sp_cards();
  $missions = sp_missions();
  $you = $players[$yourSeat];
  $board = $game['board_state'];
  $chaosMod = sp_chaos_mod($board['chaos']);

  $catalog = [];
  foreach ($cards as $key => $c) {
    $catalog[$key] = [
      'key' => $key, 'name' => $c['name'], 'action' => $c['action'],
      'stats' => $c['stats'], 'affiliation' => $c['affiliation'],
      'stage' => $c['stage'], 'cost_credits' => $c['cost_credits'],
      'rider_credits' => $c['rider_credits'], 'text' => $c['text'],
      'kind' => $c['kind'],
    ];
  }

  // Docket missions: full data, difficulties pre-adjusted for chaos.
  $docket = [];
  foreach ($board['docket'] as $mk) {
    $mm = $missions[$mk] ?? null;
    if (!$mm) continue;
    $sols = [];
    foreach ($mm['solutions'] as $d => $sol) {
      $sols[$d] = [
        'difficulty' => max(1, (int)$sol['difficulty'] + $chaosMod),
        'base_difficulty' => (int)$sol['difficulty'],
        'chaos' => (int)$sol['chaos'], 'credits' => (int)$sol['credits'],
        'has_follow' => !empty($sol['follow']),
        'text' => $sol['text'],
      ];
    }
    $docket[] = [
      'key' => $mk, 'title' => $mm['title'], 'culture' => $mm['culture'],
      'tier' => $mm['tier'], 'problem' => $mm['problem'],
      'chained' => !empty($mm['chained']), 'solutions' => $sols,
      'your_cultures' => (int)($board['cultures'][$mk][(string)$yourSeat] ?? 0),
    ];
  }

  $pubPlayers = [];
  foreach ($players as $seat => $p) {
    $pubPlayers[] = [
      'seat' => $seat, 'name' => $p['player_name'],
      'user_id' => $p['user_id'] !== null ? (int)$p['user_id'] : null,
      'credits' => (int)$p['credits'],
      'tracks' => [
        'military' => $p['tracks']['military'], 'diplomacy' => $p['tracks']['diplomacy'],
        'trade' => $p['tracks']['trade'],
      ],
      'solves' => [
        'geo' => sp_solve_count($board, $seat, 'geo'),
        'anthro' => sp_solve_count($board, $seat, 'anthro'),
        'bio' => sp_solve_count($board, $seat, 'bio'),
      ],
      'hand_count' => count($p['hand']),
      'discard_count' => count($p['discard']),
      'discard_top' => count($p['discard']) ? $p['discard'][count($p['discard']) - 1] : null,
      'roster' => sp_roster_size($p),
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

  return [
    'game' => [
      'game_id' => (int)$game['game_id'], 'status' => $game['status'],
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
    'chaos' => (int)$board['chaos'],
    'chaos_mod' => $chaosMod,
    'chaos_max' => SP_CHAOS_MAX, 'chaos_min' => SP_CHAOS_MIN,
    'docket' => $docket,
    'mission_stack_count' => count($board['mission_stack']),
    'story' => $board['solved'],
    'position_costs' => SP_POSITION_COST,
    'geo_credits_per_point' => SP_GEO_CREDITS_PER_POINT,
    'crew_cap' => SP_BASE_CREW_CAP,
    'market' => [
      'display' => $game['market_display'],
      'stack_count' => count($game['market_stack']),
    ],
    'you' => [
      'seat' => $yourSeat, 'hand' => $you['hand'], 'discard' => $you['discard'],
      'credits' => (int)$you['credits'],
      'tracks' => [
        'military' => $you['tracks']['military'], 'diplomacy' => $you['tracks']['diplomacy'],
        'trade' => $you['tracks']['trade'],
      ],
      'bio_solves' => sp_solve_count($board, $yourSeat, 'bio'),
      'roster' => sp_roster_size($you),
      'first_reset_done' => (int)$you['first_reset_done'],
      'intermediate_score' => $you['intermediate_score'] !== null ? (int)$you['intermediate_score'] : null,
      'trophy' => (int)$you['trophy'],
    ],
    'players' => $pubPlayers,
    'events' => $events,
  ];
}

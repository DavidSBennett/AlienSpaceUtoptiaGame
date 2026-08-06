<?php
/**
 * sp_map_data.php — the v1 star map ("sector_v1").
 *
 * Generated procedurally so geometry stays consistent: 5 home systems on
 * the rim (ring 0, one per seat), 5 mid systems (ring 1), 5 inner systems
 * (ring 2), one core system (ring 3). Planets are nodes; star-lanes are
 * edges; drones occupy lanes (Concordia colonists-on-routes).
 *
 * Mission model v2: every planet carries TWO secret stats — 'military'
 * (beat it with a strike card + committed-card power to CONQUER) and
 * 'political' (beat it with a diplomacy card + your drone values there to
 * ALLY) — plus a PUBLIC 'production' value. Conquered planets produce a
 * flat 1 good; allied planets produce their full production value. Stats
 * are fixed by ring and secret until scouted; this file must never be
 * publicly fetchable as data (it isn't: it's PHP).
 *
 * Coordinates are for the client's SVG board, viewBox 0 0 1000 1000.
 */

function sp_map() {
  static $map = null;
  if ($map !== null) return $map;

  $systems = [];   // id => [id, name, ring, marker (faction letter), planets[]]
  $planets = [];   // id => [id, system, name, faction, ring, opposition, x, y, home_seat|null]
  $lanes   = [];   // laneKey "a~b" => [a, b]

  $addLane = function ($a, $b) use (&$lanes) {
    $k = $a < $b ? "$a~$b" : "$b~$a";
    $lanes[$k] = [$a, $b];
  };

  $CX = 500; $CY = 500;
  $pos = function ($radius, $deg) use ($CX, $CY) {
    $rad = deg2rad($deg);
    return [round($CX + $radius * cos($rad)), round($CY + $radius * sin($rad))];
  };

  $homeNames  = ['Vesper', 'Halcyon', 'Meridian', 'Solace', 'Bastion'];
  $midNames   = ['Cinder', 'Vortex', 'Thorne', 'Ashfall', 'Ionis'];
  $innerNames = ['Obsidian', 'Zenith', 'Requiem', 'Kessler', 'Nadir'];

  // Ring stat table: [military_a, political_a, military_b, political_b].
  // Political always runs higher than military — allying is the slower,
  // richer path. Production (public, per allied production event) by ring.
  $statsByRing = [
    0 => [2, 3, 2, 4],
    1 => [4, 5, 5, 7],
    2 => [7, 8, 8, 10],
  ];
  $prodByRing = [0 => 2, 1 => 3, 2 => 4, 3 => 5];

  for ($k = 0; $k < 5; $k++) {
    $baseDeg = -90 + 72 * $k;   // seat 0 at top, clockwise

    // ---- Home system (ring 0): Krath (O) start planet + Verdani (B) ----
    $sysId = "H$k";
    [$xa, $ya] = $pos(420, $baseDeg - 7);
    [$xb, $yb] = $pos(400, $baseDeg + 9);
    $pa = "{$sysId}a"; $pb = "{$sysId}b";
    $planets[$pa] = ['id' => $pa, 'system' => $sysId, 'name' => $homeNames[$k] . ' Prime',
      'faction' => 'O', 'ring' => 0, 'military' => $statsByRing[0][0], 'political' => $statsByRing[0][1],
      'production' => $prodByRing[0], 'x' => $xa, 'y' => $ya, 'home_seat' => $k];
    $planets[$pb] = ['id' => $pb, 'system' => $sysId, 'name' => $homeNames[$k] . ' II',
      'faction' => 'B', 'ring' => 0, 'military' => $statsByRing[0][2], 'political' => $statsByRing[0][3],
      'production' => $prodByRing[0], 'x' => $xb, 'y' => $yb, 'home_seat' => null];
    $systems[$sysId] = ['id' => $sysId, 'name' => $homeNames[$k] . ' Reach', 'ring' => 0,
      'marker' => 'O', 'planets' => [$pa, $pb]];
    $addLane($pa, $pb);

    // ---- Mid system (ring 1): Components (C) + alternating B/N ----
    $sysId = "M$k";
    [$xa, $ya] = $pos(300, $baseDeg + 18);
    [$xb, $yb] = $pos(285, $baseDeg + 40);
    $pa = "{$sysId}a"; $pb = "{$sysId}b";
    $bFaction = ($k % 2 === 0) ? 'B' : 'N';
    $planets[$pa] = ['id' => $pa, 'system' => $sysId, 'name' => $midNames[$k] . ' I',
      'faction' => 'C', 'ring' => 1, 'military' => $statsByRing[1][0], 'political' => $statsByRing[1][1],
      'production' => $prodByRing[1], 'x' => $xa, 'y' => $ya, 'home_seat' => null];
    $planets[$pb] = ['id' => $pb, 'system' => $sysId, 'name' => $midNames[$k] . ' II',
      'faction' => $bFaction, 'ring' => 1, 'military' => $statsByRing[1][2], 'political' => $statsByRing[1][3],
      'production' => $prodByRing[1], 'x' => $xb, 'y' => $yb, 'home_seat' => null];
    $systems[$sysId] = ['id' => $sysId, 'name' => $midNames[$k] . ' Drift', 'ring' => 1,
      'marker' => 'C', 'planets' => [$pa, $pb]];
    $addLane($pa, $pb);

    // ---- Inner system (ring 2): Nectar (N) + alternating A/C ----
    $sysId = "I$k";
    [$xa, $ya] = $pos(180, $baseDeg + 10);
    [$xb, $yb] = $pos(165, $baseDeg + 42);
    $pa = "{$sysId}a"; $pb = "{$sysId}b";
    $bFaction = ($k % 2 === 0) ? 'A' : 'C';
    $planets[$pa] = ['id' => $pa, 'system' => $sysId, 'name' => $innerNames[$k] . ' I',
      'faction' => 'N', 'ring' => 2, 'military' => $statsByRing[2][0], 'political' => $statsByRing[2][1],
      'production' => $prodByRing[2], 'x' => $xa, 'y' => $ya, 'home_seat' => null];
    $planets[$pb] = ['id' => $pb, 'system' => $sysId, 'name' => $innerNames[$k] . ' II',
      'faction' => $bFaction, 'ring' => 2, 'military' => $statsByRing[2][2], 'political' => $statsByRing[2][3],
      'production' => $prodByRing[2], 'x' => $xb, 'y' => $yb, 'home_seat' => null];
    $systems[$sysId] = ['id' => $sysId, 'name' => $innerNames[$k] . ' Verge', 'ring' => 2,
      'marker' => 'N', 'planets' => [$pa, $pb]];
    $addLane($pa, $pb);
  }

  // ---- Core system (ring 3): the Umbral Core — N, A, A ----
  $coreFactions = ['N', 'A', 'A'];
  $coreStats = [[10, 11], [10, 12], [11, 13]];   // [military, political] each
  $corePlanets = [];
  for ($i = 0; $i < 3; $i++) {
    [$x, $y] = $pos(60, -90 + 120 * $i);
    $pid = "CORE$i";
    $planets[$pid] = ['id' => $pid, 'system' => 'CORE', 'name' => 'Umbra ' . ['I', 'II', 'III'][$i],
      'faction' => $coreFactions[$i], 'ring' => 3, 'military' => $coreStats[$i][0],
      'political' => $coreStats[$i][1], 'production' => $prodByRing[3],
      'x' => $x, 'y' => $y, 'home_seat' => null];
    $corePlanets[] = $pid;
  }
  $systems['CORE'] = ['id' => 'CORE', 'name' => 'The Umbral Core', 'ring' => 3,
    'marker' => 'A', 'planets' => $corePlanets];
  $addLane('CORE0', 'CORE1');
  $addLane('CORE1', 'CORE2');
  $addLane('CORE0', 'CORE2');

  // ---- Inter-system lanes ----
  for ($k = 0; $k < 5; $k++) {
    $next = ($k + 1) % 5;
    $addLane("H{$k}b", "M{$k}a");        // home → its mid system
    $addLane("H{$k}b", "H{$next}a");     // rim lateral: home k → home k+1
    $addLane("M{$k}b", "M{$next}a");     // mid lateral
    $addLane("M{$k}b", "I{$k}a");        // mid → inner
    $addLane("I{$k}b", "I{$next}a");     // inner lateral
    $addLane("I{$k}b", 'CORE' . ($k % 3));  // inner → core
  }

  $map = [
    'key'     => 'sector_v1',
    'name'    => 'Sector Umbra',
    'systems' => $systems,
    'planets' => $planets,
    'lanes'   => $lanes,
  ];
  return $map;
}

/** Lane key for a planet pair, order-insensitive. */
function sp_lane_key($a, $b) {
  return $a < $b ? "$a~$b" : "$b~$a";
}

/** Lanes touching a planet: [laneKey => otherPlanetId]. */
function sp_lanes_of_planet($planetId) {
  $out = [];
  foreach (sp_map()['lanes'] as $key => $pair) {
    if ($pair[0] === $planetId) $out[$key] = $pair[1];
    elseif ($pair[1] === $planetId) $out[$key] = $pair[0];
  }
  return $out;
}

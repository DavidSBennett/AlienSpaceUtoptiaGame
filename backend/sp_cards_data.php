<?php
/**
 * sp_cards_data.php — the v2 ship-component card catalog.
 *
 * Mission model v2 (simplified):
 *  - strike cards CONQUER: total = card Military + commit_power × committed
 *    cards (commits are generic fuel — their own stats don't matter).
 *  - diplomacy cards ALLY: total = card Diplomacy + sum of your drone
 *    values at the target planet (no card commits).
 *  - move cards only move drones (planet to planet); step_bonus adds steps.
 *  - deploy cards launch drones whose VALUE is set by the card
 *    (drone_value); higher-value drones are stronger diplomacy modifiers.
 *
 * Content-as-code; numbers are first-pass tuning values.
 */

function sp_cards() {
  static $cards = null;
  if ($cards !== null) return $cards;

  $c = [];

  // ---------- Starting hand (every player gets one copy of each) ----------
  $c['maintenance_bay'] = [
    'name' => 'Maintenance Bay', 'action' => 'reset',
    'stats' => [0, 1, 1], 'affiliation' => 'wealth',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'text' => 'Recover ALL cards — your whole discard pile plus this card — back into your hand. You may also build a value-1 drone (1 Ore + 1 Biomass) and buy ship upgrades.',
  ];
  $c['astrogation_array'] = [
    'name' => 'Astrogation Array', 'action' => 'move',
    'stats' => [0, 1, 0], 'affiliation' => 'diplomatic_corps',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'step_bonus' => 0,
    'text' => 'Move your drones planet-to-planet along star-lanes (steps = your drones on the board). Drones scout: they reveal the stats of their planet and its neighbors.',
  ];
  $c['extractor_rig'] = [
    'name' => 'Extractor Rig', 'action' => 'produce',
    'stats' => [0, 1, 1], 'affiliation' => 'alliances',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'text' => 'Choose a system: every controlled planet there produces for its controller (allied = full production value, conquered = 1), and you take the bonus marker — or collect the credit levy instead.',
  ];
  $c['railgun_battery'] = [
    'name' => 'Railgun Battery', 'action' => 'strike',
    'stats' => [2, 0, 0], 'affiliation' => 'war_college',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'commit_power' => 1,
    'text' => 'CONQUER any planet: Military 2, +1 per committed card, vs the planet\'s military value. Conquered planets produce only 1 good.',
  ];
  $c['envoy_shuttle'] = [
    'name' => 'Envoy Shuttle', 'action' => 'diplomacy',
    'stats' => [0, 2, 0], 'affiliation' => 'diplomatic_corps',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'text' => 'ALLY any planet: Diplomacy 2, plus the total value of your drones at the planet, vs its political value. Allied planets produce at full strength. Can upgrade a planet you conquered.',
  ];
  $c['trade_terminal'] = [
    'name' => 'Trade Terminal', 'action' => 'trade',
    'stats' => [0, 0, 2], 'affiliation' => 'trade_guild',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 3,
    'text' => 'Trade mission at a planet adjacent to your drones: gain 3 credits and buy/sell up to two resource types at list prices.',
  ];
  $c['shipyard_berth'] = [
    'name' => 'Shipyard Berth', 'action' => 'recruit',
    'stats' => [0, 1, 1], 'affiliation' => 'wealth',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'text' => 'Install up to 2 components from the market (pay each card\'s cost plus its position cost).',
  ];

  // ---------- Market ----------
  $mk = function ($key, $name, $action, $m, $d, $t, $aff, $stage, $cost, $rider, $text, $extra = []) use (&$c) {
    $c[$key] = array_merge([
      'name' => $name, 'action' => $action, 'stats' => [$m, $d, $t],
      'affiliation' => $aff, 'kind' => 'market', 'stage' => $stage,
      'cost' => $cost, 'rider_credits' => $rider, 'text' => $text,
    ], $extra);
  };

  // ---------- Stage I (7) ----------
  $mk('drone_bay_1', 'Drone Bay', 'deploy', 1, 0, 1, 'war_college', 1, ['O'], 0,
      'Launch value-1 drones (1 Ore + 1 Biomass each) at home or controlled planets — or take 5 credits plus 1 per drone on the board.',
      ['drone_value' => 1]);
  $mk('extractor_rig_2', 'Extractor Rig Mk II', 'produce', 0, 1, 2, 'alliances', 1, ['O'], 0,
      'Choose a system: every controlled planet produces for its controller, or collect the credit levy.');
  $mk('envoy_wing', 'Envoy Wing', 'diplomacy', 0, 3, 0, 'diplomatic_corps', 1, ['O', 'B'], 0,
      'ALLY any planet: Diplomacy 3 + your drone values there vs its political value.');
  $mk('jump_drive_1', 'Jump Drive', 'move', 0, 1, 1, 'diplomatic_corps', 1, ['O'], 0,
      'Move your drones with +2 extra steps.', ['step_bonus' => 2]);
  $mk('trade_terminal_2', 'Trade Terminal Mk II', 'trade', 0, 0, 3, 'trade_guild', 1, ['B'], 5,
      'Trade mission at an adjacent planet: gain 5 credits and trade two resource types.');
  $mk('krath_resonator', 'Krath Resonator', 'envoy', 1, 0, 1, 'engineering', 1, ['O'], 0,
      'Produce 1 Ore for each Krath planet you control.', ['faction' => 'O']);
  $mk('verdani_cultivator', 'Verdani Cultivator', 'envoy', 0, 1, 1, 'engineering', 1, ['B'], 0,
      'Produce 1 Biomass for each Verdani planet you control.', ['faction' => 'B']);

  // ---------- Stage II (7) ----------
  $mk('torpedo_rack_1', 'Torpedo Rack', 'strike', 3, 0, 0, 'war_college', 2, ['C'], 0,
      'CONQUER any planet: Military 3, +1 per committed card.', ['commit_power' => 1]);
  $mk('drone_bay_2', 'Drone Bay Mk II', 'deploy', 1, 1, 1, 'war_college', 2, ['O', 'B'], 0,
      'Launch value-2 drones — or take 5 credits plus 1 per drone on the board.',
      ['drone_value' => 2]);
  $mk('extractor_rig_3', 'Extractor Rig Mk III', 'produce', 0, 2, 1, 'alliances', 2, ['B'], 0,
      'Choose a system: every controlled planet produces for its controller, or collect the levy.');
  $mk('diplomatic_uplink', 'Diplomatic Uplink', 'diplomacy', 0, 3, 1, 'diplomatic_corps', 2, ['B', 'C'], 0,
      'ALLY any planet: Diplomacy 3 + your drone values there.');
  $mk('signal_decoder_2', 'Signal Decoder', 'copy', 1, 2, 1, 'diplomatic_corps', 2, ['C'], 0,
      'Execute the action of the top card of another player\'s discard pile (not a reset or copy card).');
  $mk('maintenance_bay_2', 'Maintenance Bay Mk II', 'reset', 1, 1, 1, 'wealth', 2, ['B'], 0,
      'Recover ALL cards (discard pile plus this card); the drone you may build with this reset is free.');
  $mk('mekkari_fabricator', 'Mekkari Fabricator', 'envoy', 1, 0, 2, 'engineering', 2, ['C'], 0,
      'Produce 1 Components for each Mekkari planet you control.', ['faction' => 'C']);

  // ---------- Stage III (6) ----------
  $mk('assault_lance', 'Assault Lance', 'strike', 4, 0, 0, 'war_college', 3, ['C', 'N'], 0,
      'CONQUER any planet: Military 4, +1 per committed card.', ['commit_power' => 1]);
  $mk('trade_terminal_3', 'Trade Terminal Mk III', 'trade', 0, 0, 4, 'trade_guild', 3, ['N'], 5,
      'Trade mission: gain 5 credits and trade two resource types.');
  $mk('consulate_ring', 'Consulate Ring', 'diplomacy', 0, 4, 0, 'diplomatic_corps', 3, ['N'], 0,
      'ALLY any planet: Diplomacy 4 + your drone values there.');
  $mk('extractor_rig_4', 'Extractor Rig Mk IV', 'produce', 1, 2, 1, 'alliances', 3, ['C'], 0,
      'Choose a system: every controlled planet produces for its controller, or collect the levy.');
  $mk('shipyard_berth_2', 'Shipyard Berth Mk II', 'recruit', 0, 2, 2, 'wealth', 3, ['N'], 0,
      'Install up to 2 components from the market.');
  $mk('aurelian_salon', 'Aurelian Salon', 'envoy', 0, 2, 1, 'engineering', 3, ['N'], 0,
      'Produce 1 Nectar for each Aurelian planet you control.', ['faction' => 'N']);

  // ---------- Stage IV (6) ----------
  $mk('torpedo_rack_2', 'Torpedo Rack Mk II', 'strike', 4, 1, 0, 'war_college', 4, ['N', 'A'], 0,
      'CONQUER any planet: Military 4, +2 per committed card.', ['commit_power' => 2]);
  $mk('drone_bay_3', 'Drone Bay Mk III', 'deploy', 2, 1, 1, 'war_college', 4, ['C', 'N'], 0,
      'Launch value-3 drones — or take 5 credits plus 1 per drone on the board.',
      ['drone_value' => 3]);
  $mk('priority_requisition_2', 'Priority Requisition', 'recruit_free', 1, 1, 2, 'wealth', 4, ['?', '?'], 0,
      'Install 1 component from the market, ignoring its position cost.');
  $mk('signal_decoder_3', 'Signal Decoder Mk II', 'copy', 2, 2, 2, 'diplomatic_corps', 4, ['A'], 0,
      'Execute the top card of another player\'s discard pile.');
  $mk('extractor_rig_5', 'Extractor Rig Mk V', 'produce', 1, 3, 1, 'alliances', 4, ['A'], 0,
      'Choose a system: every controlled planet produces for its controller, or collect the levy.');
  $mk('umbral_conduit', 'Umbral Conduit', 'envoy', 1, 1, 2, 'engineering', 4, ['A'], 0,
      'Produce 1 Aether for each Umbral planet you control.', ['faction' => 'A']);

  // ---------- Stage V (4) ----------
  $mk('dreadnought_spine', 'Dreadnought Spine', 'strike', 5, 0, 0, 'war_college', 5, ['A', 'A'], 0,
      'CONQUER any planet: Military 5, +2 per committed card.', ['commit_power' => 2]);
  $mk('trade_nexus', 'Trade Nexus', 'trade', 0, 0, 5, 'trade_guild', 5, ['A', 'N'], 5,
      'Trade mission: gain 5 credits and trade two resource types.');
  $mk('flag_bridge', 'Flag Bridge', 'diplomacy', 0, 5, 0, 'diplomatic_corps', 5, ['A', 'N'], 0,
      'ALLY any planet: Diplomacy 5 + your drone values there.');
  $mk('grand_extractor', 'Grand Extractor', 'produce', 2, 2, 2, 'alliances', 5, ['A', 'C'], 0,
      'Choose a system: every controlled planet produces for its controller, or collect the levy.');

  $cards = $c;
  return $cards;
}

/** Keys of the 7 starter cards, in display order. */
function sp_starter_keys() {
  return [
    'maintenance_bay', 'astrogation_array', 'extractor_rig',
    'railgun_battery', 'envoy_shuttle', 'trade_terminal', 'shipyard_berth',
  ];
}

/** Market card keys grouped by stage (1..5), authored order. */
function sp_market_stages() {
  $stages = [1 => [], 2 => [], 3 => [], 4 => [], 5 => []];
  foreach (sp_cards() as $key => $card) {
    if ($card['kind'] === 'market') $stages[$card['stage']][] = $key;
  }
  return $stages;
}

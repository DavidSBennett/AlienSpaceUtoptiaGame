<?php
/**
 * sp_cards_data.php — the v1 ship-component card catalog.
 *
 * Content-as-code (docs/FACTIONS_AND_CARDS_V1.md is the design source).
 * Ships as PHP so the deploy pipeline (backend/*.php) carries it and so
 * nothing here is publicly fetchable except through the masked game-state
 * endpoint. Numbers are first-pass tuning values.
 *
 * Card shape:
 *   key          stable id (never rename once games exist)
 *   name         display name (a ship component)
 *   action       reset|move|strike|trade|produce|deploy|recruit|recruit_free|copy|envoy
 *   faction      only for envoy cards: which faction's treaties produce
 *   stats        [M, D, T] — the upper-right stat block
 *   affiliation  wealth|diplomatic_corps|alliances|trade_guild|war_college|engineering
 *   kind         starter|market
 *   stage        market release stage 1..5 (null for starters)
 *   cost         resource letters to purchase (market only); '?' = any resource
 *   rider_credits  credits granted on play (trade cards / deploy alt-mode base)
 *   text         short rules text for the client
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
    'text' => 'Recover all cards from your discard pile. You may also build a drone (1 Ore + 1 Biomass) and buy ship upgrades.',
  ];
  $c['astrogation_array'] = [
    'name' => 'Astrogation Array', 'action' => 'move',
    'stats' => [0, 2, 0], 'affiliation' => 'diplomatic_corps',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'text' => 'Move your drones (steps = your drones on the board). Then you may attempt one treaty at a planet adjacent to your drones (Diplomacy mission).',
  ];
  $c['extractor_rig'] = [
    'name' => 'Extractor Rig', 'action' => 'produce',
    'stats' => [0, 1, 1], 'affiliation' => 'alliances',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'text' => 'Choose a system: all treaty holders there produce, and you take the bonus marker — or collect the credit levy instead.',
  ];
  $c['railgun_battery'] = [
    'name' => 'Railgun Battery', 'action' => 'strike',
    'stats' => [2, 0, 0], 'affiliation' => 'war_college',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'text' => 'Military mission at a planet adjacent to your drones: seize 2 of its resource.',
  ];
  $c['trade_terminal'] = [
    'name' => 'Trade Terminal', 'action' => 'trade',
    'stats' => [0, 0, 2], 'affiliation' => 'trade_guild',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 3,
    'text' => 'Trade mission at an adjacent planet: gain 3 credits and buy/sell up to two resource types at list prices.',
  ];
  $c['signal_decoder'] = [
    'name' => 'Signal Decoder', 'action' => 'copy',
    'stats' => [1, 1, 1], 'affiliation' => 'diplomatic_corps',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'text' => 'Execute the action of the top card of another player\'s discard pile (not a reset or copy card).',
  ];
  $c['shipyard_berth'] = [
    'name' => 'Shipyard Berth', 'action' => 'recruit',
    'stats' => [0, 1, 1], 'affiliation' => 'wealth',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'text' => 'Install up to 2 components from the market (pay each card\'s cost plus its position cost).',
  ];

  // ---------- Market — Stage I ----------
  $mk = function ($key, $name, $action, $m, $d, $t, $aff, $stage, $cost, $rider, $text, $faction = null) use (&$c) {
    $c[$key] = [
      'name' => $name, 'action' => $action, 'stats' => [$m, $d, $t],
      'affiliation' => $aff, 'kind' => 'market', 'stage' => $stage,
      'cost' => $cost, 'rider_credits' => $rider, 'text' => $text,
    ];
    if ($faction !== null) $c[$key]['faction'] = $faction;
  };

  $mk('drone_bay_1', 'Drone Bay', 'deploy', 1, 0, 1, 'war_college', 1, ['O'], 0,
      'Launch new drones (1 Ore + 1 Biomass each) at home or treaty planets — or take 5 credits plus 1 per drone on the board.');
  $mk('extractor_rig_2', 'Extractor Rig Mk II', 'produce', 0, 1, 2, 'alliances', 1, ['O'], 0,
      'Choose a system: production for all treaty holders, or take the credit levy.');
  $mk('astrogation_array_2', 'Astrogation Array Mk II', 'move', 0, 3, 0, 'diplomatic_corps', 1, ['O', 'B'], 0,
      'Move your drones, then you may attempt one treaty (Diplomacy mission).');
  $mk('trade_terminal_2', 'Trade Terminal Mk II', 'trade', 0, 0, 3, 'trade_guild', 1, ['B'], 5,
      'Trade mission at an adjacent planet: gain 5 credits and trade two resource types.');
  $mk('priority_requisition_1', 'Priority Requisition', 'recruit_free', 0, 1, 1, 'wealth', 1, ['?'], 0,
      'Install 1 component from the market, ignoring its position cost.');
  $mk('krath_resonator', 'Krath Resonator', 'envoy', 1, 0, 1, 'engineering', 1, ['O'], 0,
      'Produce 1 Ore for each treaty you hold on Krath planets.', 'O');
  $mk('verdani_cultivator', 'Verdani Cultivator', 'envoy', 0, 1, 1, 'engineering', 1, ['B'], 0,
      'Produce 1 Biomass for each treaty you hold on Verdani planets.', 'B');

  // ---------- Market — Stage II ----------
  $mk('torpedo_rack_1', 'Torpedo Rack', 'strike', 3, 0, 0, 'war_college', 2, ['C'], 0,
      'Military mission at an adjacent planet: seize 2 of its resource.');
  $mk('drone_bay_2', 'Drone Bay Mk II', 'deploy', 1, 1, 1, 'war_college', 2, ['O', 'B'], 0,
      'Launch new drones — or take 5 credits plus 1 per drone on the board.');
  $mk('extractor_rig_3', 'Extractor Rig Mk III', 'produce', 0, 2, 1, 'alliances', 2, ['B'], 0,
      'Choose a system: production for all treaty holders, or take the credit levy.');
  $mk('diplomatic_uplink', 'Diplomatic Uplink', 'move', 0, 3, 1, 'diplomatic_corps', 2, ['B', 'C'], 0,
      'Move your drones, then you may attempt one treaty (Diplomacy mission).');
  $mk('signal_decoder_2', 'Signal Decoder Mk II', 'copy', 1, 2, 1, 'diplomatic_corps', 2, ['C'], 0,
      'Execute the top card of another player\'s discard pile.');
  $mk('maintenance_bay_2', 'Maintenance Bay Mk II', 'reset', 1, 1, 1, 'wealth', 2, ['B'], 0,
      'Recover your discard pile; the drone you may build with this reset is free.');
  $mk('mekkari_fabricator', 'Mekkari Fabricator', 'envoy', 1, 0, 2, 'engineering', 2, ['C'], 0,
      'Produce 1 Components for each treaty you hold on Mekkari planets.', 'C');

  // ---------- Market — Stage III ----------
  $mk('point_defense_lattice', 'Point-Defense Lattice', 'strike', 4, 0, 0, 'war_college', 3, ['C', 'N'], 0,
      'Military mission at an adjacent planet: seize 2 of its resource.');
  $mk('trade_terminal_3', 'Trade Terminal Mk III', 'trade', 0, 0, 4, 'trade_guild', 3, ['N'], 5,
      'Trade mission: gain 5 credits and trade two resource types.');
  $mk('astrogation_array_3', 'Astrogation Array Mk III', 'move', 0, 4, 0, 'diplomatic_corps', 3, ['N'], 0,
      'Move your drones, then you may attempt one treaty (Diplomacy mission).');
  $mk('extractor_rig_4', 'Extractor Rig Mk IV', 'produce', 1, 2, 1, 'alliances', 3, ['C'], 0,
      'Choose a system: production for all treaty holders, or take the credit levy.');
  $mk('shipyard_berth_2', 'Shipyard Berth Mk II', 'recruit', 0, 2, 2, 'wealth', 3, ['N'], 0,
      'Install up to 2 components from the market.');
  $mk('aurelian_salon', 'Aurelian Salon', 'envoy', 0, 2, 1, 'engineering', 3, ['N'], 0,
      'Produce 1 Nectar for each treaty you hold on Aurelian planets.', 'N');

  // ---------- Market — Stage IV ----------
  $mk('torpedo_rack_2', 'Torpedo Rack Mk II', 'strike', 4, 1, 0, 'war_college', 4, ['N', 'A'], 0,
      'Military mission at an adjacent planet: seize 2 of its resource.');
  $mk('drone_bay_3', 'Drone Bay Mk III', 'deploy', 2, 1, 1, 'war_college', 4, ['C', 'N'], 0,
      'Launch new drones — or take 5 credits plus 1 per drone on the board.');
  $mk('priority_requisition_2', 'Priority Requisition Mk II', 'recruit_free', 1, 1, 2, 'wealth', 4, ['?', '?'], 0,
      'Install 1 component from the market, ignoring its position cost.');
  $mk('signal_decoder_3', 'Signal Decoder Mk III', 'copy', 2, 2, 2, 'diplomatic_corps', 4, ['A'], 0,
      'Execute the top card of another player\'s discard pile.');
  $mk('extractor_rig_5', 'Extractor Rig Mk V', 'produce', 1, 3, 1, 'alliances', 4, ['A'], 0,
      'Choose a system: production for all treaty holders, or take the credit levy.');
  $mk('umbral_conduit', 'Umbral Conduit', 'envoy', 1, 1, 2, 'engineering', 4, ['A'], 0,
      'Produce 1 Aether for each treaty you hold on Umbral planets.', 'A');

  // ---------- Market — Stage V ----------
  $mk('dreadnought_spine', 'Dreadnought Spine', 'strike', 5, 0, 0, 'war_college', 5, ['A', 'A'], 0,
      'Military mission at an adjacent planet: seize 2 of its resource.');
  $mk('trade_nexus', 'Trade Nexus', 'trade', 0, 0, 5, 'trade_guild', 5, ['A', 'N'], 5,
      'Trade mission: gain 5 credits and trade two resource types.');
  $mk('flag_bridge', 'Flag Bridge', 'move', 0, 5, 0, 'diplomatic_corps', 5, ['A', 'N'], 0,
      'Move your drones, then you may attempt one treaty (Diplomacy mission).');
  $mk('grand_extractor', 'Grand Extractor', 'produce', 2, 2, 2, 'alliances', 5, ['A', 'C'], 0,
      'Choose a system: production for all treaty holders, or take the credit levy.');

  $cards = $c;
  return $cards;
}

/** Keys of the 7 starter cards, in display order. */
function sp_starter_keys() {
  return [
    'maintenance_bay', 'astrogation_array', 'extractor_rig',
    'railgun_battery', 'trade_terminal', 'signal_decoder', 'shipyard_berth',
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

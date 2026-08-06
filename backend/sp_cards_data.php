<?php
/**
 * sp_cards_data.php — the v3 OCCUPATION card catalog + ship upgrade deck.
 *
 * v3 model: hand cards are CREW OCCUPATIONS tied to actions. The player
 * pilots ONE ship whose stats come from installed upgrade modules.
 *
 *  - Raid (strike): ship military + card Military vs planet military +
 *    your bounty in that region. Success: loot (production + bounty)
 *    goods, then bounty +1 there. Pirate track +1.
 *  - Diplomacy: ship political + card Diplomacy vs planet political −
 *    your reputation there. Success: payout (2 × production − rep)
 *    credits, then rep +1. Diplomat track +1.
 *  - Trade: no opposed roll. Sell goods the planet WANTS (price + 2 each),
 *    buy the planet's own goods at list price (up to its production).
 *    Capacity = 2 + card Trade + ship negotiating; flat bonus credits =
 *    negotiating. Any trade that moves ≥1 unit: Merchant track +1.
 *  - Move: the ship hops planet-to-planet; steps printed on the card.
 *
 * Occupation cards keep the [M, D, T] stat block; only the stat matching
 * the card's action is used (no committing in v3).
 */

function sp_cards() {
  static $cards = null;
  if ($cards !== null) return $cards;

  $c = [];

  // ---------- Starting crew (every player gets one copy of each) ----------
  $c['quartermaster'] = [
    'name' => 'Quartermaster', 'action' => 'reset',
    'stats' => [0, 1, 1], 'affiliation' => 'wealth',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'text' => 'Recover ALL cards — your whole discard pile plus this card — back into your hand.',
  ];
  $c['navigator'] = [
    'name' => 'Navigator', 'action' => 'move',
    'stats' => [0, 1, 0], 'affiliation' => 'alliances',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'steps' => 1,
    'text' => 'Fly your ship ONE star-lane hop (Afterburners add more). Arriving reveals the stats of nearby planets, and every region you visit counts for Explorers Guild scoring.',
  ];
  $c['navigator_b'] = [
    'name' => 'Relief Navigator', 'action' => 'move',
    'stats' => [0, 0, 1], 'affiliation' => 'alliances',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'steps' => 1,
    'text' => 'Fly your ship ONE star-lane hop.',
  ];
  $c['engineer'] = [
    'name' => 'Engineer', 'action' => 'engineer',
    'stats' => [0, 1, 1], 'affiliation' => 'engineering',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'text' => 'Install any number of ship modules from the upgrade dock, paying their credit costs. Each installed module occupies one cargo slot. (Even track steps also grant free modules.)',
  ];
  $c['corsair'] = [
    'name' => 'Corsair', 'action' => 'strike',
    'stats' => [2, 0, 0], 'affiliation' => 'war_college',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'text' => 'RAID a planet in your region: ship military + Military 2 vs its military + your local bounty. Loot = production + bounty in its goods AND the same in credits; then your bounty there rises.',
  ];
  $c['ambassador'] = [
    'name' => 'Ambassador', 'action' => 'diplomacy',
    'stats' => [0, 2, 0], 'affiliation' => 'diplomatic_corps',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'text' => 'Take a DIPLOMATIC CONTRACT in your region: ship political + Diplomacy 2 vs its political − your local reputation. You may BARGAIN AWAY other crew from hand: +1 political each (they return on your next Regroup). Payout = 3 × production − 2 × rep credits (floor production) PLUS 1 of the planet's own good; then your rep there rises. Each planet\'s crisis can be resolved only ONCE — mastering the track means twelve solved planets.',
  ];
  $c['trader'] = [
    'name' => 'Trader', 'action' => 'trade',
    'stats' => [0, 0, 2], 'affiliation' => 'trade_guild',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'text' => 'TRADE at a planet in your region: sell goods it wants (list + 3 + negotiating each), buy its own goods at list price. Capacity = 3 + Trade 2 + ship negotiating.',
  ];
  $c['recruiter'] = [
    'name' => 'Recruiter', 'action' => 'recruit',
    'stats' => [0, 1, 1], 'affiliation' => 'wealth',
    'kind' => 'starter', 'stage' => null, 'cost' => [], 'rider_credits' => 0,
    'text' => 'Hire up to 2 crew from the market (pay each card\'s cost plus its position cost).',
  ];

  // ---------- Market crew ----------
  $mk = function ($key, $name, $action, $m, $d, $t, $aff, $stage, $cost, $rider, $text, $extra = []) use (&$c) {
    $c[$key] = array_merge([
      'name' => $name, 'action' => $action, 'stats' => [$m, $d, $t],
      'affiliation' => $aff, 'kind' => 'market', 'stage' => $stage,
      'cost' => $cost, 'rider_credits' => $rider, 'text' => $text,
    ], $extra);
  };

  // ---------- Stage I (7) ----------
  $mk('buccaneer', 'Buccaneer', 'strike', 3, 0, 0, 'war_college', 1, ['O'], 0,
      'RAID in your region: ship military + Military 3 vs military + bounty.');
  $mk('consul', 'Consul', 'diplomacy', 0, 3, 0, 'diplomatic_corps', 1, ['O', 'B'], 0,
      'Diplomatic contract: ship political + Diplomacy 3 vs political − rep. Bargain away other crew: +1 each.');
  $mk('caravan_master', 'Caravan Master', 'trade', 0, 0, 3, 'trade_guild', 1, ['B'], 0,
      'Trade in your region; capacity 3 + Trade 3 + negotiating.');
  $mk('wayfinder', 'Wayfinder', 'move', 0, 1, 1, 'alliances', 1, ['O'], 0,
      'Fly your ship ONE star-lane hop.', ['steps' => 1]);
  $mk('purser', 'Purser', 'trade', 0, 0, 2, 'wealth', 1, ['B'], 3,
      'Trade in your region (capacity 3 + Trade 2 + negotiating) and pocket 3 credits.');
  $mk('spy', 'Spy', 'copy', 1, 1, 1, 'diplomatic_corps', 1, ['C'], 0,
      'Execute the action of the top card of another player\'s discard pile (not a reset or copy card).');
  $mk('bosun', 'Bosun', 'reset', 1, 1, 1, 'wealth', 1, ['B'], 2,
      'Recover ALL cards (discard plus this card) and pocket 2 credits.');

  // ---------- Stage II (7) ----------
  $mk('freebooter', 'Freebooter', 'strike', 3, 1, 0, 'war_college', 2, ['C'], 0,
      'RAID in your region: ship military + Military 3 vs military + bounty.');
  $mk('attache', 'Attaché', 'diplomacy', 0, 3, 1, 'diplomatic_corps', 2, ['B', 'C'], 0,
      'Diplomatic contract: ship political + Diplomacy 3 vs political − rep. Bargain away other crew: +1 each.');
  $mk('guild_factor', 'Guild Factor', 'trade', 0, 1, 4, 'trade_guild', 2, ['C'], 0,
      'Trade in your region; capacity 3 + Trade 4 + negotiating.');
  $mk('pathfinder', 'Pathfinder', 'move', 1, 1, 0, 'alliances', 2, ['B'], 0,
      'Fly your ship ONE star-lane hop.', ['steps' => 1]);
  $mk('infiltrator', 'Infiltrator', 'copy', 1, 2, 1, 'diplomatic_corps', 2, ['C'], 0,
      'Execute the top card of another player\'s discard pile.');
  $mk('marauder', 'Marauder', 'strike', 4, 0, 0, 'war_college', 2, ['C', 'N'], 0,
      'RAID in your region: ship military + Military 4 vs military + bounty.');
  $mk('chief_engineer', 'Chief Engineer', 'engineer', 1, 1, 1, 'engineering', 2, ['C'], 0,
      'Install any number of ship modules from the upgrade dock, paying credits.');
  $mk('first_mate', 'First Mate', 'reset', 1, 1, 1, 'wealth', 2, ['N'], 3,
      'Recover ALL cards (discard plus this card) and pocket 3 credits.');

  // ---------- Stage III (6) ----------
  $mk('legate', 'Legate', 'diplomacy', 0, 4, 0, 'diplomatic_corps', 3, ['N'], 0,
      'Diplomatic contract: ship political + Diplomacy 4 vs political − rep. Bargain away other crew: +1 each.');
  $mk('magnate', 'Magnate', 'trade', 0, 0, 5, 'trade_guild', 3, ['N'], 5,
      'Trade in your region (capacity 3 + Trade 5 + negotiating) and pocket 5 credits.');
  $mk('warlord', 'Warlord', 'strike', 4, 1, 0, 'war_college', 3, ['C', 'N'], 0,
      'RAID in your region: ship military + Military 4 vs military + bounty.');
  $mk('voidrunner', 'Voidrunner', 'move', 1, 0, 1, 'alliances', 3, ['N'], 0,
      'Fly your ship ONE star-lane hop.', ['steps' => 1]);
  $mk('guildmaster', 'Guildmaster', 'recruit', 0, 2, 2, 'wealth', 3, ['N'], 0,
      'Hire up to 2 crew from the market.');
  $mk('high_envoy', 'High Envoy', 'diplomacy', 1, 4, 0, 'diplomatic_corps', 3, ['N', 'C'], 0,
      'Diplomatic contract: ship political + Diplomacy 4 vs political − rep. Bargain away other crew: +1 each.');

  // ---------- Stage IV (6) ----------
  $mk('dread_corsair', 'Dread Corsair', 'strike', 5, 0, 0, 'war_college', 4, ['N', 'A'], 0,
      'RAID in your region: ship military + Military 5 vs military + bounty.');
  $mk('chancellor', 'Chancellor', 'diplomacy', 0, 5, 0, 'diplomatic_corps', 4, ['A'], 0,
      'Diplomatic contract: ship political + Diplomacy 5 vs political − rep. Bargain away other crew: +1 each.');
  $mk('trade_prince', 'Trade Prince', 'trade', 0, 1, 5, 'trade_guild', 4, ['A'], 5,
      'Trade in your region (capacity 3 + Trade 5 + negotiating) and pocket 5 credits.');
  $mk('star_pilot', 'Star Pilot', 'move', 1, 1, 1, 'alliances', 4, ['C', 'N'], 0,
      'Fly your ship ONE star-lane hop.', ['steps' => 1]);
  $mk('spymaster', 'Spymaster', 'copy', 2, 2, 2, 'diplomatic_corps', 4, ['A'], 0,
      'Execute the top card of another player\'s discard pile.');
  $mk('master_shipwright', 'Master Shipwright', 'engineer', 1, 1, 2, 'engineering', 4, ['C', 'N'], 0,
      'Install any number of ship modules from the upgrade dock, paying credits.');
  $mk('press_gang', 'Press Gang', 'recruit_free', 1, 1, 2, 'wealth', 4, ['?', '?'], 0,
      'Hire 1 crew member from the market, ignoring its position cost.');

  // ---------- Stage V (4) ----------
  $mk('pirate_king', 'Pirate King', 'strike', 6, 0, 0, 'war_college', 5, ['A', 'A'], 0,
      'RAID in your region: ship military + Military 6 vs military + bounty.');
  $mk('grand_diplomat', 'Grand Diplomat', 'diplomacy', 0, 6, 0, 'diplomatic_corps', 5, ['A', 'N'], 0,
      'Diplomatic contract: ship political + Diplomacy 6 vs political − rep. Bargain away other crew: +1 each.');
  $mk('cartel_boss', 'Cartel Boss', 'trade', 0, 0, 6, 'trade_guild', 5, ['A', 'N'], 5,
      'Trade in your region (capacity 3 + Trade 6 + negotiating) and pocket 5 credits.');
  $mk('admiral', 'Admiral', 'strike', 5, 2, 0, 'war_college', 5, ['A', 'C'], 0,
      'RAID in your region: ship military + Military 5 vs military + bounty.');

  $cards = $c;
  return $cards;
}

/** Keys of the starter crew, in display order. Two one-hop move cards;
 *  the Engineer is the module-buying occupation. */
function sp_starter_keys() {
  return [
    'quartermaster', 'navigator', 'navigator_b', 'corsair',
    'ambassador', 'trader', 'recruiter', 'engineer',
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

// ─────────────────────────────────────────────────────────────────────────
// Ship upgrade deck — modules that build the player board's stats.
//   weapon      → +military   diplomatic → +political
//   trade       → +negotiating  system    → utility (cargo, speed)
// Bought with credits during a reset (from the 4-card upgrade dock), or
// granted FREE from the stack when a track reaches an even step (pirate →
// weapon, diplomat → diplomatic, merchant → trade).
// ─────────────────────────────────────────────────────────────────────────

function sp_upgrade_cards() {
  static $u = null;
  if ($u !== null) return $u;
  $u = [
    // Weapons (+military)
    'pulse_laser'    => ['name' => 'Pulse Laser',     'type' => 'weapon',     'bonus' => 1, 'cost' => 6,  'text' => '+1 ship military.'],
    'autocannon'     => ['name' => 'Autocannon',      'type' => 'weapon',     'bonus' => 1, 'cost' => 6,  'text' => '+1 ship military.'],
    'flak_array'     => ['name' => 'Flak Array',      'type' => 'weapon',     'bonus' => 1, 'cost' => 6,  'text' => '+1 ship military.'],
    'ion_battery'    => ['name' => 'Ion Battery',     'type' => 'weapon',     'bonus' => 1, 'cost' => 6,  'text' => '+1 ship military.'],
    'torpedo_tubes'  => ['name' => 'Torpedo Tubes',   'type' => 'weapon',     'bonus' => 1, 'cost' => 6,  'text' => '+1 ship military.'],
    'heavy_railgun'  => ['name' => 'Heavy Railgun',   'type' => 'weapon',     'bonus' => 2, 'cost' => 12, 'text' => '+2 ship military.'],
    'antimatter_lance' => ['name' => 'Antimatter Lance', 'type' => 'weapon',  'bonus' => 2, 'cost' => 12, 'text' => '+2 ship military.'],
    // Diplomatic modules (+political)
    'hailing_suite'  => ['name' => 'Hailing Suite',   'type' => 'diplomatic', 'bonus' => 1, 'cost' => 6,  'text' => '+1 ship political.'],
    'translator_core' => ['name' => 'Translator Core', 'type' => 'diplomatic', 'bonus' => 1, 'cost' => 6, 'text' => '+1 ship political.'],
    'cultural_archive' => ['name' => 'Cultural Archive', 'type' => 'diplomatic', 'bonus' => 1, 'cost' => 6, 'text' => '+1 ship political.'],
    'embassy_pod'    => ['name' => 'Embassy Pod',     'type' => 'diplomatic', 'bonus' => 1, 'cost' => 6,  'text' => '+1 ship political.'],
    'protocol_ai'    => ['name' => 'Protocol AI',     'type' => 'diplomatic', 'bonus' => 1, 'cost' => 6,  'text' => '+1 ship political.'],
    'grand_stateroom' => ['name' => 'Grand Stateroom', 'type' => 'diplomatic', 'bonus' => 2, 'cost' => 12, 'text' => '+2 ship political.'],
    'sovereign_seal' => ['name' => 'Sovereign Seal',  'type' => 'diplomatic', 'bonus' => 2, 'cost' => 12, 'text' => '+2 ship political.'],
    // Trade modules (+negotiating: +capacity and +flat credits per trade)
    'cargo_scanner'  => ['name' => 'Cargo Scanner',   'type' => 'trade',      'bonus' => 1, 'cost' => 6,  'text' => '+1 negotiating (trade capacity and credits).'],
    'ledger_core'    => ['name' => 'Ledger Core',     'type' => 'trade',      'bonus' => 1, 'cost' => 6,  'text' => '+1 negotiating.'],
    'barter_console' => ['name' => 'Barter Console',  'type' => 'trade',      'bonus' => 1, 'cost' => 6,  'text' => '+1 negotiating.'],
    'exchange_uplink' => ['name' => 'Exchange Uplink', 'type' => 'trade',     'bonus' => 1, 'cost' => 6,  'text' => '+1 negotiating.'],
    'guild_license'  => ['name' => 'Guild License',   'type' => 'trade',      'bonus' => 1, 'cost' => 6,  'text' => '+1 negotiating.'],
    'freeport_charter' => ['name' => 'Freeport Charter', 'type' => 'trade',   'bonus' => 2, 'cost' => 12, 'text' => '+2 negotiating.'],
    'monopoly_writ'  => ['name' => 'Monopoly Writ',   'type' => 'trade',      'bonus' => 2, 'cost' => 12, 'text' => '+2 negotiating.'],
    // Systems (utility)
    'cargo_pods_a'   => ['name' => 'Cargo Pods',      'type' => 'system',     'bonus' => 0, 'cost' => 8,  'text' => '+4 cargo capacity.'],
    'cargo_pods_b'   => ['name' => 'Cargo Pods',      'type' => 'system',     'bonus' => 0, 'cost' => 8,  'text' => '+4 cargo capacity.'],
    'afterburners_a' => ['name' => 'Afterburners',    'type' => 'system',     'bonus' => 0, 'cost' => 8,  'text' => '+1 step on every move.'],
    'afterburners_b' => ['name' => 'Afterburners',    'type' => 'system',     'bonus' => 0, 'cost' => 8,  'text' => '+1 step on every move.'],
  ];
  return $u;
}

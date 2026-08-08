<?php
/**
 * sp_cards_data.php — v4 RESEARCHER catalog (the ICC ruleset).
 *
 * Hand cards are members of your research team. Three disciplines solve
 * mission problems in competing ways:
 *   survey     = Xenogeology     (stat index 0)
 *   ethnography = Xenoanthropology (stat index 1)
 *   biology    = Exobiology      (stat index 2)
 * Plus support actions: reset (regroup), recruit / recruit_free (hire
 * with CREDITS), copy (multiplayer only).
 *
 * Discipline levers:
 *   geo    — charter heavy equipment: +1 per 2 credits spent (win or lose)
 *   anthro — consult colleagues: discard other researchers, +1 each
 *            (reset crew never; they return on Regroup)
 *   bio    — cultures: each failed bio attempt on a mission gives you a
 *            permanent +1 there (iterate until the experiment takes)
 */

function sp_cards() {
  static $cards = null;
  if ($cards !== null) return $cards;

  $c = [];

  // ---------- Starting team (5) ----------
  $c['mission_coordinator'] = [
    'name' => 'Mission Coordinator', 'action' => 'reset',
    'stats' => [0, 1, 1], 'affiliation' => 'wealth',
    'kind' => 'starter', 'stage' => null, 'cost_credits' => 0, 'rider_credits' => 0,
    'text' => 'Recover ALL cards — your whole discard pile plus this card — back into your hand.',
  ];
  $c['field_geologist'] = [
    'name' => 'Field Geologist', 'action' => 'survey',
    'stats' => [2, 0, 0], 'affiliation' => 'war_college',
    'kind' => 'starter', 'stage' => null, 'cost_credits' => 0, 'rider_credits' => 0,
    'text' => 'Attempt a XENOGEOLOGY solution on a docket mission: Geology 2 vs its difficulty (+ chaos). You may charter equipment: +1 per 2 credits, spent win or lose.',
  ];
  $c['ethnographer'] = [
    'name' => 'Ethnographer', 'action' => 'ethnography',
    'stats' => [0, 2, 0], 'affiliation' => 'diplomatic_corps',
    'kind' => 'starter', 'stage' => null, 'cost_credits' => 0, 'rider_credits' => 0,
    'text' => 'Attempt a XENOANTHROPOLOGY solution: Anthropology 2 vs its difficulty (+ chaos). You may consult colleagues: discard other researchers for +1 each (they return on Regroup).',
  ];
  $c['exobiologist'] = [
    'name' => 'Exobiologist', 'action' => 'biology',
    'stats' => [0, 0, 2], 'affiliation' => 'trade_guild',
    'kind' => 'starter', 'stage' => null, 'cost_credits' => 0, 'rider_credits' => 0,
    'text' => 'Attempt an EXOBIOLOGY solution: Biology 2 vs its difficulty (+ chaos). A failed trial is never wasted: your cultures mature, +1 on that mission from then on.',
  ];
  $c['talent_scout'] = [
    'name' => 'Talent Scout', 'action' => 'recruit',
    'stats' => [0, 1, 1], 'affiliation' => 'wealth',
    'kind' => 'starter', 'stage' => null, 'cost_credits' => 0, 'rider_credits' => 0,
    'text' => 'Hire up to 2 researchers from the market (pay each card\'s credit cost plus its position surcharge).',
  ];

  // ---------- Market ----------
  $mk = function ($key, $name, $action, $g, $a, $b, $aff, $stage, $cost, $rider, $text) use (&$c) {
    $c[$key] = [
      'name' => $name, 'action' => $action, 'stats' => [$g, $a, $b],
      'affiliation' => $aff, 'kind' => 'market', 'stage' => $stage,
      'cost_credits' => $cost, 'rider_credits' => $rider, 'text' => $text,
    ];
  };

  // Stage I (3 credits)
  $mk('surveyor', 'Surveyor', 'survey', 3, 0, 0, 'war_college', 1, 3, 0,
      'Xenogeology solution attempt: Geology 3 (+ chartered equipment).');
  $mk('linguist', 'Linguist', 'ethnography', 0, 3, 0, 'diplomatic_corps', 1, 3, 0,
      'Xenoanthropology solution attempt: Anthropology 3 (+ consulted colleagues).');
  $mk('geneticist', 'Geneticist', 'biology', 0, 0, 3, 'trade_guild', 1, 3, 0,
      'Exobiology solution attempt: Biology 3 (+ matured cultures).');
  $mk('logistics_officer', 'Logistics Officer', 'reset', 1, 1, 1, 'wealth', 1, 3, 2,
      'Recover ALL cards (discard plus this card) and pocket 2 credits.');
  $mk('peer_reviewer', 'Peer Reviewer', 'copy', 1, 1, 1, 'diplomatic_corps', 1, 3, 0,
      'Execute the action of the top card of another player\'s discard pile (not a reset or copy card).');
  $mk('faculty_recruiter', 'Faculty Recruiter', 'recruit', 1, 1, 0, 'wealth', 1, 3, 0,
      'Hire up to 2 researchers from the market.');

  // Stage II (4 credits)
  $mk('seismologist', 'Seismologist', 'survey', 4, 0, 0, 'war_college', 2, 4, 0,
      'Xenogeology solution attempt: Geology 4 (+ chartered equipment).');
  $mk('archivist', 'Archivist', 'ethnography', 0, 4, 0, 'diplomatic_corps', 2, 4, 0,
      'Xenoanthropology solution attempt: Anthropology 4 (+ consulted colleagues).');
  $mk('ecologist', 'Ecologist', 'biology', 0, 0, 4, 'trade_guild', 2, 4, 0,
      'Exobiology solution attempt: Biology 4 (+ matured cultures).');
  $mk('deputy_director', 'Deputy Director', 'reset', 1, 1, 1, 'wealth', 2, 4, 3,
      'Recover ALL cards (discard plus this card) and pocket 3 credits.');
  $mk('headhunter', 'Headhunter', 'recruit_free', 1, 1, 1, 'wealth', 2, 4, 0,
      'Hire 1 researcher from the market, ignoring its position surcharge.');
  $mk('academic_rival', 'Academic Rival', 'copy', 1, 2, 1, 'diplomatic_corps', 2, 4, 0,
      'Execute the top card of another player\'s discard pile.');

  // Stage III (6 credits)
  $mk('planetary_engineer', 'Planetary Engineer', 'survey', 5, 0, 0, 'war_college', 3, 6, 0,
      'Xenogeology solution attempt: Geology 5 (+ chartered equipment).');
  $mk('chief_ethnologist', 'Chief Ethnologist', 'ethnography', 0, 5, 0, 'diplomatic_corps', 3, 6, 0,
      'Xenoanthropology solution attempt: Anthropology 5 (+ consulted colleagues).');
  $mk('biome_designer', 'Biome Designer', 'biology', 0, 0, 5, 'trade_guild', 3, 6, 0,
      'Exobiology solution attempt: Biology 5 (+ matured cultures).');
  $mk('dean', 'Dean', 'recruit', 0, 2, 2, 'wealth', 3, 6, 0,
      'Hire up to 2 researchers from the market.');
  $mk('grant_writer', 'Grant Writer', 'reset', 1, 1, 1, 'wealth', 3, 6, 5,
      'Recover ALL cards (discard plus this card) and pocket 5 credits.');

  // Stage IV (8 credits)
  $mk('core_breaker', 'Core Breaker', 'survey', 5, 1, 0, 'war_college', 4, 8, 0,
      'Xenogeology solution attempt: Geology 5 (+ chartered equipment).');
  $mk('mythographer', 'Mythographer', 'ethnography', 0, 5, 1, 'diplomatic_corps', 4, 8, 0,
      'Xenoanthropology solution attempt: Anthropology 5 (+ consulted colleagues).');
  $mk('symbiogenesist', 'Symbiogenesist', 'biology', 1, 0, 5, 'trade_guild', 4, 8, 0,
      'Exobiology solution attempt: Biology 5 (+ matured cultures).');
  $mk('spymaster', 'Spymaster', 'copy', 2, 2, 2, 'diplomatic_corps', 4, 8, 0,
      'Execute the top card of another player\'s discard pile.');
  $mk('provost', 'Provost', 'recruit', 1, 2, 2, 'wealth', 4, 8, 0,
      'Hire up to 2 researchers from the market.');

  // Stage V (10 credits)
  $mk('worldshaper', 'Worldshaper', 'survey', 6, 0, 0, 'war_college', 5, 10, 0,
      'Xenogeology solution attempt: Geology 6 (+ chartered equipment).');
  $mk('loremaster', 'Loremaster', 'ethnography', 0, 6, 0, 'diplomatic_corps', 5, 10, 0,
      'Xenoanthropology solution attempt: Anthropology 6 (+ consulted colleagues).');
  $mk('lifewright', 'Lifewright', 'biology', 0, 0, 6, 'trade_guild', 5, 10, 0,
      'Exobiology solution attempt: Biology 6 (+ matured cultures).');
  $mk('laureate', 'Nobel Laureate', 'reset', 2, 2, 2, 'wealth', 5, 10, 6,
      'Recover ALL cards (discard plus this card) and pocket 6 credits.');

  $cards = $c;
  return $cards;
}

/** Keys of the starting team, in display order. */
function sp_starter_keys() {
  return [
    'mission_coordinator', 'field_geologist', 'ethnographer',
    'exobiologist', 'talent_scout',
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

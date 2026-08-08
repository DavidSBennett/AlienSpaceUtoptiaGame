<?php
/**
 * sp_missions_data.php — the v4 MISSION deck: problems facing alien
 * cultures, each with three competing solutions (one per discipline).
 *
 *   geo    = Xenogeology     (move, build, engineer the physical world)
 *   anthro = Xenoanthropology (understand, respect, document the culture)
 *   bio    = Exobiology      (reshape the biology, engineer life itself)
 *
 * Each solution: text (the outcome that becomes canon), difficulty,
 * chaos delta (negative = ORDER, stabilizes the ICC), credits (funding
 * awarded), and optional 'follow' — a mission key injected into the deck
 * when this solution resolves: the story branches.
 *
 * Tiers: minor (difficulty 2-4) · major (5-8) · critical (9-12).
 * Track gates: step 5 needs a MAJOR solve, step 9 a CRITICAL solve.
 */

function sp_missions() {
  static $m = null;
  if ($m !== null) return $m;

  $m = [
    // ───────────────────────── MINOR ─────────────────────────
    'm_silent_reef' => [
      'title' => 'The Silent Reef', 'culture' => 'Aquari', 'tier' => 'minor',
      'problem' => 'The Aquari coral-choirs are bleaching mute — the songs that hold their society together are dying with the reef.',
      'solutions' => [
        'geo' => ['difficulty' => 3, 'chaos' => 2, 'credits' => 5,
          'text' => 'Thermal vents are diverted; the reef survives, but the new currents scatter the choirs into strangers.'],
        'anthro' => ['difficulty' => 2, 'chaos' => -1, 'credits' => 4,
          'text' => 'The last songs are recorded and taught to the young; the reef fades, the music does not.'],
        'bio' => ['difficulty' => 3, 'chaos' => 1, 'credits' => 5, 'follow' => 'f_reef_bloom',
          'text' => 'Heat-proof symbionts are spliced into the coral; the reef sings again — in a slightly different key.'],
      ],
    ],
    'm_marrow_moths' => [
      'title' => 'Marrow Moths', 'culture' => 'Velth', 'tier' => 'minor',
      'problem' => 'Moth-swarms are devouring the Velth grain-arks mid-migration; famine follows the flight path.',
      'solutions' => [
        'geo' => ['difficulty' => 2, 'chaos' => 1, 'credits' => 5,
          'text' => 'Sonic barriers wall the arks; the moths starve instead, and something that ate the moths goes hungry.'],
        'anthro' => ['difficulty' => 3, 'chaos' => -2, 'credits' => 3,
          'text' => 'The harvest festival routes are rewoven around the swarm season — the Velth adapt as they always have.'],
        'bio' => ['difficulty' => 3, 'chaos' => 2, 'credits' => 5, 'follow' => 'f_moth_collapse',
          'text' => 'Predator wasps are introduced; the moths vanish within a season.'],
      ],
    ],
    'm_glass_rain' => [
      'title' => 'Glass Rain', 'culture' => 'Ossim', 'tier' => 'minor',
      'problem' => 'Silicate storms are shredding the Ossim cliff-cities — the same storms their calendar and poetry are built around.',
      'solutions' => [
        'geo' => ['difficulty' => 3, 'chaos' => -1, 'credits' => 6,
          'text' => 'Windbreak ridges are raised upwind; the cities stand, the storms still sing overhead.'],
        'anthro' => ['difficulty' => 3, 'chaos' => 0, 'credits' => 4,
          'text' => 'The storm-pilgrimage is documented; the Ossim rebuild in glass-scar patterns, as their ancestors did.'],
        'bio' => ['difficulty' => 4, 'chaos' => 1, 'credits' => 5,
          'text' => 'A lichen skin is grown over the cliffs that swallows the shards — and slowly digests the carvings too.'],
      ],
    ],
    'm_drifting_dead' => [
      'title' => 'The Drifting Dead', 'culture' => 'Yulen', 'tier' => 'minor',
      'problem' => 'Yulen sky-burials are drifting into the shipping lanes; every collision is a desecration and a diplomatic incident.',
      'solutions' => [
        'geo' => ['difficulty' => 2, 'chaos' => 2, 'credits' => 5,
          'text' => 'Gravity nets catch the dead and hold them in orbit — caged, the Yulen say, between worlds.'],
        'anthro' => ['difficulty' => 3, 'chaos' => -2, 'credits' => 3,
          'text' => 'The shipping lanes are re-charted around the burial winds; commerce bends to the dead.'],
        'bio' => ['difficulty' => 3, 'chaos' => 1, 'credits' => 4,
          'text' => 'A gentle accelerant returns the dead to stardust in days instead of decades.'],
      ],
    ],
    'm_lightless_choir' => [
      'title' => 'The Lightless Choir', 'culture' => 'Umbral', 'tier' => 'minor',
      'problem' => 'Mining resonance is deafening Umbral novices to the dark-song they must hear to come of age.',
      'solutions' => [
        'geo' => ['difficulty' => 3, 'chaos' => 1, 'credits' => 4,
          'text' => 'The mine is sealed; the song returns, and a mining clan loses its livelihood.'],
        'anthro' => ['difficulty' => 2, 'chaos' => -1, 'credits' => 4,
          'text' => 'Silent hours are negotiated around the initiation rites; industry and mystery share the dark.'],
        'bio' => ['difficulty' => 4, 'chaos' => 1, 'credits' => 6,
          'text' => 'A cochlear symbiote lets novices hear the song through the noise — hearing it, now, forever.'],
      ],
    ],
    'm_salt_bloom' => [
      'title' => 'Salt Bloom', 'culture' => 'Krath', 'tier' => 'minor',
      'problem' => 'The Krath salt gardens — their food, their currency, their shrines — have bloomed a beautiful toxic red.',
      'solutions' => [
        'geo' => ['difficulty' => 2, 'chaos' => 1, 'credits' => 5,
          'text' => 'The aquifer is re-routed and the gardens flushed clean; two shrine pools are lost to the current.'],
        'anthro' => ['difficulty' => 3, 'chaos' => -1, 'credits' => 3,
          'text' => 'The red bloom is enshrined as an omen-year; fasting rites carry the Krath through it.'],
        'bio' => ['difficulty' => 3, 'chaos' => 0, 'credits' => 5,
          'text' => 'A tailored microbe eats the toxin and dies out on schedule; the gardens whiten by spring.'],
      ],
    ],
    'm_tide_locked' => [
      'title' => 'The Thirsty Rootway', 'culture' => 'Verdani', 'tier' => 'minor',
      'problem' => 'The Verdani rootway — a continent-spanning communal root — is drying at its southern reach.',
      'solutions' => [
        'geo' => ['difficulty' => 3, 'chaos' => 0, 'credits' => 6,
          'text' => 'An aqueduct is bored through the ridge; the rootway drinks, the ridge-dwellers now live above a river.'],
        'anthro' => ['difficulty' => 3, 'chaos' => -1, 'credits' => 3,
          'text' => 'The southern groves keep their ancient migration rite and walk north; the dry root is left as a monument.'],
        'bio' => ['difficulty' => 2, 'chaos' => 1, 'credits' => 5, 'follow' => 'f_cultivar_spread',
          'text' => 'A drought-hardy cultivar is grafted southward; it thrives — vigorously.'],
      ],
    ],
    'm_iron_pilgrims' => [
      'title' => 'Iron Pilgrims', 'culture' => 'Mekkari', 'tier' => 'minor',
      'problem' => 'Mekkari pilgrims rust and seize on the sacred wet-world they must visit once before decommissioning.',
      'solutions' => [
        'geo' => ['difficulty' => 2, 'chaos' => 1, 'credits' => 5,
          'text' => 'The pilgrim road is roofed and dehumidified; the sacred rain is now something seen through glass.'],
        'anthro' => ['difficulty' => 3, 'chaos' => -2, 'credits' => 3,
          'text' => 'Proxy pilgrimage is sanctified: one waterproofed elder walks for a thousand, carrying their names.'],
        'bio' => ['difficulty' => 3, 'chaos' => 0, 'credits' => 5,
          'text' => 'A living anti-corrosion film is cultured for pilgrim chassis; the rain touches them and does not bite.'],
      ],
    ],

    // ───────────────────────── MAJOR ─────────────────────────
    'm_binding_suns' => [
      'title' => 'The Binding Suns', 'culture' => 'Veyr', 'tier' => 'major',
      'problem' => 'Two entwined Veyr species share a world whose sun will go supernova within a generation. Every instrument agrees. The Veyr do not ask for rescue.',
      'solutions' => [
        'geo' => ['difficulty' => 6, 'chaos' => 4, 'credits' => 10, 'follow' => 'f_sundered_kin',
          'text' => 'Evacuation fleets carry the two species to two viable worlds — apart. The Veyr are saved, and sundered.'],
        'anthro' => ['difficulty' => 7, 'chaos' => -2, 'credits' => 6, 'follow' => 'f_witness_light',
          'text' => 'Their scripture is published to the ICC: the supernova is their ascension. The Council bears witness and lets them stay.'],
        'bio' => ['difficulty' => 5, 'chaos' => 2, 'credits' => 8, 'follow' => 'f_grey_garden',
          'text' => 'A sealed habitat preserves both species together, symbiosis intact — beneath a sky that will never open.'],
      ],
    ],
    'm_borrowed_sky' => [
      'title' => 'The Borrowed Sky', 'culture' => 'Aurelian', 'tier' => 'major',
      'problem' => 'The Aurelian pleasure-city of Lumen Halls is sinking into its gas giant; its people refuse to leave mid-festival, and the festival never ends.',
      'solutions' => [
        'geo' => ['difficulty' => 5, 'chaos' => 2, 'credits' => 9,
          'text' => 'The city is jacked onto new buoyancy spines mid-carnival; the Halls survive, forever creaking in waltz-time.'],
        'anthro' => ['difficulty' => 6, 'chaos' => -1, 'credits' => 6,
          'text' => 'The Last Festival is choreographed: a decade-long, dignified descent, every guest departing on the final night.'],
        'bio' => ['difficulty' => 6, 'chaos' => 1, 'credits' => 8,
          'text' => 'Gas-bladder organisms are grown into the foundations; the city becomes something half-alive that chooses to float.'],
      ],
    ],
    'm_debt_of_names' => [
      'title' => 'The Debt of Names', 'culture' => 'Umbral', 'tier' => 'major',
      'problem' => 'An Umbral name-plague is spreading: spoken names erase their bearers\' memories, and silence is starving their society of history.',
      'solutions' => [
        'geo' => ['difficulty' => 7, 'chaos' => 3, 'credits' => 10,
          'text' => 'The afflicted regions are quarantined behind sound-dead vaults; the plague halts, and so do the reunions.'],
        'anthro' => ['difficulty' => 5, 'chaos' => -2, 'credits' => 7,
          'text' => 'A gesture-tongue is assembled from Umbral funeral signs; names go unspoken and unforgotten both.'],
        'bio' => ['difficulty' => 6, 'chaos' => 1, 'credits' => 8,
          'text' => 'The plague is traced to a memory-spore and inoculated against; a generation keeps its names and loses its immunity rites.'],
      ],
    ],
    'm_hollow_herd' => [
      'title' => 'The Hollow Herd', 'culture' => 'Krath', 'tier' => 'major',
      'problem' => 'Off-world contractors have strip-mined the migrating mountain-beasts the Krath live upon — some herd-peaks now ring hollow.',
      'solutions' => [
        'geo' => ['difficulty' => 6, 'chaos' => 2, 'credits' => 10,
          'text' => 'The hollows are back-filled with load-bearing foam; the herd walks on, part flesh, part scaffold.'],
        'anthro' => ['difficulty' => 6, 'chaos' => -2, 'credits' => 6,
          'text' => 'Mining rights are renegotiated under Krath herd-law; the contractors now pay in restoration, not credits.'],
        'bio' => ['difficulty' => 5, 'chaos' => 1, 'credits' => 8, 'follow' => 'f_hollow_song',
          'text' => 'A bone-coral is seeded in the wounds; the mountains heal themselves — and begin to hum.'],
      ],
    ],
    'm_two_rivers' => [
      'title' => 'A War of Two Rivers', 'culture' => 'Verdani', 'tier' => 'major',
      'problem' => 'A silt-choked river has set two Verdani grove-nations at war for the first time in eight centuries.',
      'solutions' => [
        'geo' => ['difficulty' => 5, 'chaos' => 1, 'credits' => 9,
          'text' => 'The river is re-cut into two equal channels; the war ends at a border neither grove chose.'],
        'anthro' => ['difficulty' => 6, 'chaos' => -3, 'credits' => 7,
          'text' => 'The forgotten water-truce liturgy is recovered from seed-archives; both groves stand down, ashamed and relieved.'],
        'bio' => ['difficulty' => 6, 'chaos' => 1, 'credits' => 8,
          'text' => 'Both groves are grafted to share one circulatory root; war becomes, biologically, self-harm.'],
      ],
    ],
    'm_starving_signal' => [
      'title' => 'The Starving Signal', 'culture' => 'Mekkari', 'tier' => 'major',
      'problem' => 'A Mekkari sect has begun a signal-fast — refusing all energy transfer in protest — and their juveniles are powering down.',
      'solutions' => [
        'geo' => ['difficulty' => 7, 'chaos' => 3, 'credits' => 9,
          'text' => 'Induction fields are built under the fasting grounds; the juveniles are fed without consent, and the sect splinters.'],
        'anthro' => ['difficulty' => 6, 'chaos' => -2, 'credits' => 6,
          'text' => 'The fast\'s grievance is heard in full Council session; the sect ends the protest itself, honor intact.'],
        'bio' => ['difficulty' => 5, 'chaos' => 2, 'credits' => 8,
          'text' => 'A trickle-metabolism is engineered for the juveniles; they survive the fast — changed into something that barely needs anyone.'],
      ],
    ],
    'm_glasswing' => [
      'title' => 'The Glasswing Exodus', 'culture' => 'Ossim', 'tier' => 'major',
      'problem' => 'Ossim refugees\' crystalline wings are shattering in their new world\'s thick air — flight is their language of grief, and they cannot mourn.',
      'solutions' => [
        'geo' => ['difficulty' => 6, 'chaos' => 1, 'credits' => 9,
          'text' => 'A thin-air mourning vault is excavated at altitude; grief becomes a place you must travel to.'],
        'anthro' => ['difficulty' => 5, 'chaos' => -1, 'credits' => 7,
          'text' => 'Elders adapt the grief-flights into ground-glides; the young learn to mourn low, and the words survive.'],
        'bio' => ['difficulty' => 6, 'chaos' => 2, 'credits' => 8,
          'text' => 'Flexible wing-lattices are grown for the next generation — who will mourn fluently, and differently from their parents.'],
      ],
    ],
    'm_court_echoes' => [
      'title' => 'The Court of Echoes', 'culture' => 'Aurelian', 'tier' => 'major',
      'problem' => 'An Aurelian memory-court is compulsively replaying a centuries-old massacre, sentencing living descendants for ancestral crimes.',
      'solutions' => [
        'geo' => ['difficulty' => 6, 'chaos' => 2, 'credits' => 8,
          'text' => 'The resonance chamber is dismantled stone by stone; the trials end, unfinished, forever.'],
        'anthro' => ['difficulty' => 5, 'chaos' => -2, 'credits' => 7,
          'text' => 'A truth-and-release rite is composed with the court\'s own jurists; the massacre is finally judged, once, and laid down.'],
        'bio' => ['difficulty' => 7, 'chaos' => 1, 'credits' => 9,
          'text' => 'The memory-strain is attenuated; the echoes fade to bearable — and some testimony fades with them.'],
      ],
    ],

    // ─────────────────────── CRITICAL ───────────────────────
    'm_worldheart' => [
      'title' => 'The Worldheart Wakes', 'culture' => 'Krath', 'tier' => 'critical',
      'problem' => 'The core of the Krath homeworld is waking as a slow vast mind — and its dreams are earthquakes.',
      'solutions' => [
        'geo' => ['difficulty' => 10, 'chaos' => 4, 'credits' => 15,
          'text' => 'Dampener shafts lull the core back to sleep; the quakes end, and the Krath mourn a god they met for one year.'],
        'anthro' => ['difficulty' => 11, 'chaos' => -3, 'credits' => 10,
          'text' => 'The Krath are taught to read the dream-tremors as language; the ICC recognizes the first planetary citizen.'],
        'bio' => ['difficulty' => 9, 'chaos' => 2, 'credits' => 12,
          'text' => 'A neural moss is spread through the crust as a translator — and now something always stands between the Krath and their world.'],
      ],
    ],
    'm_last_migration' => [
      'title' => 'The Last Migration', 'culture' => 'Velth', 'tier' => 'critical',
      'problem' => 'Every Velth swarm alive is converging on a dying jump-gate their instinct insists leads home. It leads nowhere.',
      'solutions' => [
        'geo' => ['difficulty' => 9, 'chaos' => 3, 'credits' => 14,
          'text' => 'The gate is rebuilt and re-aimed at a viable world; instinct is obeyed by redirecting it.'],
        'anthro' => ['difficulty' => 10, 'chaos' => -2, 'credits' => 10,
          'text' => 'The migration is recognized as a funeral, not an error; the ICC clears the sky and lets the swarms complete it.'],
        'bio' => ['difficulty' => 10, 'chaos' => 1, 'credits' => 12, 'follow' => 'f_gate_seed',
          'text' => 'The homing instinct is rewritten mid-flight; the swarms scatter to a dozen worlds, saved and directionless.'],
      ],
    ],
    'm_ascension_engine' => [
      'title' => 'The Ascension Engine', 'culture' => 'Umbral', 'tier' => 'critical',
      'problem' => 'An ancient machine beneath the Umbral dark offers mass ascension — everyone, at once, irreversibly. Half the culture is queueing.',
      'solutions' => [
        'geo' => ['difficulty' => 11, 'chaos' => 4, 'credits' => 15,
          'text' => 'The engine is entombed in a kilometer of ceramic; the queue becomes a permanent vigil at a sealed door.'],
        'anthro' => ['difficulty' => 10, 'chaos' => -3, 'credits' => 11,
          'text' => 'A generation-long deliberation rite is instituted; those who still choose the engine enter it understood, not fled from.'],
        'bio' => ['difficulty' => 10, 'chaos' => 2, 'credits' => 12,
          'text' => 'A reversible trial-ascension is engineered; most return. What they report divides the Umbral forever.'],
      ],
    ],
    'm_seed_of_ruin' => [
      'title' => 'The Seed of Ruin', 'culture' => 'Verdani', 'tier' => 'critical',
      'problem' => 'A pre-Council bioweapon is germinating in the Verdani homeworld\'s root-heart, wearing the face of a sacred first-tree.',
      'solutions' => [
        'geo' => ['difficulty' => 10, 'chaos' => 3, 'credits' => 14,
          'text' => 'The root-heart is excised and the crater sanctified; the Verdani survive, orphaned from their own center.'],
        'anthro' => ['difficulty' => 11, 'chaos' => -1, 'credits' => 10,
          'text' => 'The first-tree rites are studied until the weapon\'s trigger-liturgy is found — and simply never performed again.'],
        'bio' => ['difficulty' => 9, 'chaos' => 1, 'credits' => 13,
          'text' => 'The weapon is domesticated — gene by gene — into an actual first-tree. The sacred thing is now real, and made.'],
      ],
    ],

    // ─────────────────────── FOLLOW-UPS ───────────────────────
    'f_reef_bloom' => [
      'title' => 'The Loud Reef', 'culture' => 'Aquari', 'tier' => 'minor', 'chained' => true,
      'problem' => 'The spliced coral has overgrown the harbor mouths — the reef now sings day and night, and nothing can dock.',
      'solutions' => [
        'geo' => ['difficulty' => 3, 'chaos' => 1, 'credits' => 5,
          'text' => 'Channels are cut through the singing coral; the harbors open, scarred with silence.'],
        'anthro' => ['difficulty' => 2, 'chaos' => -1, 'credits' => 3,
          'text' => 'The ports are moved; the reef is declared a cathedral, and ships learn to anchor in the quiet coves.'],
        'bio' => ['difficulty' => 3, 'chaos' => 0, 'credits' => 5,
          'text' => 'A dormancy cycle is spliced in; the reef sleeps on schedule, and the harbors breathe between hymns.'],
      ],
    ],
    'f_moth_collapse' => [
      'title' => 'The Quiet Fields', 'culture' => 'Velth', 'tier' => 'minor', 'chained' => true,
      'problem' => 'The introduced wasps have finished the moths — and turned on the native pollinators. The grain-arks bloom, unfruited.',
      'solutions' => [
        'geo' => ['difficulty' => 3, 'chaos' => 1, 'credits' => 4,
          'text' => 'Pollination is mechanized with drift-drones; the harvest is saved and the fields hum like machinery now.'],
        'anthro' => ['difficulty' => 3, 'chaos' => -1, 'credits' => 3,
          'text' => 'Hand-pollination becomes a communal rite; the harvest shrinks, the festivals grow.'],
        'bio' => ['difficulty' => 4, 'chaos' => 2, 'credits' => 6,
          'text' => 'A sterile-generation switch ends the wasps; the ecosystem resets, one deliberate extinction deeper.'],
      ],
    ],
    'f_cultivar_spread' => [
      'title' => 'The Eager Graft', 'culture' => 'Verdani', 'tier' => 'minor', 'chained' => true,
      'problem' => 'The drought-cultivar is outcompeting the ancestral rootway it was grafted to save.',
      'solutions' => [
        'geo' => ['difficulty' => 3, 'chaos' => 1, 'credits' => 5,
          'text' => 'Mineral barriers channel the cultivar\'s spread; old root and new divide the continent like treaty powers.'],
        'anthro' => ['difficulty' => 3, 'chaos' => -1, 'credits' => 3,
          'text' => 'The Verdani adopt the cultivar into their lineage-songs; what was a graft is now a daughter.'],
        'bio' => ['difficulty' => 2, 'chaos' => 1, 'credits' => 5,
          'text' => 'A growth governor is spliced into the cultivar; it slows, obedient — and the Verdani wonder what else obeys.'],
      ],
    ],
    'f_hollow_song' => [
      'title' => 'The Humming Peaks', 'culture' => 'Krath', 'tier' => 'minor', 'chained' => true,
      'problem' => 'The bone-coral that healed the herd-mountains resonates in storms — a hum that drives Krath herders sleepless and strange.',
      'solutions' => [
        'geo' => ['difficulty' => 3, 'chaos' => 1, 'credits' => 5,
          'text' => 'Resonance baffles are bolted along the ridgelines; the hum dies to a whisper only the old still claim to hear.'],
        'anthro' => ['difficulty' => 2, 'chaos' => -1, 'credits' => 4,
          'text' => 'The hum is scored into herd-lullabies; within a generation the sleepless nights are called holy.'],
        'bio' => ['difficulty' => 4, 'chaos' => 1, 'credits' => 5,
          'text' => 'The coral is re-tuned below hearing; the mountains fall silent, and the herders say they feel watched.'],
      ],
    ],
    'f_sundered_kin' => [
      'title' => 'The Sundered Kin', 'culture' => 'Veyr', 'tier' => 'major', 'chained' => true,
      'problem' => 'The two evacuated Veyr species are failing apart: one colony is dying of a grief their biology cannot name.',
      'solutions' => [
        'geo' => ['difficulty' => 6, 'chaos' => 2, 'credits' => 8,
          'text' => 'A permanent transit-bridge links the two worlds; the Veyr live apart-together, citizens of a corridor.'],
        'anthro' => ['difficulty' => 5, 'chaos' => -2, 'credits' => 6,
          'text' => 'A rite of long-parting is composed from both species\' fragments; the grief is named, and survivable.'],
        'bio' => ['difficulty' => 5, 'chaos' => 1, 'credits' => 7,
          'text' => 'The symbiotic bond is re-grown in tissue banks on both worlds; each Veyr carries a living piece of the other kind.'],
      ],
    ],
    'f_witness_light' => [
      'title' => 'The Witness Light', 'culture' => 'Veyr', 'tier' => 'minor', 'chained' => true,
      'problem' => 'Pilgrims of a dozen species are flooding toward the doomed Veyr sun to witness the ascension — into a blast radius.',
      'solutions' => [
        'geo' => ['difficulty' => 4, 'chaos' => 1, 'credits' => 6,
          'text' => 'A shielded observatory ring is built at safe distance; witness becomes an institution.'],
        'anthro' => ['difficulty' => 3, 'chaos' => -2, 'credits' => 4,
          'text' => 'The Veyr themselves ordain the viewing rites and distances; the pilgrims obey the hosts of the miracle.'],
        'bio' => ['difficulty' => 4, 'chaos' => 1, 'credits' => 5,
          'text' => 'Radiation-buffer symbionts are issued to pilgrims; the reckless survive their own devotion.'],
      ],
    ],
    'f_grey_garden' => [
      'title' => 'The Grey Garden', 'culture' => 'Veyr', 'tier' => 'minor', 'chained' => true,
      'problem' => 'Inside the sealed habitat, the preserved Veyr are sinking into a listless grief — saved together, denied their ascension.',
      'solutions' => [
        'geo' => ['difficulty' => 4, 'chaos' => 2, 'credits' => 5,
          'text' => 'A false sky is engineered — dawn, storm, aurora; the Veyr live under weather again, and some call it kindness.'],
        'anthro' => ['difficulty' => 3, 'chaos' => -2, 'credits' => 4,
          'text' => 'Their ascension scripture is recomposed WITH the Veyr into a waiting-faith; the garden gains a horizon.'],
        'bio' => ['difficulty' => 4, 'chaos' => 1, 'credits' => 6,
          'text' => 'The grief-response itself is gently attenuated; the Veyr are content, and their poets write nothing new.'],
      ],
    ],
    'f_gate_seed' => [
      'title' => 'The Gate Seed', 'culture' => 'Velth', 'tier' => 'major', 'chained' => true,
      'problem' => 'The scattered swarms have begun building gate-shaped nests on a dozen worlds — instinct, rewritten, is dreaming in architecture.',
      'solutions' => [
        'geo' => ['difficulty' => 5, 'chaos' => 1, 'credits' => 8,
          'text' => 'One nest is completed into a real, working gate; the diaspora gains a hub, and the ICC gains a chokepoint.'],
        'anthro' => ['difficulty' => 6, 'chaos' => -2, 'credits' => 6,
          'text' => 'The nest-building is recognized as the swarms\' new religion and left untouched, studied with reverence.'],
        'bio' => ['difficulty' => 6, 'chaos' => 2, 'credits' => 7,
          'text' => 'The architectural instinct is pruned back to nesting; the gates stop — and something in the swarm-song goes flat.'],
      ],
    ],
  ];

  // ── Keywords: thematic tags that boons key off. ──
  $keywords = [
    'm_silent_reef' => ['ritual', 'extinction'],
    'm_marrow_moths' => ['migration', 'industry'],
    'm_glass_rain' => ['ritual', 'memory'],
    'm_drifting_dead' => ['ritual', 'memory'],
    'm_lightless_choir' => ['faith', 'industry'],
    'm_salt_bloom' => ['faith', 'industry'],
    'm_tide_locked' => ['migration', 'symbiosis'],
    'm_iron_pilgrims' => ['faith', 'ritual'],
    'm_binding_suns' => ['faith', 'extinction', 'symbiosis'],
    'm_borrowed_sky' => ['ritual', 'industry'],
    'm_debt_of_names' => ['memory', 'extinction'],
    'm_hollow_herd' => ['industry', 'symbiosis'],
    'm_two_rivers' => ['war', 'ritual'],
    'm_starving_signal' => ['faith', 'war'],
    'm_glasswing' => ['migration', 'memory'],
    'm_court_echoes' => ['memory', 'war'],
    'm_worldheart' => ['faith', 'industry'],
    'm_last_migration' => ['migration', 'extinction'],
    'm_ascension_engine' => ['faith', 'memory'],
    'm_seed_of_ruin' => ['war', 'symbiosis'],
    'f_reef_bloom' => ['ritual', 'industry'],
    'f_moth_collapse' => ['extinction', 'industry'],
    'f_cultivar_spread' => ['symbiosis', 'migration'],
    'f_hollow_song' => ['ritual', 'memory'],
    'f_sundered_kin' => ['symbiosis', 'memory'],
    'f_witness_light' => ['faith', 'migration'],
    'f_grey_garden' => ['faith', 'symbiosis'],
    'f_gate_seed' => ['migration', 'faith'],
  ];
  foreach ($keywords as $k => $kws) {
    if (isset($m[$k])) $m[$k]['keywords'] = $kws;
  }

  // ── Boons: the tempting engine on the back of every chaotic choice. ──
  // Solutions with chaos ≥ 1 carry a boon the solver claims permanently;
  // chaos ≥ 3 carries a MAJOR one. Order solutions carry none — stability
  // is the Council's reward, not yours.
  foreach ($m as $mkey => &$mm) {
    foreach ($mm['solutions'] as $disc => &$sol) {
      $chaos = (int)$sol['chaos'];
      if ($chaos < 1) continue;
      $kw = $mm['keywords'][0] ?? 'ritual';
      $slot = abs(crc32($mkey . $disc)) % 3;
      if ($chaos >= 3) {
        if ($slot === 0) {
          $sol['boon'] = ['type' => 'affinity', 'power' => 2, 'keyword' => $kw,
            'name' => 'Renowned Expertise: ' . ucfirst($kw),
            'text' => '+2 on every mission tagged "' . $kw . '".'];
        } elseif ($slot === 1) {
          if ($disc === 'geo') {
            $sol['boon'] = ['type' => 'fleet', 'name' => 'Fleet Charter',
              'text' => 'Equipment charters cost 1 credit per +1 (instead of 2).'];
          } elseif ($disc === 'anthro') {
            $sol['boon'] = ['type' => 'faculty', 'name' => 'Star Faculty',
              'text' => 'Consulted colleagues add +2 each (instead of +1).'];
          } else {
            $sol['boon'] = ['type' => 'panspermia', 'name' => 'Panspermia Library',
              'text' => '+1 on every Exobiology attempt.'];
          }
        } else {
          $sol['boon'] = ['type' => 'income', 'power' => 2, 'name' => 'Endowment',
            'text' => '+2 credits every time you solve a mission.'];
        }
      } else {
        if ($slot === 0) {
          $sol['boon'] = ['type' => 'affinity', 'power' => 1, 'keyword' => $kw,
            'name' => 'Field Dossier: ' . ucfirst($kw),
            'text' => '+1 on every mission tagged "' . $kw . '".'];
        } elseif ($slot === 1) {
          if ($disc === 'geo') {
            $sol['boon'] = ['type' => 'income', 'power' => 1, 'name' => 'Salvage Rights',
              'text' => '+1 credit every time you solve a mission.'];
          } elseif ($disc === 'anthro') {
            $sol['boon'] = ['type' => 'purist', 'name' => 'Methodological Purity',
              'text' => '+3 when every consulted colleague is an anthropologist (at least one).'];
          } else {
            $sol['boon'] = ['type' => 'incubators', 'name' => 'Rapid Incubators',
              'text' => 'Your cultures mature +2 per failed trial.'];
          }
        } else {
          $sol['boon'] = ['type' => 'hire_discount', 'power' => 1, 'name' => 'Recruiting Ties',
            'text' => 'Hiring researchers costs 1 credit less.'];
        }
      }
    }
    unset($sol);
  }
  unset($mm);

  return $m;
}

/** Mission keys by tier, in authored order (base deck only, no chained). */
function sp_mission_tiers() {
  $tiers = ['minor' => [], 'major' => [], 'critical' => []];
  foreach (sp_missions() as $key => $mm) {
    if (!empty($mm['chained'])) continue;
    $tiers[$mm['tier']][] = $key;
  }
  return $tiers;
}

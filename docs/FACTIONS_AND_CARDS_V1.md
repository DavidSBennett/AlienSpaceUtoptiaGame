# Factions & Card List — v1 Draft

> **Status: DRAFT v0.1, 2026-08-06.** Companion to `docs/SPACE_REDESIGN.md`.
> All names are proposals (swap freely); all numbers are first-pass tuning
> values modeled on Concordia's proportions and will move in playtesting.

---

## 1. The five alien factions

Retheme of Concordia's five goods. Each planet is aligned to one faction; a
treaty there yields that faction's resource. The **value index** mirrors
Concordia's goods prices (brick 3 → cloth 7) and sets trade rates and
building-cost asymmetries.

| # | Faction | Archetype | Resource | Value | Concordia analog |
|---|---|---|---|---|---|
| A | **Krath Combine** | Lithoid industrialists — slow, vast, everywhere. Their ore underpins every construction. | **Ore** | 3 | brick |
| B | **Verdani Symbiosis** | A planetary plant-mind and its cultivator species. Feeds half the sector. | **Biomass** | 4 | food |
| C | **Mekkari Assembly** | A machine collective that sells precision the organics can't match. | **Components** | 5 | tool |
| D | **Aurelian Court** | Decadent post-scarcity aesthetes. Their nectar is currency, sacrament, and status. | **Nectar** | 6 | wine |
| E | **Umbral Choir** | Reclusive psionics at the map's dark edge. Aether is bottled thought. | **Aether** | 7 | cloth |

Concordia cost echoes carried forward: a treaty on a Krath (ore) planet is
the cheap build (Concordia's brick-city discount); Umbral (aether) planets
are the expensive, prestigious ones. Faction personality can later flavor
mission difficulty modifiers per type (e.g. Mekkari resist diplomacy but
trade readily) — **not** in v1; v1 uses ring-based opposition only.

Faction UI colors: needs a 5-color set distinct from the 5 player seat
colors (`lib/playerColors.js`) — 10 distinguishable hues total, including
for color-blind players. Flag for the reskin pass.

---

## 2. Card anatomy recap (see spec §5/§9)

Every card: name (a **ship component**), action, three stats (Military /
Diplomacy / Trade, upper right), scoring affiliation, purchase cost
(market cards; in resources, Concordia-style — the market position may add
further resources per the position table).

Action types: `reset`, `move` (navigate + may attempt a treaty = Diplomacy
mission), `strike` (Military mission), `trade` (Trade mission), `produce`,
`deploy` (drones), `recruit` (buy up to 2 from display), `recruit_free`
(buy 1, ignore position costs), `copy`, `envoy_a`–`envoy_e`.

---

## 3. Starting hand (7 cards, identical per player)

Modeled on Concordia's opener (Tribune / Architect / Prefect ×2 / Mercator /
Diplomat / Senator) with **one deliberate deviation**: one of the two
produce cards is replaced by a strike card so all three tracks are
reachable from turn 1.

| Card | Action | M/D/T | Affiliation | Notes |
|---|---|---|---|---|
| **Maintenance Bay** | reset | 0/1/1 | wealth | Recover discard; may build a drone (pay resources). |
| **Astrogation Array** | move | 0/2/0 | diplomatic_corps | Move drones; may then attempt one treaty (Diplomacy mission). |
| **Extractor Rig** | produce | 0/1/1 | alliances | Choose a system: production for all treaty-holders, or take the credit levy. |
| **Railgun Battery** | strike | 2/0/0 | war_college | Military mission at a planet adjacent to your drone: seize its resource(s). |
| **Trade Terminal** | trade | 0/0/2 | trade_guild | Trade mission at an adjacent planet: exchange goods at its rates; +3 credits rider. |
| **Signal Decoder** | copy | 1/1/1 | diplomatic_corps | Execute the top card of another player's discard (not resets/copies). |
| **Shipyard Berth** | recruit | 0/1/1 | wealth | Buy up to 2 cards from the display. |

---

## 4. Market deck (30 cards, released in stages I–V)

Stage sizes 7/7/6/6/4, Concordia-like. Stats escalate by stage; mission
cards concentrate one stat, support cards spread. Costs are resources
(O=Ore, B=Biomass, C=Components, N=Nectar, A=Aether); display position may
add more.

### Stage I (7)
| Card | Action | M/D/T | Affiliation | Cost |
|---|---|---|---|---|
| Drone Bay | deploy | 1/0/1 | war_college | O |
| Extractor Rig Mk II | produce | 0/1/2 | alliances | O |
| Astrogation Array Mk II | move | 0/3/0 | diplomatic_corps | O,B |
| Trade Terminal Mk II | trade | 0/0/3 | trade_guild | B (rider: +5 credits) |
| Priority Requisition | recruit_free | 0/1/1 | wealth | ? (any one resource) |
| Krath Resonator | envoy_a | 1/0/1 | engineering | O |
| Verdani Cultivator | envoy_b | 0/1/1 | engineering | B |

### Stage II (7)
| Card | Action | M/D/T | Affiliation | Cost |
|---|---|---|---|---|
| Torpedo Rack | strike | 3/0/0 | war_college | C |
| Drone Bay Mk II | deploy | 1/1/1 | war_college | O,B |
| Extractor Rig Mk III | produce | 0/2/1 | alliances | B |
| Diplomatic Uplink | move | 0/3/1 | diplomatic_corps | B,C |
| Signal Decoder Mk II | copy | 1/2/1 | diplomatic_corps | C |
| Maintenance Bay Mk II | reset | 1/1/1 | wealth | B (reset + free drone build) |
| Mekkari Fabricator | envoy_c | 1/0/2 | engineering | C |

### Stage III (6)
| Card | Action | M/D/T | Affiliation | Cost |
|---|---|---|---|---|
| Point-Defense Lattice | strike | 4/0/0 | war_college | C,N |
| Trade Terminal Mk III | trade | 0/0/4 | trade_guild | N (rider: +5 credits) |
| Astrogation Array Mk III | move | 0/4/0 | diplomatic_corps | N |
| Extractor Rig Mk IV | produce | 1/2/1 | alliances | C |
| Shipyard Berth Mk II | recruit | 0/2/2 | wealth | N |
| Aurelian Salon | envoy_d | 0/2/1 | engineering | N |

### Stage IV (6)
| Card | Action | M/D/T | Affiliation | Cost |
|---|---|---|---|---|
| Torpedo Rack Mk II | strike | 4/1/0 | war_college | N,A |
| Drone Bay Mk III | deploy | 2/1/1 | war_college | C,N |
| Priority Requisition Mk II | recruit_free | 1/1/2 | wealth | ? ,? |
| Signal Decoder Mk III | copy | 2/2/2 | diplomatic_corps | A |
| Extractor Rig Mk V | produce | 1/3/1 | alliances | A |
| Umbral Conduit | envoy_e | 1/1/2 | engineering | A |

### Stage V (4)
| Card | Action | M/D/T | Affiliation | Cost |
|---|---|---|---|---|
| Dreadnought Spine | strike | 5/0/0 | war_college | A,A |
| Trade Nexus | trade | 0/0/5 | trade_guild | A,N (rider: +5 credits) |
| Flag Bridge | move | 0/5/0 | diplomatic_corps | A,N |
| Grand Extractor | produce | 2/2/2 | alliances | A,C |

---

## 5. Envoys (specialists)

One per faction, Concordia's Mason→Weaver ladder: play to produce that
faction's resource once **per treaty you hold** on that faction's planets.
All carry the **engineering** affiliation (Minerva analog — they also score
per ship upgrade at game end, per their printed rate).

| Envoy | Faction | Produces |
|---|---|---|
| Krath Resonator | Krath Combine | Ore per Krath treaty |
| Verdani Cultivator | Verdani Symbiosis | Biomass per Verdani treaty |
| Mekkari Fabricator | Mekkari Assembly | Components per Mekkari treaty |
| Aurelian Salon | Aurelian Court | Nectar per Aurelian treaty |
| Umbral Conduit | Umbral Choir | Aether per Umbral treaty |

---

## 6. Deliberate deviations from Concordia's card set

1. **Strike cards exist** (no Concordia analog) — Military missions need
   initiators. Balanced as the M-focused mirror of move/trade cards.
2. **A strike card replaces one starting produce card** so the Military
   track is reachable before the market opens.
3. **Every card has the M/D/T stat block** — even produce/recruit/envoy
   cards — so any card can be committed to boost a mission (spec §5).
4. **Affiliation spread is deliberately buildable**: war_college rides
   strikes + drone bays, diplomatic_corps rides move + copy, alliances rides
   produce, trade_guild rides trade, wealth rides recruit + reset,
   engineering rides envoys. Buying actions *is* buying your scoring lane.

## 7. Tuning surface (expected to move)

Stat magnitudes vs. ring opposition values (spec §10 sets rings; a stage-V
5-stat card should roughly solo an easy-ring planet, while hard-ring should
demand a mission card plus 2–3 committed cards), costs vs. faction value
index, rider sizes (credit grants), envoy placement per stage, market
position surcharge table.

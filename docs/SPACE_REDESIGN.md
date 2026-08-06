# Space Redesign — Working Design Spec

> **Status: DRAFT — v0.2, 2026-08-06.** This is the working spec for reframing the
> digital game around Concordia's engine, rethemed to space. It is the successor
> to the "Historians" ruleset. Where a decision is still open it is marked
> **[OPEN]**. Companion reading: `docs/HANDOFF.md` (codebase map — still accurate),
> Concordia rules PDF (mechanical baseline).
>
> **Decided 2026-08-06:** fixed-ring difficulty (§4) · commits recoverable + all
> owned cards score, pure Concordia (§5/§6) · PvE only, no direct PvP (§7) ·
> server-authoritative rules engine for both modes (§8) · scout intel is
> private (§4) · mission failure costs tempo only (§5) · every successful
> mission = +1 on its track (§5) · one drone type, one lane class; scouting is
> a drone capability, not a separate piece (§4) · tracks are tiered with
> breakthrough gates keyed to mission difficulty ring, **4 steps per tier**
> (§5) · reset keeps the build-a-drone rider (§3) · Diplomat-style copy card
> kept, functionally identical (§2) · intermediate scoring kept: personal
> score at each player's first reset, compared once all have reset (§3).
>
> **All original open questions are resolved.** Remaining items are numeric
> tuning only (§7).
>
> **IMPLEMENTED (v1 prototype, 2026-08-06)** as a parallel game mode
> coexisting with The Historians — see §11 for the file map and the manual
> deployment steps (DB migration must be run by hand).

---

## 1. Vision

Players captain starships exploring a shared star map. Concordia's engine is the
skeleton: your **hand of cards is your action menu** — play one card per turn,
it goes to your personal discard, and a **reset action** (Tribune analog) takes
everything back. You grow your capabilities by acquiring new cards, and the
cards you own are also your **end-game scoring multipliers**.

On top of that skeleton, three departures from Concordia:

1. **Opposed missions.** Every card carries three stats — **Military,
   Diplomacy, Trade** — in its upper right. Actions against the map are
   *missions* resolved by comparing your committed value against a hidden
   opposition value.
2. **Hidden, distance-scaled difficulty.** Players start in different corners
   of the map. Opposition values are hidden and grow with distance from your
   home space. Scout drones reveal a location's value before you commit.
3. **Three progression tracks** (Military / Diplomacy / Trade) that both gate
   progress and feed end-game scoring.

---

## 2. Concordia → Space mapping

| Concordia | Space retheme | Notes |
|---|---|---|
| Personality cards (hand = actions) | **Ship-component / crew cards** | Same engine: play one/turn, personal discard, reset recovers all. Cards double as end-game scorers. |
| Tribune (recover hand) | **Reset action** (e.g. "Refit" / "Regroup") | Keeps the Tribune rider: on reset you may also build a drone by paying resources (cost = tuning). |
| Colonists (land/sea) | **Drones** launched from the ship | One unit type (no land/sea split). Move along star-lanes; enable treaties in adjacent locations; can scout. |
| Scouts (new — no Concordia analog) | **Scouting** — a drone capability | A drone adjacent to a location reveals its hidden opposition value, privately. |
| Houses | **Treaties** with the local alien faction | Signed via a Diplomacy mission at a planet your drone is adjacent to. Escalating cost analog: opposition or cost rises with existing treaties there. |
| Cities | **Planets** | Each planet is aligned to one alien faction (= its "goods type"). |
| Provinces | **Star systems** | Group planets; Saturnus-analog scores systems where you hold treaties. |
| Land/sea routes | **Star-lanes** | One lane class (Concordia's land/sea split collapsed). |
| Goods (brick/food/tool/wine/cloth) | **Faction resources** — one per alien faction | Gained from combat / trade / diplomacy missions and from production. |
| Storehouse (12 spaces, shared with colonists) | **Cargo hold** | Same hard-capacity pressure: drones aboard ship occupy cargo space until launched. |
| Coins / sestertii | **Credits** | Universal currency. |
| Prefect (province production / cash) | **Production or levy action** targeting a system | All treaty-holders in the system benefit — keeps Concordia's "everyone profits" tension. |
| Mercator (cash + trade 2 goods) | **Trade mission / market action** | Fixed exchange rates on the cargo-hold "roof". |
| Architect (move + build) | **Navigation action** (move drones + sign treaties) | Signing a treaty is where the opposed Diplomacy check happens. |
| Senator / Consul (buy cards from display) | **Recruitment / salvage action** — acquire new ship components from a shared display | Deck-building loop unchanged. |
| Diplomat (copy top of another discard) | **Signal-intercept card** (name TBD) | Kept, functionally identical: execute the action of the card atop another player's discard (resets and other copy cards can't be copied). |
| Specialists (produce per matching house) | **Faction envoys** — produce per treaty with that faction | One per faction. |
| Praefectus Magnus | **Rotating boon token** (flagship honor?) | Doubles your production bonus, passes right. Keep as-is initially. |
| Gods (end-game scoring on cards) | **Six scoring affiliations** (§6) | Vesta→Wealth, Jupiter→Diplomatic track, Saturnus→Treaties, Mercurius→Trade track, Mars→Military track, Minerva→Ship upgrades. |
| Concordia card (+7 VP, triggers end) | **Endgame trophy card** | Same triggers: display emptied, or Nth treaty signed. |

**The five alien factions** replace the five goods *types*. Each planet is
aligned to exactly one faction; a treaty there yields that faction's
resource; the matching envoy card produces per treaty with that faction.
Names, personalities, resources, and the full v1 card list live in
`docs/FACTIONS_AND_CARDS_V1.md` (Krath/Ore, Verdani/Biomass,
Mekkari/Components, Aurelian/Nectar, Umbral/Aether — value ladder mirrors
brick→cloth).

---

## 3. Turn structure

Sequential clockwise turns, exactly Concordia:

1. On your turn, play **one** card from your hand and execute its action
   (optionally committing extra cards from hand if it's a mission — §5).
2. Played (and committed) cards go to your **personal discard**, top card visible.
3. The **reset action** returns your whole discard to your hand, and offers
   the Tribune rider: you may also **build a drone** by paying resources
   (cost = tuning; Concordia's was 1 food + 1 tool), placed at your home
   or any location where you hold a treaty.

**Intermediate scoring (kept, per Concordia):** the first time each player
resets, they immediately perform a personal intermediate scoring and record
their VP. Once **all** players have performed their first reset, the recorded
scores are compared: highest receives 2 credits, second receives 1 (ties — all
tied players receive the full amount), then all score markers return to zero.
Recommended as a first-game teaching aid; can be disabled per-game for
experienced tables.

No simultaneous phases, no barriers, no year clock. This *replaces* the current
game's simultaneous-commit year structure entirely.

---

## 4. The board

- A fixed star map per deck/scenario: **star systems** containing **planets**,
  connected by **star-lanes**. Each planet has a faction alignment and an
  **opposition value** (hidden until scouted or attempted).
- **Asymmetric starts:** each player begins in their own home region (their
  "starter space"), analogous to Roma but per-player. **Decided: fixed map
  rings.** Each home region is printed easy; opposition values rise ring by
  ring toward the contested core / far regions. One opposition value per
  location, same for every player — scout intel means the same thing to
  everyone. Map authoring must place home regions symmetrically enough that
  no start is ring-disadvantaged.
- **Drones** are the only mobile unit — **one type, one lane class**
  (Concordia's land/sea split is collapsed). They move along star-lanes
  (Architect-style movement pool: steps = number of your drones on the board,
  freely allocated; can't end on an occupied lane, may pass through).
- **Scouting is a drone capability**, not a separate piece: a drone adjacent
  to a location can reveal its hidden opposition value. **Intel is private** —
  revealed to the scouting player only; every other player must scout it
  themselves or attempt the mission blind. (Server stores reveal state
  per-player per-location.)

---

## 5. Missions — the opposed-check system

The signature new mechanic. Card anatomy: every card shows **three stats** in
the upper right — **Military / Diplomacy / Trade** — plus its action text and
its scoring affiliation.

Resolution flow when a played card initiates a mission (e.g. a Diplomacy
mission to sign a treaty):

1. **Base value** = the initiating card's stat of the mission's type.
2. **Commit:** the player may commit additional cards from hand, adding each
   card's matching stat to the total. **Decided:** committed cards go to the
   personal discard alongside the played card and are **recoverable on
   reset** — committing costs tempo (a thinner hand until you reset), not
   permanent points.
3. **Reveal** the location's opposition value (already known if you scouted it).
4. **Resolve:** total ≥ opposition → success (treaty signed / cargo seized /
   trade concluded, per mission type). **Failure costs tempo only:** the
   played and committed cards are in your discard and the turn is spent, but
   nothing else is lost — no drone recall, no resource penalty. This is an
   efficiency game: the punishment for a blind failed mission is the wasted
   action, which is exactly what scouting lets you avoid.

**Track advancement: every successful mission advances you +1 on its track**
(Military mission → Military track, etc.). Tracks are the Jupiter/Mercurius/
Mars scoring targets (§6), so mission wins compound into end-game
multiplicands.

**Tracks are tiered, with breakthrough gates.** Each track is divided into
levels (tiers) separated by gates. Wins from any mission advance you +1
*within* your current tier, but you cannot cross a gate into the next tier
until you succeed at a mission of that tier's minimum difficulty ring:
easy-ring wins carry you through the first tier only; breaking into the
middle tier requires a medium-ring success, and the top tier a hard-ring
success. This is the outward-pressure mechanism — home-ring grinding caps
out, and track scoring (worth per Jupiter/Mercurius/Mars card) makes deep
progress mean venturing deep into the map. **Decided: 4 steps per tier** —
three tiers of 4 (easy / medium / hard gated), 12 steps total per track.
Whether gates also grant milestone bonuses is tuning **[tuning — §7]**.

Design tension to preserve: committing cards drains your hand — future actions
AND (if scoring counts cards in hand — §6) your score. Push-your-luck against
hidden values, mitigated by scouting. This is the intended texture; tuning
must keep scouting worthwhile without making unscouted missions suicidal.

---

## 6. Scoring

End-game scoring is Concordia's: **each card you own scores via its
affiliation**, multiplied against what you built during the game.

| Affiliation (Concordia god) | Scores per card × … |
|---|---|
| **Wealth** (Vesta) | credits + cargo value (1 VP per 10, as Concordia — flat, not per-card, matching Vesta) |
| **Diplomatic Corps** (Jupiter) | your position on the **Diplomacy track** |
| **Alliances** (Saturnus) | number of alien factions / systems you hold treaties with |
| **Trade Guild** (Mercurius) | your position on the **Trade track** |
| **War College** (Mars) | your position on the **Military track** |
| **Engineering** (Minerva) | your **ship upgrades** (VP per upgrade, per the card's printed rate) |

**Decided: all owned cards score** (hand + discard), pure Concordia. Buying a
card from the display is therefore always buying both an action and a
permanent scoring multiplier; committing cards to missions never costs
end-game points, only tempo.

**Ship upgrades** (Minerva target) are the retheme of the current game's
stat-upgrade system — bought with resources/credits, granting in-game powers
(cargo capacity, drone count, movement, hand size…) and worth VP to
Engineering cards. This keeps a beloved existing subsystem and gives Minerva
teeth.

---

## 7. Open design questions

Resolved 2026-08-06: ~~difficulty scaling~~ (fixed rings, §4), ~~commit cost &
scoring base~~ (recoverable / all owned cards, §5–6), ~~PvP~~ (PvE only —
players compete Concordia-style for treaties, cards, and position; direct
attacks may be revisited post-v1), ~~rules home~~ (server-authoritative, §8),
~~scout intel~~ (private per-player, §4), ~~failure cost~~ (tempo only, §5),
~~track advancement~~ (+1 per successful mission, §5), ~~unit/lane types~~
(one drone type, one lane class, scouting is a drone capability, §4).

Also resolved 2026-08-06: ~~reset rider~~ (kept — reset may build a drone,
§3), ~~diplomat analog~~ (kept, functionally identical, §2), ~~intermediate
scoring~~ (kept — personal scoring at first reset, comparison + 2/1 credit
bonus once all have reset, §3), ~~track shape~~ (tiered with ring-keyed
gates, **4 steps per tier**, 12 steps per track, §5).

**All design questions are resolved.** Remaining items are numeric tuning,
to be set during implementation and playtesting:

- Drone build cost on reset (Concordia: 1 food + 1 tool).
- Opposition value ranges per ring (easy / medium / hard).
- Whether tier gates grant milestone bonuses (extra drone, cargo space,
  credits) beyond unlocking further advancement.
- Card stat ranges (M/D/T), card purchase costs, market display size.
- Cargo hold capacity, starting drones, starting hand composition.
- Game-end triggers (display emptied / Nth treaty) and trophy VP value.

---

## 8. Implementation mapping (current codebase)

### Survives largely intact
- Accounts/auth, invite codes, admin tooling, deck upload pipeline (card
  schema will change — new columns for the three stats, affiliation,
  faction), lobby/game creation, polling loop + `state_version`, chat,
  event log/toasts, leaderboards (new score semantics), playtest feedback.

### Replaced wholesale (rules layer)
- Year/phase engine (simultaneous commits, review barriers, conferences,
  citations, manuscripts) → sequential turn engine.
- `validateArgument`/prestige math → mission resolution + god-scoring.
- Career stages/awards → track progression + endgame scoring (award analogs
  can return later).

### Net-new systems
- **Board**: map data model, drone positions, lane adjacency, movement
  validation, treaty placement — no counterpart exists today.
- **Goods/cargo economy**: five resources + credits + capacity.
- **Hidden information**: per-location opposition values with per-player
  reveal state (fits the existing per-player state-masking discipline in
  `mp_getGameState.php`).
- **Card display/market** (Senator/Consul purchasing).
- **Three tracks** + ship-upgrade shop (retheme/extension of stat upgrades).

### Structural decision (decided 2026-08-06)
**Server-authoritative rules engine for both modes.** The new rules are NOT
mirrored into the existing three copies (solo hook ↔ frontend mp libs ↔ PHP).
One PHP engine owns all rules; solo mode becomes a 1-player server game
against the map (which also means solo requires a connection — acceptable).
The client keeps only presentation-level helpers (previews, validation hints)
that are advisory, never authoritative. Hidden information (unscouted
opposition values, opponents' hands) never leaves the server — this extends
the existing per-player masking discipline in `mp_getGameState.php`.

---

## 9. Card anatomy (v1 sketch)

```
┌─────────────────────────────┐
│ CARD NAME          M  D  T  │  ← three stats, upper right
│ [art]                       │
│ ACTION: what it does when   │
│         played              │
│ AFFILIATION: scoring house  │  ← Wealth/Diplomacy/Alliances/Trade/War/Engineering
│ (faction origin? cost?)     │
└─────────────────────────────┘
```

### Deferred variant — market-based Trade **[DEFERRED 2026-08-06]**

**Decision: the base spec stands** — Trade is a third opposed-mission type,
same resolution as Diplomacy/Military. The variant below is kept as a
documented future option (revisit after the opposed-mission core is proven
in playtesting).

Instead of Trade being a third opposed-mission type, Trade may become a
**market system**: a market action lets the player buy and sell goods at
planets, with prices/stock varying by planet or faction — functionally
different from the Diplomacy/Military opposed checks. Sketch if adopted:

- **Card stat:** the Trade stat becomes trading *capacity* (units movable in
  one market action), still boostable by committing cards — the commit
  mechanic is preserved, pushing volume rather than beating opposition.
- **Track advancement:** Trade track steps come from executing market
  actions; **tier gates break by trading at medium-/hard-ring planets**,
  preserving the outward-pressure design of §5.
- **Scouting:** for traders, scouts reveal a planet's **price/stock intel**
  instead of opposition — private intel stays universally valuable.
- **Data model impact:** planets gain price/stock columns; opposition values
  remain for Military/Diplomacy (and the single-opposition-value
  simplification in §10 becomes the default, since Trade no longer needs one).

Undecided — the base spec (Trade as opposed mission) stands until this is
adopted or rejected. Decision point: before the mission-resolution engine is
implemented.

### Card data model (deck spreadsheet / Cards table)

The upload pipeline parses by column letter (see HANDOFF §4.4); this is the
proposed new column map, replacing the Historians layout:

| Col | Field | Notes |
|---|---|---|
| A | `sequence` | Authoring order / print id. |
| B | `card_name` | Display name. |
| C | `card_kind` | `starter` \| `market` — starter cards form each player's opening hand; market cards go in the purchase display. |
| D | `deck_stage` | Market release stage (Concordia's decks I–V): `1`–`5`. Blank for starters. |
| E | `action_type` | `move` (Architect analog), `produce` (Prefect), `trade` (Mercator), `recruit` (Senator), `recruit_free` (Consul), `deploy` (Colonist), `copy` (Diplomat), `reset` (Tribune), `envoy_a`…`envoy_e` (specialists). |
| F | `stat_military` | Upper-right stat. |
| G | `stat_diplomacy` | Upper-right stat. |
| H | `stat_trade` | Upper-right stat. |
| I | `affiliation` | Scoring house: `wealth` \| `diplomatic_corps` \| `alliances` \| `trade_guild` \| `war_college` \| `engineering`. |
| J | `cost_credits` | Market purchase cost (credits component). |
| K | `cost_resources` | Resource component, e.g. `A,C` or `?` for free choice (Concordia's ?-slots come from the display position, not the card — see §10 note). |
| L | `action_text` | Rules text shown on card. |
| M | `flavor_text` | Lore. |
| N | `image_url` | Art. |
| O | `contributor` | Kept from current pipeline. |

Fields the engine derives (not authored): owner, zone (hand/discard/market
position), etc.

---

## 10. Star map data model

Maps are authored content, uploaded/managed like decks (admin pipeline), one
map per player-count band if needed. Proposed structure (JSON or spreadsheet
tabs — TBD at implementation):

- **`systems`** — id, name, ring (`0` home … `N` core). A system groups
  planets; Alliances scoring counts systems (and/or factions) where you hold
  ≥1 treaty.
- **`planets`** — id, system_id, name, `faction` (`A`–`E`), `ring`
  (inherits from system unless overridden), `opposition_military`,
  `opposition_diplomacy`, `opposition_trade` (hidden values; may be a single
  value per planet if missions of all types face the same number — start
  single, split later if tuning demands), `is_home_candidate` (bool).
- **`lanes`** — planet_id ↔ planet_id, undirected. One class. Lanes are the
  drone positions (Concordia: colonists sit *on* routes) — the engine tracks
  occupancy per lane.
- **`home_regions`** — one per seat: designated start planet + its ring-0
  neighborhood. Map authoring must keep home regions ring-symmetric (§4).
- **Market goods rows** (Concordia's beneath-display goods): the extra
  resource cost tied to display *position* rather than to the card. Keep as a
  fixed per-position table in the map/scenario config: position 1 = no extra,
  rising to the right, `?` = any resource.

Server tables (sketch): `maps`, `map_systems`, `map_planets`, `map_lanes` for
authored content; per-game state adds `game_drones` (player, lane), 
`game_treaties` (player, planet), `game_intel` (player, planet — private
scout reveals), `game_tracks` (player × 3 tracks: step, tier),
`game_cargo` (player, resource, qty), plus the card zones
(hand/discard/market display/stack) and credit balances.

---

## 11. Implementation map (v1 prototype)

Built 2026-08-06 as a **parallel mode** — no Historians code paths were
modified beyond two additive route/link edits. Everything is `sp_`-prefixed.

| Piece | Files |
|---|---|
| DB migration (run BY HAND, both installs) | `database/34_space_game_tables.sql` — `sp_games`, `sp_game_players`, `sp_event_log` (JSON-in-TEXT state; single-writer under `FOR UPDATE`) |
| Card catalog (content-as-code) | `backend/sp_cards_data.php` — 7 starters + 30 market cards in 5 stages |
| Star map (content-as-code, secret oppositions) | `backend/sp_map_data.php` — "Sector Umbra": 16 systems / 33 planets / rings 0–3, procedural geometry |
| Rules engine (single source of truth) | `backend/sp_engine.php` — setup, all 10 action types, missions + commits, tier-gated tracks, auto-scout intel, treaty costs, boon token, market, intermediate + final scoring, endgame triggers, masked state builder |
| Endpoints | `sp_createGame` (max_players 1 = solo, auto-starts), `sp_joinGame`, `sp_startGame`, `sp_getGameState`, `sp_playCard` (the one action endpoint), `sp_concede`, `sp_cancelGame`, `sp_listOpenGames`, `sp_listMyGames` |
| Frontend | `src/api/space.js`, `src/api/spSession.js`, `src/hooks/useSpaceGame.js` (1.5 s poll), `src/pages/SpaceLobby.jsx`, `src/pages/SpaceGame.jsx` (SVG star map, hand/commits, market, tracks w/ gates, cargo, action panel, results); routes `/space` + `/space/game/:id` in `App.jsx`; entry button on Home |

### v1 simplifications (deliberate, revisit later)
- Map + cards ship in code, not the DB/admin-upload pipeline (no deck picker;
  one map, one deck). Opposition values stay server-side by construction.
- One opposition value per planet (not per mission type).
- Recruit payment is auto-computed client-side ('?' costs spend the most
  abundant resource); server validates strictly.
- Scouting is passive: drones auto-reveal adjacent planets after any
  move/deploy (Deep Scanners upgrade extends to 2 lanes). Intel is private.
- No chat, tutorials, or leaderboard submission for the space mode yet.
- Visuals reuse the Victorian theme tokens — the space reskin is a later pass.

### Deploying this
1. Run `database/34_space_game_tables.sql` in phpMyAdmin (live + seed DBs).
2. Push to `main` → deploys to alienspace.thehistorians.org.
3. PHP could not be lint-checked locally (no PHP on the dev machine) — after
   first deploy, hit `/sp_listMyGames.php` signed-in and check for a clean
   JSON response before opening the lobby to players.

---

## 12. Mission model v2 (2026-08-06 — supersedes §5's opposed-mission design)

Playtest-driven simplification. Planets now carry TWO secret stats —
**military** and **political** (political always higher) — plus a PUBLIC
**production** value (2/3/4/5 by ring). Missions are single-turn
comparisons; there are no acquisition costs beyond tempo.

- **Conquer (strike card, any planet, no drone needed):** total = the
  card's Military stat + (its printed **commit power** × committed cards —
  commits are generic fuel, their own stats don't matter). Total ≥
  military ⇒ the planet is **occupied**: it produces a flat **1 good**.
  Fast, straightforward, weakest production.
- **Ally (diplomacy card — its own action now, any planet):** total = the
  card's Diplomacy stat + the summed **value of your drones at the
  planet** (no card commits). Total ≥ political ⇒ the planet is
  **allied**: it produces its **full production value**. Slower logistics,
  strongest production. Diplomacy also upgrades your own occupied planet
  to allied.
- **Drones** now sit ON planets and hop planet-to-planet (lane occupancy
  rules deleted). Drones have a VALUE (1–3) stamped by the deploy card
  that launched them (reset-built drones are value 1). Scouting reveals
  both stats of a drone's planet and its neighbors, privately.
- **Removed:** treaty resource/credit costs, the treaty rider on move
  cards, commit-stat matching, land-of-lanes drone placement,
  strike loot (conquest replaces raid-farming — income now flows from
  the produce action over controlled planets).
- Control is per-player and non-exclusive for now (several players can
  independently control one planet) — exclusivity is an open toggle.
- Trade is UNCHANGED mechanically (opposed vs the political stat,
  commits add their Trade stats) pending its own redesign pass.
- Tracks, tier gates, scoring, market, produce/levy/boon, reset, copy,
  endgame triggers all unchanged; the 10-treaty trigger now counts
  controlled planets.

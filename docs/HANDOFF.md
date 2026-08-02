# The Historians — Codebase Handoff

> **Purpose.** This document is the orientation file for any future working session
> (human or AI) that intends to make **major changes to the game's framework, theme,
> or structure**. It maps where everything lives, which numbers are duplicated where,
> which documents are stale, and what will silently break. Read this before touching
> anything; read the linked files before changing them.
>
> Written 2026-08-01 against commit `c3154af`. If the repo has moved far past that,
> re-verify the line numbers and constants below before trusting them.

---

## 1. What the game is

A browser-based educational card game about an academic historian's career. Players
draw **evidence cards** from a shared archive, assemble them under a **conclusion**
(thesis) card in a **project** workspace, and **publish** articles and books for
**prestige**. Two modes:

- **Solo** — a single-player career over 8/12/15 years (selectable), entirely
  client-side.
- **Multiplayer** — 2–5 players on a shared archive with synchronous phases:
  peer review of each other's manuscripts, conferences, citations, objection
  tokens, and end-of-game awards. Server-authoritative.

Core publish rule (both modes): an argument is valid iff it has a conclusion,
≥ 2 evidence cards (≥ 6 = book), and **every card shares at least one common tag**.
Prestige = evidence count + card bonuses + influence, **doubled** if all evidence
shares a context field (location / author / date / source_type / citation /
context_tags). Validity (tags) and doubling (context) are independent axes.

---

## 2. Repo layout and deploy

```
frontend/    React 18 + Vite 5 + Tailwind 3 SPA (~24,400 lines, 108 files). No TS, no tests, no lint.
backend/     66 flat PHP files — one file per endpoint, no framework, no router.
database/    35 hand-numbered SQL migrations, run MANUALLY in phpMyAdmin.
landing/     Static marketing site (index.html, rulebook.html page-turner, 2 PDFs). Separate subdomain.
docs/        RULES.md (stale — see §8), generated .docx handouts, this file.
scripts/     md_to_docx.py — converts RULES.md → RULES.docx (python-docx).
tools/docgen/  generate.js — emits the two class-handout .docx files (docx npm pkg).
.github/workflows/  deploy.yml (live) + deploy-seed.yml (seed subdomain).
the-historians-repo.zip   ~405 KB manual snapshot committed at root; nothing references it.
```

### Deploy pipeline (important: code auto-deploys, schema does NOT)

Push to `main` → GitHub Actions builds the frontend (`npm ci && npm run build`),
copies `frontend/dist/*` **and** `backend/*.php` flat into one `publish/` folder,
and rsyncs it over SSH to `public_html/thehistorians.org/` — **the SPA and the PHP
endpoints share one web root**, which is why API calls have no `/api` prefix in
production. rsync runs with no `--delete` and excludes the server-only files:
`config.secret.php`, `dbConfig.php`, `vendor/`, `uploads/`, `Images/`. After
upload it curls `_opcache_reset.php` (token hard-coded in the workflow) to flush
LiteSpeed's opcache.

`deploy-seed.yml` is the identical pipeline pointed at `seed.thehistorians.org`
with `VITE_SEED_MODE=1` — a second install with its **own database** and a
reproducible-shuffle-seed feature for experiments.

- **The README's FTPS/FTP-secrets section is stale** — the real deploy is SSH/rsync.
- **SQL migrations never auto-apply.** They are run by hand in phpMyAdmin, on TWO
  databases (live + seed). This is why many endpoints do `SHOW COLUMNS` /
  try-catch fallbacks for newer columns. `backend/admin_schemaCheck.php` (admin
  GET) introspects the DB and reports which migrations have landed — use it
  before and after any schema change.

---

## 3. Frontend architecture

### 3.1 Build and theme (the "Victorian binding" aesthetic)

The visual identity — a peacock-teal gilt-stamped antique book cover with
aged-cream paper cards on a wood worktable — lives in exactly **two files**, and a
reskin must change both:

1. **`frontend/tailwind.config.js`** — the tokens. Custom palettes `teal`
   (950 `#0c1f22` page ground → 500), `gold` (gilt), `cream` (paper), `oxblood`
   (danger), `verdigris` (success), `ink` (text on cream), `wood` (worktable);
   `fontFamily` display/serif/sans/mono → **Cormorant Garamond / Spectral /
   IBM Plex Sans / JetBrains Mono** (loaded via Google Fonts `<link>`s in
   `frontend/index.html`); custom shadows (`card`, `well`, `gilt`) and easing
   (`ease-desk`).
2. **`frontend/src/styles/index.css`** (305 lines) — the textures and component
   classes: `.surface-paper` / `.surface-well` / `.surface-binding` /
   `.surface-wood`, `.slot-impression`, `.rule-gilt`, `.divider-fleuron`,
   `.frame-gilt`, `.btn-primary`, `.btn-ghost`, `.tag`, plus WCAG-documented
   border utilities (`.border-edge-on-dark` / `-on-light`) with contrast ratios
   computed in comments.

The only ornament *components* are `CornerOrnament.jsx` (inline-SVG Victorian
corner cartouche) and `FleuronDivider.jsx`; everything else gilt is CSS classes.

⚠ **Load-bearing hack:** `:root { zoom: 0.9 }` in `index.css`. The boards are laid
out for browser-90%, and 250+ sizes are hard-coded px (`text-[10px]` etc.), so a
rem-based rescale is a large project, not a variable swap. This is the single
biggest obstacle to a responsive/layout rework.

⚠ Tailwind class strings must be **whole literals, never interpolated**
(documented in `AuthFrame.jsx`) — the scanner drops constructed class names.

Dev server: Vite on :5173 proxying `/api/*` → the live backend
(`vite.config.js`). Prod: same-origin, no prefix.

### 3.2 State: two incompatible architectures sharing one component set

- **Solo — `frontend/src/hooks/useGameState.js` (1,419 lines).** One pure
  `useReducer` state machine, entirely client-side; the server is only touched to
  load cards and submit the final score. Exports the canonical solo constants:
  `STAT_TABLES`, `PUBLISH_THRESHOLDS {articleMin:2, bookMin:6}`,
  `ARCHIVE_PILE_COUNT 4`, `CONFERENCE_CONTRIBUTIONS 2`, `TOTAL_YEARS 15`,
  starting hand 3. Invariant: the year advances **only** on Draw, Publish, and
  conference resolution; all card movement is free. Also contains the
  publication auto-titling system (`pickPublicationTitle`, word-overlap scoring
  against the conclusion's pipe-separated title pools).
- **Multiplayer — `frontend/src/hooks/useMultiplayerGame.js` (117 lines).** No
  local rules at all: a 1.5 s recursive-setTimeout **polling loop** around
  `mp_getGameState.php`, plus ~30 fire-and-forget POST endpoints
  (`frontend/src/api/multiplayer.js`). The server is fully authoritative
  (see §4.2). Deliberately no in-flight lock (StrictMode race, documented in
  the header); refetches immediately on tab refocus.

**The rules exist in three places** and comments say "keep in sync":
solo `useGameState.js` `STAT_TABLES` ↔ MP `frontend/src/lib/mpStats.js`
`MP_STAT_TABLES` ↔ PHP `backend/mp_resolveYear.php` tables. Plus
`lib/gameModes.js` ↔ `mp_createGame.php` (8/12/15), and `lib/cardBonus.js` ↔
`mp_bonus_at()` (citation-ladder parsing), and `lib/validation.js`
`computePrestigeMpPreview()` ↔ `mp_compute_prestige()`. **Any rules change must
touch every mirror.** This triplication is the #1 structural liability.

### 3.3 `src/lib/` — the logic modules that matter most

| File | Role |
|---|---|
| `validation.js` (375) | THE rules core: `validateArgument` (tag-intersection validity), `computePrestige` / `computePrestigeMpPreview` (scoring + context doubling via `findSharedContext`), `critiqueArgument` (pedagogical failure diagnosis used to write reviewer letters). |
| `tags.js` | Single source of truth for card tags (comma-separated `argument`+`sub_argument`). `buildTagToConclusionMap` exists so players **never see raw tag letters** — the UI says "the Political Frame of the War", not `'p'`. |
| `cardBonus.js` | `bonus` VARCHAR is `"3"` or a pipe-separated **citation ladder** `"3\|6\|10\|15"`; rung picked by citation count. |
| `career.js` | Stage keys/labels/narrative copy and `computeStage()` — see §6. |
| `awards.js` | The 4 end-of-game MP awards, computed client-side from polled state. |
| `mpStats.js` | MP mirror of the stat tables + `MP_BOOK_MIN`/`MP_ARTICLE_MIN`. |
| `gameModes.js` | short 8 / medium 12 / long 15; default long. |
| `playerColors.js` | Per-seat color kits (seat 0 gold, 1 verdigris, 2 oxblood, 3 periwinkle, 4 sage). |
| `seededRng.js`, `shuffle.js`, `seedMode.js` | Stateless-threaded mulberry32 RNG (reducer-safe) + seed-build gate. |
| `toasts.js`, `sounds.js` | Event-log→toast diffing + Web-Audio-synthesized SFX (no audio assets). |
| `publicationsPDF.js`, `playtestReport.js` | sessionStorage → new tab → browser Print-to-PDF (no PDF library). |
| **Dead/stale:** `tutorialStorage.js` (all no-ops, still imported by 2 pages), `upgradeCadence.js` (documents a removed 3-year upgrade drip but still powers an on-screen counter), `UpgradeChooserDialog.jsx` inline comments cite outdated stat values. |

### 3.4 Routing, pages, monoliths

`App.jsx`: flat routes. Gating pattern `<DesktopOnlyGate><RequireAuth>…` (gate
outside so mobile sees the notice, not a login form). `/tutorial` is desktop-only
but **not** auth-gated. `/` and `/multiplayer` both render `Home`. Admin routes
use `<RequireAuth admin>`.

**The five monoliths (≈28 % of the frontend):**

| File | Lines | Note |
|---|---|---|
| `pages/MultiplayerGame.jsx` | 2,334 | 14 inline sub-components; every action is an API call. |
| `pages/Game.jsx` | 1,550 | Solo board + the entire Guided Walkthrough driver. |
| `hooks/useGameState.js` | 1,419 | Solo rules engine. |
| `pages/Home.jsx` | 754 | Landing/deck picker/MP lobby/Your Games/embedded leaderboard. |
| `components/Card.jsx` | 753 | The biggest theme-carrying component: `CardThumbnail`, `ConclusionSpine`/`Tile`, `CardModal`. |

Extracting the shared board chrome out of `Game.jsx`/`MultiplayerGame.jsx` is the
highest-leverage refactor **before** any theme/framework change — both define
near-duplicate inline sub-components (`ConclusionSidebar`,
`PlaceInProjectButtons`, draw-focus panels…).

Shared board components used by BOTH modes with differently-shaped props:
`ProjectRow`, `Card`, `NotebookArea`, `StatsStrip`, `ArchiveMarket`,
`UpgradeBoard`, `EvidenceFan`, `ReviewSubmissionDialog`, `Bookshelf` variants.

### 3.5 API + auth layer (client side)

- **Two separate axios instances** (gotcha): `src/api/client.js`
  (`VITE_API_BASE` or `/api` dev proxy; attaches
  `Authorization: Bearer <localStorage['historians.sessionToken']>`) and
  `src/api/auth.js` (its own instance on `BASE_URL`). They agree only because
  prod is same-origin. Both carry duplicate `normalizeError` implementations
  reading the server's `{error: "..."}` envelope.
- `src/api/multiplayer.js` — 30 one-per-endpoint wrappers.
- `src/api/mpSession.js` — per-game MP identity in localStorage
  (`historians_mp_session_<gameId>` = player_token/seat); `listAllSessions()`
  drives Home's "Your Games".
- `src/auth/AuthContext.jsx` — `me()` on mount; `useAuth()` exposes
  `isSignedIn`/`isAdmin`/settings. Session = **bearer token in localStorage**,
  not a cookie (a few stale comments say "cookie" — ignore them).
- `src/auth/useUserSetting.js` — server-backed settings are **explicit columns**
  in `user_settings`, NOT a KV store: an unknown key optimistically "works"
  then silently reverts. Per-device prefs use `lib/useLocalToggle.js` instead.

---

## 4. Backend architecture

### 4.1 Conventions

- **One flat PHP file = one action**, deployed into the web root. Prefixes:
  `mp_*` (player_token + bearer), `users_*` (bearer), `admin_*` (bearer +
  `is_admin`), bare files public (`listCards`, `listDecks`, `publicScores`,
  `playtest_feedback_submit`, `verifySignificanceCode`).
- **`backend/mp_dbConfig.php` is the hub**: requires `config.secret.php`
  (server-only; template at `config.secret.example.php`), opens a global mysqli
  `$mysqli`, and defines the shared helpers: `mp_json()`, `mp_error()`
  (→ `{"error":"…"}` + HTTP status — this is the error contract the client
  reads), `mp_require_method`, `mp_read_json_body`, `mp_authenticate`,
  `mp_bump_state_version`, `mp_log_event`.
- **Second, legacy DB handle:** a PDO wrapper class `MyDatabase` lives in
  `dbConfig.php`, which is **server-only and NOT in the repo** — treat its
  interface (`query/execute/resultset/lastInsertId/beginTransaction/endTransaction`)
  as fixed. Only 5 content endpoints use it (`listCards`, `listDecks`,
  `admin_uploadDeck`, `admin_listDecks`, `admin_deleteDeck`). Unifying on one
  handle is an easy cleanup in any restructure.
- No PHP sessions anywhere. CORS `*` on exactly three public endpoints
  (`listCards`, `listDecks`, `publicScores`).
- Success bodies are **not** uniform: `{ok:true,…}` (most writes), bare domain
  object (`mp_getGameState`, `mp_createGame`), bare JSON array
  (`listCards`/`listDecks`).
- Many endpoints are deliberately **migration-tolerant** (try newer column,
  fall back) because code deploys automatically but SQL is manual.

### 4.2 The multiplayer engine — server-authoritative

**`backend/mp_resolveYear.php` (~2,900 lines, ~70 functions) is the rules
engine.** It is not an endpoint — it's a library `require_once`d by ~15
endpoints. Splitting it is the highest-leverage *and* riskiest backend refactor:
phase advancement, prestige math, conference drafting, title selection, and
reshuffling all share the game-row lock inside it.

Key mechanics (trust the code, NOT the file-header comments — see §8):

- **No cron/worker.** Every 1.5 s client poll of `mp_getGameState.php`
  opportunistically runs exactly ONE phase-appropriate advancer
  (`mp_maybe_resolve_year` / `mp_maybe_advance_review` /
  `mp_maybe_finish_conference` / `mp_maybe_finish_aftermath`) under
  `FOR UPDATE`.
- **`since_version` is accepted and deliberately ignored** — a short-circuit
  caused desync and was removed; full state is always returned.
  `state_version` is still bumped on every write and used client-side for
  change detection. Do not naively reintroduce the short-circuit.
- **Round loop:** phase `action` (everyone commits draw/publish/pass/
  attend_conference via `mp_commitAction.php`; **no timers — the game waits
  indefinitely** on absent players) → `draw` (4 face-up piles derived as
  `archive_position % 4`; turn order fewest-taken-then-seat, tiebroken by a
  **derived** first-historian token `crc32(shuffle_seed) % seats` rotated by
  year — no DB column) → `conference` → `review` (one manuscript at a time,
  barrier via `mp_review_progress`) → `mp_finish_round_tail()` (majority vote,
  **ties lean to revise**; year++, back to `action`).
- **Publish:** cards leave the project and **bind to the submission**. Approved →
  prestige (see formula in §1; citations excluded from doubling; influence
  counts evidence + citations; conclusion bonus is a ladder rung by citation
  count), evidence to discards, an `mp_published_works` row with
  `evidence_snapshot` JSON and `citation_value`. Rejected → writer reclaims via
  `mp_reclaimManuscript` + one-time `mp_drawConsolation`. Revise →
  `mp_resolveRevise` next year (accept / object / rebuild); canonical reviewer
  paid 5 prestige, accepting pays them `floor(prestige/3)` as contributor.
  **Objection** (`mp_spendObjection`): pure tag re-check; win = published +
  each rejecting reviewer −5 prestige.
- **Conference:** attendees stage project evidence into a shared pool, stock 2
  archive cards each, then draft up to what they contributed (order:
  reputation desc, renown desc, prestige asc). Citation tokens `[1,2,3,6]` by
  reputation; leftover pool cards become 0-prestige `kind='conference'`
  published works (citable by opponents).
- **Aftermath phase:** if the final year ends with a live revise-pending or
  contestable rejection, the game holds in `phase='aftermath'` until every
  writer resolves or signs off (`mp_aftermathReady`).
- **Information masking (hard constraint on refactors):** `mp_getGameState.php`
  is per-player. Opponents never receive card contents — only counts/levels.
  During review, non-writer reviewers get only
  `{idCard, title, author, argument, sub_argument}`.
- End-of-game: renown bonus (`citations_received_count × [1,2,3,5][renown-1]`)
  applied server-side; **awards computed client-side** in `lib/awards.js` from
  polled state.

### 4.3 Auth (server side)

DB-backed bearer tokens (`user_sessions`, 64-hex CSPRNG, 30-day TTL), read from
`Authorization` **or** `REDIRECT_HTTP_AUTHORIZATION` (cPanel strips the former).
bcrypt via `password_hash`. Login throttling (10 fails → 15-min lock) with a
dummy-verify against unknown usernames. **Registration is invite-code-gated**
(`user_invite_codes`, admin-minting via `/admin/invites`; `grants_admin` codes
exist; `bootstrap_admin_invite.sql` seeds the first). Email (verification,
reset) via PHPMailer/SMTP from server-only `vendor/`, falling back to `mail()`.
`users_helpers.php` holds all constants (TTLs, username pattern, alphabet…).

**Multiplayer double-auth:** `mp_authenticate()` validates the per-game
`player_token` AND, when the player row has a `user_id`, also requires a
matching bearer session.

### 4.4 Decks and cards

- Authored as **CSV/XLSX spreadsheets**, uploaded via `/admin/decks` →
  `admin_uploadDeck.php` (PhpSpreadsheet, server-only vendor/). Parsed **by
  column letter A–Y, not header names** (header row skipped):
  A sequence, B date, C source_type, D title, E content, F significance,
  G author, H location, I argument, J sub_argument, K bonus, L citation,
  M image_url, N contributor, O card_identifier (`archive`|`conclusion`),
  P description, Q article_titles, R book_titles, S context_tags,
  T–Y image front/back variants. `admin_downloadDeck.php` exports the same
  order from the DB (round-trips).
- Cards live in the DB (`Cards` table); the uploaded file is only an archive
  artifact in `uploads/decks/`. `listCards.php` does `SELECT *` so new columns
  flow to the client automatically; exposes the type flag as both
  `card_identifier` and legacy `type`.
- **No FK from `mp_*` tables to `Cards`** — they store bare idCard ints.
  Deleting a deck under a live game silently corrupts it; the only guard is
  application code in `admin_deleteDeck.php` (refuses unless `force`).
- **There is NO deck seed data in the repo.** The only committed card content
  is the tutorial deck (`frontend/src/lib/tutorialDeck.js`, American
  Revolution). Tutorial card images referenced under `/cardimages/tutorial/`
  are **not in the repo** (server-only `Images/`).
- Gates: tags reveal code lives in DB `Settings.tag_unlock_code`
  (`'marginalia'`); significance code is **hard-coded**
  `$SIGNIFICANCE_CODE = 'CHANGE_ME'` in `verifySignificanceCode.php` —
  inconsistent, worth fixing.

### 4.5 Scores — two leaderboards merged at read time

| What | Table | Written by |
|---|---|---|
| Solo | `user_scores` (per-user FK, `display_name` admin override) | `users_saveScore.php` (name from session, never body; **no game_mode column** — length inferred from `year_ended`) |
| Multiplayer | legacy `Scores` (name suffixed `" [MP]"`, `game_mode` column) | `mp_submitFinalScore.php` (idempotent via `mp_event_log` scan) |

Read: `users_listScores.php` (solo), `mp_listScores.php` (MP, shaped to match so
one `<Leaderboard>` renders both), and **`publicScores.php`** (no auth, CORS `*`)
which UNIONs both with deck/mode/length filters — this powers the landing page's
embedded scoreboard. `admin_editScoreName.php` renames per-entry or per-account.

---

## 5. Database schema (summary)

Migrations `database/01…33` + extras; numbering drifted (`11b` exists). Apply in
order; verify with `admin_schemaCheck.php`. Remember: TWO installs (live + seed).

- **Content:** `Decks`, `Cards` (see §4.4 for columns), `Settings` (KV),
  legacy `Scores` (now the MP leaderboard).
- **Accounts:** `users` (bcrypt, `is_admin`, throttle columns),
  `user_sessions` (bearer tokens), `password_reset_tokens`,
  `email_verification_tokens`, `user_settings` (**explicit columns**:
  `voip_enabled`, `notebook_collapsed`, `show_tags`, `tutorial_enabled`,
  `tutorials_dismissed` JSON, `games_dismissed` JSON), `user_invite_codes` +
  `user_invite_consumptions`, `user_scores`.
- **Multiplayer:** `mp_games` (status lobby/active/ended; **phase**
  action/draw/review/conference/aftermath; `review_index`, `total_years`,
  `shuffle_seed`, `state_version`; vestigial timer columns),
  **`mp_game_players`** (ALL per-player state as ordinary columns — stats,
  prestige, `pending_action`+`pending_action_data` JSON, `objection_tokens_remaining`
  default 4, `draws_remaining/taken`, `aftermath_ready`…), `mp_game_archive`
  (shuffled deck; cards *marked* drawn, never deleted; piles = position % 4),
  `mp_player_hands`, `mp_player_discards` (reshuffled into the **shared**
  archive on exhaustion), `mp_projects` (conclusion + `evidence_card_ids`
  ordered JSON), `mp_submissions` (manuscripts; status enum incl.
  objection-won/lost, revise-pending, reclaimed), `mp_reviews`
  (verdict approve/reject/revise + flagged/added card JSON),
  `mp_published_works` (the shelf; `evidence_snapshot` JSON,
  `citation_value`, kind article/book/**conference**), `mp_citations` (live
  project→work links, snapshotted at publish), `mp_citation_tokens`,
  `mp_pending_card_returns`, `mp_review_progress` (the review barrier),
  `mp_conference_pool` + `mp_conference_attendees`, `mp_chat_messages`,
  `mp_event_log` (toast feed AND idempotency ledger).
- **`playtest_feedback`** — anonymous by design (no user_id/FK): Likert ×7,
  free text ×3, self-reported outcome, raw `responses_json`. Submitted via
  bare axios with **no** auth header (deliberate, in `client.js`).

---

## 6. Theme vocabulary — where every themed concept is defined

**This is the section to consult for a re-theme.** Canonical definition files
first; the same words also appear in prose across tutorials, toasts, and docs.

| Concept | Authoritative file(s) |
|---|---|
| Career stages (keys, labels, narrative copy, thresholds) | `frontend/src/lib/career.js` — `RANK_ORDER`, `STAGE_LABELS`, `STAGE_NARRATIVE`, `computeStage()` |
| Stat display names (6 tracks) | THREE copies: `components/StatsStrip.jsx` (`STAT_LABELS`), `components/UpgradeChooserDialog.jsx` (solo dialog), `components/MultiplayerUpgradeChooser.jsx` |
| Award names + criteria | `frontend/src/lib/awards.js` (ids are stable keys — never rename ids, only display names) |
| Action names / how-to-play prose | `components/ActionsGuideModal.jsx` (`GUIDE.single` / `GUIDE.multiplayer`) |
| Game-length labels/blurbs | `frontend/src/lib/gameModes.js` |
| Goal-line prose | `components/GoalLine.jsx` (`computeGoal()`) |
| Promotion story modals ("Story" toggle) | `components/NarrativeModal.jsx` + `NarrativeToggle.jsx`, copy in `career.js` `STAGE_NARRATIVE`, localStorage toggle in `lib/narrativeSetting.js` (client-only, does not sync) |
| Toast flavor / eyebrows | `frontend/src/lib/toasts.js` |
| Tutorial copy | `lib/tutorials.jsx` (MP), `lib/soloTutorials.jsx` (solo), `lib/tutorialScript.jsx` + `lib/tutorialDeck.js` (guided walkthrough) |
| Playtest survey wording | `frontend/src/lib/playtestQuestions.js` |
| Visual identity | `frontend/tailwind.config.js` + `frontend/src/styles/index.css` (§3.1) |
| Landing copy + duplicated palette | `landing/index.html` (CSS vars re-declare the Tailwind palette) |
| Class handouts (assignment + how-to-play) | `tools/docgen/generate.js` — ALL prose hard-coded in JS; regenerate the .docx files after edits |
| Rulebook prose | `docs/RULES.md` (**historical** — see §8) → `scripts/md_to_docx.py` → `RULES.docx`; designed PDF `landing/The_Historians_rulebook.pdf` has **no source in the repo** |

### Career stages as implemented

`visiting-assistant-professor` (start) → 1 article `assistant-professor` →
1 book `associate-professor` → 4 books `full-professor` → 7 books
`endowed-professor`; plus `retired` and exit stages `failed-comps`,
`tenure-denied`, `conceded` (the first two are now dead paths — no deadlines
exist anymore). Legacy keys `recent-graduate`/`graduate-student`/`abd` survive
for old saves.

### Stat tracks — internal keys do NOT match display names (re-theme trap)

| Internal key (DB columns, PHP, stat tables) | Display name |
|---|---|
| `research` | Research Funding |
| `notebookCapacity` (`notebook_level` in DB) | Personal Archive |
| `influence` | Literary Agent |
| `workspaces` | Workspaces |
| `reputation` | Association Memberships |
| `renown` | Publicist |

The internal keys are wired into `mp_game_players` columns and both score
tables — renaming them is a schema migration, not a find-and-replace.

### Awards (4 in code; RULES.md wrongly lists 5)

| Stable id | Display name | Prestige | Criterion |
|---|---|---|---|
| `francis-perkins` | Francis Perkins Award | 15 | Biggest single publication |
| `lifetime-achievement` | Arnold J. Toynbee Award | 15 | Most publications |
| `pulitzer` | Michael Foucault Award | 10 | Most citations (≥1 pub) |
| `prodigy` | Alice Loxton Award | 10 | First book |

⚠ Latent bug: `awards.js` hard-codes `25 - earliestYear` for the prodigy
tiebreak, but games are now 8/12/15 years.

Other themed surfaces: "Hall of Scholars" (leaderboard — `Home.jsx`,
`LeaderboardPage.jsx`), "Collected Works" (`publicationsPDF.js` → `WorksPage.jsx`),
"First Historian" token (tooltip only, `MultiplayerGame.jsx` ~line 2192 — not in
RULES.md), significance notes, objection tokens, sound names in `lib/sounds.js`.

---

## 7. Tuning constants — the sync map

Every number below is duplicated; change ALL listed locations together.

| Constant | Value | Locations |
|---|---|---|
| Stat tables (research/notebook/influence/workspaces/reputation/renown) | `[3,5,7,'capacity']` / `[7,9,11,15]` / `[0,1,2,4]` / `[1,2,3,3]` (L4 = free publish) / `[1,2,3,6]` / `[1,2,3,5]` | `useGameState.js:33` · `lib/mpStats.js:12` · `mp_resolveYear.php:1175, 2049, 2865` |
| Article / book minimums | 2 / 6 | `useGameState.js:68` · `mpStats.js:28` · `mp_resolveYear.php:54` |
| Game lengths | short 8 / medium 12 / long 15 (default long; solo default 15) | `lib/gameModes.js:13` · `mp_createGame.php:57` (its line-21 comment still says 10/18/25 — stale) · `useGameState.js:105` |
| Archive piles | 4 | `useGameState.js:75` · `MP_ARCHIVE_PILES` in `mp_resolveYear.php` |
| Conference contributions per attendee | 2 | `useGameState.js:81` · `mp_resolveYear.php:729` |
| Stat max level | 4 (hard-coded clamps) | `useGameState.js:1098` · `validation.js:243` · PHP throughout |
| Revise-reviewer payment | 5 prestige (+ `floor(prestige/3)` contributor share on accept) | `mp_resolveYear.php` |
| Objection tokens per player | 4 | `database/13_token_economy.sql` (RULES.md says 2 to spend — cost is 2, stock is 4) |
| Starting hand | 3 | `useGameState.js:328` |
| Tutorial length | 12 years | `pages/Game.jsx:77` |
| Bonus/citation ladders, doubling fields | pipe-parsing + `[location, author, date, source_type, citation, context_tags]` | `lib/cardBonus.js` ↔ `mp_bonus_at()` · `validation.js:123` ↔ `mp_compute_prestige()` |

Also: tutorial copy hard-codes numbers in prose ("6 or more evidence cards",
"4 → Full Professor, 7 → Endowed") — none read from the constants.

---

## 8. Documentation drift — what NOT to trust

**`docs/RULES.md` is historical, not authoritative.** It (and several in-code
comments) describes a previous economy:

| Topic | RULES.md / old comments say | Code actually does |
|---|---|---|
| Solo length | 25 years | 15 (8/12/15 selectable) |
| MP lengths | 10/18/25 | 8/12/15 |
| Career | Grad Student → Comps (yr 5) → ABD → tenure denial (yr 12) | Starts at Visiting Asst Prof; NO deadlines; promotion purely by pub counts |
| Upgrades | "every third year" drip | Only on successful publish + conference attendance (`upgradeCadence.js` is dead code) |
| Awards | 5, old names | 4, renamed (Toynbee/Foucault/Loxton) |
| Solo Reputation | lowers publish thresholds | thresholds fixed; Reputation = conference tokens |
| MP timers/ghosting | timers, auto-pass, ghost after 3 timeouts | ALL removed — games wait indefinitely; `timer_*` columns vestigial |
| Review | a year-costing action | its own synchronous phase |

Header comments in `mp_resolveYear.php` and `01_create_mp_tables.sql` repeat the
stale timer/25-year story. The **most current prose** is actually
`tools/docgen/generate.js` (still wrong about "every third year"). The README's
deploy section (FTPS) is stale too (§2).

---

## 9. Tutorial system — fragility map

Three independent systems (plus the dead `tutorialStorage.js` shim):

1. **Contextual hints** — `lib/tutorials.jsx` (MP) / `lib/soloTutorials.jsx`
   (solo); entries `{id, order, title, body, targetAttr, condition(state)}`;
   driver `TutorialManager.jsx` → `TutorialModal.jsx`; dismissals persisted
   per-account in `user_settings.tutorials_dismissed` keyed by **id**.
2. **Guided Walkthrough** (`/tutorial`) — `lib/tutorialScript.jsx` (15 steps
   with `allow`/`mask`/`target`/`dragGroup`/`done(state, snapshot)`) +
   `lib/tutorialDeck.js` (fixed American Revolution deck, dealt unshuffled) +
   `TutorialCoach.jsx` (spotlight; **fails open** if the target is missing) +
   driver code inside `pages/Game.jsx`.
3. **Static reference** — `ActionsGuideModal.jsx`.

What breaks under change, silently:

- Restructuring components breaks `data-tutorial="…"` anchors (`draw-zone`,
  `project-area`, `conclusion-rail`, `publish-button`, `conference-button`,
  `significance-toggle`, `manuscript-inbox`, `history-button`) — the coach
  fails open, so **breakage is invisible**, not loud.
- Renaming state fields breaks the `condition`/`done` predicates
  (they read `articlesPublished`, `pendingUpgrades`, `state.you`, etc.).
- **Never rename/reuse tutorial ids** — they are persisted dismissal keys; a
  rename re-fires every hint for every existing account.
- A re-theme must rewrite `tutorialDeck.js` wholesale, keep `dragGroup`
  values paired between deck and script, and re-author the fake peer-review
  manuscript (`TUTORIAL_REVIEW_SUBMISSION` — its teaching point is one card
  missing the Economic tag).

---

## 10. Landing site and generated documents

- **`landing/index.html`** — self-contained (no build): CSS vars duplicating the
  palette, `html { font-size: clamp(...) }` viewport-fit trick, hero + three
  YouTube embeds (ids hard-coded), buttons to game/tutorial/sell-sheet/rulebook,
  and the **embedded scoreboard IIFE** (lines ~434–562) fetching
  `listDecks.php` + `publicScores.php` cross-subdomain with deck/Format/Length
  toggles and conditional columns. Recent git history is mostly this scoreboard.
- **`landing/rulebook.html`** — a PDF.js page-turn reader over
  `The_Historians_rulebook.pdf` (~73 pp, 7.4 MB); by design the displayed rules
  and the downloadable file are the same document.
- **`landing/apex-redirect.html`** — meta-refresh `thehistorians.org` →
  `sellsheet.thehistorians.org`.
- The two PDFs (rulebook, sell sheet — the latter duplicated in
  `frontend/public/`) are **binary drops with no source in the repo**; a
  re-theme must re-author them externally.
- Generated docs: edit `tools/docgen/generate.js` then re-run (`node`) for the
  two class handouts; edit `docs/RULES.md` then run
  `python scripts/md_to_docx.py docs/RULES.md docs/RULES.docx`.

---

## 11. Known warts / hard-coded secrets / loose ends

- OPcache reset token hard-coded in both workflows and `_opcache_reset.php`.
- `$SIGNIFICANCE_CODE = 'CHANGE_ME'` in `verifySignificanceCode.php` (the tags
  code, by contrast, is DB-driven).
- `favicon.svg` referenced by `frontend/index.html` but missing from `public/`.
- `the-historians-repo.zip` at root: unreferenced ~405 KB snapshot; confirm
  redundant before deleting.
- No tests, no linter, no type system anywhere — nothing catches regressions
  during a big refactor. Consider adding at least a smoke harness first.
- Accessibility work is deliberate (WCAG contrast math in CSS comments,
  skip link, semantic print pages for tagged PDFs) — carry it forward
  intentionally in any reskin.
- Legacy MP guest rows: `mp_game_players.user_id` is nullable.

---

## 12. Checklists

### A. Cosmetic re-theme (new subject/skin, same mechanics)

1. `tailwind.config.js` + `src/styles/index.css` (both, together) + Google Font
   links in `frontend/index.html`; `CornerOrnament.jsx` / `FleuronDivider.jsx`.
2. `lib/career.js` (stages + narrative), `lib/awards.js` (names only, keep ids),
   the THREE stat-name copies (§6), `ActionsGuideModal.jsx`, `GoalLine.jsx`,
   `lib/toasts.js`, `lib/playtestQuestions.js`, `lib/gameModes.js` blurbs.
3. `lib/tutorials.jsx` / `soloTutorials.jsx` copy — **do not touch ids**.
4. `lib/tutorialDeck.js` + `tutorialScript.jsx` — full content rewrite as a
   matched pair (see §9).
5. `landing/index.html` (copy + duplicated palette), `tools/docgen/generate.js`
   (+ regenerate .docx), `docs/RULES.md` (+ regenerate RULES.docx), re-author
   the two PDFs externally.
6. Author new decks (spreadsheets, §4.4 column map) and upload via
   `/admin/decks`; remember tutorial card images live server-side in `Images/`.

### B. Framework/structure change (rules, phases, state shape)

1. Read §3.2's triplication map — plan every mirror touch up front
   (`useGameState.js` ↔ `mpStats.js`/`validation.js`/`gameModes.js`/`cardBonus.js`
   ↔ `mp_resolveYear.php`/`mp_createGame.php`).
2. Any schema change: write a numbered migration, apply by hand to BOTH DBs,
   verify with `admin_schemaCheck.php`; keep endpoints migration-tolerant
   during the rollout window (code deploys before SQL is applied).
3. Preserve the information-masking contract in `mp_getGameState.php` (§4.2)
   and the full-state-every-poll decision.
4. Check every `data-tutorial` anchor and tutorial predicate after moving
   components (§9 — breakage is silent).
5. Watch the dead-but-referenced modules: `upgradeCadence.js`,
   `tutorialStorage.js`, vestigial timer columns, legacy `type` card field.
6. If touching layout: budget for the `:root { zoom: 0.9 }` + hard-coded-px
   situation (§3.1) before promising responsive anything.
7. Update `docs/RULES.md` and `tools/docgen/generate.js` afterward — they are
   already drifted; don't widen the gap.

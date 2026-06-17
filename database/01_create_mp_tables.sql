-- =============================================================================
-- The Historians — Multiplayer Schema (Phase A)
-- =============================================================================
--
-- Run this in phpMyAdmin against the existing historians database. Tables are
-- prefixed `mp_` to keep them clearly separate from single-player tables
-- (Cards, Decks, Conclusions, Scores).
--
-- Forward-compatibility: columns for Phase B features (renown, citations,
-- cross-citation, objections, awards) are included from day 1, defaulted to
-- 0/NULL/'pending' so Phase A code can ignore them. This means we don't have
-- to ALTER tables later — Phase B just starts populating fields that already
-- exist.
--
-- All foreign keys reference idCard / idDeck from the existing schema so
-- cards stay the single source of truth.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- mp_games — one row per game session
-- -----------------------------------------------------------------------------
-- A game progresses through three statuses:
--   'lobby'  — host has created, players are joining; no actions yet
--   'active' — host has started; current_year advances based on commitments
--   'ended'  — year 25 reached or all players ghosted; final scores frozen
--
-- shuffle_seed: not strictly needed since GameArchive stores the order, but
-- kept for diagnostic purposes (lets us reconstruct what the seed was if we
-- ever need to investigate a weird game).
--
-- year_started_at: timestamp of when the current year began. Used by the
-- server-side timer to detect timeouts. Updated every year-advance.
--
-- timer_seconds_default / timer_seconds_review: per-game timer settings. We
-- hard-code these for now at 60/120 (per design), but storing them per-game
-- means we can later make them configurable per host.
CREATE TABLE IF NOT EXISTS mp_games (
  game_id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  idDeck           INT UNSIGNED NOT NULL,
  status           ENUM('lobby','active','ended') NOT NULL DEFAULT 'lobby',
  current_year     SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  host_player_id   INT UNSIGNED DEFAULT NULL,
  max_players      TINYINT UNSIGNED NOT NULL DEFAULT 5,
  shuffle_seed     VARCHAR(32) DEFAULT NULL,

  year_started_at  DATETIME DEFAULT NULL,
  timer_seconds_default TINYINT UNSIGNED NOT NULL DEFAULT 60,
  timer_seconds_review  TINYINT UNSIGNED NOT NULL DEFAULT 120,

  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at         DATETIME DEFAULT NULL,

  -- state_version bumps on every game-state-affecting write. Clients poll
  -- with their last-known version; server returns 304-equivalent if unchanged.
  -- This is what makes 3-second polling cheap on shared hosting.
  state_version    INT UNSIGNED NOT NULL DEFAULT 1,

  PRIMARY KEY (game_id),
  KEY idx_status (status),
  KEY idx_deck   (idDeck)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- -----------------------------------------------------------------------------
-- mp_game_players — one row per player per game
-- -----------------------------------------------------------------------------
-- seat_index (0..4) establishes a stable display order for opponent panels.
-- Assigned at join time, never changes.
--
-- player_token is a random secret returned to the client on join. Every API
-- call includes it; server uses it to identify "you" without sessions/login.
-- 32 hex chars = 128 bits of entropy, more than enough.
--
-- is_ghost flips to 1 after 3 consecutive timeouts. Ghosts auto-pass every
-- subsequent year. They still count toward final scoring.
--
-- pending_action / pending_action_data hold what the player has selected for
-- the current year, before all players commit. Resolved at year-end into
-- actual state changes. NULL = haven't selected yet.
--
-- Stat levels mirror the single-player schema; stored as individual columns
-- (rather than a JSON blob) so queries can filter/index on them cheaply.
-- renown_level is Phase B but the column exists from day 1.
--
-- citations_received_count is Phase B (cross-citation rewards); column lives
-- here so we can increment it without a schema change.
--
-- objection_tokens_remaining is Phase B; starts at 2 per career.
CREATE TABLE IF NOT EXISTS mp_game_players (
  player_id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_id          INT UNSIGNED NOT NULL,
  player_name      VARCHAR(50) NOT NULL,
  seat_index       TINYINT UNSIGNED NOT NULL,
  player_token     VARCHAR(64) NOT NULL,

  joined_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_ghost         TINYINT(1) NOT NULL DEFAULT 0,
  consecutive_timeouts TINYINT UNSIGNED NOT NULL DEFAULT 0,

  -- Player state
  prestige             INT NOT NULL DEFAULT 0,
  articles_published   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  books_published      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  stage                VARCHAR(32) NOT NULL DEFAULT 'graduate-student',
  comps_event_fired    TINYINT(1) NOT NULL DEFAULT 0,
  game_over_reason     VARCHAR(32) DEFAULT NULL,

  -- Stat levels (1..4); reputation is the existing 5th single-player stat,
  -- renown is the Phase B citation-multiplier stat (1/2/3/6 progression).
  research_level      TINYINT UNSIGNED NOT NULL DEFAULT 1,
  notebook_level      TINYINT UNSIGNED NOT NULL DEFAULT 1,
  influence_level     TINYINT UNSIGNED NOT NULL DEFAULT 1,
  workspaces_level    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  reputation_level    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  renown_level        TINYINT UNSIGNED NOT NULL DEFAULT 1,

  -- Phase B fields
  citations_received_count    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  objection_tokens_remaining  TINYINT UNSIGNED NOT NULL DEFAULT 2,

  -- Current-year action commitment.
  --   pending_action: NULL | 'draw' | 'publish' | 'review' | 'pass'
  --   pending_action_data: JSON details depending on action
  --     draw    → null (no extra data needed)
  --     publish → { projectId, conclusionId, evidenceIds[], argumentText }
  --     review  → { submissionId }  (verdict comes later via mp_submit_review.php)
  --     pass    → null
  --
  -- pending_action_committed flips to 1 when the player clicks "End Year".
  -- Until then, the action is tentative — they can change their mind.
  pending_action       VARCHAR(16) DEFAULT NULL,
  pending_action_data  TEXT DEFAULT NULL,
  pending_action_committed TINYINT(1) NOT NULL DEFAULT 0,

  -- Pending upgrade — set to 1 when this player earned an upgrade choice
  -- (writer successful publication, OR reviewer rejection bonus, OR
  -- reviewer-approve free upgrade). Cleared when they pick a stat.
  pending_upgrade      TINYINT(1) NOT NULL DEFAULT 0,
  pending_upgrade_reason VARCHAR(32) DEFAULT NULL,  -- 'publish' | 'review-approve' | 'review-reject'

  PRIMARY KEY (player_id),
  UNIQUE KEY uniq_token (player_token),
  UNIQUE KEY uniq_game_seat (game_id, seat_index),
  KEY idx_game (game_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- -----------------------------------------------------------------------------
-- mp_game_archive — server-side shuffled deck order
-- -----------------------------------------------------------------------------
-- Filled once at game start by mp_startGame.php. Cards are removed (or marked
-- drawn) as players draw; when the deck empties, the discard pile is
-- reshuffled in (mirrors the single-player reshuffle behavior).
--
-- For Phase A simplicity, we DON'T remove rows on draw — we just mark them
-- drawn and track which player took them. When the entire archive is drawn
-- (no rows with drawn_by_player_id IS NULL), the discard pile gets reshuffled
-- back in by resetting drawn_by_player_id and assigning new positions.
--
-- archive_position is the authoritative draw order. Lower = drawn first.
-- After a reshuffle, archive_position values are reassigned (gaps allowed).
CREATE TABLE IF NOT EXISTS mp_game_archive (
  game_id              INT UNSIGNED NOT NULL,
  idCard               INT UNSIGNED NOT NULL,
  archive_position     INT UNSIGNED NOT NULL,
  drawn_by_player_id   INT UNSIGNED DEFAULT NULL,
  drawn_year           SMALLINT UNSIGNED DEFAULT NULL,

  PRIMARY KEY (game_id, idCard),
  KEY idx_position (game_id, archive_position),
  KEY idx_drawn (game_id, drawn_by_player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- -----------------------------------------------------------------------------
-- mp_player_hands — cards currently in each player's notebook
-- -----------------------------------------------------------------------------
-- One row per (player, card) pair. Cards move into hand on draw, move out
-- when placed into a project (-> mp_projects) or published.
--
-- We don't enforce capacity at the DB level — that's a client-side / endpoint
-- check using the player's notebook_level. The DB just records the truth.
CREATE TABLE IF NOT EXISTS mp_player_hands (
  player_id   INT UNSIGNED NOT NULL,
  idCard      INT UNSIGNED NOT NULL,
  added_year  SMALLINT UNSIGNED NOT NULL,

  PRIMARY KEY (player_id, idCard)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- -----------------------------------------------------------------------------
-- mp_player_discards — cards spent by each player
-- -----------------------------------------------------------------------------
-- Discard pile per player (cards consumed by successful publications).
-- When the shared archive empties, all players' discards reshuffle BACK INTO
-- the shared archive — this mirrors single-player behavior where the
-- discard becomes the new deck.
--
-- This is a meaningful change from the single-player model: in MP, no card
-- is "lost" to one player. All discards return to the shared pool. This is
-- the right behavior because otherwise late-game would starve players who
-- happened to publish more.
CREATE TABLE IF NOT EXISTS mp_player_discards (
  player_id      INT UNSIGNED NOT NULL,
  idCard         INT UNSIGNED NOT NULL,
  discarded_year SMALLINT UNSIGNED NOT NULL,

  PRIMARY KEY (player_id, idCard)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- -----------------------------------------------------------------------------
-- mp_projects — workspace slots holding draft arguments
-- -----------------------------------------------------------------------------
-- Each player has 3 project slots (slot_index 0..2). A project holds a
-- conclusion card and zero-or-more evidence cards, just like single-player.
-- Cards placed here are NOT in the hand (mp_player_hands) — moving a card
-- into a project removes it from the hand.
--
-- evidence_card_ids stored as JSON array of integers. Order matters (it's
-- the sequence the writer arranges; reviewer sees them in this order).
CREATE TABLE IF NOT EXISTS mp_projects (
  player_id            INT UNSIGNED NOT NULL,
  slot_index           TINYINT UNSIGNED NOT NULL,
  conclusion_card_id   INT UNSIGNED DEFAULT NULL,
  evidence_card_ids    TEXT DEFAULT NULL,   -- JSON array of idCards in order

  PRIMARY KEY (player_id, slot_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- -----------------------------------------------------------------------------
-- mp_submissions — publications awaiting review
-- -----------------------------------------------------------------------------
-- When a player commits a 'publish' action and the year advances, a
-- submission is created here. Status flows:
--   'pending'        — submitted, not yet reviewed
--   'approved'       — at least one reviewer approved
--   'rejected'       — all volunteered reviewers rejected
--   'auto-approved'  — Phase B: 3 years unreviewed → tag algorithm passed
--   'auto-rejected'  — Phase B: 3 years unreviewed → tag algorithm failed
--   'objection-won'  — Phase B: writer objected and won
--   'objection-lost' — Phase B: writer objected and lost
--
-- The argument_text is the player's prose (max ~2000 chars). Stored verbatim.
--
-- evidence_card_ids is a JSON array — same ordering the writer chose. The
-- reviewer sees them in this order.
--
-- writer_seen_result flips to 1 when the writer has seen the verdict and
-- collected rewards (or feedback). Until then, the submission shows up
-- in the writer's "pending result" feed at the start of their next year.
CREATE TABLE IF NOT EXISTS mp_submissions (
  submission_id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_id              INT UNSIGNED NOT NULL,
  writer_player_id     INT UNSIGNED NOT NULL,
  year_submitted       SMALLINT UNSIGNED NOT NULL,
  conclusion_card_id   INT UNSIGNED NOT NULL,
  evidence_card_ids    TEXT NOT NULL,        -- JSON array, ordered
  argument_text        TEXT NOT NULL,
  kind                 ENUM('article','book') NOT NULL,

  status               ENUM(
    'pending','approved','rejected',
    'auto-approved','auto-rejected',
    'objection-won','objection-lost'
  ) NOT NULL DEFAULT 'pending',
  resolved_year        SMALLINT UNSIGNED DEFAULT NULL,
  writer_seen_result   TINYINT(1) NOT NULL DEFAULT 0,

  -- For published works (status approved / auto-approved / objection-won):
  -- prestige granted to the writer. Stored so we can show it in the
  -- Published Library and compute end-of-game totals.
  prestige_granted     INT DEFAULT NULL,
  publication_title    VARCHAR(255) DEFAULT NULL,   -- picked from conclusion's title pool

  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (submission_id),
  KEY idx_game_status (game_id, status),
  KEY idx_writer (writer_player_id),
  KEY idx_resolved (game_id, resolved_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- -----------------------------------------------------------------------------
-- mp_reviews — one row per reviewer's verdict per submission
-- -----------------------------------------------------------------------------
-- A submission can have multiple reviews (multiple volunteers per article).
-- Only one needs to be 'approve' for the submission to succeed.
--
-- flagged_card_ids: JSON array of idCard ints. On reject, must contain ≥ 1.
-- On approve, can be NULL (no need to flag anything).
--
-- comment: optional one-sentence comment (max ~500 chars). Currently shown
-- to the writer along with the verdict.
CREATE TABLE IF NOT EXISTS mp_reviews (
  review_id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  submission_id      INT UNSIGNED NOT NULL,
  reviewer_player_id INT UNSIGNED NOT NULL,
  verdict            ENUM('approve','reject') NOT NULL,
  flagged_card_ids   TEXT DEFAULT NULL,    -- JSON array, required on reject
  comment            TEXT DEFAULT NULL,
  reviewed_year      SMALLINT UNSIGNED NOT NULL,
  reviewed_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (review_id),
  UNIQUE KEY uniq_submission_reviewer (submission_id, reviewer_player_id),
  KEY idx_submission (submission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- -----------------------------------------------------------------------------
-- mp_published_works — denormalized library of approved publications
-- -----------------------------------------------------------------------------
-- A row is INSERTed here when a submission resolves to approved /
-- auto-approved / objection-won. Phase A populates the row; Phase B uses it
-- for cross-citation.
--
-- Snapshotting evidence titles & tags here (rather than joining to mp_submissions
-- + Cards every time) keeps the Published Library panel fast. The evidence
-- cards themselves return to the discard pile, but the snapshot persists for
-- the rest of the game.
--
-- evidence_count + conclusion_tag are denormalized to make Phase B's
-- cross-citation math trivial (cite-points = floor(evidence_count / 2),
-- contributes the conclusion_tag to the citing writer's tag pool).
CREATE TABLE IF NOT EXISTS mp_published_works (
  work_id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_id              INT UNSIGNED NOT NULL,
  submission_id        INT UNSIGNED NOT NULL,
  writer_player_id     INT UNSIGNED NOT NULL,
  publication_title    VARCHAR(255) NOT NULL,
  conclusion_card_id   INT UNSIGNED NOT NULL,
  conclusion_tag       VARCHAR(16) NOT NULL,
  kind                 ENUM('article','book') NOT NULL,
  evidence_count       SMALLINT UNSIGNED NOT NULL,
  evidence_snapshot    TEXT NOT NULL,   -- JSON: [{title, author, tags}, ...]
  prestige_granted     INT NOT NULL,
  year_published       SMALLINT UNSIGNED NOT NULL,

  PRIMARY KEY (work_id),
  UNIQUE KEY uniq_submission (submission_id),
  KEY idx_game (game_id),
  KEY idx_writer (writer_player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- -----------------------------------------------------------------------------
-- mp_citation_tokens — Phase B: tokens earned by reviewers
-- -----------------------------------------------------------------------------
-- Created at the same time as mp_published_works rows, one row per token
-- granted. Each token is tied to a specific tag (the conclusion tag of the
-- work the reviewer approved). Tokens are spent in future publications.
--
-- This table is included in Phase A schema for forward compatibility but
-- is not populated by Phase A code. Phase B inserts rows on approval and
-- deletes them on use.
CREATE TABLE IF NOT EXISTS mp_citation_tokens (
  token_id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_id             INT UNSIGNED NOT NULL,
  owner_player_id     INT UNSIGNED NOT NULL,
  source_work_id      INT UNSIGNED NOT NULL,
  tag                 VARCHAR(16) NOT NULL,
  earned_year         SMALLINT UNSIGNED NOT NULL,
  spent_on_submission INT UNSIGNED DEFAULT NULL,   -- NULL until spent

  PRIMARY KEY (token_id),
  KEY idx_owner_unspent (owner_player_id, spent_on_submission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- -----------------------------------------------------------------------------
-- mp_chat_log — optional informational log for debugging / playtesting
-- -----------------------------------------------------------------------------
-- Each significant event (player joined, year advanced, submission published,
-- review submitted, etc.) writes a row here. Useful for post-mortem
-- investigation when something feels off. Not required for game logic.
CREATE TABLE IF NOT EXISTS mp_event_log (
  event_id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_id        INT UNSIGNED NOT NULL,
  player_id      INT UNSIGNED DEFAULT NULL,
  event_type     VARCHAR(32) NOT NULL,
  event_data     TEXT DEFAULT NULL,    -- JSON
  occurred_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (event_id),
  KEY idx_game_time (game_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- -----------------------------------------------------------------------------
-- Indexes summary (already created inline above)
-- -----------------------------------------------------------------------------
-- mp_games:           status, deck
-- mp_game_players:    game, unique(token), unique(game,seat)
-- mp_game_archive:    game+position, game+drawn_by
-- mp_submissions:     game+status, writer, game+resolved_year
-- mp_reviews:         submission, unique(submission,reviewer)
-- mp_published_works: game, writer, unique(submission)
-- mp_citation_tokens: owner+unspent
-- mp_event_log:       game+time

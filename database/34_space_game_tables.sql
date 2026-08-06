-- 34_space_game_tables.sql
--
-- SPACE GAME (Concordia-engine redesign — docs/SPACE_REDESIGN.md).
-- Brand-new tables, sp_ prefix. Coexists with all mp_* Historians tables;
-- nothing here touches existing data. Run manually in phpMyAdmin on BOTH
-- installs (live + seed) like every other migration.
--
-- State model: deliberately JSON-in-TEXT columns rather than normalized
-- tables. The space engine is single-writer per game (every mutation runs
-- inside a SELECT ... FOR UPDATE on the sp_games row), so JSON blobs are
-- safe, keep this migration tiny, and let the rules engine evolve without
-- a migration per tweak. Card and map CONTENT ships in code
-- (backend/sp_cards_data.php, backend/sp_map_data.php), not in the DB —
-- hidden opposition values must never be publicly fetchable.

CREATE TABLE IF NOT EXISTS sp_games (
  game_id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  status         ENUM('lobby','active','ended') NOT NULL DEFAULT 'lobby',
  map_key        VARCHAR(40) NOT NULL DEFAULT 'sector_v1',
  deck_key       VARCHAR(40) NOT NULL DEFAULT 'components_v1',
  max_players    TINYINT UNSIGNED NOT NULL DEFAULT 5,
  host_player_id INT UNSIGNED NULL,

  -- Sequential-turn engine (no phases, no barriers)
  current_seat   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  turn_number    INT UNSIGNED NOT NULL DEFAULT 1,

  -- Rotating production-boon token (Praefectus Magnus analog): seat index.
  boon_seat      TINYINT UNSIGNED NULL,

  -- Market: JSON array of card keys on display (leftmost = position 0)
  -- and the face-down stack (JSON array, index 0 = next to flip).
  market_display TEXT NULL,
  market_stack   TEXT NULL,

  -- Shared board state, one JSON object:
  --   drones:   [ {seat, type:'docked'|'lane', at:'<planetId>'|'<a~b>'} ]
  --   treaties: { '<planetId>': [seat, ...] }
  --   markers:  { '<systemId>': {flipped: bool} }   (production bonus markers)
  board_state    MEDIUMTEXT NULL,

  -- Endgame: when a trigger fires (market emptied / treaty count reached)
  -- the triggering seat takes the trophy and every OTHER player gets one
  -- final turn, counted down in final_turns_remaining.
  endgame_trigger       VARCHAR(40) NULL,
  trigger_seat          TINYINT UNSIGNED NULL,
  final_turns_remaining TINYINT UNSIGNED NULL,
  winner_seat           TINYINT UNSIGNED NULL,

  state_version  INT UNSIGNED NOT NULL DEFAULT 0,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                 ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (game_id),
  KEY idx_sp_games_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE IF NOT EXISTS sp_game_players (
  player_id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_id       INT UNSIGNED NOT NULL,
  user_id       INT UNSIGNED NULL,          -- account identity (users table)
  seat          TINYINT UNSIGNED NOT NULL,
  player_name   VARCHAR(80) NOT NULL,
  player_token  VARCHAR(64) NOT NULL,       -- per-game auth, mp_* pattern

  credits       INT NOT NULL DEFAULT 5,
  -- cargo: {"O":n,"B":n,"C":n,"N":n,"A":n} — resources by faction letter
  cargo         TEXT NULL,
  cargo_capacity TINYINT UNSIGNED NOT NULL DEFAULT 12,
  -- Drones not on the board sit in cargo and occupy cargo spaces.
  drones_reserve TINYINT UNSIGNED NOT NULL DEFAULT 4,

  hand          TEXT NULL,                  -- JSON array of card keys
  discard       TEXT NULL,                  -- JSON array, LAST element = top

  -- {"military":{"step":0},"diplomacy":{"step":0},"trade":{"step":0}}
  -- step 0..12; tier = floor((step-1)/4)+1; gates enforced by the engine.
  tracks        TEXT NULL,

  intel         TEXT NULL,                  -- JSON array of planetIds (private)
  upgrades      TEXT NULL,                  -- JSON array of upgrade keys

  vp_current    INT NOT NULL DEFAULT 0,     -- running VP marker (intermediate)
  first_reset_done   TINYINT(1) NOT NULL DEFAULT 0,
  intermediate_score INT NULL,
  trophy        TINYINT(1) NOT NULL DEFAULT 0,  -- endgame trophy card (+7 VP)
  final_score   INT NULL,                   -- filled at game end
  score_breakdown TEXT NULL,                -- JSON, per-affiliation detail

  conceded      TINYINT(1) NOT NULL DEFAULT 0,
  last_seen_at  TIMESTAMP NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (player_id),
  UNIQUE KEY uq_sp_players_token (player_token),
  UNIQUE KEY uq_sp_players_seat (game_id, seat),
  KEY idx_sp_players_game (game_id),
  KEY idx_sp_players_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- Toast/event feed, mirroring mp_event_log's role (also the idempotency
-- ledger if score submission is added later).
CREATE TABLE IF NOT EXISTS sp_event_log (
  event_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_id    INT UNSIGNED NOT NULL,
  seat       TINYINT UNSIGNED NULL,
  event_type VARCHAR(40) NOT NULL,
  message    VARCHAR(500) NULL,             -- pre-rendered player-facing text
  event_data TEXT NULL,                     -- JSON detail
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (event_id),
  KEY idx_sp_events_game (game_id, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

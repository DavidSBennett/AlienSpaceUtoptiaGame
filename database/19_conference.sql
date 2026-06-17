-- 19_conference.sql
--
-- "Attend a Conference" action. After the review phase, any players who
-- attended a conference draft cards from a shared pool in priority order
-- (reputation, then renown, then least prestige). Each attendee takes up to as
-- many cards as they contributed; leftovers are discarded. Attendees also earn
-- citation tokens equal to their reputation level (end-game victory points).

ALTER TABLE mp_games
  MODIFY COLUMN phase ENUM('action','review','conference') NOT NULL DEFAULT 'action';

-- The cards available to draft this conference. contributor_player_id is the
-- attendee who put the card in (NULL for fresh cards drawn from the archive);
-- taken_by_player_id is who drafted it (NULL until taken).
CREATE TABLE IF NOT EXISTS mp_conference_pool (
  pool_id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_id              INT UNSIGNED NOT NULL,
  idCard               INT UNSIGNED NOT NULL,
  contributor_player_id INT UNSIGNED NULL,
  taken_by_player_id   INT UNSIGNED NULL,
  PRIMARY KEY (pool_id),
  KEY idx_game (game_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per attendee for the duration of the conference. draft_order fixes
-- the pick priority; done flips to 1 once they've taken their cards.
CREATE TABLE IF NOT EXISTS mp_conference_attendees (
  game_id     INT UNSIGNED NOT NULL,
  player_id   INT UNSIGNED NOT NULL,
  take_limit  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  taken_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  draft_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  done        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

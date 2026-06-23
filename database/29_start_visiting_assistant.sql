-- 29_start_visiting_assistant.sql
--
-- Careers now START as Visiting Assistant Professor (no more unemployed
-- "recent-graduate" pre-stage, and no early game-over gates). Update the
-- default so newly-joined multiplayer players begin at the right rank and
-- don't get a spurious "promotion" on the first year resolution.
--
-- Run once in phpMyAdmin.

ALTER TABLE mp_game_players
  MODIFY COLUMN stage VARCHAR(32) NOT NULL DEFAULT 'visiting-assistant-professor';

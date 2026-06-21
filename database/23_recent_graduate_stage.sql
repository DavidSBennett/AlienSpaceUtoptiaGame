-- 23_recent_graduate_stage.sql
--
-- Career-narrative rework: there is no more "graduate student". Players now
-- start as recently minted PhDs ("recent-graduate"), get hired (Visiting
-- Assistant Professor) on their first article, and make Assistant Professor on
-- their first book. New deadlines: an article by year 3, a book by year 6.
--
-- This migration just updates the default starting stage for newly created
-- players. In-progress games recompute each player's stage from their
-- publications on the next year resolution, so no data backfill is needed.

ALTER TABLE mp_game_players
  MODIFY COLUMN stage VARCHAR(32) NOT NULL DEFAULT 'recent-graduate';

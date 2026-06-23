-- 27_score_display_name.sql
--
-- Lets an admin override the name shown on the SOLO leaderboard for a single
-- score, without renaming the underlying user account. The solo board shows
-- COALESCE(display_name, username), so a NULL override falls back to the live
-- username (the default).
--
-- (Multiplayer scores already store an editable player_name snapshot in the
-- legacy `Scores` table, so they need no schema change.)
--
-- Run once in phpMyAdmin.

ALTER TABLE user_scores
  ADD COLUMN display_name VARCHAR(50) DEFAULT NULL AFTER user_id;

-- 10_user_settings_games_dismissed.sql
--
-- Adds a per-user list of dismissed game_ids so players can clear ended
-- games from their "Your Games" list on the home page. Stored as a JSON
-- array of integers, mirroring tutorials_dismissed.

ALTER TABLE user_settings
  ADD COLUMN games_dismissed JSON DEFAULT NULL
  AFTER tutorials_dismissed;

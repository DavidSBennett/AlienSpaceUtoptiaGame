-- 15_game_toggles.sql
--
-- Host-controlled, table-wide display toggles set from the waiting room.
-- When on, they force tags / significance notes visible for EVERY player in
-- the game, on top of each player's own in-game toggle.

ALTER TABLE mp_games
  ADD COLUMN force_show_tags         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN force_show_significance TINYINT UNSIGNED NOT NULL DEFAULT 0;

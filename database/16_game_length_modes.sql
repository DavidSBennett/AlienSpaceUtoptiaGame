-- 16_game_length_modes.sql
--
-- Multiplayer game-length modes. A game can now be Short (10 rounds),
-- Medium (18 rounds), or Long (25 rounds — the original full career). The
-- chosen length is stored per game and drives when the game ends; the
-- career gate rounds (comps at 5, tenure at 12) stay fixed.
--
-- Scores get a `game_mode` tag so each length keeps its own leaderboard.

ALTER TABLE mp_games
  ADD COLUMN total_years SMALLINT UNSIGNED NOT NULL DEFAULT 25 AFTER max_players;

-- The Scores table is the shared multiplayer leaderboard (written by
-- mp_submitFinalScore.php). Tag each row with the length mode it came from
-- so Short / Medium / Long can be listed separately. NULL = untagged/legacy.
ALTER TABLE Scores
  ADD COLUMN game_mode VARCHAR(10) NULL DEFAULT NULL;

-- Every multiplayer score recorded before this change was a full 25-round
-- game, so backfill those as 'long'. (Multiplayer rows are tagged " [MP]"
-- in player_name by mp_submitFinalScore.php.)
UPDATE Scores
  SET game_mode = 'long'
  WHERE game_mode IS NULL AND player_name LIKE '% [MP]';

-- Speeds up the per-mode leaderboard filter.
CREATE INDEX idx_scores_game_mode ON Scores (game_mode);

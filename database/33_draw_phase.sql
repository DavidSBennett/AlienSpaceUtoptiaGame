-- 33_draw_phase.sql
--
-- Synchronous DRAW phase (multiplayer).
--
-- The archive is presented as four piles (derived as archive_position % 4 — no
-- column needed). When a round's actions resolve, every player who chose 'draw'
-- enters a draw phase and takes cards ONE AT A TIME in round-robin seat order
-- until their allowance is spent.
--
--   draws_remaining — how many cards this player still gets to take.
--   draws_taken     — how many they've taken this phase. Round-robin turn order
--                     is "fewest taken, then lowest seat", which stays fair even
--                     when players have different research allowances.
--
-- The round now runs: action -> draw -> conference -> review.

ALTER TABLE mp_games
  MODIFY COLUMN phase
    ENUM('action','draw','review','conference','aftermath')
    NOT NULL DEFAULT 'action';

ALTER TABLE mp_game_players
  ADD COLUMN draws_remaining TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN draws_taken     TINYINT UNSIGNED NOT NULL DEFAULT 0;

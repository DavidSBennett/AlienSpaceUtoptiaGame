-- 32_mp_seed_input.sql
--
-- Seed / lab installation ONLY. Stores the admin-entered seed for a
-- reproducible multiplayer game. mp_startGame reads it and shuffles the deck
-- deterministically instead of using the crypto-random shuffle.
--
-- On the LIVE database this column is harmless if present, but it only needs to
-- exist on the seed installation's separate database (SEED_MODE). The live game
-- never sets a seed.

ALTER TABLE mp_games
  ADD COLUMN seed_input VARCHAR(64) DEFAULT NULL AFTER shuffle_seed;

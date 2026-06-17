-- 13_token_economy.sql
--
-- Stage C of Revise & Resubmit — the objection-token economy.
--   * New players start with 4 objection tokens (was 2). The cap of 4 is
--     enforced in code wherever tokens are granted (objection refund,
--     accept-a-rejection bonus).
--   * Existing players are topped up to the new starting amount for the
--     transition (safe: it's a soft, capped resource).

ALTER TABLE mp_game_players
  MODIFY objection_tokens_remaining TINYINT UNSIGNED NOT NULL DEFAULT 4;

UPDATE mp_game_players
  SET objection_tokens_remaining = 4
  WHERE objection_tokens_remaining < 4;

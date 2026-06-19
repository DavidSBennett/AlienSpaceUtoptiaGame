-- 21_aftermath_phase.sql
--
-- Final-year writer-response window.
--
-- Bug: a manuscript resolved on the LAST year as a Revise & Resubmit (or a
-- plain rejection the writer could contest with objection tokens) gave the
-- writer no chance to respond — the game ended immediately and the outcome
-- stood. Normally that response happens in the "next year"; on the final year
-- there is no next year.
--
-- Fix: a new 'aftermath' phase. When the final round would end the game but a
-- live writer still has an outstanding response (a revise-pending decision, or
-- a peer rejection they have >=2 objection tokens to contest), the game holds
-- in 'aftermath' instead of ending. Writers resolve (or sign off via the
-- aftermath_ready flag); once no live writer is still blocking, the game
-- finalizes (scores + renown) and ends.

ALTER TABLE mp_games
  MODIFY COLUMN phase ENUM('action','review','conference','aftermath') NOT NULL DEFAULT 'action';

-- Per-player "I'm done responding — end the game" flag for the aftermath phase.
-- Reset to 0 on entering aftermath; set to 1 when the writer signs off.
ALTER TABLE mp_game_players
  ADD COLUMN aftermath_ready TINYINT UNSIGNED NOT NULL DEFAULT 0;

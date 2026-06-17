-- 20_pending_action_width.sql
--
-- Widen mp_game_players.pending_action. It was VARCHAR(16), which silently
-- truncates the new 'attend_conference' action (17 chars) to 'attend_conferenc'
-- on save — breaking both the action label and the conference trigger (the
-- resolver matches the full string).

ALTER TABLE mp_game_players
  MODIFY COLUMN pending_action VARCHAR(32) DEFAULT NULL;

-- Repair any rows already truncated by the old width (in-flight selections).
UPDATE mp_game_players
  SET pending_action = 'attend_conference'
  WHERE pending_action = 'attend_conferenc';

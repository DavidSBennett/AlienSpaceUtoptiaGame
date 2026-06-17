-- 12_revise_stage_b.sql
--
-- Stage B of Revise & Resubmit. Records the peer reviewer as a contributor
-- on the published work when the writer accepts their revision (they earn a
-- third of the manuscript's prestige).

ALTER TABLE mp_published_works
  ADD COLUMN contributor_player_id INT UNSIGNED DEFAULT NULL AFTER writer_player_id;

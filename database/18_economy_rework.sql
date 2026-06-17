-- 18_economy_rework.sql
--
-- Economy rework (multiplayer).
--
-- Citations: when a manuscript is published, we record half of its conclusion's
-- prestige contribution as `citation_value`. Citing that work later adds that
-- many prestige to the citer's article (replacing the old effective-evidence
-- contribution). The cited author still gains a citation token.

ALTER TABLE mp_published_works
  ADD COLUMN citation_value INT NOT NULL DEFAULT 0 AFTER prestige_granted;

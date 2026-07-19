-- 30_conference_publications.sql
--
-- Conference publications (multiplayer).
--
-- When a conference resolves, each attendee is awarded ONE leftover pool card
-- as a single-evidence "conference paper" that lands on their bookshelf. The
-- owner earns no prestige from it, but it is CITABLE by opponents: citing it
-- adds the card's bonus prestige to the citer's article and mints the owner a
-- citation token (same machinery as citing an article or book).
--
-- Two schema changes are needed on mp_published_works:
--   1. `kind` must allow a 'conference' value.
--   2. Conference papers have no submission, so `submission_id` must allow NULL.
--      MySQL UNIQUE indexes permit multiple NULLs, so uniq_submission still
--      protects real (non-null) submission ids.

ALTER TABLE mp_published_works
  MODIFY COLUMN kind ENUM('article','book','conference') NOT NULL;

ALTER TABLE mp_published_works
  MODIFY COLUMN submission_id INT UNSIGNED NULL;

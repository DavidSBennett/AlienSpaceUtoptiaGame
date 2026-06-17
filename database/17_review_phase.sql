-- 17_review_phase.sql
--
-- Synchronous review phase. After everyone ends a year, any newly-published
-- manuscripts pull all players into an interstitial where each manuscript is
-- reviewed one at a time behind a per-player barrier, before the next year
-- begins.
--
-- mp_games gains a phase ('action' = normal play, 'review' = interstitial) and
-- a review_index pointing at the manuscript currently under review. A small
-- progress table records each player's "Continue" click per manuscript (the
-- barrier).

ALTER TABLE mp_games
  ADD COLUMN phase        ENUM('action','review') NOT NULL DEFAULT 'action' AFTER status,
  ADD COLUMN review_index SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER phase;

-- One row per (manuscript, player) once that player clicks Continue for that
-- manuscript during the review phase. The writer gets a row too (they don't
-- vote, they just acknowledge). ready is always 1 when a row exists; the row's
-- presence IS the readiness, but we keep the column for clarity/idempotence.
CREATE TABLE IF NOT EXISTS mp_review_progress (
  submission_id INT UNSIGNED NOT NULL,
  player_id     INT UNSIGNED NOT NULL,
  ready         TINYINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (submission_id, player_id),
  KEY idx_submission (submission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

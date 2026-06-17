-- 11_revise_and_resubmit.sql
--
-- Stage A of the Revise & Resubmit feature.
--   * mp_reviews.verdict gains a third option, 'revise'.
--   * mp_reviews.added_card_ids stores the reviewer's hand cards proposed
--     for ADDING to the manuscript (JSON array of idCard ints).
--   * mp_submissions.status gains 'revise-pending' — a submission a reviewer
--     has proposed revisions to, awaiting the writer's year-end decision.

ALTER TABLE mp_reviews
  MODIFY verdict ENUM('approve','reject','revise') NOT NULL;

ALTER TABLE mp_reviews
  ADD COLUMN added_card_ids TEXT DEFAULT NULL AFTER flagged_card_ids;

ALTER TABLE mp_submissions
  MODIFY status ENUM(
    'pending','approved','rejected',
    'auto-approved','auto-rejected',
    'objection-won','objection-lost',
    'revise-pending'
  ) NOT NULL DEFAULT 'pending';

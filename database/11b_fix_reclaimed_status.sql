-- 11b_fix_reclaimed_status.sql
--
-- Fixes a latent bug surfaced by the Stage A migration: mp_reclaimManuscript.php
-- writes status='reclaimed', but 'reclaimed' was never part of the status ENUM,
-- so reclaimed manuscripts were silently stored as '' (blank) under non-strict
-- SQL mode. This adds 'reclaimed' to the ENUM (alongside the new 'revise-pending')
-- and restores the rows that were blanked.

ALTER TABLE mp_submissions
  MODIFY status ENUM(
    'pending','approved','rejected',
    'auto-approved','auto-rejected',
    'objection-won','objection-lost',
    'reclaimed','revise-pending'
  ) NOT NULL DEFAULT 'pending';

-- The only out-of-ENUM status the code ever set was 'reclaimed', so any blanked
-- row is a fully-reclaimed manuscript. Restore it.
UPDATE mp_submissions SET status = 'reclaimed' WHERE status = '';

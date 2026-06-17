-- =============================================================================
-- The Historians — Multiplayer Phase A.5 Schema Migration
-- =============================================================================
--
-- Adds support for the new manuscript-lifecycle behavior:
--   - Cards bind to the submission when published, leaving the project empty
--   - Rejections let the writer reclaim cards via a modal
--   - Consolation draws are tracked per-submission so the button can disable
--   - 'reclaimed' is a new status for fully-unpacked rejected manuscripts
--
-- Run this in phpMyAdmin AFTER the original 01_create_mp_tables.sql. It's
-- purely additive — no data loss on existing games. Idempotent: re-running
-- is safe (uses IF NOT EXISTS where MySQL allows, otherwise tolerates
-- "Duplicate column" errors).
-- =============================================================================


-- Track whether the writer has claimed their consolation draw for a
-- rejected submission. Starts 0; flips to 1 when the consolation button
-- is clicked. The button stays disabled after that.
ALTER TABLE mp_submissions
  ADD COLUMN consolation_drawn TINYINT(1) NOT NULL DEFAULT 0;


-- Add 'reclaimed' to the status enum. A rejected manuscript whose evidence
-- has all been moved back to the writer's hand becomes 'reclaimed' and is
-- hidden from queries. (We don't delete the row so the event log + future
-- analysis remains possible.)
--
-- MySQL ENUM modifications require listing all values, including existing
-- ones. If this fails with "Duplicate column" or "BLOB/TEXT column" errors
-- on your specific MySQL version, alternative is to add a separate
-- `is_reclaimed TINYINT(1)` flag column instead. Try the ENUM modification
-- first since it's cleaner.
ALTER TABLE mp_submissions
  MODIFY COLUMN status ENUM(
    'pending','approved','rejected',
    'auto-approved','auto-rejected',
    'objection-won','objection-lost',
    'reclaimed'
  ) NOT NULL DEFAULT 'pending';

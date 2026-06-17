-- ─────────────────────────────────────────────────────────────────────────
-- 07_user_settings_tutorial_enabled.sql
--
-- Adds the tutorial-enabled master toggle to user_settings. Previously
-- tracked via the localStorage key 'historians.tutorial.enabled'. With
-- all settings server-side, this column completes the user_settings
-- table for the locked launch.
--
-- Default = 1 (on), matching the original isTutorialEnabled() default
-- — new users see tutorials until they explicitly switch them off.
--
-- Run order: AFTER 04 + 05 + 06.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE user_settings
  ADD COLUMN tutorial_enabled TINYINT(1) NOT NULL DEFAULT 1
  AFTER show_tags;

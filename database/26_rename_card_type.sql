-- 26_rename_card_type.sql
--
-- Rename the ambiguous Cards.`type` column (which holds 'archive' /
-- 'conclusion') to `card_identifier`, so it is no longer confused with the
-- separate `source_type` column (which holds the kind of historical source).
--
-- SAFE ORDERING: deploy the matching application code FIRST, then run this.
-- The deployed code reads the value with a `card_identifier ?? type` fallback
-- and selects with `SELECT *`, so it works both before and after this runs —
-- there is no breakage window.
--
-- Run once in phpMyAdmin (migrations are applied by hand).

ALTER TABLE Cards
  CHANGE COLUMN `type` `card_identifier` VARCHAR(64) DEFAULT NULL;

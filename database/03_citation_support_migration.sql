-- =============================================================================
-- The Historians — Multiplayer Phase B (citations) Schema Migration
-- =============================================================================
--
-- Adds support for cross-citation:
--   1. mp_citations linking table — tracks live citations from a project
--      to a published work (citations carry across the publish/approve
--      cycle; on submit they get snapshotted onto the submission row).
--   2. mp_submissions.cited_work_ids — JSON array of work_ids snapshotted
--      from mp_citations at publish time. Persists through review; on
--      approval, citations contribute prestige + tokens; on rejection,
--      they don't auto-restore (player can re-add after reclaiming).
--
-- Pre-existing forward-compatibility columns that we use:
--   - mp_game_players.citations_received_count  (from 01)
--   - mp_citation_tokens table                  (from 01)
--
-- Run AFTER 01_create_mp_tables.sql and 02_manuscript_lifecycle_migration.sql.
-- Idempotent — uses IF NOT EXISTS where possible. The ALTER may fail with
-- "Duplicate column" if re-run; that's safe to ignore.
-- =============================================================================


-- A citation: a project (slot) cites a published work. Persists in the
-- project until the player either publishes (snapshot then delete) or
-- removes it. UNIQUE KEY enforces "a project cannot cite the same work
-- twice."
CREATE TABLE IF NOT EXISTS mp_citations (
  citation_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id        INT UNSIGNED NOT NULL,
  slot_index       TINYINT UNSIGNED NOT NULL,
  cited_work_id    INT UNSIGNED NOT NULL,
  added_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (citation_id),
  UNIQUE KEY uniq_citation_per_project (player_id, slot_index, cited_work_id),
  KEY idx_citations_by_player (player_id),
  KEY idx_citations_by_work   (cited_work_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- Snapshot column: at publish time, the active citations for the project
-- get snapped into this JSON array. The mp_citations rows are then
-- deleted (so the project slot starts fresh). The snapshot persists
-- through approval/rejection.
ALTER TABLE mp_submissions
  ADD COLUMN cited_work_ids TEXT DEFAULT NULL COMMENT 'JSON array of citation work_ids';

-- 28_playtest_feedback_stat_columns.sql
--
-- OPTIONAL. The playtest_feedback table was, in some deployments, created from
-- an earlier version that lacked the per-respondent stat columns. That made
-- the survey submit (and the admin report) fail with "Unknown column".
--
-- The application now inserts/reads only the columns that exist and keeps the
-- full submission in responses_json regardless, so the survey works WITHOUT
-- this migration. Run it only if you also want those stats stored in their own
-- columns (so the admin report can aggregate them directly).
--
-- Syntax below is MariaDB (GreenGeeks). On MySQL (no IF NOT EXISTS for ADD
-- COLUMN), remove "IF NOT EXISTS" and skip any column that already exists.

ALTER TABLE playtest_feedback
  ADD COLUMN IF NOT EXISTS self_citations        INT         NULL AFTER self_books,
  ADD COLUMN IF NOT EXISTS self_stage            VARCHAR(40) NULL AFTER self_citations,
  ADD COLUMN IF NOT EXISTS self_game_over_reason VARCHAR(40) NULL AFTER self_stage,
  ADD COLUMN IF NOT EXISTS self_research         TINYINT     NULL AFTER self_game_over_reason,
  ADD COLUMN IF NOT EXISTS self_notebook         TINYINT     NULL AFTER self_research,
  ADD COLUMN IF NOT EXISTS self_influence        TINYINT     NULL AFTER self_notebook,
  ADD COLUMN IF NOT EXISTS self_workspaces       TINYINT     NULL AFTER self_influence,
  ADD COLUMN IF NOT EXISTS self_reputation       TINYINT     NULL AFTER self_workspaces,
  ADD COLUMN IF NOT EXISTS self_renown           TINYINT     NULL AFTER self_reputation,
  ADD COLUMN IF NOT EXISTS responses_json        LONGTEXT    NULL;

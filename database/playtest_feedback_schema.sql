-- ============================================================================
-- playtest_feedback — anonymous post-game questionnaire + gameplay data.
--
-- Run in phpMyAdmin with the happypoe_hgame database selected FIRST.
--
-- ANONYMITY BY DESIGN: NO user_id, NO player_name, NO session/player token,
-- NO foreign key to any account table. A response cannot be traced to the
-- account that submitted it. Stored context is non-identifying: which deck,
-- solo vs multiplayer, how far the game got, and the respondent's own
-- anonymized result + final stat levels.
--
-- Likert columns: 1 = Strongly disagree .. 5 = Strongly agree (NULL = skipped).
-- had_technical_errors: 1 = yes, 0 = no, NULL = unanswered.
--
-- >>> If you already created this table from the earlier version, do NOT
-- >>> re-run the CREATE; instead run the ALTER block at the very bottom to
-- >>> add the new stat columns.
-- ============================================================================

CREATE TABLE IF NOT EXISTS playtest_feedback (
  id                       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Non-identifying game context
  mode                     VARCHAR(16)  NULL,   -- 'solo' | 'multiplayer'
  deck_id                  INT          NULL,
  final_year               INT          NULL,
  player_count             INT          NULL,

  -- Technical errors
  had_technical_errors     TINYINT(1)   NULL,
  technical_errors_detail  TEXT         NULL,

  -- Likert battery (1..5; NULL = skipped)
  likert_draw              TINYINT      NULL,
  likert_publish           TINYINT      NULL,
  likert_peer_review       TINYINT      NULL,
  likert_historian         TINYINT      NULL,
  likert_learned           TINYINT      NULL,
  likert_enjoyed           TINYINT      NULL,
  likert_play_again        TINYINT      NULL,

  -- Free text
  free_enjoyed             TEXT         NULL,
  free_confusing           TEXT         NULL,
  free_other               TEXT         NULL,

  -- Respondent's own anonymized result + final stats (no name/account)
  self_prestige            INT          NULL,
  self_articles            INT          NULL,
  self_books               INT          NULL,
  self_citations           INT          NULL,
  self_stage               VARCHAR(40)  NULL,
  self_game_over_reason    VARCHAR(40)  NULL,   -- outcome (completed / failed-comps / tenure-denied / conceded)
  self_research            TINYINT      NULL,
  self_notebook            TINYINT      NULL,
  self_influence           TINYINT      NULL,
  self_workspaces          TINYINT      NULL,
  self_reputation          TINYINT      NULL,
  self_renown              TINYINT      NULL,   -- multiplayer only

  -- Full raw submission as JSON text (future-proof; nothing identifying)
  responses_json           LONGTEXT     NULL,

  PRIMARY KEY (id),
  KEY idx_deck    (deck_id),
  KEY idx_mode    (mode),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ============================================================================
-- ALTER block — run ONLY if you already created playtest_feedback from the
-- earlier version (which lacked the stat columns). Each statement errors
-- harmlessly if the column already exists; just skip any that complain.
-- ============================================================================
-- ALTER TABLE playtest_feedback
--   ADD COLUMN self_game_over_reason VARCHAR(40) NULL AFTER self_stage,
--   ADD COLUMN self_research   TINYINT NULL AFTER self_game_over_reason,
--   ADD COLUMN self_notebook   TINYINT NULL AFTER self_research,
--   ADD COLUMN self_influence  TINYINT NULL AFTER self_notebook,
--   ADD COLUMN self_workspaces TINYINT NULL AFTER self_influence,
--   ADD COLUMN self_reputation TINYINT NULL AFTER self_workspaces,
--   ADD COLUMN self_renown     TINYINT NULL AFTER self_reputation;

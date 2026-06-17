-- ─────────────────────────────────────────────────────────────────────────
-- 06_user_scores_migration.sql
--
-- Adds an account-linked solo scores table. The legacy Scores table
-- (used by saveScore.php in the unlocked codebase) is left untouched
-- as historical record — it never had user accounts so its rows can't
-- be migrated. New scores in the locked version go to user_scores
-- with a real user_id FK.
--
-- Run order: AFTER 04 + 05. Idempotent only if you haven't run it
-- before — uses CREATE TABLE without IF NOT EXISTS to make accidental
-- double-applies obvious.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE user_scores (
  score_id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id             INT UNSIGNED NOT NULL,
  idDeck              INT UNSIGNED NOT NULL,
  -- Final career metrics
  rank                VARCHAR(64) NOT NULL,
  prestige            INT UNSIGNED NOT NULL DEFAULT 0,
  articles_published  INT UNSIGNED NOT NULL DEFAULT 0,
  books_published     INT UNSIGNED NOT NULL DEFAULT 0,
  -- Final stat levels
  research_level      TINYINT UNSIGNED NOT NULL DEFAULT 1,
  notebook_level      TINYINT UNSIGNED NOT NULL DEFAULT 1,
  influence_level     TINYINT UNSIGNED NOT NULL DEFAULT 1,
  workspaces_level    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  -- How far the career got (years 1-25 for solo)
  year_ended          SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  submitted_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY user_idx (user_id),
  KEY deck_idx (idDeck),
  KEY prestige_idx (idDeck, prestige DESC),
  CONSTRAINT fk_score_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

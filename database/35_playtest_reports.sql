-- Playtest reports: free-form feedback filed by players (mid-game or
-- after the end), stored with a compact snapshot of the game at filing
-- time. Read them in phpMyAdmin; nothing in the game reads them back.
CREATE TABLE IF NOT EXISTS sp_playtest_reports (
  report_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_id     INT UNSIGNED NOT NULL,
  seat        TINYINT UNSIGNED NULL,
  player_name VARCHAR(80) NULL,
  variant     VARCHAR(20) NULL,
  rating      TINYINT NULL,            -- 1..5, optional
  notes       TEXT NULL,
  snapshot    MEDIUMTEXT NULL,         -- JSON: turn, chaos, scores, trigger
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (report_id),
  KEY idx_sp_reports_game (game_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

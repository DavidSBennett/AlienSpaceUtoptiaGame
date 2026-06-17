-- ─────────────────────────────────────────────────────────────────────────
-- 04_user_accounts_migration.sql
--
-- Adds the user-account layer that locks both single-player and
-- multiplayer behind real login. After this migration is applied:
--
--   • New tables: users, user_sessions, password_reset_tokens,
--     email_verification_tokens, user_settings.
--   • mp_game_players gains a nullable user_id column. Existing rows
--     (from the unlocked launch) have NULL user_id and read as "guest"
--     data; new rows are populated from the session.
--
-- Run order: AFTER 01_create_mp_tables.sql, 02_manuscript_lifecycle,
-- 03_citation_support. Idempotent if re-run (DROP IF EXISTS pattern not
-- used because we don't want to lose existing data on accident — apply
-- exactly once).
-- ─────────────────────────────────────────────────────────────────────────

-- ─── users ────────────────────────────────────────────────────────────
-- Core account record. password_hash is bcrypt via PHP's
-- password_hash() with PASSWORD_DEFAULT (currently bcrypt cost-12).
-- username_lower and email_lower are generated columns we index for
-- case-insensitive uniqueness — store the display-cased original but
-- enforce uniqueness on the lowercase.
CREATE TABLE users (
  user_id              INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username             VARCHAR(32) NOT NULL,
  username_lower       VARCHAR(32) AS (LOWER(username)) STORED,
  password_hash        VARCHAR(255) NOT NULL,
  email                VARCHAR(255) NOT NULL,
  email_lower          VARCHAR(255) AS (LOWER(email)) STORED,
  email_verified       TINYINT(1) NOT NULL DEFAULT 0,
  is_admin             TINYINT(1) NOT NULL DEFAULT 0,
  is_disabled          TINYINT(1) NOT NULL DEFAULT 0,
  -- Brute-force throttle. failed_logins resets to 0 on any successful
  -- login. If it climbs to 10 within a short window, login_blocked_until
  -- is set; the login endpoint rejects attempts until that timestamp
  -- passes. Tunable via constants in users_helpers.php.
  failed_logins        INT UNSIGNED NOT NULL DEFAULT 0,
  login_blocked_until  TIMESTAMP NULL DEFAULT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at        TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY username_unique (username_lower),
  UNIQUE KEY email_unique (email_lower)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ─── user_sessions ────────────────────────────────────────────────────
-- Server-side session tokens. Sent by the client in
-- Authorization: Bearer <token> on every protected request. Sessions
-- are rotated on password change and on explicit logout. last_used_at
-- bumps on every authenticated request so we can show an "active
-- sessions" list in account settings later.
CREATE TABLE user_sessions (
  session_id      INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED NOT NULL,
  token           CHAR(64) NOT NULL,
  user_agent      VARCHAR(255) DEFAULT NULL,
  ip_address      VARCHAR(45) DEFAULT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      TIMESTAMP NOT NULL,
  UNIQUE KEY token_unique (token),
  KEY user_id_idx (user_id),
  KEY expires_idx (expires_at),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ─── password_reset_tokens ────────────────────────────────────────────
-- One-time tokens for the "forgot password" flow. The reset email
-- contains a link with the token. Token expires after 1 hour and is
-- single-use (used_at is set on completion). We never expose the
-- token over GET because it'd land in server logs — links go to a
-- React route that posts the token over POST.
CREATE TABLE password_reset_tokens (
  token_id    INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  token       CHAR(64) NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP NOT NULL,
  used_at     TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY token_unique (token),
  KEY user_id_idx (user_id),
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ─── email_verification_tokens ────────────────────────────────────────
-- Same shape as password_reset_tokens but a separate table so we can
-- expire them independently (verify tokens live 7 days, reset tokens
-- 1 hour). Verification is required for password reset to work.
CREATE TABLE email_verification_tokens (
  token_id    INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  token       CHAR(64) NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP NOT NULL,
  used_at     TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY token_unique (token),
  KEY user_id_idx (user_id),
  CONSTRAINT fk_verify_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ─── user_settings ────────────────────────────────────────────────────
-- Per-user preferences previously stored in localStorage. Migrating
-- these to the server means they sync across devices. updated_at lets
-- us implement last-write-wins if the same user logs in from two
-- devices simultaneously.
--
-- tutorials_dismissed is a JSON array of tutorial keys the user has
-- closed and doesn't want re-shown.
CREATE TABLE user_settings (
  user_id            INT UNSIGNED NOT NULL PRIMARY KEY,
  voip_enabled       TINYINT(1) NOT NULL DEFAULT 0,
  notebook_collapsed TINYINT(1) NOT NULL DEFAULT 0,
  show_tags          TINYINT(1) NOT NULL DEFAULT 0,
  tutorials_dismissed JSON DEFAULT NULL,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                       ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_settings_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ─── mp_game_players gains user_id ────────────────────────────────────
-- Nullable so the migration is non-destructive — existing rows from
-- the unlocked launch read as user_id = NULL (guest data). New rows
-- (after the locked version deploys) always populate user_id from the
-- session. If you wipe mp_* before deploying locked, this column will
-- only ever hold real user_ids and nothing else.
ALTER TABLE mp_game_players
  ADD COLUMN user_id INT UNSIGNED NULL AFTER player_id,
  ADD KEY user_id_idx (user_id);

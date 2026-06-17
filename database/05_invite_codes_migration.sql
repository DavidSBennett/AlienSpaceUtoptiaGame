-- ─────────────────────────────────────────────────────────────────────────
-- 05_invite_codes_migration.sql
--
-- Adds invite-code gating to registration. After this migration is
-- applied, users_register.php requires a valid invite_code in the
-- request body; the matching code is consumed atomically.
--
-- Two-table design:
--   user_invite_codes        — the codes themselves
--   user_invite_consumptions — audit trail of who used what
--
-- Codes are 12-char base32-style strings (display-grouped as XXXX-XXXX-XXXX
-- for readability; dashes are stripped before storage and on lookup, so
-- users can type with or without dashes). Stored uppercase, looked up
-- case-insensitively via the generated code_lower column.
--
-- Run order: AFTER 04_user_accounts_migration.sql.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE user_invite_codes (
  invite_id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code               VARCHAR(32) NOT NULL,
  code_lower         VARCHAR(32) AS (LOWER(code)) STORED,
  -- If true, the user created via this code is granted is_admin = 1.
  -- Used to bootstrap the first admin without needing DB shell access.
  -- Normal player codes leave this 0.
  grants_admin       TINYINT(1) NOT NULL DEFAULT 0,
  -- Who minted this code. NULL for the bootstrap code seeded before any
  -- user exists. Set to a real user_id for all admin-generated codes.
  created_by_user_id INT UNSIGNED NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Single-use codes have max_uses = 1. Multi-use codes (e.g., a shared
  -- "discord launch" code) can be higher. uses_count tracks consumption;
  -- the code becomes invalid when uses_count >= max_uses.
  max_uses           INT UNSIGNED NOT NULL DEFAULT 1,
  uses_count         INT UNSIGNED NOT NULL DEFAULT 0,
  -- Optional time limit. NULL = never expires (still capped by uses).
  expires_at         TIMESTAMP NULL DEFAULT NULL,
  -- Free-form admin label so you can remember why you made it
  -- ("for Alex", "discord drop 2025-06").
  note               VARCHAR(255) DEFAULT NULL,
  -- Soft-revoke. Once set, the code is dead regardless of remaining
  -- uses or expiry. Audit trail in user_invite_consumptions still works.
  revoked_at         TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY code_unique (code_lower),
  KEY created_by_idx (created_by_user_id),
  CONSTRAINT fk_invite_creator FOREIGN KEY (created_by_user_id)
    REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE user_invite_consumptions (
  consumption_id   INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invite_id        INT UNSIGNED NOT NULL,
  user_id          INT UNSIGNED NOT NULL,
  consumed_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY invite_idx (invite_id),
  KEY user_idx (user_id),
  CONSTRAINT fk_consumption_invite FOREIGN KEY (invite_id)
    REFERENCES user_invite_codes(invite_id) ON DELETE CASCADE,
  CONSTRAINT fk_consumption_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

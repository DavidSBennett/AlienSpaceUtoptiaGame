-- ─────────────────────────────────────────────────────────────────────────
-- 08_chat_messages_migration.sql
--
-- Adds in-game chat. Renumbered from 04 in the merged build because
-- 04-07 are taken by the user-account migrations (which need to run
-- before this one, since locked-version flows assume signed-in users
-- — though this table itself does not depend on the users table).
--
-- One row per message, scoped to a game. Messages are sent via
-- mp_sendChatMessage.php (auth via player_token) and surfaced to all
-- players in the game through mp_getGameState's response.
--
-- Cleanup: messages are kept for the lifetime of the game row. When
-- a game is deleted, ON DELETE CASCADE wipes the chat with it. We
-- don't paginate — clients receive the last ~50 messages per poll
-- (the chat panel scrolls newest-at-bottom). For longer histories,
-- a future endpoint could lazy-load earlier pages.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mp_chat_messages (
  message_id   INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  game_id      INT UNSIGNED NOT NULL,
  -- Who sent it. NULL slot reserved for future system messages
  -- (e.g., "Game started", though those are currently events not
  -- chat). Nullable FK is fine; we just don't render a name for
  -- NULL senders.
  player_id    INT UNSIGNED NULL,
  -- Snapshot of the sender's display name AT TIME OF SENDING. We
  -- store this denormalized rather than joining to mp_game_players
  -- each render because:
  --   (a) it's faster — chat polls are frequent
  --   (b) if a player's name ever changes (it can't right now, but
  --       future-proofs), old messages still show the original sender
  player_name  VARCHAR(64) NOT NULL,
  -- Free-form text. Capped server-side at 500 chars to prevent
  -- griefers from posting walls. Stored as utf8mb4 so emoji work.
  content      VARCHAR(500) NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_game_msg (game_id, message_id),
  CONSTRAINT fk_chat_game FOREIGN KEY (game_id)
    REFERENCES mp_games(game_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

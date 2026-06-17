-- 14_card_lock.sql
--
-- Locks a reviewer's contributed cards out of their hand while a Revise &
-- Resubmit proposal is pending (so they can't play cards committed to someone
-- else's manuscript). If the writer declines (objects or rebuilds), the cards
-- are returned to the reviewer's hand; any that don't fit are parked here and
-- delivered at the start of a later year when the hand has room.

CREATE TABLE IF NOT EXISTS mp_pending_card_returns (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  game_id     INT UNSIGNED NOT NULL,
  player_id   INT UNSIGNED NOT NULL,
  idCard      INT UNSIGNED NOT NULL,
  queued_year INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pcr_player (player_id),
  KEY idx_pcr_game (game_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

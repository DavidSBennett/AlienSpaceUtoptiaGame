-- =============================================================================
-- 09_decks_cards_settings.sql
--
-- Creates the CONTENT tables the game's deck pipeline needs. These existed
-- on the old davidsbennett.com host but were never part of the multiplayer
-- migrations (01-08) — they were created and populated by uploadDeck.php
-- over time. This file reconstructs them from the live schema as used by
-- dbConfig.php / listDecks.php / listCards.php / verifyTagCode.php /
-- uploadDeck.php.
--
-- No dependency on the mp_* tables — run any time (ideally first, since the
-- game can't load a deck without these). Idempotent: safe to re-run.
--
-- After running, seed your decks by uploading each CSV through uploadDeck.php.
-- =============================================================================


-- ── Decks ────────────────────────────────────────────────────────────────
-- One row per deck. uploadDeck.php inserts nameFirst/nameLast/nameDeck from
-- the upload form, then stores the uploaded file path in deckFile.
-- listDecks.php builds its label as CONCAT_WS("'s ", nameLast, nameDeck).
CREATE TABLE IF NOT EXISTS Decks (
  idDeck     INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nameFirst  VARCHAR(100)  DEFAULT NULL,
  nameLast   VARCHAR(100)  DEFAULT NULL,
  nameDeck   VARCHAR(100)  DEFAULT NULL,
  deckFile   VARCHAR(255)  DEFAULT NULL,
  timeStamp  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ── Cards ────────────────────────────────────────────────────────────────
-- One row per evidence card. Column order/names mirror uploadDeck.php's
-- INSERT exactly. listCards.php does `SELECT *, CAST(idCard AS CHAR) AS id
-- ... WHERE idDeck = ?`, so any future column added here flows through to
-- the frontend automatically.
--
-- Type notes:
--   * `date` is free-form text ("October 7, 1763", "circa 1955") — NOT a
--     DATE column. Backticked because DATE is a type keyword.
--   * argument / sub_argument / bonus / type are short tag codes ('b','p',
--     'e','3','archive'); kept as VARCHAR so any deck's tagging scheme fits.
--   * content / significance / citation / description / *_titles are
--     free-form and can be long → TEXT.
--   * article_titles / book_titles are PIPE-separated title pools.
CREATE TABLE IF NOT EXISTS Cards (
  idCard           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  idDeck           INT UNSIGNED NOT NULL,
  sequence_number  INT           DEFAULT NULL,
  title            VARCHAR(255)  DEFAULT NULL,
  source_type      VARCHAR(100)  DEFAULT NULL,
  content          TEXT          DEFAULT NULL,
  `date`           VARCHAR(100)  DEFAULT NULL,
  author           VARCHAR(255)  DEFAULT NULL,
  location         VARCHAR(255)  DEFAULT NULL,
  significance     TEXT          DEFAULT NULL,
  image_url        VARCHAR(512)  DEFAULT NULL,
  argument         VARCHAR(64)   DEFAULT NULL,
  sub_argument     VARCHAR(64)   DEFAULT NULL,
  citation         TEXT          DEFAULT NULL,
  `type`           VARCHAR(64)   DEFAULT NULL,
  bonus            VARCHAR(64)   DEFAULT NULL,
  contributor      VARCHAR(255)  DEFAULT NULL,
  description      TEXT          DEFAULT NULL,
  article_titles   TEXT          DEFAULT NULL,
  book_titles      TEXT          DEFAULT NULL,

  KEY idx_cards_by_deck (idDeck),
  CONSTRAINT fk_cards_deck FOREIGN KEY (idDeck)
    REFERENCES Decks(idDeck) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ── Settings ─────────────────────────────────────────────────────────────
-- Key/value config read by verifyTagCode.php. The tag-unlock code lives
-- here (NOT hardcoded), so you can change it per class without editing PHP.
CREATE TABLE IF NOT EXISTS Settings (
  setting_key    VARCHAR(100) NOT NULL PRIMARY KEY,
  setting_value  VARCHAR(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed the tag-unlock code. INSERT IGNORE so re-running won't clobber a
-- value you've since changed in the UI/DB.
INSERT IGNORE INTO Settings (setting_key, setting_value)
VALUES ('tag_unlock_code', 'marginalia');

-- 25_conclusion_images.sql
--
-- Conclusion cards can be published as either an article or a book, each with
-- its own rendered front and back. So conclusions get FOUR whole-card images
-- (evidence/archive cards keep image_front / image_back from migration 24).
-- Supplied via the deck spreadsheet, columns V–Y.

ALTER TABLE Cards
  ADD COLUMN image_article_front TEXT DEFAULT NULL,
  ADD COLUMN image_article_back  TEXT DEFAULT NULL,
  ADD COLUMN image_book_front     TEXT DEFAULT NULL,
  ADD COLUMN image_book_back      TEXT DEFAULT NULL;

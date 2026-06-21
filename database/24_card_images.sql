-- 24_card_images.sql
--
-- Whole-card images for the Card Viewer: a rendered FRONT image and a BACK
-- image of each card, stored as URLs (like image_url for the inner portrait).
-- Supplied via the deck upload spreadsheet (columns T = image_front,
-- U = image_back). listCards.php returns them automatically (SELECT *).

ALTER TABLE Cards
  ADD COLUMN image_front TEXT DEFAULT NULL,
  ADD COLUMN image_back  TEXT DEFAULT NULL;

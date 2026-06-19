-- 22_card_context_tags.sql
--
-- New per-card "context tags" field — a PIPE-separated list (like
-- article_titles / book_titles). It feeds the prestige "doubling" check:
-- alongside the single-value context fields (location, author, date,
-- source_type, citation), a publication now also doubles when every piece of
-- real evidence shares at least one common context tag.

ALTER TABLE Cards
  ADD COLUMN context_tags TEXT DEFAULT NULL;

-- 31_review_flagged_works.sql
--
-- Let a peer reviewer flag CITED WORKS (books / articles / conference papers),
-- not just raw evidence cards, as evidence that doesn't fit the argument.
--
-- mp_reviews.flagged_work_ids stores a JSON array of mp_published_works.work_id
-- the reviewer wants dropped, alongside the existing flagged_card_ids (evidence
-- cards). On a Revise & Resubmit that the writer accepts, the flagged works are
-- removed from the manuscript's citations (see mp_resolveRevise.php).

ALTER TABLE mp_reviews
  ADD COLUMN flagged_work_ids TEXT DEFAULT NULL AFTER flagged_card_ids;

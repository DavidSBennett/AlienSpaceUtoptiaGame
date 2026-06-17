/**
 * Date sorting helpers for evidence cards.
 *
 * Card date strings come from the deck and use varied formats: "1955-12-01",
 * "December 1955", "c. 1820", "1865". These helpers parse what they can and
 * fall back gracefully for unparseable values.
 */

/**
 * Parse an evidence card's date string into a sortable number.
 *
 * Returns Infinity for empty/unparseable dates so they sort to the end
 * rather than the start (i.e. card chronology comes first, "unknown date"
 * cards go after).
 */
export function sortableDate(s) {
  if (!s || typeof s !== 'string') return Infinity;
  const yearMatch = s.match(/-?\d{3,4}/);
  if (!yearMatch) return Infinity;
  const year = parseInt(yearMatch[0], 10);

  // Look for month + day refinement after the year, if present.
  const months = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const lower = s.toLowerCase();
  let month = 0;
  for (const k in months) {
    if (lower.includes(k)) { month = months[k]; break; }
  }
  // ISO format like "1955-12-01" → take the 2-digit groups after the year
  const iso = s.match(/(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  let day = 0;
  if (iso) {
    month = parseInt(iso[2], 10) || month;
    day = parseInt(iso[3], 10) || 0;
  }
  return year * 10000 + month * 100 + day;
}

/**
 * Sort an evidence array chronologically (oldest first). Items without a
 * parseable date go to the end, preserving their input order among themselves.
 *
 * Returns a NEW array — does not mutate the input.
 */
export function sortEvidenceByDate(evidence) {
  if (!Array.isArray(evidence)) return [];
  return [...evidence]
    .map((ev, i) => ({ ev, i, sortKey: sortableDate(ev?.date) }))
    .sort((a, b) => {
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      return a.i - b.i;  // stable: preserve original order on ties
    })
    .map(({ ev }) => ev);
}

/**
 * Open the player's "Collected Works" in a new tab as an accessible,
 * print-ready HTML document.
 *
 * Phase 10.11 — replaces both the jsPDF and server-side TCPDF approaches.
 *
 * Why this approach: modern browsers' Print → Save as PDF produces a
 * *tagged* PDF (preserving heading hierarchy, table header cells, reading
 * order, document language) when the source is semantic HTML. So instead
 * of fighting PDF libraries, we generate clean semantic HTML and let the
 * student's own browser do the PDF conversion. Genuine accessibility,
 * zero server infrastructure.
 *
 * Mechanism: we write the publication data to sessionStorage, then open
 * the /works route in a new tab. WorksPage reads sessionStorage and
 * renders the accessible document.
 *
 * NOTE: the function name is kept as exportPublicationsToPDF for now so
 * existing import sites don't all need to change. It no longer produces
 * a PDF directly — it opens the printable works page.
 *
 * @param {Object[]} publications
 * @param {string} playerName
 * @param {Object} deck            { idDeck, nameDeck, ... }
 */
export function exportPublicationsToPDF({ publications, playerName, deck }) {
  if (!publications || publications.length === 0) {
    alert('You have no published works yet.');
    return;
  }

  // Build the payload the WorksPage expects. Strip bookshelf-only fields
  // (id, conclusionId, conclusionTitle) — the works page only needs the
  // display data.
  const payload = {
    playerName: playerName || 'Anonymous Historian',
    deckName: deck?.nameDeck || '',
    publications: publications.map((pub) => ({
      kind: pub.kind,
      title: pub.title,
      description: pub.description || '',
      year: pub.year,
      prestige: pub.prestige,
      evidence: (pub.evidence || []).map((ev) => ({
        date: ev.date || '',
        title: ev.title || '',
        content: ev.content || '',
        significance: ev.significance || '',
        citation: ev.citation || '',
      })),
    })),
  };

  try {
    sessionStorage.setItem('historians:works', JSON.stringify(payload));
  } catch (err) {
    console.error('Could not save works data to sessionStorage:', err);
    alert('Could not prepare the works document. Your browser may have storage disabled.');
    return;
  }

  // Open the works page in a new tab. We use the app's base path so this
  // works under the /projects/historiansv2/ deployment subdirectory.
  // import.meta.env.BASE_URL is '/projects/historiansv2/' in production
  // (set by vite.config base) and '/' in dev.
  const base = import.meta.env.BASE_URL || '/';
  const worksUrl = `${base.replace(/\/$/, '')}/works`;

  const newTab = window.open(worksUrl, '_blank');
  if (!newTab) {
    // Popup blocked — tell the user how to proceed.
    alert(
      'Your browser blocked the new tab. Please allow popups for this site, '
      + 'or use the link that will open the Collected Works page.'
    );
  }
}

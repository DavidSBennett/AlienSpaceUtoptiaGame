import { useEffect, useState } from 'react';
import { sortEvidenceByDate } from '../lib/evidenceSort.js';

/**
 * WorksPage — an accessible, print-optimized view of a player's published
 * works. Opened in a new tab from the bookshelf or game-over screen.
 *
 * Phase 10.11 — replaces server-side PDF generation. This page is built
 * from semantic HTML (proper heading hierarchy, real <table> markup with
 * <th scope="col"> headers, lang="en" on the document). When the student
 * uses their browser's Print → Save as PDF, modern browsers (Chrome, Edge,
 * Firefox) produce a *tagged* PDF that preserves this structure for screen
 * readers. This gives genuine accessibility with zero server infrastructure.
 *
 * Data is passed via sessionStorage under the key 'historians:works' —
 * the launching page writes it there, then opens this route in a new tab.
 *
 * Expected sessionStorage payload (JSON):
 *   {
 *     playerName: string,
 *     deckName: string,
 *     publications: [
 *       { kind, title, description, year, prestige,
 *         evidence: [{ date, title, content, significance }] }
 *     ]
 *   }
 */
export default function WorksPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Set the document language for screen readers + the tab title.
    document.documentElement.lang = 'en';

    try {
      const raw = sessionStorage.getItem('historians:works');
      if (!raw) {
        setError('No publication data found. Please open this page from the game.');
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.publications) || parsed.publications.length === 0) {
        setError('No published works to display.');
        return;
      }
      setData(parsed);
      // Set a descriptive document title — becomes the PDF title when
      // the user prints, and is announced by screen readers.
      document.title = `The Collected Works of ${parsed.playerName || 'Anonymous Historian'}`;
    } catch (err) {
      console.error('Failed to load works data:', err);
      setError('Could not load publication data.');
    }
  }, []);

  if (error) {
    return (
      <main style={styles.errorWrap}>
        <h1 style={styles.errorHeading}>Collected Works</h1>
        <p style={styles.errorText}>{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main style={styles.errorWrap}>
        <p style={styles.errorText}>Loading…</p>
      </main>
    );
  }

  const { playerName, deckName, publications } = data;
  const books = publications.filter((p) => p.kind === 'book').length;
  const articles = publications.filter((p) => p.kind === 'article').length;

  return (
    <>
      {/* Print + screen styles. The print rules ensure each publication
          starts on a new page and the toolbar is hidden when printing. */}
      <style>{printStyles}</style>

      {/* Skip link — first focusable element, jumps past the toolbar */}
      <a href="#works-main" className="skip-link">Skip to the document</a>

      {/* Screen-only toolbar — hidden when printing */}
      <div className="works-toolbar" role="toolbar" aria-label="Document actions">
        <button
          type="button"
          onClick={() => window.print()}
          className="works-btn works-btn-primary"
        >
          Print / Save as PDF
        </button>
        <button
          type="button"
          onClick={() => window.close()}
          className="works-btn works-btn-secondary"
        >
          Close
        </button>
        <p className="works-hint">
          Tip: in the print dialog, choose “Save as PDF” as the destination.
          The saved PDF keeps its headings and table structure for screen readers.
        </p>
      </div>

      {/* The actual document. <main> is the primary landmark. */}
      <main id="works-main" tabIndex={-1} className="works-doc">
        {/* ===== Cover / title block ===== */}
        <header className="works-cover">
          <h1 className="works-title">The Collected Works</h1>
          <p className="works-byline">
            of <span className="works-author">{playerName || 'Anonymous Historian'}</span>
          </p>
          {deckName && (
            <p className="works-deck">Studies in: {deckName}</p>
          )}
          <p className="works-counts">
            {books} {books === 1 ? 'book' : 'books'} · {articles} {articles === 1 ? 'article' : 'articles'}
          </p>
        </header>

        {/* ===== One <section> per publication ===== */}
        {publications.map((pub, idx) => {
          const sortedEvidence = sortEvidenceByDate(pub.evidence || []);
          const kindLabel = pub.kind === 'book' ? 'Book' : 'Article';

          return (
            <section
              key={idx}
              className="works-publication"
              aria-labelledby={`pub-heading-${idx}`}
            >
              <p className="works-pub-meta">
                {kindLabel} · Year {pub.year} · +{pub.prestige} prestige
              </p>

              {/* H2 — each publication is a navigable heading for screen readers */}
              <h2 id={`pub-heading-${idx}`} className="works-pub-title">
                {pub.title}
              </h2>

              {pub.description && (
                <p className="works-pub-desc">{pub.description}</p>
              )}

              {/* H3 — the evidence subsection */}
              <h3 className="works-evidence-heading">Evidence</h3>

              {sortedEvidence.length === 0 ? (
                <p className="works-no-evidence">No evidence recorded.</p>
              ) : (
                <table className="works-table">
                  <caption className="works-table-caption">
                    Evidence supporting “{pub.title}”, in chronological order
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="works-th works-th-date">Date</th>
                      <th scope="col" className="works-th works-th-title">Title</th>
                      <th scope="col" className="works-th works-th-content">Content</th>
                      <th scope="col" className="works-th works-th-sig">Significance</th>
                      <th scope="col" className="works-th works-th-cite">Citation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEvidence.map((ev, evIdx) => (
                      <tr key={evIdx}>
                        <td className="works-td works-td-date">{ev.date || '—'}</td>
                        <td className="works-td works-td-title">{ev.title || '—'}</td>
                        <td className="works-td works-td-content">{ev.content || '—'}</td>
                        <td className="works-td works-td-sig">{ev.significance || '—'}</td>
                        <td className="works-td works-td-cite">{ev.citation || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </main>
    </>
  );
}

// Inline styles for the error / loading states (kept minimal — these
// states are rarely seen and don't need the full print treatment).
const styles = {
  errorWrap: {
    maxWidth: '640px',
    margin: '4rem auto',
    padding: '0 1.5rem',
    fontFamily: 'Georgia, "Times New Roman", serif',
    textAlign: 'center',
  },
  errorHeading: {
    fontSize: '2rem',
    marginBottom: '1rem',
  },
  errorText: {
    fontSize: '1.1rem',
    color: '#444',
    lineHeight: 1.6,
  },
};

/**
 * Print + screen styles for the works document.
 *
 * Design goals:
 *   - On screen: readable, centered, clearly a "document"
 *   - On print: each publication on its own page, toolbar hidden,
 *     table headers repeat on each page (thead { display: table-header-group })
 *   - Black text on white — maximum contrast, ink-friendly
 *   - Real margins via @page
 */
const printStyles = `
  /* ===== Base ===== */
  body {
    margin: 0;
    background: #f4f1ea;
    color: #1a1a1a;
    font-family: Georgia, "Times New Roman", serif;
  }

  /* ===== Skip link — WCAG 2.4.1. Hidden until focused. ===== */
  .skip-link {
    position: absolute;
    top: -100px;
    left: 0;
    z-index: 200;
    padding: 0.75rem 1.25rem;
    background: #0c1f22;
    color: #f4f1ea;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 0.95rem;
    font-weight: 600;
    text-decoration: underline;
    border: 2px solid #d8b85b;
    border-radius: 0 0 4px 0;
    transition: top 0.15s ease;
  }
  .skip-link:focus {
    top: 0;
    outline: 3px solid #f4f1ea;
    outline-offset: 2px;
  }
  @media print {
    .skip-link { display: none !important; }
  }

  /* ===== Screen toolbar (hidden in print) ===== */
  .works-toolbar {
    position: sticky;
    top: 0;
    background: #1d4e4e;
    padding: 0.85rem 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    z-index: 10;
  }
  .works-btn {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 0.9rem;
    padding: 0.5rem 1.1rem;
    border: 1px solid #c8a84b;
    cursor: pointer;
    border-radius: 2px;
  }
  .works-btn-primary {
    background: #c8a84b;
    color: #1a1a1a;
    font-weight: bold;
  }
  .works-btn-primary:hover { background: #d8b85b; }
  .works-btn-secondary {
    background: transparent;
    color: #f4f1ea;
  }
  .works-btn-secondary:hover { background: rgba(255,255,255,0.1); }
  .works-hint {
    color: #d8e8e8;
    font-size: 0.8rem;
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    flex: 1 1 240px;
  }

  /* ===== The document body ===== */
  /* On screen the document is shown at a landscape-page width (≈10in of
     printable area on US Letter landscape) so what you see matches what
     prints. The print rules below override this to fill the actual page. */
  .works-doc {
    max-width: 10in;
    margin: 2rem auto;
    background: #fff;
    padding: 0.6in 0.75in;
    box-shadow: 0 4px 24px rgba(0,0,0,0.18);
  }

  /* ===== Cover block ===== */
  .works-cover {
    text-align: center;
    padding: 2rem 0 2.5rem;
    border-bottom: 2px solid #c8a84b;
    margin-bottom: 2rem;
  }
  .works-title {
    font-size: 2.6rem;
    margin: 0 0 0.5rem;
    font-weight: bold;
    /* Dark antique gold — matches the game's gold-700. 6.44:1 on white,
       so it stays well within WCAG AA contrast. */
    color: #665015;
  }
  .works-byline {
    font-size: 1.4rem;
    font-style: italic;
    margin: 0 0 1rem;
  }
  .works-author { font-style: normal; }
  .works-deck {
    font-size: 1rem;
    margin: 0.5rem 0;
  }
  .works-counts {
    font-size: 0.95rem;
    color: #555;
    margin-top: 1rem;
  }

  /* ===== Each publication ===== */
  .works-publication {
    margin-bottom: 2.5rem;
  }
  .works-pub-meta {
    font-size: 0.8rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #6e4f12;
    margin: 0 0 0.35rem;
    font-weight: bold;
  }
  .works-pub-title {
    font-size: 1.6rem;
    margin: 0 0 0.75rem;
    line-height: 1.2;
    font-weight: bold;
    /* Dark antique gold — same as the cover title. */
    color: #665015;
  }
  .works-pub-desc {
    font-size: 1.05rem;
    font-style: italic;
    line-height: 1.6;
    margin: 0 0 1.25rem;
  }
  .works-evidence-heading {
    font-size: 1.05rem;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    border-bottom: 1px solid #ccc;
    padding-bottom: 0.25rem;
    margin: 1.5rem 0 0.75rem;
  }
  .works-no-evidence {
    font-style: italic;
    color: #555;
  }

  /* ===== Evidence table ===== */
  .works-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
    table-layout: fixed;
  }
  .works-table-caption {
    /* Caption is important for screen readers but visually redundant
       with the H3 above — visually hide it but keep it in the a11y tree. */
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .works-th {
    background: #f0e6c8;
    text-align: left;
    padding: 0.5rem 0.6rem;
    border: 1px solid #c8a84b;
    font-weight: bold;
    vertical-align: top;
  }
  .works-td {
    padding: 0.5rem 0.6rem;
    border: 1px solid #ddd;
    vertical-align: top;
    line-height: 1.5;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  .works-th-date, .works-td-date { width: 10%; }
  .works-th-title, .works-td-title { width: 18%; }
  .works-th-content, .works-td-content { width: 34%; }
  .works-th-sig, .works-td-sig { width: 20%; }
  .works-th-cite, .works-td-cite { width: 18%; }
  .works-td-title { font-weight: bold; }
  .works-td-sig { font-style: italic; }
  .works-td-cite { font-style: italic; font-size: 0.82rem; }

  /* ===== Print rules ===== */
  @page {
    /* Landscape — the evidence table has five columns and needs the
       wider page to stay legible. */
    size: letter landscape;
    /* @page margin stays at 0: Chrome's print engine handles non-zero
       @page margins inconsistently and content can bleed past the edge.
       The blank space around the printout is provided by .works-doc's
       own padding below, which the print box model honours reliably. */
    margin: 0;
  }

  @media print {
    body { background: #fff; }

    /* Hide the toolbar entirely when printing */
    .works-toolbar { display: none !important; }

    /* The document fills the page. Its 0.5in padding creates the band of
       blank space around the printout — done with element padding rather
       than @page margin so nothing bleeds past the edge. */
    .works-doc {
      max-width: none;
      width: auto;
      margin: 0;
      padding: 0.5in;
      box-shadow: none;
    }

    /* Each publication starts on a fresh page. The cover is page 1. */
    .works-publication {
      break-before: page;
      page-break-before: always;  /* legacy browser support */
      margin-bottom: 0;
    }

    /* Don't break inside a publication's heading/description block */
    .works-pub-meta,
    .works-pub-title,
    .works-pub-desc,
    .works-evidence-heading {
      break-after: avoid;
      page-break-after: avoid;
    }

    /* Table header repeats at the top of each printed page —
       this is also what makes the <th> tags carry across pages
       in the tagged PDF output. */
    .works-table thead {
      display: table-header-group;
    }

    /* Avoid breaking a row across pages where possible */
    .works-table tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
  }
`;

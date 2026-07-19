import { useState } from 'react';
import { exportPublicationsToPDF } from '../lib/publicationsPDF.js';
import { sortEvidenceByDate } from '../lib/evidenceSort.js';
import FleuronDivider from './FleuronDivider.jsx';

/**
 * Bookshelf — collapsible row of book/article spines for each successful
 * publication the player has made.
 *
 *   Collapsed:  thin chevron bar at the bottom of the page
 *   Expanded:   horizontal scrollable row of spines with a download icon
 *
 * Phase 10.8 — added below the Research Notebook.
 *
 * Spines render as:
 *   - Article: thin (~22px wide × 144px tall), vertical title
 *   - Book:    thick (~44px wide × 144px tall), vertical title
 *
 * Clicking a spine opens a PublicationModal with the publication's
 * details and evidence table.
 *
 * @param {Object[]} publications  state.publications (newest at end)
 * @param {string}   playerName    used in the PDF filename / header
 * @param {Object}   deck          used in the PDF header
 */
export default function Bookshelf({ publications, playerName, deck }) {
  const [collapsed, setCollapsed] = useState(true);
  const [openPub, setOpenPub] = useState(null);

  const count = publications.length;

  return (
    <>
      <section className="surface-binding border-t border-edge-on-dark">

        {/* Header bar — always visible, click to toggle */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="w-full px-8 py-2 flex items-center justify-between gap-3 hover:bg-teal-800/40 transition-colors"
          aria-expanded={!collapsed}
        >
          <span className="flex items-center gap-2">
            <span
              className="font-mono text-xs text-gold-400 transition-transform inline-block"
              style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)' }}
            >
              ▾
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream-100/80">
              Bookshelf
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-cream-200">
              · {count} published
            </span>
          </span>

          {!collapsed && count > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                exportPublicationsToPDF({ publications, playerName, deck });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  exportPublicationsToPDF({ publications, playerName, deck });
                }
              }}
              className="font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:text-gold-300 cursor-pointer flex items-center gap-1"
              title="Open your collected works in a new tab — print or save as an accessible PDF from there"
            >
              ⎙ View / Print Works
            </span>
          )}
        </button>

        {/* Spines rail — only when expanded */}
        {!collapsed && (
          <div className="px-8 py-3 border-t border-gold-500/20 animate-fade-in">
            {count === 0 ? (
              <p className="font-serif italic text-cream-200 text-sm text-center py-4">
                The shelf is empty. Your published work will appear here.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex gap-1 items-end min-w-max">
                  {publications.map((pub) => (
                    <PublicationSpine
                      key={pub.id}
                      pub={pub}
                      onClick={() => setOpenPub(pub)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Modal — shown over the rest of the UI when a spine is clicked */}
      {openPub && (
        <PublicationModal pub={openPub} onClose={() => setOpenPub(null)} />
      )}
    </>
  );
}

/**
 * PublicationSpine — a single book/article spine on the shelf.
 *
 * Articles are thin and pale; books are thick and saturated. The spine
 * shows the title rotated 90° (reads bottom-to-top, like a real bookshelf).
 *
 * The full-height shelf row is 144px (h-36) — articles are 22px wide,
 * books are 44px wide.
 */
function PublicationSpine({ pub, onClick }) {
  const isBook = pub.kind === 'book';
  const isConference = pub.kind === 'conference';
  const widthClass = isBook ? 'w-11' : 'w-[22px]';
  const colorClass = isBook
    ? 'bg-oxblood-500 border-oxblood-700 text-cream-50 hover:bg-oxblood-400'
    : isConference
      ? 'bg-gold-600 border-gold-800 text-ink-900 hover:bg-gold-500'
      : 'bg-teal-700 border-teal-900 text-cream-100 hover:bg-teal-600';
  const kindLabel = isBook ? 'Book' : isConference ? 'Conference paper' : 'Article';
  const prestigeNote = pub.prestige > 0 ? `, +${pub.prestige} prestige` : '';

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${kindLabel} · ${pub.title} (Year ${pub.year}${prestigeNote})`}
      className={`
        relative ${widthClass} h-36 border-2 ${colorClass}
        transition-all duration-200 ease-desk hover:-translate-y-1 hover:shadow-card-hover
        flex items-center justify-center flex-shrink-0 cursor-pointer
      `}
    >
      {/* Inner gilt border for richer look */}
      <span className="absolute inset-1 border border-gold-500/30 pointer-events-none" />

      {/* Title rotated 90° counter-clockwise so it reads bottom-to-top */}
      <span
        className="font-display font-bold text-[10px] uppercase tracking-wider whitespace-nowrap overflow-hidden"
        style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          textOverflow: 'ellipsis',
          maxHeight: '130px',
        }}
      >
        {pub.title}
      </span>
    </button>
  );
}


/**
 * PublicationModal — opens when the player clicks a spine. Shows:
 *   - Title (the random title)
 *   - Description (paragraph from the conclusion)
 *   - Table of evidence: title / content / significance
 *
 * Per design (Phase 10.8) — the conclusion question is NOT included on the
 * publication itself; only the random title and description appear.
 */
function PublicationModal({ pub, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[70] bg-teal-950/80 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto animate-fade-in"
      onClick={onClose}
    >
      <article
        className="relative surface-paper max-w-5xl w-full my-6 animate-fade-up"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(184, 146, 58, 0.5)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Inner gilt frame */}
        <div className="absolute inset-2 border border-gold-500/30 pointer-events-none" />

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-30 px-4 py-2 bg-cream-50 border border-gold-500 text-ink-900 hover:bg-oxblood-500 hover:text-cream-50 hover:border-oxblood-500 transition-colors font-mono text-sm uppercase tracking-wider shadow-md"
          aria-label="Close"
        >
          ✕ Close
        </button>

        <div className="px-12 py-10">
          {/* Type chip + year */}
          <div className="flex items-center gap-3 mb-3">
            <span className="font-mono uppercase tracking-[0.15em] px-2.5 py-0.5 border border-cream-300 text-ink-900 bg-cream-50 text-xs">
              {pub.kind === 'book' ? 'Book' : pub.kind === 'conference' ? 'Conference paper' : 'Article'}
            </span>
            <span className="font-mono text-xs text-ink-700">Year {pub.year}</span>
            {pub.prestige > 0 && (
              <span className="font-mono text-xs text-ink-700">+{pub.prestige} prestige</span>
            )}
          </div>

          {/* Title */}
          <h2 className="font-display text-4xl font-bold text-ink-900 leading-tight">
            {pub.title}
          </h2>

          {/* Description */}
          {pub.description && (
            <p className="font-serif text-lg leading-relaxed text-ink-900 mt-4 italic">
              {pub.description}
            </p>
          )}

          <FleuronDivider className="my-6" />

          {/* Evidence table */}
          <h3 className="font-display text-xl font-bold uppercase tracking-widest text-ink-900 mb-3">
            Evidence
          </h3>

          {pub.evidence.length === 0 ? (
            <p className="font-serif italic text-ink-700">No evidence recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-cream-200/60 border-b border-gold-500/50">
                    <th className="font-display font-bold text-left px-3 py-2 text-ink-900 text-sm uppercase tracking-wider w-[12%]">
                      Date
                    </th>
                    <th className="font-display font-bold text-left px-3 py-2 text-ink-900 text-sm uppercase tracking-wider w-[20%]">
                      Title
                    </th>
                    <th className="font-display font-bold text-left px-3 py-2 text-ink-900 text-sm uppercase tracking-wider w-[44%]">
                      Content
                    </th>
                    <th className="font-display font-bold text-left px-3 py-2 text-ink-900 text-sm uppercase tracking-wider w-[24%]">
                      Significance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortEvidenceByDate(pub.evidence).map((ev, i) => (
                    <tr key={i} className="border-b border-gold-500/20 align-top">
                      <td className="font-mono px-3 py-3 text-ink-900 text-xs whitespace-nowrap">
                        {ev.date || '—'}
                      </td>
                      <td className="font-serif px-3 py-3 text-ink-900 font-semibold">
                        {ev.title || '—'}
                      </td>
                      <td className="font-serif px-3 py-3 text-ink-900 leading-relaxed">
                        {ev.content || '—'}
                      </td>
                      <td className="font-serif px-3 py-3 text-ink-900 italic leading-relaxed">
                        {ev.significance || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </article>
    </div>
  );
}

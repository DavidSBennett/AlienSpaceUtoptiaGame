/**
 * DeckListPage — /decks and /cards (signed-in). The unified Card Library that
 * merges the old deck-list and card-viewer pages.
 *
 * Controls:
 *   • Deck dropdown (All Cards | a deck)
 *   • Evidence / Conclusions filter
 *   • Text search
 *   • Cards | Table view
 *   • In Cards view: Rendered (from data) | Image (the uploaded PNGs)
 *
 * Cards view tiles are all the same 5:7 shape so toggling Rendered↔Image
 * doesn't reflow the grid. In Image mode, hovering flips a card to its back,
 * and a conclusion shows its Article and Book faces (only where PNGs exist);
 * in Rendered mode a conclusion shows as a single card.
 *
 * Clicking any card/row opens the styled CardModal — now with the front/back
 * images and a full "Card Data" section, plus prev/next navigation.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { fetchDecks, fetchCards, fetchAllCards } from '../api/client.js';
import { CardModal } from '../components/Card.jsx';
import SkipLink from '../components/SkipLink.jsx';

const isConclusion = (c) => String(c?.type || '').toLowerCase() === 'conclusion';

/**
 * The card "faces" to show as images. Evidence cards have one front/back pair;
 * conclusions have Article and Book pairs.
 */
function cardFaces(card) {
  if (isConclusion(card)) {
    return [
      { label: 'Article', front: card.image_article_front, back: card.image_article_back },
      { label: 'Book',    front: card.image_book_front,    back: card.image_book_back },
    ];
  }
  return [{ label: '', front: card.image_front, back: card.image_back }];
}

export default function DeckListPage() {
  const [decks, setDecks] = useState([]);
  const [selectedDeckId, setSelectedDeckId] = useState('all');
  const [cards, setCards] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);

  const [cardType, setCardType] = useState('archive');   // 'archive' | 'conclusion'
  const [search, setSearch] = useState('');
  const [view, setView] = useState('cards');             // 'cards' | 'table'
  const [cardStyle, setCardStyle] = useState('png'); // 'rendered' | 'png'
  const [sortKey, setSortKey] = useState('id');
  const [sortDir, setSortDir] = useState('asc');
  const [openIndex, setOpenIndex] = useState(null);

  // Deck dropdown (value/label shape, with idDeck/nameDeck fallback).
  useEffect(() => {
    let cancelled = false;
    fetchDecks()
      .then((data) => {
        if (cancelled) return;
        const list = (Array.isArray(data) ? data : []).map((d) => ({
          value: String(d.value ?? d.idDeck),
          label: d.label ?? d.nameDeck ?? `Deck ${d.value ?? d.idDeck}`,
        }));
        setDecks(list);
      })
      .catch(() => { /* dropdown falls back to All Cards */ });
    return () => { cancelled = true; };
  }, []);

  // Cards for the current deck selection.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    const load = selectedDeckId === 'all' ? fetchAllCards() : fetchCards(selectedDeckId);
    load
      .then((data) => {
        if (cancelled) return;
        setCards(Array.isArray(data) ? data : []);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Could not load cards.');
        setStatus('error');
      });
    return () => { cancelled = true; };
  }, [selectedDeckId]);

  // The list changes when filters change — close any open modal.
  useEffect(() => { setOpenIndex(null); }, [selectedDeckId, cardType, search]);

  const deckName = useMemo(() => {
    const m = new Map();
    for (const d of decks) m.set(String(d.value), d.label);
    return m;
  }, [decks]);

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase();
    const typed = cards.filter((c) => (cardType === 'conclusion' ? isConclusion(c) : !isConclusion(c)));
    const searched = !q ? typed : typed.filter((c) =>
      [c.title, c.author, c.content, c.location, c.source_type, c.citation, c.description]
        .some((v) => String(v || '').toLowerCase().includes(q))
    );

    const dir = sortDir === 'asc' ? 1 : -1;
    const cmp = (a, b) => {
      if (sortKey === 'id') {
        return ((Number(a.idDeck) * 1e7 + Number(a.idCard)) - (Number(b.idDeck) * 1e7 + Number(b.idCard))) * dir;
      }
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (sortKey === 'bonus' || sortKey === 'sequence_number') {
        return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
      }
      return String(av).toLowerCase().localeCompare(String(bv).toLowerCase(), undefined, { numeric: true }) * dir;
    };
    return [...searched].sort(cmp);
  }, [cards, cardType, search, sortKey, sortDir]);

  const toggleSort = useCallback((key) => {
    setSortKey((prev) => {
      if (prev === key) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return prev; }
      setSortDir('asc');
      return key;
    });
  }, []);

  const openCard = openIndex != null ? displayed[openIndex] : null;
  const onPrev = openIndex != null && openIndex > 0 ? () => setOpenIndex((i) => i - 1) : null;
  const onNext = openIndex != null && openIndex < displayed.length - 1 ? () => setOpenIndex((i) => i + 1) : null;

  const tabBtn = (active) =>
    `px-4 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
      active ? 'bg-gold-500 text-teal-950' : 'text-cream-200 hover:bg-cream-50/10'
    }`;

  return (
    <>
      <SkipLink />
      <main id="main-content" tabIndex={-1} className="min-h-screen px-6 py-10 surface-binding">
        <div className="max-w-7xl mx-auto">

          {/* Header */}
          <div className="flex items-end justify-between flex-wrap gap-4 mb-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-400 mb-1">The Historians</p>
              <h1 className="font-display text-4xl font-medium text-cream-50 leading-none">Card Library</h1>
            </div>
            <Link to="/" className="btn-primary inline-block">Return to Lobby</Link>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between flex-wrap gap-4 border-y border-gold-500/20 py-3 my-4">
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">Deck</span>
                <select value={selectedDeckId} onChange={(e) => setSelectedDeckId(e.target.value)} className="input-dark">
                  <option value="all">All Cards</option>
                  {decks.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </label>

              {/* Evidence / Conclusions */}
              <div className="inline-flex border border-gold-500/40">
                <button type="button" onClick={() => setCardType('archive')} className={tabBtn(cardType === 'archive')}>Evidence</button>
                <button type="button" onClick={() => setCardType('conclusion')} className={`${tabBtn(cardType === 'conclusion')} border-l border-gold-500/40`}>Conclusions</button>
              </div>

              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="input-dark w-44"
              />
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {/* Cards view sub-toggle: rendered vs png */}
              {view === 'cards' && (
                <div className="inline-flex border border-gold-500/40">
                  <button type="button" onClick={() => setCardStyle('rendered')} className={tabBtn(cardStyle === 'rendered')}>Rendered</button>
                  <button type="button" onClick={() => setCardStyle('png')} className={`${tabBtn(cardStyle === 'png')} border-l border-gold-500/40`}>Image</button>
                </div>
              )}

              {/* Cards | Table */}
              <div className="inline-flex border border-gold-500/40">
                <button type="button" onClick={() => setView('cards')} className={tabBtn(view === 'cards')}>Cards</button>
                <button type="button" onClick={() => setView('table')} className={`${tabBtn(view === 'table')} border-l border-gold-500/40`}>Table</button>
              </div>
            </div>
          </div>

          {/* Status */}
          {status === 'loading' && <p className="font-serif italic text-cream-200/70 text-sm py-8 text-center">Loading cards…</p>}
          {status === 'error' && <p className="font-serif italic text-oxblood-300 text-sm py-8 text-center">{error}</p>}

          {status === 'ready' && (
            <>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream-200/50 mb-4">
                {displayed.length} {cardType === 'conclusion' ? 'conclusion' : 'card'}{displayed.length === 1 ? '' : 's'}
              </p>

              {displayed.length === 0 ? (
                <p className="font-serif italic text-cream-200/70 text-sm py-8 text-center">
                  No {cardType === 'conclusion' ? 'conclusions' : 'cards'} here.
                </p>
              ) : view === 'table' ? (
                <CardTable rows={displayed} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort}
                           deckName={deckName} onRowClick={setOpenIndex} />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {displayed.flatMap((card, i) =>
                    cardStyle === 'png'
                      ? cardFaces(card).map((face, fi) => (
                          <PngCell key={`${card.idDeck}-${card.idCard}-${face.label || fi}`} card={card} face={face} onClick={() => setOpenIndex(i)} />
                        ))
                      : [<RenderedCell key={`${card.idDeck}-${card.idCard}`} card={card} onClick={() => setOpenIndex(i)} />]
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {openCard && (
        <CardModal
          card={openCard}
          onClose={() => setOpenIndex(null)}
          showSignificance
          showTags
          onPrev={onPrev}
          onNext={onNext}
          position={{ current: openIndex + 1, total: displayed.length }}
          faces={cardFaces(openCard)}
        />
      )}
    </>
  );
}


/* ── Rendered-from-data card (5:7) ──────────────────────────────────────── */

function RenderedCell({ card, onClick }) {
  const body = card.content || card.description;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group text-left surface-paper border border-gold-500/40 hover:border-gold-500 hover:shadow-card-hover
                 transition-all duration-200 flex flex-col aspect-[5/7] overflow-hidden"
    >
      <h3 className="font-display font-bold text-ink-900 text-center text-sm leading-tight px-3 pt-3 pb-1 line-clamp-2">
        {card.title || 'Untitled'}
      </h3>
      {card.image_url && (
        <div className="px-3">
          <img src={card.image_url} alt={card.title || ''} loading="lazy"
               className="w-full h-24 object-cover border border-gold-500/20"
               onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
      )}
      {body && (
        <p className="font-serif text-ink-800 text-[11px] leading-snug px-3 pt-2 line-clamp-5 flex-1">
          {body}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between px-3 py-1.5 font-mono text-[9px] text-ink-700 border-t border-gold-500/20">
        <span title="Deck ID – Card ID">{card.idDeck}-{card.idCard}</span>
        <span title="Date">{card.date || '—'}</span>
      </div>
    </button>
  );
}


/* ── PNG card (5:7) with hover-flip ─────────────────────────────────────── */

function PngCell({ card, face, onClick }) {
  const front = face?.front;
  const back = face?.back;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${card.title || 'Untitled'}${face?.label ? ` (${face.label})` : ''}`}
      className="group relative aspect-[5/7] border border-gold-500/30 bg-teal-950/40 overflow-hidden
                 hover:border-gold-400 hover:-translate-y-1 transition-all duration-200"
    >
      {face?.label && (
        <span className="absolute top-1 left-1 z-10 font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 bg-teal-950/85 text-gold-300 border border-gold-500/40">
          {face.label}
        </span>
      )}
      {front
        ? <img src={front} alt={card.title || 'Card'} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        : <FacePlaceholder card={card} />}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        {back
          ? <img src={back} alt={`${card.title || 'Card'} back`} className="w-full h-full object-cover" loading="lazy" />
          : <FacePlaceholder card={card} back />}
      </div>
    </button>
  );
}

function FacePlaceholder({ card, back }) {
  return (
    <div className="absolute inset-0 surface-paper flex flex-col items-center justify-center text-center px-3">
      {back && <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-ink-700 mb-1">Back</p>}
      <p className="font-display text-sm font-bold text-ink-900 line-clamp-4">{card.title || 'Untitled'}</p>
      <p className="font-mono text-[9px] text-ink-600 mt-2">no image</p>
    </div>
  );
}


/* ── Table ──────────────────────────────────────────────────────────────── */

const COLS = [
  { key: 'id', label: 'Deck–№' },
  { key: 'type', label: 'Type' },
  { key: 'title', label: 'Title' },
  { key: 'source_type', label: 'Source' },
  { key: 'author', label: 'Author' },
  { key: 'date', label: 'Date' },
  { key: 'location', label: 'Location' },
  { key: 'argument', label: 'Arg' },
  { key: 'sub_argument', label: 'Sub' },
  { key: 'bonus', label: 'Bonus' },
  { key: 'context_tags', label: 'Context tags' },
];

function CardTable({ rows, sortKey, sortDir, onSort, onRowClick }) {
  const arrow = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  return (
    <div className="overflow-x-auto border border-gold-500/20">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-teal-900/40">
            {COLS.map((c) => (
              <th key={c.key} onClick={() => onSort(c.key)}
                  className="py-2 px-3 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-gold-400 cursor-pointer select-none hover:text-gold-300 whitespace-nowrap"
                  title="Click to sort">
                {c.label}{arrow(c.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-serif text-cream-100 align-top">
          {rows.map((card, i) => (
            <tr key={`${card.idDeck}-${card.idCard}`} onClick={() => onRowClick(i)}
                className="border-t border-gold-500/15 hover:bg-cream-50/5 cursor-pointer">
              <td className="py-2 px-3 font-mono text-cream-200/70 whitespace-nowrap">{card.idDeck}-{card.idCard}</td>
              <td className="py-2 px-3 text-cream-200/80">{card.type || '—'}</td>
              <td className="py-2 px-3 font-display text-cream-50">{card.title || '—'}</td>
              <td className="py-2 px-3 text-cream-200/80">{card.source_type || '—'}</td>
              <td className="py-2 px-3 text-cream-200/80">{card.author || '—'}</td>
              <td className="py-2 px-3 whitespace-nowrap text-cream-200/80">{card.date || '—'}</td>
              <td className="py-2 px-3 text-cream-200/80">{card.location || '—'}</td>
              <td className="py-2 px-3 text-cream-200/80">{card.argument || '—'}</td>
              <td className="py-2 px-3 text-cream-200/80">{card.sub_argument || '—'}</td>
              <td className="py-2 px-3 text-cream-200/80">{card.bonus ?? '—'}</td>
              <td className="py-2 px-3 text-cream-200/80 max-w-xs">{card.context_tags || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

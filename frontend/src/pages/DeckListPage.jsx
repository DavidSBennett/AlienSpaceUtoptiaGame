/**
 * DeckListPage — /decks (public, no login required).
 *
 * A browsable archive of the game's cards. A pull-down selects a single
 * deck or "All Cards" (every uploaded card). A toggle switches between:
 *
 *   • Card view  — each card rendered like a real card: title centered on
 *                  top, image, content, significance, with the deck/card id
 *                  in the lower-left and the card's date in the lower-right.
 *                  Clicking a card opens the normal CardModal.
 *   • Table view — the same information in a sortable table (click any
 *                  column header to sort; click again to reverse).
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';

import { fetchDecks, fetchCards, fetchAllCards } from '../api/client.js';
import { CardModal } from '../components/Card.jsx';
import CornerOrnament from '../components/CornerOrnament.jsx';
import SkipLink from '../components/SkipLink.jsx';

export default function DeckListPage() {
  const [decks, setDecks] = useState([]);
  const [selectedDeckId, setSelectedDeckId] = useState('all'); // 'all' | deck id string
  const [cards, setCards] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);

  const [view, setView] = useState('card'); // 'card' | 'table'
  const [cardType, setCardType] = useState('archive'); // 'archive' (evidence) | 'conclusion'
  const [sortKey, setSortKey] = useState('id');
  const [sortDir, setSortDir] = useState('asc');

  const [openIndex, setOpenIndex] = useState(null); // index into `displayed`

  // Load the deck list once for the dropdown.
  useEffect(() => {
    let cancelled = false;
    fetchDecks()
      .then((data) => { if (!cancelled) setDecks(Array.isArray(data) ? data : []); })
      .catch(() => { /* dropdown just falls back to All Cards */ });
    return () => { cancelled = true; };
  }, []);

  // Load cards whenever the selection changes.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    const load = selectedDeckId === 'all'
      ? fetchAllCards()
      : fetchCards(selectedDeckId);
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

  // The displayed list shifts when the deck or card-type filter changes, so
  // close any open card modal to avoid a stale index.
  useEffect(() => { setOpenIndex(null); }, [selectedDeckId, cardType]);

  // Sort comparator. The id column sorts numerically by (deck, card); the
  // date column tries numeric first (years) then falls back to text; all
  // other columns are case-insensitive string sorts.
  const displayed = useMemo(() => {
    // Conclusions live in their own list; everything else is "evidence".
    const typed = cards.filter((c) =>
      cardType === 'conclusion' ? c.type === 'conclusion' : c.type !== 'conclusion'
    );
    const arr = [...typed];
    const dir = sortDir === 'asc' ? 1 : -1;
    const cmp = (a, b) => {
      if (sortKey === 'id') {
        const av = Number(a.idDeck) * 1e7 + Number(a.idCard);
        const bv = Number(b.idDeck) * 1e7 + Number(b.idCard);
        return (av - bv) * dir;
      }
      let av = a[sortKey] ?? '';
      let bv = b[sortKey] ?? '';
      if (sortKey === 'date') {
        const an = parseFloat(av), bn = parseFloat(bv);
        if (!Number.isNaN(an) && !Number.isNaN(bn) && String(an) === String(av).trim() && String(bn) === String(bv).trim()) {
          return (an - bn) * dir;
        }
      }
      return String(av).toLowerCase().localeCompare(String(bv).toLowerCase()) * dir;
    };
    arr.sort(cmp);
    return arr;
  }, [cards, cardType, sortKey, sortDir]);

  const toggleSort = useCallback((key) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prevKey;
      }
      setSortDir('asc');
      return key;
    });
  }, []);

  const openCard = openIndex != null ? displayed[openIndex] : null;
  const onPrev = openIndex != null && openIndex > 0
    ? () => setOpenIndex((i) => i - 1) : null;
  const onNext = openIndex != null && openIndex < displayed.length - 1
    ? () => setOpenIndex((i) => i + 1) : null;

  return (
    <>
      <SkipLink />
      <main id="main-content" tabIndex={-1} className="min-h-screen px-6 py-10 surface-binding">
        <div className="max-w-7xl mx-auto">

          {/* Header */}
          <div className="flex items-end justify-between flex-wrap gap-4 mb-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-400 mb-1">
                The Historians
              </p>
              <h1 className="font-display text-4xl font-medium text-cream-50 leading-none">
                Deck List
              </h1>
            </div>
            <Link to="/" className="btn-primary inline-block">
              Return to Lobby
            </Link>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between flex-wrap gap-4 border-y border-gold-500/20 py-3 my-4">
            <div className="flex items-center gap-5 flex-wrap">
              <label className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">Deck</span>
                <select
                  value={selectedDeckId}
                  onChange={(e) => setSelectedDeckId(e.target.value)}
                  className="input-dark"
                >
                  <option value="all">All Cards</option>
                  {decks.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </label>

              {/* Card-type segmented control — evidence vs conclusions */}
              <div className="inline-flex border border-gold-500/40">
                <button
                  type="button"
                  onClick={() => setCardType('archive')}
                  aria-pressed={cardType === 'archive'}
                  className={`px-4 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
                    cardType === 'archive' ? 'bg-gold-500 text-teal-950' : 'text-cream-200 hover:bg-cream-50/10'
                  }`}
                >
                  Evidence
                </button>
                <button
                  type="button"
                  onClick={() => setCardType('conclusion')}
                  aria-pressed={cardType === 'conclusion'}
                  className={`px-4 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors border-l border-gold-500/40 ${
                    cardType === 'conclusion' ? 'bg-gold-500 text-teal-950' : 'text-cream-200 hover:bg-cream-50/10'
                  }`}
                >
                  Conclusions
                </button>
              </div>
            </div>

            {/* View toggle */}
            <div className="inline-flex border border-gold-500/40">
              <button
                type="button"
                onClick={() => setView('card')}
                aria-pressed={view === 'card'}
                className={`px-4 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
                  view === 'card' ? 'bg-gold-500 text-teal-950' : 'text-cream-200 hover:bg-cream-50/10'
                }`}
              >
                Cards
              </button>
              <button
                type="button"
                onClick={() => setView('table')}
                aria-pressed={view === 'table'}
                className={`px-4 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors border-l border-gold-500/40 ${
                  view === 'table' ? 'bg-gold-500 text-teal-950' : 'text-cream-200 hover:bg-cream-50/10'
                }`}
              >
                Table
              </button>
            </div>
          </div>

          {/* Status / count */}
          {status === 'loading' && (
            <p className="font-serif italic text-cream-200/70 text-sm py-8 text-center">Loading cards…</p>
          )}
          {status === 'error' && (
            <p className="font-serif italic text-oxblood-300 text-sm py-8 text-center">{error}</p>
          )}
          {status === 'ready' && (
            <>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream-200/50 mb-4">
                {displayed.length} {cardType === 'conclusion' ? 'conclusion' : 'card'}{displayed.length === 1 ? '' : 's'}
              </p>

              {displayed.length === 0 ? (
                <p className="font-serif italic text-cream-200/70 text-sm py-8 text-center">
                  No {cardType === 'conclusion' ? 'conclusion cards' : 'cards'} here.
                </p>
              ) : view === 'card' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {displayed.map((card, i) => (
                    <CardFace key={`${card.idDeck}-${card.idCard}`} card={card} onClick={() => setOpenIndex(i)} />
                  ))}
                </div>
              ) : (
                <CardTable
                  rows={displayed}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  onRowClick={(i) => setOpenIndex(i)}
                />
              )}
            </>
          )}
        </div>
      </main>

      {openCard && (
        <CardModal
          card={openCard}
          onClose={() => setOpenIndex(null)}
          showSignificance={true}
          showTags={true}
          onPrev={onPrev}
          onNext={onNext}
          position={{ current: openIndex + 1, total: displayed.length }}
        />
      )}
    </>
  );
}


/**
 * CardFace — a single card rendered "like a real card": title centered on
 * top, image, content, significance, deck/card id lower-left, date lower-right.
 */
function CardFace({ card, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group text-left surface-paper border border-gold-500/40 hover:border-gold-500
                 hover:shadow-card-hover transition-all duration-200 flex flex-col h-full overflow-hidden"
    >
      {/* Title — centered at top */}
      <h3 className="font-display font-bold text-ink-900 text-center text-base leading-tight px-3 pt-3 pb-2">
        {card.title || 'Untitled'}
      </h3>

      {/* Image */}
      {card.image_url && (
        <div className="px-3">
          <img
            src={card.image_url}
            alt={card.description || card.title || ''}
            loading="lazy"
            className="w-full h-36 object-cover border border-gold-500/20"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        </div>
      )}

      {/* Content */}
      {card.content && (
        <p className="font-serif text-ink-800 text-xs leading-snug px-3 pt-2 line-clamp-4">
          {card.content}
        </p>
      )}

      {/* Significance */}
      {card.significance && (
        <p className="font-serif italic text-ink-700 text-[11px] leading-snug px-3 pt-2 line-clamp-3 border-t border-gold-500/20 mt-2">
          <span className="font-mono not-italic text-[8px] uppercase tracking-[0.2em] text-gold-700 block mb-0.5">Significance</span>
          {card.significance}
        </p>
      )}

      {/* Footer corners: deck-card id (left), date (right) */}
      <div className="mt-auto flex items-center justify-between px-3 py-2 font-mono text-[10px] text-ink-700 border-t border-gold-500/20">
        <span title="Deck ID – Card ID">{card.idDeck}-{card.idCard}</span>
        <span title="Date">{card.date || '—'}</span>
      </div>
    </button>
  );
}


/**
 * CardTable — the same card information in a sortable table.
 */
function CardTable({ rows, sortKey, sortDir, onSort, onRowClick }) {
  const COLS = [
    { key: 'id', label: 'Deck–Card', align: 'left' },
    { key: 'title', label: 'Title', align: 'left' },
    { key: 'date', label: 'Date', align: 'left' },
    { key: 'source_type', label: 'Source', align: 'left' },
    { key: 'author', label: 'Author', align: 'left' },
    { key: 'content', label: 'Content', align: 'left' },
    { key: 'significance', label: 'Significance', align: 'left' },
  ];

  const arrow = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <div className="overflow-x-auto border border-gold-500/20">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-teal-900/40">
            {COLS.map((c) => (
              <th
                key={c.key}
                onClick={() => onSort(c.key)}
                className="py-2 px-3 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-gold-400
                           cursor-pointer select-none hover:text-gold-300 whitespace-nowrap"
                title="Click to sort"
              >
                {c.label}{arrow(c.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-serif text-cream-100 align-top">
          {rows.map((card, i) => (
            <tr
              key={`${card.idDeck}-${card.idCard}`}
              onClick={() => onRowClick(i)}
              className="border-t border-gold-500/15 hover:bg-cream-50/5 cursor-pointer"
            >
              <td className="py-2 px-3 font-mono text-cream-200/70 whitespace-nowrap">{card.idDeck}-{card.idCard}</td>
              <td className="py-2 px-3 font-display text-cream-50">{card.title || '—'}</td>
              <td className="py-2 px-3 whitespace-nowrap text-cream-200/80">{card.date || '—'}</td>
              <td className="py-2 px-3 text-cream-200/80">{card.source_type || '—'}</td>
              <td className="py-2 px-3 text-cream-200/80">{card.author || '—'}</td>
              <td className="py-2 px-3 text-cream-200/90 max-w-md">{card.content || '—'}</td>
              <td className="py-2 px-3 italic text-cream-200/70 max-w-md">{card.significance || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

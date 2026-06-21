/**
 * CardViewerPage — browse every card across all decks, in two modes:
 *
 *   • Table  — sortable columns of the card data.
 *   • Images — the rendered card faces. Hover flips a card to its back; click
 *              opens a modal with front + back on the left and the full card
 *              data on the right.
 *
 * Card front/back images come from the new image_front / image_back fields
 * (URLs supplied via the deck spreadsheet). Cards without an image fall back to
 * a simple placeholder so the grid still reads.
 *
 * Signed-in users only (gated in App.jsx).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAllCards, fetchDecks } from '../api/client.js';

// Columns shown in table mode. `num` flags numeric sorting.
const COLUMNS = [
  { key: 'deckName',        label: 'Deck' },
  { key: 'sequence_number', label: '№', num: true },
  { key: 'type',            label: 'Type' },
  { key: 'title',           label: 'Title' },
  { key: 'source_type',     label: 'Source' },
  { key: 'author',          label: 'Author' },
  { key: 'date',            label: 'Date' },
  { key: 'location',        label: 'Location' },
  { key: 'argument',        label: 'Arg' },
  { key: 'sub_argument',    label: 'Sub' },
  { key: 'bonus',           label: 'Bonus', num: true },
  { key: 'context_tags',    label: 'Context tags' },
];

/**
 * The card "faces" to show. Evidence/archive cards have one front+back pair.
 * Conclusions can be published as an article OR a book, so they have two
 * labelled pairs (Article, Book).
 */
function cardFaces(card) {
  if (String(card.type || '').toLowerCase() === 'conclusion') {
    return [
      { label: 'Article', front: card.image_article_front, back: card.image_article_back },
      { label: 'Book',    front: card.image_book_front,    back: card.image_book_back },
    ];
  }
  return [{ label: '', front: card.image_front, back: card.image_back }];
}

export default function CardViewerPage() {
  const [decks, setDecks] = useState([]);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [mode, setMode] = useState('image');        // 'table' | 'image'
  const [deckFilter, setDeckFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'sequence_number', dir: 'asc' });
  const [openCard, setOpenCard] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchDecks(), fetchAllCards()])
      .then(([d, c]) => {
        if (cancelled) return;
        setDecks(Array.isArray(d) ? d : []);
        setCards(Array.isArray(c) ? c : []);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  // Deck id → name, and cards annotated with their deck name.
  const deckName = useMemo(() => {
    const m = new Map();
    for (const d of decks) m.set(String(d.idDeck), d.nameDeck || `Deck ${d.idDeck}`);
    return m;
  }, [decks]);

  const annotated = useMemo(
    () => cards.map((c) => ({ ...c, deckName: deckName.get(String(c.idDeck)) || `Deck ${c.idDeck}` })),
    [cards, deckName]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return annotated.filter((c) => {
      if (deckFilter !== 'all' && String(c.idDeck) !== deckFilter) return false;
      if (!q) return true;
      return [c.title, c.author, c.content, c.location, c.source_type, c.citation]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [annotated, deckFilter, search]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key);
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (col?.num) {
        return ((Number(av) || 0) - (Number(bv) || 0)) * factor;
      }
      return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true }) * factor;
    });
  }, [filtered, sort]);

  function toggleSort(key) {
    setSort((cur) =>
      cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <Link to="/" className="font-mono text-[10px] uppercase tracking-wider text-cream-200/70 hover:text-gold-300">
              ← Home
            </Link>
            <h1 className="font-display text-3xl text-cream-50">Card Viewer</h1>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream-200/60 mt-1">
              {filtered.length} of {cards.length} cards
            </p>
          </div>

          {/* Mode toggle */}
          <div className="flex items-center border border-gold-500/40 rounded-sm overflow-hidden">
            {['image', 'table'].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-colors ${
                  mode === m ? 'bg-gold-500 text-teal-950' : 'text-cream-200 hover:bg-teal-800/40'
                }`}
              >
                {m === 'image' ? 'Images' : 'Table'}
              </button>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <select
            value={deckFilter}
            onChange={(e) => setDeckFilter(e.target.value)}
            className="bg-teal-950/60 border border-gold-500/40 px-3 py-2 font-mono text-xs text-cream-50 focus:border-gold-400 focus:outline-none"
          >
            <option value="all">All decks</option>
            {decks.map((d) => (
              <option key={d.idDeck} value={String(d.idDeck)}>{d.nameDeck || `Deck ${d.idDeck}`}</option>
            ))}
          </select>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, author, content…"
            className="flex-1 min-w-[12rem] bg-teal-950/60 border border-gold-500/40 px-3 py-2 font-mono text-xs text-cream-50 placeholder:text-cream-200/40 focus:border-gold-400 focus:outline-none"
          />
        </div>

        {loading && <p className="font-serif italic text-cream-200/70 py-12 text-center">Loading the archive…</p>}
        {error && <p className="font-serif italic text-oxblood-300 py-12 text-center">{error}</p>}

        {!loading && !error && mode === 'table' && (
          <CardTable cards={sorted} sort={sort} onSort={toggleSort} onOpen={setOpenCard} />
        )}

        {!loading && !error && mode === 'image' && (
          <div className="flex flex-wrap gap-4 justify-center sm:justify-start">
            {filtered.flatMap((card) =>
              cardFaces(card).map((face, i) => (
                <CardImageCell
                  key={`${card.idDeck}-${card.id}-${face.label || i}`}
                  card={card}
                  face={face}
                  onOpen={() => setOpenCard(card)}
                />
              ))
            )}
          </div>
        )}

        {openCard && <CardViewerModal card={openCard} onClose={() => setOpenCard(null)} />}
      </div>
    </main>
  );
}


/* ── Table mode ─────────────────────────────────────────────────────────── */

function CardTable({ cards, sort, onSort, onOpen }) {
  return (
    <div className="overflow-x-auto border border-gold-500/20">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="surface-binding">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => onSort(col.key)}
                className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-gold-300 cursor-pointer hover:text-gold-100 whitespace-nowrap select-none"
              >
                {col.label}
                {sort.key === col.key && <span className="ml-1">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => (
            <tr
              key={`${card.idDeck}-${card.id}`}
              onClick={() => onOpen(card)}
              className="border-t border-gold-500/10 hover:bg-teal-800/30 cursor-pointer"
            >
              {COLUMNS.map((col) => (
                <td key={col.key} className="px-3 py-2 font-serif text-sm text-cream-100 align-top max-w-[18rem]">
                  <span className="line-clamp-2">{String(card[col.key] ?? '') || '—'}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


/* ── Image mode ─────────────────────────────────────────────────────────── */

function CardImageCell({ card, face, onOpen }) {
  const front = face?.front;
  const back = face?.back;
  const titleSuffix = face?.label ? ` (${face.label})` : '';

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${card.title || 'Untitled'}${titleSuffix} — click for details`}
      className="group relative w-48 aspect-[5/7] flex-shrink-0 border border-gold-500/30 bg-teal-950/40 overflow-hidden hover:border-gold-400 hover:-translate-y-1 transition-all duration-200"
    >
      {/* Article / Book badge for conclusions */}
      {face?.label && (
        <span className="absolute top-1 left-1 z-10 font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 bg-teal-950/85 text-gold-300 border border-gold-500/40">
          {face.label}
        </span>
      )}

      {front ? (
        <img src={front} alt={card.title || 'Card'} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
      ) : (
        <CardPlaceholder card={card} face="front" />
      )}

      {/* Back — revealed on hover. Falls back to a placeholder if no back image. */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        {back ? (
          <img src={back} alt={`${card.title || 'Card'} (back)`} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <CardPlaceholder card={card} face="back" />
        )}
      </div>
    </button>
  );
}

function CardPlaceholder({ card, face }) {
  return (
    <div className="absolute inset-0 surface-paper flex flex-col items-center justify-center text-center px-3">
      <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-ink-700 mb-1">
        {face === 'back' ? 'Back' : (card.type || 'Card')}
      </p>
      <p className="font-display text-sm font-bold text-ink-900 line-clamp-4">{card.title || 'Untitled'}</p>
      <p className="font-mono text-[9px] text-ink-600 mt-2">no image</p>
    </div>
  );
}


/* ── Detail modal ───────────────────────────────────────────────────────── */

// Every field we surface in the detail panel, in display order.
const FIELDS = [
  ['deckName', 'Deck'],
  ['sequence_number', 'Sequence #'],
  ['type', 'Type'],
  ['title', 'Title'],
  ['source_type', 'Source type'],
  ['date', 'Date'],
  ['author', 'Author'],
  ['location', 'Location'],
  ['argument', 'Argument'],
  ['sub_argument', 'Sub-argument'],
  ['bonus', 'Bonus'],
  ['contributor', 'Contributor'],
  ['context_tags', 'Context tags'],
  ['content', 'Content'],
  ['significance', 'Significance'],
  ['description', 'Description'],
  ['citation', 'Citation'],
  ['article_titles', 'Article titles'],
  ['book_titles', 'Book titles'],
  ['image_url', 'Inner image URL'],
  ['image_front', 'Front image URL'],
  ['image_back', 'Back image URL'],
  ['image_article_front', 'Article front URL'],
  ['image_article_back', 'Article back URL'],
  ['image_book_front', 'Book front URL'],
  ['image_book_back', 'Book back URL'],
];

function CardViewerModal({ card, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[80] bg-teal-950/90 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative surface-paper max-w-5xl w-full my-6 grid grid-cols-1 md:grid-cols-2 gap-0 animate-fade-up"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(184, 146, 58, 0.5)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider bg-cream-50 border border-gold-500 text-ink-900 hover:bg-gold-500 hover:text-teal-950 transition-colors"
        >
          ✕ Close
        </button>

        {/* Left: card faces — front+back per face (Article + Book for conclusions). */}
        <div className="p-6 bg-teal-950/30 flex flex-col gap-5 border-r border-gold-500/20 max-h-[80vh] overflow-y-auto">
          {cardFaces(card).map((f, i) => (
            <div key={f.label || i}>
              {f.label && (
                <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-300 text-center mb-2">
                  {f.label}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <CardFace url={f.front} card={card} label="Front" face="front" />
                <CardFace url={f.back} card={card} label="Back" face="back" />
              </div>
            </div>
          ))}
        </div>

        {/* Right: full card data */}
        <div className="p-6 max-h-[80vh] overflow-y-auto">
          <h2 className="font-display text-2xl font-bold text-ink-900 leading-tight pr-24">
            {card.title || 'Untitled'}
          </h2>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-600 mb-4">
            {card.deckName} · {card.type || 'card'} · № {card.sequence_number ?? '—'}
          </p>

          <dl className="space-y-2">
            {FIELDS.map(([key, label]) => {
              const val = card[key];
              const text = val === null || val === undefined || val === '' ? '—' : String(val);
              const isUrl = key.startsWith('image');
              return (
                <div key={key} className="grid grid-cols-[8rem_1fr] gap-3 border-b border-gold-500/10 pb-2">
                  <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-600 pt-0.5">{label}</dt>
                  <dd className="font-serif text-sm text-ink-900 break-words whitespace-pre-wrap">
                    {isUrl && text !== '—' ? (
                      <a href={text} target="_blank" rel="noreferrer" className="text-verdigris-700 underline break-all">
                        {text}
                      </a>
                    ) : text}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </div>
    </div>
  );
}

function CardFace({ url, card, label, face }) {
  return (
    <div className="w-full">
      <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-gold-300 text-center mb-1">{label}</p>
      <div className="relative aspect-[5/7] border border-gold-500/30 overflow-hidden bg-teal-950/40">
        {url ? (
          <img src={url} alt={`${card.title || 'Card'} ${label}`} className="absolute inset-0 w-full h-full object-contain" />
        ) : (
          <CardPlaceholder card={card} face={face} />
        )}
      </div>
    </div>
  );
}

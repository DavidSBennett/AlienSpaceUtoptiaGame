import { useEffect, useMemo, useState } from 'react';
import { fetchScores } from '../api/client.js';

/**
 * Leaderboard — table of scores. Two ways to use:
 *
 *   Mode A — auto-fetch by params:
 *     <Leaderboard fetchParams={{ deck: 28 }} />
 *     <Leaderboard fetchParams={{ all: true }} />
 *     <Leaderboard fetchParams={{ player: 'Dave' }} />
 *
 *   Mode B — pre-fetched data (useful when the parent already has the rows):
 *     <Leaderboard scores={scoresArray} />
 *
 * Columns are sortable by clicking the header (toggles asc/desc). Initial
 * sort respects whatever the server returned. The "Deck" column is shown
 * only when scores span multiple decks — derived automatically.
 *
 * @param {Object}   props.fetchParams       passed to fetchScores
 * @param {Array}    props.scores            pre-fetched rows (alternative to fetchParams)
 * @param {Map}      props.deckNamesById     idDeck → display name (for Deck column)
 * @param {number}   props.highlightIdScore  highlight one row (after submission)
 * @param {boolean}  props.showDeckColumn    force-show deck column (default: auto-detect)
 */
export default function Leaderboard({
  fetchParams,
  scores: scoresProp,
  deckNamesById,
  highlightIdScore,
  showDeckColumn,
}) {
  const [scores, setScores] = useState(scoresProp || []);
  const [status, setStatus] = useState(scoresProp ? 'ok' : 'loading');
  const [error, setError] = useState(null);

  // Sort state — null means "use server order"
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('desc');  // 'asc' | 'desc'

  // Re-fetch when fetchParams change. We stringify to compare deeply.
  const fetchKey = fetchParams ? JSON.stringify(fetchParams) : null;

  useEffect(() => {
    // If the parent passed scores directly, use them
    if (scoresProp !== undefined) {
      setScores(scoresProp);
      setStatus('ok');
      return;
    }
    if (!fetchParams) return;

    let cancelled = false;
    setStatus('loading');

    fetchScores(fetchParams)
      .then((data) => {
        if (cancelled) return;
        setScores(Array.isArray(data) ? data : []);
        setStatus('ok');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setStatus('error');
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, scoresProp]);

  // Auto-detect whether we need a Deck column: if the scores span more than
  // one distinct idDeck, show it. Caller can also force-show or force-hide.
  const autoShowDeck = useMemo(() => {
    if (!scores || scores.length === 0) return false;
    const first = scores[0].idDeck;
    return scores.some((s) => s.idDeck !== first);
  }, [scores]);
  const showDeck = showDeckColumn !== undefined ? showDeckColumn : autoShowDeck;

  // Apply sort
  const sortedScores = useMemo(() => {
    if (!sortKey) return scores;
    const dir = sortDir === 'asc' ? 1 : -1;
    const copy = [...scores];
    copy.sort((a, b) => compareByKey(a, b, sortKey) * dir);
    return copy;
  }, [scores, sortKey, sortDir]);

  function handleSort(key) {
    if (sortKey === key) {
      // Toggle direction
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      // New column — sensible default: descending for numbers, ascending for text
      setSortKey(key);
      setSortDir(isNumericKey(key) ? 'desc' : 'asc');
    }
  }

  if (status === 'loading') {
    return (
      <p className="font-serif italic text-ink-700 text-sm text-center py-4">
        Loading the standings…
      </p>
    );
  }

  if (status === 'error') {
    return (
      <p className="font-serif italic text-oxblood-500 text-sm text-center py-4">
        Could not load the leaderboard. {error}
      </p>
    );
  }

  if (scores.length === 0) {
    return (
      <p className="font-serif italic text-ink-700 text-sm text-center py-4">
        No standings recorded yet.
      </p>
    );
  }

  return (
    <div className="overflow-y-auto" style={{ maxHeight: '24rem' }}>
      <table className="w-full font-serif text-sm">
        <thead className="sticky top-0 bg-cream-100 z-10">
          <tr className="border-b border-gold-500/40">
            <SortHeader
              label="#"
              align="left"
              activeKey={sortKey}
              dir={sortDir}
              myKey={null /* the # column is not sortable; it shows visual rank */}
              onSort={null}
              title="Visual rank in current sort"
            />
            <SortHeader label="Scholar"   myKey="player_name"        activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            {showDeck && (
              <SortHeader label="Deck"    myKey="idDeck"             activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            )}
            <SortHeader label="Rank"      myKey="rank"               activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            <SortHeader label="Prestige"  myKey="prestige"           activeKey={sortKey} dir={sortDir} onSort={handleSort} align="right" />
            <SortHeader label="Art"       myKey="articles_published" activeKey={sortKey} dir={sortDir} onSort={handleSort} align="center" title="Articles published" />
            <SortHeader label="Bk"        myKey="books_published"    activeKey={sortKey} dir={sortDir} onSort={handleSort} align="center" title="Books published" />
            <SortHeader label="Stats"     myKey={null}               activeKey={sortKey} dir={sortDir} onSort={null} align="center" title="Ending stat levels: Research Funding / Personal Archive / Literary Agent / Workspaces / Association Memberships" />
            <SortHeader label="Date"      myKey="submitted_at"       activeKey={sortKey} dir={sortDir} onSort={handleSort} align="right" />
          </tr>
        </thead>
        <tbody>
          {sortedScores.map((s, i) => {
            const isMine = highlightIdScore && Number(s.idScore) === Number(highlightIdScore);
            const deckName = deckNamesById?.get(Number(s.idDeck)) || `Deck ${s.idDeck}`;
            return (
              <tr
                key={s.idScore}
                className={`
                  border-b border-cream-300/60
                  ${isMine ? 'bg-gold-300/40 font-semibold' : ''}
                `}
              >
                <td className="py-2 pr-2 font-mono text-xs text-ink-700">{i + 1}</td>
                <td className="py-2 px-2 text-ink-900">
                  {s.player_name}
                  {isMine && <span className="ml-2 font-mono text-[9px] uppercase tracking-widest text-gold-700">you</span>}
                </td>
                {showDeck && (
                  <td className="py-2 px-2 text-ink-800 text-xs italic">{deckName}</td>
                )}
                <td className="py-2 px-2 italic text-ink-800">{labelForRank(s.rank)}</td>
                <td className="py-2 px-2 text-right font-mono text-ink-900">{s.prestige}</td>
                <td className="py-2 px-2 text-center font-mono text-xs text-ink-700">{s.articles_published}</td>
                <td className="py-2 px-2 text-center font-mono text-xs text-ink-700">{s.books_published}</td>
                <td className="py-2 px-2 text-center font-mono text-[10px] text-ink-700/80">
                  {s.research_level}/{s.notebook_level}/{s.influence_level}/{s.workspaces_level}/{s.reputation_level || 1}
                </td>
                <td className="py-2 pl-2 text-right font-mono text-[10px] text-ink-700 whitespace-nowrap">
                  {formatDate(s.submitted_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


/**
 * SortHeader — a sortable <th>. Clickable when `onSort` is provided.
 * Shows ▲/▼ when this column is the active sort.
 */
function SortHeader({ label, myKey, activeKey, dir, onSort, align = 'left', title }) {
  const sortable = !!onSort && myKey !== null;
  const isActive = sortable && activeKey === myKey;
  const alignClass =
    align === 'right' ? 'text-right' :
    align === 'center' ? 'text-center' :
    'text-left';

  return (
    <th
      className={`${alignClass} py-2 px-2 font-mono text-[10px] uppercase tracking-widest text-gold-700 ${sortable ? 'cursor-pointer select-none hover:text-gold-900' : ''}`}
      onClick={sortable ? () => onSort(myKey) : undefined}
      title={title}
    >
      {label}
      {isActive && (
        <span className="ml-1 text-gold-700">
          {dir === 'asc' ? '▲' : '▼'}
        </span>
      )}
    </th>
  );
}


// ===== Sort helpers =====

const NUMERIC_KEYS = new Set([
  'prestige', 'articles_published', 'books_published',
  'research_level', 'notebook_level', 'influence_level', 'workspaces_level',
  'reputation_level',
  'year_ended', 'idDeck',
]);

function isNumericKey(key) {
  return NUMERIC_KEYS.has(key);
}

function compareByKey(a, b, key) {
  const va = a[key];
  const vb = b[key];

  if (isNumericKey(key)) {
    return (Number(va) || 0) - (Number(vb) || 0);
  }
  if (key === 'submitted_at') {
    // Lexicographic comparison works for ISO-ish datetime strings,
    // but the DB returns 'YYYY-MM-DD HH:MM:SS' which sorts correctly as text.
    return String(va).localeCompare(String(vb));
  }
  // Strings (player_name, rank)
  return String(va).localeCompare(String(vb));
}


/**
 * Translate the stored rank value into a player-readable phrase.
 * Mirrors labelForStage in Game.jsx but kept local to avoid a circular import.
 */
function labelForRank(rank) {
  const labels = {
    'graduate-student':    'Graduate Student',
    'abd':                 'ABD',
    'assistant-professor': 'Asst. Professor',
    'associate-professor': 'Assoc. Professor',
    'full-professor':      'Full Professor',
    'endowed-professor':   'Endowed Professor',
    'retired':             'Retired',
    'failed-comps':        'Withdrew',
    'tenure-denied':       'Tenure Denied',
  };
  return labels[rank] || rank;
}


/**
 * Compact date formatter — turns '2026-05-12 02:18:34' into '5/12/26'.
 * Defensive against unexpected formats; returns the original string if
 * parsing fails.
 */
function formatDate(s) {
  if (!s) return '';
  // The DB returns 'YYYY-MM-DD HH:MM:SS' — replace the space with T for
  // wider parser compatibility.
  const d = new Date(s.replace(' ', 'T'));
  if (isNaN(d.getTime())) return s;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear() % 100;
  return `${month}/${day}/${String(year).padStart(2, '0')}`;
}

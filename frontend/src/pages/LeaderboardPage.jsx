import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { fetchDecks } from '../api/client.js';
import Leaderboard from '../components/Leaderboard.jsx';
import { GAME_MODES } from '../lib/gameModes.js';
import FleuronDivider from '../components/FleuronDivider.jsx';
import CornerOrnament from '../components/CornerOrnament.jsx';
import SkipLink from '../components/SkipLink.jsx';

/**
 * LeaderboardPage — standalone view of the scoreboard.
 *
 * Two sections:
 *   1. Browse by deck (or "All Decks" to see merged standings)
 *   2. Look up a scholar by name (case-insensitive)
 *
 * Both reuse the same <Leaderboard> table component. The page also passes
 * a deckNamesById Map so the table can render a "Deck" column when
 * showing cross-deck data (auto-detected by Leaderboard itself).
 */
export default function LeaderboardPage() {
  const [decks, setDecks] = useState([]);
  const [loadStatus, setLoadStatus] = useState('loading');
  const [loadError, setLoadError] = useState(null);

  // Deck-browse state. '' = no selection, 'all' = merged view, number string = specific deck.
  // We initialize to 'all' so the page is informative on first load.
  const [selectedDeckId, setSelectedDeckId] = useState('all');

  // Which score source to display: solo (user_scores) or multiplayer (Scores).
  const [scoreMode, setScoreMode] = useState('solo');

  // For the multiplayer board: which game-length leaderboard to show.
  const [lengthMode, setLengthMode] = useState('long');

  // Name-search state. We keep the query separate from the "submitted" value
  // so we only re-fetch on explicit submit (typing doesn't hammer the server).
  const [nameQuery, setNameQuery] = useState('');
  const [submittedName, setSubmittedName] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoadStatus('loading');

    fetchDecks()
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setDecks(list);
        setLoadStatus('ok');
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err.message);
        setLoadStatus('error');
      });

    return () => { cancelled = true; };
  }, []);

  // Build idDeck → display name lookup so the Leaderboard's Deck column
  // can show human-readable names instead of raw numeric IDs.
  const deckNamesById = useMemo(() => {
    const m = new Map();
    for (const d of decks) {
      m.set(Number(d.value), d.label);
    }
    return m;
  }, [decks]);

  // Translate the dropdown's current value into fetch params for Leaderboard.
  const fetchParams = useMemo(() => {
    const base = { mode: scoreMode };
    if (scoreMode === 'mp') base.length = lengthMode;
    if (selectedDeckId === 'all') return { ...base, all: true };
    if (selectedDeckId) return { ...base, deck: selectedDeckId };
    return null;
  }, [selectedDeckId, scoreMode, lengthMode]);

  // Determine the heading text shown above the table
  const tableHeading = useMemo(() => {
    if (selectedDeckId === 'all') return 'All Decks';
    const d = decks.find((x) => String(x.value) === String(selectedDeckId));
    return d?.label || '';
  }, [selectedDeckId, decks]);

  function handleNameSubmit(e) {
    e.preventDefault();
    const trimmed = nameQuery.trim();
    if (trimmed === '') {
      setSubmittedName(null);
      return;
    }
    setSubmittedName(trimmed);
  }

  return (
    <>
    <SkipLink />
    <main id="main-content" tabIndex={-1} className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="relative max-w-3xl w-full">

        {/* Outer gilt frame */}
        <div className="relative border border-gold-500/40 px-10 py-12 surface-binding">
          <div className="absolute inset-2 border border-gold-500/20 pointer-events-none" />

          <div className="absolute top-3 left-3 text-gold-400 pointer-events-none">
            <CornerOrnament corner="tl" size={32} />
          </div>
          <div className="absolute top-3 right-3 text-gold-400 pointer-events-none">
            <CornerOrnament corner="tr" size={32} />
          </div>
          <div className="absolute bottom-3 left-3 text-gold-400 pointer-events-none">
            <CornerOrnament corner="bl" size={32} />
          </div>
          <div className="absolute bottom-3 right-3 text-gold-400 pointer-events-none">
            <CornerOrnament corner="br" size={32} />
          </div>

          {/* Title block */}
          <div className="text-center relative z-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-400 mb-3">
              Hall of Scholars
            </p>
            <h1 className="font-display text-5xl font-medium text-cream-50 leading-none tracking-tight">
              Standings
            </h1>
            <p className="font-display italic text-base text-cream-200/80 mt-2">
              The collected careers of the historians
            </p>
          </div>

          <FleuronDivider className="my-8" />

          <div className="relative z-10">

            {loadStatus === 'loading' && (
              <p className="text-center font-serif italic text-cream-200/70">
                Loading the archives…
              </p>
            )}

            {loadStatus === 'error' && (
              <div className="text-center">
                <p className="font-serif italic text-oxblood-500 mb-3">
                  Could not reach the archives.
                </p>
                <p className="font-mono text-xs text-cream-200">
                  {loadError}
                </p>
              </div>
            )}

            {loadStatus === 'ok' && (
              <>
                {/* ───── SECTION 1: Browse by deck ───── */}
                <div className="mb-8">
                  <label
                    htmlFor="leaderboard-deck-select"
                    className="block font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-2"
                  >
                    Field of study
                  </label>
                  <select
                    id="leaderboard-deck-select"
                    value={selectedDeckId}
                    onChange={(e) => setSelectedDeckId(e.target.value)}
                    className="input-dark w-full appearance-none cursor-pointer"
                    style={{
                      backgroundImage:
                        'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\'><path d=\'M1 1 L6 6 L11 1\' stroke=\'%23d4ae5e\' stroke-width=\'1.5\' fill=\'none\'/></svg>")',
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 1rem center',
                      paddingRight: '2.5rem',
                    }}
                  >
                    {/* The 'All Decks' option is special — merged view across the whole archive */}
                    <option value="all">⌘ All Decks (merged)</option>
                    {decks.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>

                  {/* Solo / Multiplayer source toggle */}
                  <div className="mt-4 flex justify-center">
                    <div
                      role="group"
                      aria-label="Score source"
                      className="inline-flex rounded-full border border-gold-500/40 bg-ink-900/40 p-1"
                    >
                      <button
                        type="button"
                        onClick={() => setScoreMode('solo')}
                        aria-pressed={scoreMode === 'solo'}
                        className={`px-6 py-1.5 rounded-full font-mono text-[11px] uppercase tracking-[0.22em] transition-colors ${
                          scoreMode === 'solo'
                            ? 'bg-gold-500 text-ink-900'
                            : 'text-cream-200 hover:text-gold-400'
                        }`}
                      >
                        Solo
                      </button>
                      <button
                        type="button"
                        onClick={() => setScoreMode('mp')}
                        aria-pressed={scoreMode === 'mp'}
                        className={`px-6 py-1.5 rounded-full font-mono text-[11px] uppercase tracking-[0.22em] transition-colors ${
                          scoreMode === 'mp'
                            ? 'bg-gold-500 text-ink-900'
                            : 'text-cream-200 hover:text-gold-400'
                        }`}
                      >
                        Multiplayer
                      </button>
                    </div>
                  </div>

                  {/* Game-length board — only meaningful for multiplayer,
                      where Short / Medium / Long each keep their own board. */}
                  {scoreMode === 'mp' && (
                    <div className="mt-3 flex justify-center">
                      <div
                        role="group"
                        aria-label="Game length"
                        className="inline-flex rounded-full border border-gold-500/40 bg-ink-900/40 p-1"
                      >
                        {GAME_MODES.map((m) => (
                          <button
                            key={m.key}
                            type="button"
                            onClick={() => setLengthMode(m.key)}
                            aria-pressed={lengthMode === m.key}
                            title={`${m.rounds} rounds`}
                            className={`px-5 py-1.5 rounded-full font-mono text-[11px] uppercase tracking-[0.18em] transition-colors ${
                              lengthMode === m.key
                                ? 'bg-gold-500 text-ink-900'
                                : 'text-cream-200 hover:text-gold-400'
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* The table */}
                  {fetchParams && (
                    <div className="surface-paper p-5 relative mt-4">
                      <div className="absolute inset-1 border border-gold-500/20 pointer-events-none" />
                      <h2 className="font-display text-xl font-bold text-ink-900 mb-1 text-center relative">
                        {tableHeading}
                      </h2>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-ink-700 text-center mb-4 relative">
                        {scoreMode === 'mp'
                          ? `Multiplayer · ${GAME_MODES.find((m) => m.key === lengthMode)?.label || ''}`
                          : 'Solo'} ·{' '}
                        {selectedDeckId === 'all'
                          ? 'Combined standings across all decks · click headers to sort'
                          : 'Sorted by Prestige · click headers to sort'
                        }
                      </p>
                      <div className="relative">
                        <Leaderboard
                          fetchParams={fetchParams}
                          deckNamesById={deckNamesById}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <FleuronDivider className="my-8" />

                {/* ───── SECTION 2: Look up by scholar ───── */}
                <div>
                  <label
                    htmlFor="leaderboard-name-search"
                    className="block font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-2"
                  >
                    Search for a scholar
                  </label>
                  <form onSubmit={handleNameSubmit} className="flex gap-3">
                    <input
                      id="leaderboard-name-search"
                      type="text"
                      value={nameQuery}
                      onChange={(e) => setNameQuery(e.target.value)}
                      placeholder="Enter a scholar's name"
                      maxLength={50}
                      className="input-dark flex-1"
                    />
                    <button
                      type="submit"
                      disabled={nameQuery.trim() === ''}
                      className="btn-primary flex-shrink-0"
                    >
                      Look Up
                    </button>
                  </form>

                  {submittedName && (
                    <div className="surface-paper p-5 relative mt-4">
                      <div className="absolute inset-1 border border-gold-500/20 pointer-events-none" />
                      <h2 className="font-display text-xl font-bold text-ink-900 mb-1 text-center relative">
                        Career of {submittedName}
                      </h2>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-ink-700 text-center mb-4 relative">
                        All runs across all decks · most recent first
                      </p>
                      <div className="relative">
                        <Leaderboard
                          fetchParams={{
                            player: submittedName,
                            mode: scoreMode,
                            ...(scoreMode === 'mp' ? { length: lengthMode } : {}),
                          }}
                          deckNamesById={deckNamesById}
                          showDeckColumn
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Back-to-home link */}
        <div className="text-center mt-6">
          <Link to="/" className="btn-primary inline-block">
            Return to Lobby
          </Link>
        </div>
      </div>
    </main>
    </>
  );
}

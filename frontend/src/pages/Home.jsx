import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { fetchDecks } from '../api/client.js';
import { mpListOpenGames, mpCreateGame, mpJoinGame, mpListMyGames, mpCancelGame } from '../api/multiplayer.js';
import { saveSession, clearSession } from '../api/mpSession.js';
import FleuronDivider from '../components/FleuronDivider.jsx';
import CornerOrnament from '../components/CornerOrnament.jsx';
import SkipLink from '../components/SkipLink.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import useUserSetting from '../auth/useUserSetting.js';
import { GAME_MODES, DEFAULT_MODE, labelForRounds, roundsForMode, labelForMode } from '../lib/gameModes.js';
import { SEED_MODE } from '../lib/seedMode.js';

/**
 * Home — the unified landing page. Hosts BOTH the solo and multiplayer
 * entry flows in a single frame, gated by auth.
 *
 * The page renders in three states based on AuthContext:
 *
 *   - Auth loading  → small placeholder (avoids flashing the wrong UI)
 *   - Signed-out    → gilt frame with sign-in / create-account CTA
 *                     (and a brief description of what the game is)
 *   - Signed-in     → full picker: deck dropdown, Solo button, MP toggle
 *                     and (when expanded) the MP panel with Your Games +
 *                     max-players + Create lobby + Open lobbies list
 *
 * The signed-in player's name comes from `user.username` — no separate
 * "Your name" input on this page anymore. The locked version's
 * AuthChip floats top-right in all three states.
 *
 * Polling for open lobbies + your-games only runs while the MP panel
 * is open AND the user is signed in. Anonymous visitors and
 * collapsed-panel visitors don't trigger network traffic.
 */
export default function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading, isSignedIn, isAdmin } = useAuth();

  // ── Server data ──────────────────────────────────────────────────
  const [decks, setDecks] = useState([]);
  const [loadStatus, setLoadStatus] = useState('loading');
  const [loadError, setLoadError] = useState(null);

  // ── Shared form state ────────────────────────────────────────────
  const [selectedDeckId, setSelectedDeckId] = useState('');
  // Seed mode only: an admin-entered seed makes the deck + hands reproducible.
  const [seed, setSeed] = useState('');
  const seedEnabled = SEED_MODE && isAdmin;
  // Game length (Short 8 / Medium 12 / Long 15) — shared by both solo and
  // multiplayer. The picker sits above the Solo/Multiplayer choice.
  const [gameMode, setGameMode] = useState(DEFAULT_MODE);

  // ── Multiplayer panel state ──────────────────────────────────────
  const [mpOpen, setMpOpen] = useState(() => location.pathname === '/multiplayer');
  const [maxPlayers, setMaxPlayers] = useState(5);
  const [lobbies, setLobbies] = useState([]);
  const [myGames, setMyGames] = useState([]);

  // Per-user dismissed games — ended games the player has cleared from the
  // "Your Games" list. Persisted server-side so they stay gone.
  const [dismissedGames, setDismissedGames] = useUserSetting('games_dismissed', []);
  const dismissedSet = new Set(
    (Array.isArray(dismissedGames) ? dismissedGames : []).map(Number)
  );
  const visibleGames = myGames.filter((g) => !dismissedSet.has(Number(g.game_id)));
  function dismissGame(gameId) {
    const base = Array.isArray(dismissedGames) ? dismissedGames : [];
    setDismissedGames([...base, Number(gameId)]);
  }

  // Remove a game from "Your Games" without entering it. The HOST deletes it
  // for everyone (mp_cancelGame); anyone else can only hide it from their own
  // list. Non-ended games ask for confirmation first.
  async function removeGame(g) {
    const isHost = !!g.host_name && !!user?.username && g.host_name === user.username;

    if (isHost) {
      if (g.status !== 'ended' &&
          !window.confirm('Delete this game for everyone? This cannot be undone.')) {
        return;
      }
      setMpBusy(true);
      setMpError(null);
      try {
        await mpCancelGame(g.player_token);
        clearSession(g.game_id);
        dismissGame(g.game_id);
        setMyGames((prev) => prev.filter((x) => Number(x.game_id) !== Number(g.game_id)));
      } catch (e) {
        setMpError(e.message);
      } finally {
        setMpBusy(false);
      }
      return;
    }

    // Non-host: hide it from your own list only.
    if (g.status !== 'ended' &&
        !window.confirm('Remove this game from your list?')) {
      return;
    }
    dismissGame(g.game_id);
    setMyGames((prev) => prev.filter((x) => Number(x.game_id) !== Number(g.game_id)));
  }
  const [mpError, setMpError] = useState(null);
  const [mpBusy, setMpBusy] = useState(false);

  useEffect(() => {
    if (location.pathname === '/multiplayer' && !mpOpen) setMpOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // ── Deck fetch ───────────────────────────────────────────────────
  async function loadDecks() {
    setLoadStatus('loading');
    setLoadError(null);
    try {
      const data = await fetchDecks();
      const list = Array.isArray(data) ? data : [];
      setDecks(list);
      setLoadStatus('ok');
    } catch (err) {
      setLoadError(err.message);
      setLoadStatus('error');
    }
  }
  useEffect(() => { loadDecks(); }, []);

  // ── Lobby polling — only while MP panel is open AND signed in ────
  // Two parallel fetches:
  //   - mpListOpenGames: all open lobbies (no auth required server-side
  //     but we still gate on signed-in here to suppress UI churn)
  //   - mpListMyGames:   the user's seats across all games (auth-required,
  //     resolved server-side via session cookie)
  useEffect(() => {
    if (!mpOpen || !isSignedIn) return;
    let cancelled = false;
    async function poll() {
      try {
        const [openList, myList] = await Promise.all([
          mpListOpenGames(),
          mpListMyGames().then((d) => d.games || []),
        ]);
        if (cancelled) return;
        setLobbies(openList);
        setMyGames(myList);
      } catch (e) {
        if (!cancelled) setMpError(e.message);
      }
    }
    poll();
    const handle = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(handle); };
  }, [mpOpen, isSignedIn]);

  // ── Validity ─────────────────────────────────────────────────────
  // Auth is the gate for everything. If not signed in, all submission
  // paths are disabled — the sign-in CTA appears instead.
  const hasDeck = selectedDeckId !== '';
  const canStartSolo  = isSignedIn && hasDeck && loadStatus === 'ok';
  const canCreateMp   = isSignedIn && hasDeck && loadStatus === 'ok' && !mpBusy;
  const canJoinMp     = isSignedIn && !mpBusy;

  // ── Submit paths ─────────────────────────────────────────────────

  function handleSoloSubmit(e) {
    e.preventDefault();
    if (!canStartSolo) return;
    const raw = decks.find((d) => String(d.value) === String(selectedDeckId));
    if (!raw) return;
    const deck = { idDeck: raw.value, nameDeck: raw.label };
    // Note: no playerName in nav state. Game.jsx pulls from useAuth.
    const navState = { deck, totalYears: roundsForMode(gameMode) };
    if (seedEnabled && seed.trim()) navState.seed = seed.trim();
    navigate('/game', { state: navState });
  }

  async function handleCreateLobby() {
    if (!canCreateMp) return;
    setMpError(null);
    setMpBusy(true);
    try {
      const res = await mpCreateGame({
        idDeck: Number(selectedDeckId),
        // Use the auth username as the multiplayer display name.
        player_name: user.username,
        max_players: Number(maxPlayers),
        mode: gameMode,
        // Seed build + admins only; the backend ignores it unless SEED_MODE.
        ...(seedEnabled && seed.trim() ? { seed: seed.trim() } : {}),
      });
      saveSession(res.game_id, {
        player_token: res.player_token,
        player_id:    res.player_id,
        seat_index:   res.seat_index,
        player_name:  user.username,
      });
      navigate(`/multiplayer/lobby/${res.game_id}`);
    } catch (e) {
      setMpError(e.message);
      setMpBusy(false);
    }
  }

  async function handleJoinLobby(gameId) {
    if (!canJoinMp) return;
    setMpError(null);
    setMpBusy(true);
    try {
      const res = await mpJoinGame({
        game_id: Number(gameId),
        player_name: user.username,
      });
      saveSession(res.game_id, {
        player_token: res.player_token,
        player_id:    res.player_id,
        seat_index:   res.seat_index,
        player_name:  user.username,
      });
      navigate(`/multiplayer/lobby/${res.game_id}`);
    } catch (e) {
      setMpError(e.message);
      setMpBusy(false);
    }
  }

  function handleResume(g) {
    const route =
      g.status === 'lobby'  ? `/multiplayer/lobby/${g.game_id}` :
      g.status === 'ended'  ? `/multiplayer/end/${g.game_id}`   :
                              `/multiplayer/game/${g.game_id}`;
    navigate(route);
  }

  return (
    <>
    <SkipLink />
    <AuthChip />
    <main id="main-content" tabIndex={-1} className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="relative max-w-4xl w-full">

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
              A Game About
            </p>
            <h1 className="font-display text-6xl font-medium text-cream-50 leading-none tracking-tight">
              The Historians
            </h1>
            <p className="font-display italic text-xl text-cream-200 mt-2">
              Building Arguments
            </p>
          </div>

          <FleuronDivider className="my-8" />

          <div className="relative z-10">
            {loadStatus === 'loading' && (
              <p className="text-center font-serif italic text-cream-200/70">
                Loading the archive…
              </p>
            )}

            {loadStatus === 'error' && (
              <div className="text-center">
                <p className="font-serif italic text-oxblood-500 mb-4">
                  The archive is unreachable.
                </p>
                <p className="font-mono text-xs text-cream-200 mb-4">
                  {loadError}
                </p>
                <button type="button" onClick={loadDecks} className="btn-ghost">
                  Try again
                </button>
              </div>
            )}

            {loadStatus === 'ok' && (
              <form onSubmit={handleSoloSubmit} className="space-y-5">

                {/* Auth gate. The form below is always RENDERED so the
                    page composition stays consistent, but the play
                    buttons are dimmed when not signed-in. Above-form
                    block changes depending on auth state. */}
                {authLoading ? (
                  <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream-200/40 text-center">
                    Loading…
                  </p>
                ) : isSignedIn ? (
                  <p className="font-display italic text-cream-200 text-center">
                    Welcome, <span className="text-gold-400">{user.username}</span>
                  </p>
                ) : (
                  <div className="text-center space-y-2">
                    <p className="font-display italic text-cream-200">
                      An invitation is required to play.
                    </p>
                    <div className="flex justify-center gap-3">
                      <Link to="/login" className="btn-ghost">Sign In</Link>
                      <Link to="/register" className="btn-primary">Create Account</Link>
                    </div>
                  </div>
                )}

                {/* Deck selection — shown for everyone (the visual frame
                    is the page itself). Signed-out users see it but
                    can't submit. */}
                <div>
                  <label
                    htmlFor="deck-select"
                    className="block font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-2"
                  >
                    Subject of study
                  </label>
                  <select
                    id="deck-select"
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
                    <option value="">— Select a deck —</option>
                    {decks.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                  {decks.length === 0 && (
                    <p className="font-serif italic text-cream-200 text-xs mt-2">
                      The archive returned no decks.
                    </p>
                  )}
                </div>

                {/* Seed field — seed build + admins only. A non-empty seed makes
                    the shuffle and starting hands reproducible (solo and the
                    lobby you create). Empty = a normal random game. */}
                {seedEnabled && (
                  <div>
                    <label
                      htmlFor="seed-input"
                      className="block font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-2"
                    >
                      <span className="px-1.5 py-0.5 mr-2 bg-gold-500 text-teal-950 rounded">Seed mode</span>
                      Reproducible seed (optional)
                    </label>
                    <input
                      id="seed-input"
                      type="text"
                      value={seed}
                      onChange={(e) => setSeed(e.target.value)}
                      placeholder="e.g. test-01 — leave blank for a random game"
                      className="input-dark w-full"
                      autoComplete="off"
                    />
                    <p className="font-serif italic text-cream-200/70 text-xs mt-1">
                      Same seed → same deck order and opening hands, every time.
                    </p>
                  </div>
                )}

                {/* Game length — Short 8 / Medium 12 / Long 15. Shared by
                    both solo and multiplayer (it sits above that choice). */}
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-2">
                    Game length
                  </label>
                  <div
                    role="group"
                    aria-label="Game length"
                    className="inline-flex rounded-full border border-gold-500/40 bg-ink-900/40 p-1"
                  >
                    {GAME_MODES.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => setGameMode(m.key)}
                        aria-pressed={gameMode === m.key}
                        title={`${m.rounds} years — ${m.blurb}`}
                        className={`px-4 py-1.5 rounded-full font-mono text-[11px] uppercase tracking-[0.18em] transition-colors ${
                          gameMode === m.key
                            ? 'bg-gold-500 text-ink-900'
                            : 'text-cream-200 hover:text-gold-400'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <p className="font-serif italic text-cream-200/60 text-xs mt-1.5">
                    {roundsForMode(gameMode)} years
                    {' · '}
                    {GAME_MODES.find((m) => m.key === gameMode)?.blurb}
                  </p>
                </div>

                {/* Start row — Solo (form submit) and Multiplayer toggle.
                    Disabled when signed-out so the auth CTA above is
                    the obvious path forward. */}
                <div className="pt-3 grid grid-cols-2 gap-3">
                  <button
                    type="submit"
                    disabled={!canStartSolo}
                    className="btn-primary"
                  >
                    Solo Game
                  </button>
                  <button
                    type="button"
                    onClick={() => setMpOpen((v) => !v)}
                    disabled={!isSignedIn}
                    className="btn-primary"
                    aria-expanded={mpOpen}
                    aria-controls="mp-panel"
                  >
                    Multiplayer {mpOpen ? '▲' : '▼'}
                  </button>
                </div>

                {/* Graduate School — the guided walkthrough. Open to EVERYONE
                    (no login needed); it has its own deck and saves no score. */}
                <button
                  type="button"
                  onClick={() => navigate('/tutorial')}
                  className="btn-primary w-full leading-tight"
                >
                  Graduate School
                  <span className="block font-mono text-[10px] uppercase tracking-[0.2em] opacity-80 mt-0.5">
                    Guided Walkthrough
                  </span>
                </button>

                {/* MP panel — only rendered when expanded AND signed in.
                    Contents conditionally mounted so polling cleans up
                    on collapse / sign-out. */}
                {mpOpen && isSignedIn && (
                  <section
                    id="mp-panel"
                    className="pt-2"
                    aria-label="Multiplayer options"
                  >
                    <FleuronDivider className="my-4" />

                    {/* Your Games — in-flight games from saved sessions
                        for this browser. The endpoint dedupes against
                        the user's actual server-side player records. */}
                    {visibleGames.length > 0 && (
                      <section className="mb-5">
                        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-3">
                          Your Games
                        </p>
                        <ul className="space-y-2">
                          {visibleGames.map((g) => (
                            <li
                              key={g.game_id}
                              className="border border-cream-50/10 p-3 bg-ink-900/40 flex items-center justify-between gap-3 flex-wrap"
                            >
                              <div className="min-w-0">
                                <div className="font-display text-cream-50 text-sm truncate">
                                  {g.deck.label}
                                  {' · '}
                                  <span className="font-mono text-[10px] uppercase tracking-wider text-cream-200/60">
                                    {g.status === 'active'
                                      ? `year ${g.current_year}/${g.max_year}`
                                      : g.status === 'lobby'
                                      ? 'lobby'
                                      : 'ended'}
                                  </span>
                                </div>
                                <div className="font-serif italic text-cream-200/70 text-xs mt-0.5">
                                  {g.player_count} player{g.player_count === 1 ? '' : 's'}
                                  {g.host_name ? ` · host: ${g.host_name}` : ''}
                                  {g.is_your_turn && (
                                    <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-gold-400">
                                      · your turn
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleResume(g)}
                                  disabled={mpBusy}
                                  className="btn-ghost text-xs"
                                >
                                  {g.status === 'ended' ? 'Review' : 'Resume'}
                                </button>
                                {(() => {
                                  const isHost = !!g.host_name && !!user?.username && g.host_name === user.username;
                                  const label = g.status === 'ended'
                                    ? 'Dismiss this game'
                                    : isHost
                                    ? 'Delete this game for everyone'
                                    : 'Remove this game from your list';
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => removeGame(g)}
                                      disabled={mpBusy}
                                      title={label}
                                      aria-label={label}
                                      className="w-6 h-6 flex items-center justify-center rounded text-cream-200/50 hover:text-oxblood-300 hover:bg-cream-50/10 transition-colors text-sm leading-none disabled:opacity-40"
                                    >
                                      ✕
                                    </button>
                                  );
                                })()}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {/* Create lobby */}
                    <div className="space-y-4">
                      <div>
                        <label
                          htmlFor="mp-max-players"
                          className="block font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-2"
                        >
                          Max players
                        </label>
                        <select
                          id="mp-max-players"
                          value={maxPlayers}
                          onChange={(e) => setMaxPlayers(Number(e.target.value))}
                          className="input-dark w-32 appearance-none cursor-pointer"
                          style={{
                            backgroundImage:
                              'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\'><path d=\'M1 1 L6 6 L11 1\' stroke=\'%23d4ae5e\' stroke-width=\'1.5\' fill=\'none\'/></svg>")',
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'right 0.75rem center',
                            paddingRight: '2rem',
                          }}
                        >
                          {[2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </div>

                      {/* Game length is set by the shared picker above the
                          Solo/Multiplayer choice — show it here read-only so
                          the host knows what they're creating. */}
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream-200/60">
                        Length:{' '}
                        <span className="text-gold-400">
                          {labelForMode(gameMode)} · {roundsForMode(gameMode)} rounds
                        </span>
                        <span className="tracking-normal normal-case text-cream-200/40"> — set above</span>
                      </p>

                      <button
                        type="button"
                        onClick={handleCreateLobby}
                        disabled={!canCreateMp}
                        className="btn-primary w-full"
                      >
                        {mpBusy ? 'Creating…' : 'Create lobby'}
                      </button>

                      {mpError && (
                        <p className="font-serif italic text-oxblood-300 text-sm">
                          {mpError}
                        </p>
                      )}
                    </div>

                    {/* Open lobbies */}
                    <div className="mt-6">
                      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-3">
                        Or join a lobby
                      </p>
                      {lobbies.length === 0 ? (
                        <p className="font-serif italic text-cream-200/70 text-sm">
                          No open lobbies right now. Create one above, or wait for someone else to.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {lobbies.map((lob) => (
                            <li
                              key={lob.game_id}
                              className="surface-well p-3 flex items-center justify-between"
                            >
                              <div className="min-w-0">
                                <div className="font-display text-cream-50 truncate">
                                  {lob.deck_name}
                                </div>
                                <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-cream-200/70 mt-1">
                                  Host: {lob.host_player_name || '—'} · {lob.current_players_count} / {lob.max_players}
                                  {lob.total_years ? ` · ${labelForRounds(lob.total_years)}` : ''}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleJoinLobby(lob.game_id)}
                                disabled={!canJoinMp}
                                className="btn-ghost flex-shrink-0"
                              >
                                Join
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </section>
                )}
              </form>
            )}
          </div>
        </div>

        {/* Below-frame links */}
        <div className="text-center mt-8 flex flex-col items-center gap-4">
          <div className="flex flex-row flex-wrap justify-center gap-4">
            <Link to="/leaderboard" className="btn-primary inline-block">
              Hall of Scholars
            </Link>
            <Link to="/decks" className="btn-primary inline-block">
              Card Library
            </Link>
          </div>

          {isAdmin && (
            <div className="flex flex-col items-center gap-2 border border-gold-500/30 px-5 py-3 mt-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-400">
                Administration
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Link to="/admin/decks" className="btn-ghost inline-block">
                  Deck Manager
                </Link>
                <Link to="/admin/invites" className="btn-ghost inline-block">
                  Invite Codes
                </Link>
                <Link to="/admin/playtest" className="btn-ghost inline-block">
                  Playtest Data
                </Link>
              </div>
            </div>
          )}

          <a
            href="accessibility-report.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost inline-block"
          >
            Accessibility Report
            <span className="sr-only"> (opens PDF in a new tab)</span>
          </a>

          <a
            href="the-historians-sell-sheet.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost inline-block"
          >
            Sell Sheet
            <span className="sr-only"> (opens PDF in a new tab)</span>
          </a>

          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream-200">
            Davidsbennett.com
          </p>
        </div>
      </div>
    </main>
    </>
  );
}


/**
 * AuthChip — top-right floating widget showing the current user's
 * sign-in state. Signed-in users see their username (linking to
 * /account) and a Sign Out button. Signed-out users see Sign In /
 * Create Account links. The widget keeps the Home page composition
 * clean by floating outside <main>.
 */
function AuthChip() {
  const { user, loading, signOut } = useAuth();
  if (loading) return null;

  return (
    <div className="fixed top-4 right-4 z-40 flex items-center gap-3 text-sm">
      {user ? (
        <>
          <Link
            to="/account"
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream-200 hover:text-cream-50"
            title={`Signed in as ${user.username}`}
          >
            {user.username}
          </Link>
          <button
            onClick={signOut}
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream-200/70 hover:text-cream-50 underline"
          >
            Sign Out
          </button>
        </>
      ) : (
        <>
          <Link
            to="/login"
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream-200 hover:text-cream-50"
          >
            Sign In
          </Link>
          <Link
            to="/register"
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 hover:text-gold-300"
          >
            Create Account
          </Link>
        </>
      )}
    </div>
  );
}

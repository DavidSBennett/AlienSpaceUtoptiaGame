import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  spCreateGame, spJoinGame, spStartGame, spCancelGame,
  spListOpenGames, spListMyGames, spGetGameState,
  spHighScores, spExportGame, spExportAll, spDeleteGame,
} from '../api/space.js';
import { saveSpSession, loadSpSession, clearSpSession } from '../api/spSession.js';

// Space palette (matches SpaceGame.jsx)
const BTN = 'px-3 py-1.5 rounded border border-[#2f4b6e] bg-[#122036] hover:bg-[#1a2c4a] text-[#dbe4f0] text-sm disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_ACCENT = 'px-3 py-1.5 rounded border border-[#79c9d6]/70 bg-[#12454f] hover:bg-[#186273] text-[#d6f2f7] text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * SpaceLobby — entry hall for the SPACE GAME (Concordia-engine prototype).
 * Create solo/multiplayer games, join open lobbies, resume your games.
 * A lobby you're in is shown inline with a start button (host) or a
 * waiting notice; active games link into /space/game/:id.
 */
export default function SpaceLobby() {
  const navigate = useNavigate();
  const [openGames, setOpenGames] = useState([]);
  const [myGames, setMyGames] = useState([]);
  const [highScores, setHighScores] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(2);
  // The lobby game the user is currently waiting in (if any).
  const [waiting, setWaiting] = useState(null); // {gameId, token, state}

  const reload = useCallback(async () => {
    try {
      const [open, mine, hs] = await Promise.all([
        spListOpenGames(), spListMyGames(), spHighScores().catch(() => ({ scores: [] })),
      ]);
      setOpenGames(open.games || []);
      setMyGames(mine.games || []);
      setHighScores(hs.scores || []);
      // Adopt server-known sessions locally so any device can resume.
      for (const g of mine.games || []) {
        if (g.player_token) {
          saveSpSession(g.game_id, {
            player_token: g.player_token, seat: g.seat, game_id: g.game_id,
          });
        }
      }
      const lobbyGame = (mine.games || []).find((g) => g.status === 'lobby');
      if (lobbyGame) {
        const st = await spGetGameState(lobbyGame.player_token);
        setWaiting({ gameId: lobbyGame.game_id, token: lobbyGame.player_token, state: st });
      } else {
        setWaiting(null);
      }
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Opt out of the Historians' :root zoom while on space pages.
  useEffect(() => {
    const prev = document.documentElement.style.zoom;
    document.documentElement.style.zoom = '1';
    return () => { document.documentElement.style.zoom = prev; };
  }, []);

  // Poll while waiting in a lobby so the host's start flips us into the game.
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(async () => {
      try {
        const st = await spGetGameState(waiting.token);
        if (st.game.status !== 'lobby') {
          navigate(`/space/game/${waiting.gameId}`);
          return;
        }
        setWaiting((w) => (w ? { ...w, state: st } : w));
      } catch {
        // Lobby may have been cancelled out from under us.
        clearSpSession(waiting.gameId);
        setWaiting(null);
        reload();
      }
    }, 2000);
    return () => clearInterval(t);
  }, [waiting, navigate, reload]);

  async function handleDownload(g) {
    try {
      const res = await spExportGame(g.player_token);
      const blob = new Blob([JSON.stringify(res.export, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `utopian-playthrough-game${g.game_id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDownloadAll() {
    setBusy(true);
    try {
      const res = await spExportAll();
      const blob = new Blob([JSON.stringify(res.export, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `utopian-playthroughs-all-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleClear(g) {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Clear playthrough #${g.game_id} permanently? Its record, log and high-score entries are deleted (download it first if you want to keep it).`)) return;
    setBusy(true);
    try {
      await spDeleteGame(g.player_token);
      clearSpSession(g.game_id);
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleClearAll() {
    const done = myGames.filter((g) => g.status === 'ended');
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Clear ALL ${done.length} finished playthroughs permanently? Download any you want to keep first.`)) return;
    setBusy(true);
    try {
      for (const g of done) {
        // sequential — each delete is its own transaction
        // eslint-disable-next-line no-await-in-loop
        await spDeleteGame(g.player_token);
        clearSpSession(g.game_id);
      }
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(solo, variant = 'plain') {
    setBusy(true);
    setError(null);
    try {
      const res = await spCreateGame(solo ? 1 : maxPlayers, variant);
      saveSpSession(res.game_id, {
        player_token: res.player_token, seat: res.seat, game_id: res.game_id,
      });
      if (res.status === 'active') {
        navigate(`/space/game/${res.game_id}`);
      } else {
        await reload();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(gameId) {
    setBusy(true);
    setError(null);
    try {
      const res = await spJoinGame(gameId);
      saveSpSession(res.game_id, {
        player_token: res.player_token, seat: res.seat, game_id: res.game_id,
      });
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    if (!waiting) return;
    setBusy(true);
    try {
      await spStartGame(waiting.token);
      navigate(`/space/game/${waiting.gameId}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!waiting) return;
    setBusy(true);
    try {
      await spCancelGame(waiting.token);
      clearSpSession(waiting.gameId);
      setWaiting(null);
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const isHost = waiting?.state?.game?.host_player_id != null &&
    waiting?.state?.you?.player_id === waiting?.state?.game?.host_player_id;

  return (
    <div className="min-h-screen bg-[#03060d] text-[#dbe4f0] px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-baseline justify-between mb-6">
          <h1 className="font-display text-3xl text-[#79c9d6]">Utopian Space Game</h1>
          <Link to="/account" className="text-sm underline text-[#8593ad] hover:text-[#79c9d6]">
            Account
          </Link>
        </div>
        <p className="text-sm mb-6">&nbsp;</p>

        {error && (
          <div className="mb-4 rounded border border-[#e58787] bg-[#3a1420]/80 px-4 py-3 text-sm">
            <b>⚠ Something went wrong:</b> {error}
            {/error|table|exist/i.test(error) && (
              <div className="mt-1 text-[#8593ad] text-[12px]">
                If this mentions a missing table, the database migration
                (database/34_space_game_tables.sql) hasn't been run on this
                install yet — run it in phpMyAdmin, then retry.
              </div>
            )}
          </div>
        )}

        {waiting ? (
          <div className="rounded-lg border border-[#79c9d6]/50 bg-[#0a1120]/90 p-5 mb-8">
            <h2 className="font-display text-xl text-[#79c9d6] mb-2">
              Lobby #{waiting.gameId} — waiting for crew
            </h2>
            <ul className="mb-4 text-sm">
              {(waiting.state?.players || []).map((p) => (
                <li key={p.seat}>
                  Seat {p.seat + 1}: {p.name}{p.is_you ? ' (you)' : ''}
                </li>
              ))}
            </ul>
            <div className="flex gap-3">
              {isHost && (
                <button className={BTN_ACCENT} disabled={busy || (waiting.state?.players || []).length < 2}
                  onClick={handleStart}>
                  Launch with {(waiting.state?.players || []).length} players
                </button>
              )}
              {isHost ? (
                <button className={BTN} disabled={busy} onClick={handleCancel}>
                  Cancel lobby
                </button>
              ) : (
                <span className="text-[#8593ad] text-sm self-center">
                  Waiting for the host to launch…
                </span>
              )}
            </div>
          </div>
        ) : (
          <>
          <div className="grid sm:grid-cols-2 gap-4 mb-4">
            <div className="rounded-lg border border-[#26365a] bg-[#0a1120]/90 p-5">
              <h2 className="font-display text-lg text-[#79c9d6] mb-2">Solo</h2>
              <button className={BTN_ACCENT} disabled={busy} onClick={() => handleCreate(true, 'plain')}>
                {busy ? 'Launching…' : 'Play solo'}
              </button>
            </div>
            <div className="rounded-lg border border-[#26365a] bg-[#0a1120]/90 p-5">
              <h2 className="font-display text-lg text-[#79c9d6] mb-2">Multiplayer</h2>
              <div className="flex items-center gap-2 mb-3 text-sm">
                <label htmlFor="sp-max-players">Players:</label>
                <select id="sp-max-players" value={maxPlayers}
                  onChange={(e) => setMaxPlayers(Number(e.target.value))}
                  className="bg-[#060b16] border border-[#2f4b6e] rounded px-2 py-1">
                  {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <button className={BTN_ACCENT} disabled={busy} onClick={() => handleCreate(false, 'plain')}>
                {busy ? 'Opening…' : 'Open a lobby'}
              </button>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 mb-8">
            <div className="rounded-lg border border-[#26365a] bg-[#0a1120]/70 p-5">
              <h2 className="font-display text-lg text-[#e0b45c] mb-2">Story edition — solo</h2>
              <p className="text-sm text-[#8593ad] mb-3">
                The same game with authored missions: THE ICC.
              </p>
              <button className={BTN} disabled={busy} onClick={() => handleCreate(true, 'story')}>
                {busy ? 'Launching…' : 'Play the story'}
              </button>
            </div>
            <div className="rounded-lg border border-[#26365a] bg-[#0a1120]/70 p-5">
              <h2 className="font-display text-lg text-[#e0b45c] mb-2">Story edition — multiplayer</h2>
              <p className="text-sm text-[#8593ad] mb-3">
                Authored missions, shared docket, same player count picker above.
              </p>
              <button className={BTN} disabled={busy} onClick={() => handleCreate(false, 'story')}>
                {busy ? 'Opening…' : 'Open a story lobby'}
              </button>
            </div>
          </div>
          </>
        )}

        <h2 className="font-display text-xl text-[#79c9d6] mb-3">High scores</h2>
        {highScores.length === 0 ? (
          <p className="text-sm text-[#8593ad] mb-6">No finished games yet — the board is open.</p>
        ) : (
          <ol className="mb-6 space-y-1">
            {highScores.map((h2, i) => (
              <li key={h2.game_id + '-' + h2.name + '-' + i}
                className="flex items-center gap-3 rounded border border-[#26365a] bg-[#0a1120]/70 px-4 py-1.5 text-sm">
                <span className="font-mono text-[#e0b45c] w-6">{i + 1}.</span>
                <span className="font-semibold">{h2.name}</span>
                <span className="font-mono text-[#e0b45c]">{h2.score} VP</span>
                <span className="text-[#8593ad] text-[11px]">
                  {h2.variant === 'story' ? 'story' : 'base'} · {h2.solo ? 'solo' : 'multi'}
                  {' · '}{h2.turns} turns{h2.won ? ' · won' : ''}
                </span>
              </li>
            ))}
          </ol>
        )}

        <h2 className="font-display text-xl text-[#79c9d6] mb-3">Open lobbies</h2>
        {openGames.length === 0 ? (
          <p className="text-sm text-[#8593ad] mb-6">No open lobbies right now.</p>
        ) : (
          <ul className="mb-6 space-y-2">
            {openGames.map((g) => (
              <li key={g.game_id}
                className="flex items-center justify-between rounded border border-[#26365a] bg-[#0a1120]/70 px-4 py-2 text-sm">
                <span>
                  #{g.game_id} — {g.variant === 'story' ? 'story' : 'base'} — host {g.host_name || '?'} — {g.player_count}/{g.max_players} seats
                </span>
                <button className={BTN} disabled={busy} onClick={() => handleJoin(g.game_id)}>
                  Join
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-display text-xl text-[#79c9d6]">Your games</h2>
          <span className="flex items-baseline gap-3">
            <button className="text-[11px] underline text-[#8593ad] hover:text-[#79c9d6]"
              disabled={busy} onClick={handleDownloadAll}
              title="Every game on the server with its full event log, plus all playtest reports (admin only)">
              ⬇ Download entire playthrough database
            </button>
            {myGames.some((g) => g.status === 'ended') && (
              <button className="text-[11px] underline text-[#8593ad] hover:text-[#e58787]"
                disabled={busy} onClick={handleClearAll}>
                Clear all finished
              </button>
            )}
          </span>
        </div>
        {myGames.length === 0 ? (
          <p className="text-sm text-[#8593ad]">None yet — launch one above.</p>
        ) : (
          <ul className="space-y-2">
            {myGames.map((g) => (
              <li key={g.game_id}
                className="flex items-center justify-between rounded border border-[#26365a] bg-[#0a1120]/70 px-4 py-2 text-sm">
                <span>
                  #{g.game_id} — {g.variant === 'story' ? 'story' : 'base'} — {g.is_solo ? 'solo' : `${g.player_count}/${g.max_players} players`}
                  {' · '}{g.status}
                  {g.status === 'active' && (g.your_turn ? ' · YOUR TURN' : ' · waiting')}
                  {g.status === 'ended' && g.final_score !== null && ` · ${g.final_score} VP`}
                </span>
                {g.status !== 'lobby' && (
                  <span className="flex gap-1.5">
                    <Link className={BTN} to={`/space/game/${g.game_id}`}>
                      {g.status === 'active' ? 'Resume' : 'Review'}
                    </Link>
                    {g.status === 'ended' && (
                      <>
                        <button className={BTN} title="Download the full playthrough (every action, every turn)"
                          onClick={() => handleDownload(g)}>
                          ⬇
                        </button>
                        <button className={BTN + ' hover:border-[#e58787]'} disabled={busy}
                          title="Clear this playthrough permanently"
                          onClick={() => handleClear(g)}>
                          ✕
                        </button>
                      </>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

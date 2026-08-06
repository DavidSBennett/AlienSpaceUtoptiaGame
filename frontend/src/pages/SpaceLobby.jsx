import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  spCreateGame, spJoinGame, spStartGame, spCancelGame,
  spListOpenGames, spListMyGames, spGetGameState,
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
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(2);
  // The lobby game the user is currently waiting in (if any).
  const [waiting, setWaiting] = useState(null); // {gameId, token, state}

  const reload = useCallback(async () => {
    try {
      const [open, mine] = await Promise.all([spListOpenGames(), spListMyGames()]);
      setOpenGames(open.games || []);
      setMyGames(mine.games || []);
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

  async function handleCreate(solo) {
    setBusy(true);
    setError(null);
    try {
      const res = await spCreateGame(solo ? 1 : maxPlayers);
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
          <h1 className="font-display text-3xl text-[#79c9d6]">Sector Umbra — Space Game</h1>
          <Link to="/" className="text-sm underline text-[#8593ad] hover:text-[#79c9d6]">
            ← Back to The Historians
          </Link>
        </div>
        <p className="text-[#8593ad] text-sm mb-6">
          Concordia-engine prototype: captain a starship, play component cards,
          send drones down star-lanes, sign treaties with alien factions, and
          score your whole collection at journey's end.
        </p>

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
          <div className="grid sm:grid-cols-2 gap-4 mb-8">
            <div className="rounded-lg border border-[#26365a] bg-[#0a1120]/90 p-5">
              <h2 className="font-display text-lg text-[#79c9d6] mb-2">Solo expedition</h2>
              <p className="text-sm text-[#8593ad] mb-3">
                One captain against the sector. Same rules, same scoring.
              </p>
              <button className={BTN_ACCENT} disabled={busy} onClick={() => handleCreate(true)}>
                {busy ? 'Launching…' : 'Launch solo'}
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
              <button className={BTN_ACCENT} disabled={busy} onClick={() => handleCreate(false)}>
                {busy ? 'Opening…' : 'Open a lobby'}
              </button>
            </div>
          </div>
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
                  #{g.game_id} — host {g.host_name || '?'} — {g.player_count}/{g.max_players} seats
                </span>
                <button className={BTN} disabled={busy} onClick={() => handleJoin(g.game_id)}>
                  Join
                </button>
              </li>
            ))}
          </ul>
        )}

        <h2 className="font-display text-xl text-[#79c9d6] mb-3">Your games</h2>
        {myGames.length === 0 ? (
          <p className="text-sm text-[#8593ad]">None yet — launch one above.</p>
        ) : (
          <ul className="space-y-2">
            {myGames.map((g) => (
              <li key={g.game_id}
                className="flex items-center justify-between rounded border border-[#26365a] bg-[#0a1120]/70 px-4 py-2 text-sm">
                <span>
                  #{g.game_id} — {g.is_solo ? 'solo' : `${g.player_count}/${g.max_players} players`}
                  {' · '}{g.status}
                  {g.status === 'active' && (g.your_turn ? ' · YOUR TURN' : ' · waiting')}
                  {g.status === 'ended' && g.final_score !== null && ` · ${g.final_score} VP`}
                </span>
                {g.status !== 'lobby' && (
                  <Link className={BTN} to={`/space/game/${g.game_id}`}>
                    {g.status === 'active' ? 'Resume' : 'Review'}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

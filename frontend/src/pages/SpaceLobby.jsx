import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  spCreateGame, spJoinGame, spStartGame, spCancelGame,
  spListOpenGames, spListMyGames, spGetGameState,
} from '../api/space.js';
import { saveSpSession, loadSpSession, clearSpSession } from '../api/spSession.js';

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
    <div className="min-h-screen bg-teal-950 text-cream-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-baseline justify-between mb-6">
          <h1 className="font-display text-3xl text-gold-300">Sector Umbra — Space Game</h1>
          <Link to="/" className="text-sm underline text-cream-300 hover:text-gold-300">
            ← Back to The Historians
          </Link>
        </div>
        <p className="text-cream-300 text-sm mb-6">
          Concordia-engine prototype: captain a starship, play component cards,
          send drones down star-lanes, sign treaties with alien factions, and
          score your whole collection at journey's end.
        </p>

        {error && (
          <div className="mb-4 rounded border border-oxblood-400 bg-oxblood-900/40 px-4 py-2 text-sm">
            {error}
          </div>
        )}

        {waiting ? (
          <div className="rounded-lg border border-gold-600/40 bg-teal-900/60 p-5 mb-8">
            <h2 className="font-display text-xl text-gold-300 mb-2">
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
                <button className="btn-primary" disabled={busy || (waiting.state?.players || []).length < 2}
                  onClick={handleStart}>
                  Launch with {(waiting.state?.players || []).length} players
                </button>
              )}
              {isHost ? (
                <button className="btn-ghost" disabled={busy} onClick={handleCancel}>
                  Cancel lobby
                </button>
              ) : (
                <span className="text-cream-300 text-sm self-center">
                  Waiting for the host to launch…
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4 mb-8">
            <div className="rounded-lg border border-teal-700 bg-teal-900/60 p-5">
              <h2 className="font-display text-lg text-gold-300 mb-2">Solo expedition</h2>
              <p className="text-sm text-cream-300 mb-3">
                One captain against the sector. Same rules, same scoring.
              </p>
              <button className="btn-primary" disabled={busy} onClick={() => handleCreate(true)}>
                Launch solo
              </button>
            </div>
            <div className="rounded-lg border border-teal-700 bg-teal-900/60 p-5">
              <h2 className="font-display text-lg text-gold-300 mb-2">Multiplayer</h2>
              <div className="flex items-center gap-2 mb-3 text-sm">
                <label htmlFor="sp-max-players">Players:</label>
                <select id="sp-max-players" value={maxPlayers}
                  onChange={(e) => setMaxPlayers(Number(e.target.value))}
                  className="bg-teal-950 border border-teal-700 rounded px-2 py-1">
                  {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <button className="btn-primary" disabled={busy} onClick={() => handleCreate(false)}>
                Open a lobby
              </button>
            </div>
          </div>
        )}

        <h2 className="font-display text-xl text-gold-300 mb-3">Open lobbies</h2>
        {openGames.length === 0 ? (
          <p className="text-sm text-cream-400 mb-6">No open lobbies right now.</p>
        ) : (
          <ul className="mb-6 space-y-2">
            {openGames.map((g) => (
              <li key={g.game_id}
                className="flex items-center justify-between rounded border border-teal-700 bg-teal-900/40 px-4 py-2 text-sm">
                <span>
                  #{g.game_id} — host {g.host_name || '?'} — {g.player_count}/{g.max_players} seats
                </span>
                <button className="btn-ghost" disabled={busy} onClick={() => handleJoin(g.game_id)}>
                  Join
                </button>
              </li>
            ))}
          </ul>
        )}

        <h2 className="font-display text-xl text-gold-300 mb-3">Your games</h2>
        {myGames.length === 0 ? (
          <p className="text-sm text-cream-400">None yet — launch one above.</p>
        ) : (
          <ul className="space-y-2">
            {myGames.map((g) => (
              <li key={g.game_id}
                className="flex items-center justify-between rounded border border-teal-700 bg-teal-900/40 px-4 py-2 text-sm">
                <span>
                  #{g.game_id} — {g.is_solo ? 'solo' : `${g.player_count}/${g.max_players} players`}
                  {' · '}{g.status}
                  {g.status === 'active' && (g.your_turn ? ' · YOUR TURN' : ' · waiting')}
                  {g.status === 'ended' && g.final_score !== null && ` · ${g.final_score} VP`}
                </span>
                {g.status !== 'lobby' && (
                  <Link className="btn-ghost" to={`/space/game/${g.game_id}`}>
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

/**
 * mpSession.js
 *
 * Tiny helper for persisting the multiplayer player_token in localStorage,
 * keyed by game_id. Lets a player refresh the page mid-game and pick up
 * where they left off without re-joining (which would assign them a new
 * seat).
 *
 * Storage shape:
 *   localStorage['historians_mp_session_<gameId>'] = JSON.stringify({
 *     player_token, player_id, seat_index, player_name
 *   })
 *
 * Why per-game keys rather than one global slot: a player could be in
 * multiple games over time (different tabs, different decks, finished
 * games still in URL history). Per-game keys keep them isolated.
 */

const KEY_PREFIX = 'historians_mp_session_';

export function saveSession(gameId, session) {
  try {
    localStorage.setItem(KEY_PREFIX + gameId, JSON.stringify(session));
  } catch {
    // localStorage may be unavailable (incognito, quota exceeded). Silently
    // fail; the player will just need to stay on the same tab.
  }
}

export function loadSession(gameId) {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + gameId);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSession(gameId) {
  try {
    localStorage.removeItem(KEY_PREFIX + gameId);
  } catch {
    // ignore
  }
}

/**
 * Enumerate all multiplayer sessions stored in localStorage. Returns
 * an array of { gameId, player_token, player_id, seat_index,
 * player_name } — one per saved session.
 *
 * Used by the "Your Games" widget on Home.jsx to ask the server which
 * of these games are still live, plus their current status.
 *
 * Sessions whose JSON has been corrupted in some way are silently
 * skipped. Same for if localStorage is unavailable (incognito).
 */
export function listAllSessions() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(KEY_PREFIX)) continue;
      const gameId = Number(key.slice(KEY_PREFIX.length));
      if (!Number.isFinite(gameId)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const data = JSON.parse(raw);
        if (data && typeof data.player_token === 'string') {
          out.push({ gameId, ...data });
        }
      } catch { /* skip bad entry */ }
    }
  } catch { /* localStorage unavailable */ }
  return out;
}

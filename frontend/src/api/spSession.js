/**
 * spSession.js — per-game space-game identity in localStorage
 * (mirror of mpSession.js with its own key prefix).
 */
const KEY_PREFIX = 'space_session_';

export function saveSpSession(gameId, session) {
  try {
    localStorage.setItem(KEY_PREFIX + gameId, JSON.stringify(session));
  } catch { /* ignore */ }
}

export function loadSpSession(gameId) {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + gameId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSpSession(gameId) {
  try {
    localStorage.removeItem(KEY_PREFIX + gameId);
  } catch { /* ignore */ }
}

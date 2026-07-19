/**
 * src/api/auth.js
 *
 * Axios wrappers for the user-account / authentication endpoints
 * shipped in Session 1. Mirrors the shape of api/multiplayer.js so
 * callers get a consistent interface.
 *
 * This module owns the SESSION TOKEN lifecycle:
 *
 *   - getSessionToken()         — read from localStorage
 *   - setSessionToken(token)    — write to localStorage; updates the
 *                                 axios default headers so subsequent
 *                                 requests carry the Bearer header
 *   - clearSessionToken()       — remove from localStorage + headers
 *
 * AuthContext (separate file) is the React-facing wrapper that
 * orchestrates these — components don't reach into this module
 * directly except through it.
 *
 * All endpoints throw a normalized Error with .message extracted from
 * the server's JSON {error: "..."} body. Status code is available
 * on err.response?.status when needed.
 */
import axios from 'axios';

// Reuse the same base URL convention as api/multiplayer.js. If your
// deployment puts these files at a different path, change it once here.
const api = axios.create({
  baseURL: import.meta.env.BASE_URL.replace(/\/$/, '') || '',
  headers: { 'Content-Type': 'application/json' },
});

const SESSION_KEY = 'historians.sessionToken';

export function getSessionToken() {
  try { return localStorage.getItem(SESSION_KEY); }
  catch { return null; }
}

export function setSessionToken(token) {
  try { localStorage.setItem(SESSION_KEY, token); } catch {}
  api.defaults.headers.common.Authorization = `Bearer ${token}`;
}

export function clearSessionToken() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  delete api.defaults.headers.common.Authorization;
}

// On module load, hydrate the Authorization header from whatever's in
// localStorage. This means every API call (including api/multiplayer.js
// if it imports this) automatically carries the Bearer token after a
// page refresh.
const _bootToken = getSessionToken();
if (_bootToken) api.defaults.headers.common.Authorization = `Bearer ${_bootToken}`;


// Extract the server-side error message from an axios error and
// re-throw with a clean message. Server returns { error: "..." } on
// failure.
function normalizeError(err) {
  if (err?.response?.data?.error) return new Error(err.response.data.error);
  if (err?.message) return new Error(err.message);
  return new Error('Network error');
}


/**
 * Register a new account. Returns { session_token, user }.
 * Throws on invalid invite, duplicate username/email, weak password.
 */
export async function register({ username, password, email, invite_code }) {
  try {
    const res = await api.post('/users_register.php', { username, password, email, invite_code });
    if (res.data?.session_token) setSessionToken(res.data.session_token);
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

/**
 * Sign in. Returns { session_token, user }. Throws on bad credentials,
 * disabled account, or throttled lockout.
 */
export async function login({ username, password }) {
  try {
    const res = await api.post('/users_login.php', { username, password });
    if (res.data?.session_token) setSessionToken(res.data.session_token);
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

/**
 * Sign out — revoke the current session token server-side and drop it
 * from localStorage. Always succeeds locally even if the server call
 * fails (network issue, expired token already).
 */
export async function logout() {
  try {
    await api.post('/users_logout.php', {});
  } catch {
    // Best-effort. We're going to clear locally either way.
  }
  clearSessionToken();
}

/**
 * Resolve the current session to user + settings, or null if no
 * session / expired. Used by AuthContext on app boot.
 */
export async function me() {
  if (!getSessionToken()) return null;
  try {
    const res = await api.get('/users_me.php');
    return res.data;
  } catch (err) {
    if (err?.response?.status === 401) {
      // Stale token. Clean it up so the rest of the app treats us as
      // signed-out.
      clearSessionToken();
      return null;
    }
    throw normalizeError(err);
  }
}

/**
 * Change the current user's password. Requires old + new.
 */
export async function changePassword({ old_password, new_password }) {
  try {
    const res = await api.post('/users_changePassword.php', { old_password, new_password });
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

/**
 * Trigger a password-reset email. Always resolves ok regardless of
 * whether the email exists in the system (the server is deliberately
 * non-committal to prevent enumeration).
 */
export async function requestPasswordReset({ email }) {
  try {
    const res = await api.post('/users_requestReset.php', { email });
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

/**
 * Complete a password reset using the token from the email link.
 * Returns { session_token, user } — the caller is now signed in.
 */
export async function completePasswordReset({ token, new_password }) {
  try {
    const res = await api.post('/users_completeReset.php', { token, new_password });
    if (res.data?.session_token) setSessionToken(res.data.session_token);
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

/**
 * Verify an email address using the token from the verification link.
 * Doesn't issue a session (the user might or might not be signed in).
 */
export async function verifyEmail({ token }) {
  try {
    const res = await api.post('/users_verifyEmail.php', { token });
    return res.data;
  } catch (err) { throw normalizeError(err); }
}


/**
 * Update one or more settings fields. Pass only the fields you want
 * to change; the server keeps the rest as-is. Returns the canonical
 * settings row back from the server so the caller can update state.
 */
export async function updateSettings(patch) {
  try {
    const res = await api.post('/users_updateSettings.php', patch);
    return res.data;
  } catch (err) { throw normalizeError(err); }
}


// ─── Admin endpoints ───────────────────────────────────────────────────

export async function adminGenerateInvite({ note, max_uses, expires_days, grants_admin } = {}) {
  try {
    const res = await api.post('/admin_generateInvite.php', {
      note: note ?? null,
      max_uses: max_uses ?? 1,
      expires_days: expires_days ?? null,
      grants_admin: !!grants_admin,
    });
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

export async function adminListInvites() {
  try {
    const res = await api.get('/admin_listInvites.php');
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

export async function adminRevokeInvite({ invite_id }) {
  try {
    const res = await api.post('/admin_revokeInvite.php', { invite_id });
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

export async function adminWipeMultiplayer() {
  try {
    const res = await api.post('/admin_wipeMultiplayer.php', { confirm: 'WIPE MULTIPLAYER' });
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

/**
 * Admin: purge multiplayer games older than `olderThanDays` (by last activity).
 * Pass dryRun=true to get the matched count without deleting anything.
 * @param {{ olderThanDays: number, dryRun?: boolean }} args
 * @returns {Promise<{ ok, dry_run, older_than_days, cutoff, matched, purged }>}
 */
export async function adminPurgeOldGames({ olderThanDays, dryRun = false }) {
  try {
    const res = await api.post('/admin_purgeGames.php', {
      older_than_days: olderThanDays,
      dry_run: !!dryRun,
    });
    return res.data;
  } catch (err) { throw normalizeError(err); }
}


// ─── Admin: deck management ─────────────────────────────────────────

export async function adminListDecks() {
  try {
    const res = await api.get('/admin_listDecks.php');
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

export async function adminUploadDeck({ nameFirst, nameLast, nameDeck, file }) {
  try {
    const fd = new FormData();
    fd.append('nameFirst', nameFirst ?? '');
    fd.append('nameLast', nameLast ?? '');
    fd.append('nameDeck', nameDeck ?? '');
    fd.append('deckFile', file);
    // Clear the instance's default application/json Content-Type so the
    // browser sets multipart/form-data WITH the boundary. The Bearer token
    // default header still rides along.
    const res = await api.post('/admin_uploadDeck.php', fd, {
      headers: { 'Content-Type': undefined },
    });
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

export async function adminDeleteDeck({ idDeck }) {
  try {
    const res = await api.post('/admin_deleteDeck.php', { idDeck });
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

/**
 * Download a deck as CSV, in the same column order admin_uploadDeck expects
 * (so it can be edited and re-uploaded). Returns a Blob — the caller saves it.
 * Fetched through the api instance so the Bearer token rides along; a plain
 * <a href> link would not be authenticated.
 */
export async function adminDownloadDeck({ idDeck }) {
  try {
    const res = await api.get('/admin_downloadDeck.php', {
      params: { idDeck },
      responseType: 'blob',
    });
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

export async function adminListPlaytestFeedback() {
  try {
    const res = await api.get('/admin_listPlaytestFeedback.php');
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

/**
 * Admin: permanently delete ALL anonymous playtest feedback responses.
 * @returns {Promise<{ ok, dry_run, matched, purged }>}
 */
export async function adminPurgePlaytestFeedback() {
  try {
    const res = await api.post('/admin_purgePlaytestFeedback.php', { confirm: 'PURGE PLAYTEST' });
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

/**
 * Admin: delete specific playtest feedback responses by id (curation).
 * @param {{ ids: number[] }} args
 * @returns {Promise<{ ok, deleted }>}
 */
export async function adminDeletePlaytestFeedback({ ids }) {
  try {
    const res = await api.post('/admin_deletePlaytestFeedback.php', { ids });
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

/**
 * Edit the name on a leaderboard entry (admin only).
 * @param {Object} args
 * @param {'solo'|'mp'} args.mode       which leaderboard the score lives on
 * @param {number} args.score_id        the score row id
 * @param {'entry'|'account'} args.scope 'entry' = this row only; 'account' = rename the user (solo)
 * @param {string} args.name            the new name
 */
export async function adminEditScoreName({ mode, score_id, scope, name }) {
  try {
    const res = await api.post('/admin_editScoreName.php', { mode, score_id, scope, name });
    return res.data;
  } catch (err) { throw normalizeError(err); }
}

import axios from 'axios';

/**
 * Central API client.
 *
 * In dev: Vite's proxy (vite.config.js) forwards /api/... to davidsbennett.com.
 * In prod: set VITE_API_BASE in a .env file when deploying to point at the
 *          actual PHP folder.
 */
const PROD_API_BASE = ''; // same-origin: frontend + backend both at thehistorians.org root

const baseURL =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.PROD ? PROD_API_BASE : '/api');

export const api = axios.create({
  baseURL,
  timeout: 15000,
});

// Attach the auth session token (set at login by api/auth.js, stored in
// localStorage under the same key) to every request from THIS client too.
// Without this, user-bound endpoints called through here —
// users_saveScore.php, users_listScores.php — receive no Bearer token and
// the server responds 401 "Not signed in" even though the user is logged in.
api.interceptors.request.use((config) => {
  try {
    const t = localStorage.getItem('historians.sessionToken');
    if (t) config.headers.Authorization = `Bearer ${t}`;
  } catch { /* localStorage unavailable — proceed without the header */ }
  return config;
});

/**
 * Normalize an axios error into a plain Error with a useful message.
 * Lets call sites do:  catch (err) { setError(err.message); }
 * and get human-readable text in the UI.
 */
function normalizeError(err) {
  if (err.response) {
    // Server responded with a non-2xx status. Prefer the body's `error`
    // field if present (our PHP endpoints all return {"error":"reason"} on
    // failure), then fall back to statusText, then to a generic message.
    // statusText is often empty under HTTP/2, so checking the body first
    // gives much more diagnostic value.
    const bodyError = err.response.data && err.response.data.error;
    // Show the server's friendly {error: "..."} message as-is; only fall back
    // to the technical "Server returned NNN" form when there's no message.
    if (bodyError) return new Error(bodyError);
    return new Error(`Server returned ${err.response.status}: ${err.response.statusText || 'error'}`);
  }
  if (err.request) {
    // Request was made, no response — network or CORS or server down
    return new Error(
      'Could not reach the server. Check your connection or try again in a moment.'
    );
  }
  // Something else (axios config error, etc.)
  return new Error(err.message || 'Unknown error');
}

// ---- Endpoints ---------------------------------------------------

/**
 * Fetch the list of all decks.
 * Backend: listDecks.php (returns JSON)
 *
 * IMPORTANT: this endpoint may not exist yet on the server. Earlier in the
 * project we only saw listCards.php. If listDecks.php returns an error,
 * we fall back to deriving deck info from a SELECT-via-existing-API.
 *
 * Returns: array of { idDeck, nameDeck, name (author), ... }
 */
export async function fetchDecks() {
  try {
    const res = await api.get('/listDecks.php');
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Fetch all cards for a given deck.
 * Backend: listCards.php?deck=:id
 *
 * Returns: array of card rows. Each card has at least:
 *   id, idDeck, title, source_type, sequence_number, content, date,
 *   author, location, significance, image_url, argument, sub_argument,
 *   citation, bonus, type, contributor
 */
export async function fetchCards(idDeck) {
  try {
    const res = await api.get('/listCards.php', { params: { deck: idDeck } });
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Fetch every card across all decks (no deck filter). Backend: listCards.php
 * with no `deck` param returns the full Cards table.
 */
export async function fetchAllCards() {
  try {
    const res = await api.get('/listCards.php');
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Submit a final game score to the leaderboard.
 * Backend: saveScore.php (POST, JSON body)
 *
 * Per design (locked in 2026-04), every game-end submits a score —
 * success or failure. Per-deck leaderboard means this score is
 * only compared against other plays of the same deck.
 *
 * @param {Object} payload  shape matching the backend's expected fields:
 *   {
 *     player_name, idDeck, rank, prestige,
 *     articles_published, books_published,
 *     research_level, notebook_level, influence_level, workspaces_level,
 *     year_ended
 *   }
 * @returns {Promise<{ ok: true, idScore: number }>}
 */
export async function submitScore(payload) {
  try {
    // Routes to users_saveScore.php — auth-gated endpoint that stores
    // solo results in user_scores keyed by user_id. The merged build
    // requires sign-in for solo play, so there's always a session
    // cookie present when this is called.
    const res = await api.post('/users_saveScore.php', payload);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Fetch leaderboard scores. Supports three modes:
 *
 *   fetchScores({ deck: 28 })       — scores for one specific deck
 *   fetchScores({ all: true })      — all scores across every deck
 *   fetchScores({ player: 'name' }) — all scores by one player (case-insensitive)
 *
 * Server returns rows sorted appropriately for the chosen mode. No need
 * to re-sort client-side unless the user clicks a column header.
 *
 * @param {Object} opts
 * @returns {Promise<Array>}
 */
export async function fetchScores(opts = {}) {
  // Backward compat: if a bare number/string is passed, treat as deck.
  if (typeof opts === 'number' || typeof opts === 'string') {
    opts = { deck: opts };
  }

  // Route to users_listScores.php (auth-aware backend). Param names
  // align with the locked endpoint: idDeck for deck filter, plus the
  // mp-full extras (all/player) which the endpoint either honors or
  // ignores depending on the server-side version. The auth cookie
  // provides the requesting user so the response can highlight the
  // viewer's own row.
  const params = {};
  if (opts.deck !== undefined && opts.deck !== null && opts.deck !== '') {
    params.idDeck = opts.deck;
  } else if (opts.all) {
    params.all = 1;
  } else if (opts.player) {
    params.player = opts.player;
  }
  if (opts.user_id) params.user_id = opts.user_id;
  if (opts.limit)   params.limit = opts.limit;
  if (opts.sort)    params.sort = opts.sort;
  // Multiplayer game-length board: 'short' | 'medium' | 'long' (mp only).
  if (opts.length)  params.length = opts.length;

  try {
    const endpoint = opts.mode === 'mp' ? '/mp_listScores.php' : '/users_listScores.php';
    const res = await api.get(endpoint, { params });
    // Locked endpoint returns { scores: [...] }; older endpoint returned
    // the array directly. Normalize to the array shape callers expect.
    return Array.isArray(res.data) ? res.data : (res.data?.scores || []);
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Verify the Show Tags unlock code against the server.
 * Backend: verifyTagCode.php (POST, JSON body)
 *
 * Returns { valid: boolean }. We never send the actual code from server
 * to client — only confirm whether what the student typed matches.
 *
 * @param {string} code  what the student typed
 * @returns {Promise<{ valid: boolean }>}
 */
export async function verifyTagCode(code) {
  try {
    const res = await api.post('/verifyTagCode.php', { code });
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Verify the historical-significance reveal code.
 * Backend: verifySignificanceCode.php (POST, JSON body).
 * Returns { valid: boolean }.
 *
 * @param {string} code  what the player typed
 * @returns {Promise<{ valid: boolean }>}
 */
export async function verifySignificanceCode(code) {
  try {
    const res = await api.post('/verifySignificanceCode.php', { code });
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}
/**
 * Submit one ANONYMOUS playtest questionnaire response.
 *
 * Deliberately uses the bare `axios` (NOT the `api` instance above), so the
 * auth interceptor does not run and NO Authorization/Bearer header is sent.
 * The response is not tied to the player's account in any way.
 */
export async function submitPlaytestFeedback(payload) {
  const url = `${baseURL}/playtest_feedback_submit.php`;
  try {
    const { data } = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    return data;
  } catch (err) {
    throw normalizeError(err);
  }
}

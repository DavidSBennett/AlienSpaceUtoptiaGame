/**
 * space.js — API wrappers for the SPACE GAME (sp_*) endpoints.
 * One thin async function per endpoint, mirroring api/multiplayer.js.
 */
import { api } from './client.js';

function normalizeError(err) {
  if (err.response) {
    const bodyError = err.response.data && err.response.data.error;
    if (bodyError) return new Error(bodyError);
    return new Error(`Server returned ${err.response.status}`);
  }
  if (err.request) return new Error('Could not reach the server.');
  return new Error(err.message || 'Unknown error');
}

async function post(path, body) {
  try {
    const res = await api.post(path, body);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

async function get(path, params) {
  try {
    const res = await api.get(path, { params });
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/** Create a game. maxPlayers 1 = solo (starts immediately).
 *  variant: 'plain' (themeless) | 'story' (authored missions). */
export const spCreateGame = (maxPlayers, variant = 'plain') =>
  post('/sp_createGame.php', { max_players: maxPlayers, variant });

export const spJoinGame = (gameId) =>
  post('/sp_joinGame.php', { game_id: gameId });

export const spStartGame = (playerToken) =>
  post('/sp_startGame.php', { player_token: playerToken });

export const spGetGameState = (playerToken) =>
  get('/sp_getGameState.php', { player_token: playerToken });

/**
 * Play one card. params shape depends on the card's action:
 *   move:    { steps: [{drone, to}], treaty?: {planet, commits: []} }
 *   strike:  { planet, commits: [] }
 *   trade:   { planet, commits: [], sell: {L:n}, buy: {L:n} }
 *   produce: { mode: 'production'|'levy', system? }
 *   deploy:  { mode: 'place'|'credits', placements?: [{planet}] }
 *   recruit / recruit_free: { picks: [{card, payment: {L:n}}] }
 *   copy:    { target_seat, params: {…inner…} }
 *   reset:   { build_drone?, drone_planet?, upgrades?: [] }
 *   envoy:   { }
 */
export const spPlayCard = (playerToken, card, params = {}) =>
  post('/sp_playCard.php', { player_token: playerToken, card, params });

/**
 * Exobiology HARVEST — a free-standing turn action (no card played).
 * assignments: [{ field: <index into your field>, mission: '<key>' }]
 */
export const spHarvest = (playerToken, assignments) =>
  post('/sp_harvest.php', { player_token: playerToken, assignments });

/**
 * Resolve a pending one-shot triggered boon (no turn cost).
 * card: key to fire (Severance Authority), or null to decline.
 */
export const spResolveBoon = (playerToken, pending, card) =>
  post('/sp_resolveBoon.php', { player_token: playerToken, pending, card });

export const spConcede = (playerToken) =>
  post('/sp_concede.php', { player_token: playerToken });

export const spCancelGame = (playerToken) =>
  post('/sp_cancelGame.php', { player_token: playerToken });

/** Full playthrough export: game summary, players, story, entire event log. */
export const spExportGame = (playerToken) =>
  get('/sp_exportGame.php', { player_token: playerToken });

/** File a playtest report (notes required, rating 1-5 optional). */
export const spSubmitReport = (playerToken, notes, rating = null) =>
  post('/sp_submitReport.php', { player_token: playerToken, notes, rating });

export const spListOpenGames = () => get('/sp_listOpenGames.php');

export const spListMyGames = () => get('/sp_listMyGames.php');

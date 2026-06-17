import { api } from './client.js';

/**
 * Multiplayer API client.
 *
 * Thin axios wrappers around every mp_*.php endpoint. Each function does
 * exactly one HTTP call and returns the parsed JSON body, or throws an
 * Error with a useful message on failure.
 *
 * Error normalization is handled by api.js's interceptor (which extracts the
 * server's {error: "..."} body into err.message). We catch and re-throw here
 * with the same pattern as fetchDecks() / fetchCards() in client.js.
 */

function normalizeError(err) {
  if (err.response) {
    const bodyError = err.response.data && err.response.data.error;
    const message = bodyError || err.response.statusText || 'no message';
    return new Error(`Server returned ${err.response.status}: ${message}`);
  }
  if (err.request) {
    return new Error('Could not reach the server. Check your connection or try again.');
  }
  return new Error(err.message || 'Unknown error');
}

// ===== Lobby =====

/**
 * List open lobbies. Used on the multiplayer landing page so a joining
 * player can see what's available.
 *
 * @returns {Promise<Array<{game_id, deck_name, host_player_name,
 *                          current_players_count, max_players, created_at}>>}
 */
export async function mpListOpenGames() {
  try {
    const res = await api.get('/mp_listOpenGames.php');
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Create a new lobby and become its host.
 * @param {{ idDeck, player_name, max_players? }} args
 * @returns {Promise<{ game_id, player_id, player_token, seat_index }>}
 */
export async function mpCreateGame(args) {
  try {
    const res = await api.post('/mp_createGame.php', args);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Join an existing lobby.
 * @param {{ game_id, player_name }} args
 * @returns {Promise<{ game_id, player_id, player_token, seat_index }>}
 */
export async function mpJoinGame(args) {
  try {
    const res = await api.post('/mp_joinGame.php', args);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Host action — start the game. Locks the roster, shuffles the archive
 * server-side, sets status='active'.
 * @param {{ player_token }} args
 * @returns {Promise<{ ok, game_id, started_at, archive_size }>}
 */
export async function mpStartGame(args) {
  try {
    const res = await api.post('/mp_startGame.php', args);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

// ===== Game state =====

/**
 * Poll the current game state. If `sinceVersion` is provided AND nothing
 * has changed, server returns { state_version, unchanged: true } and the
 * caller should not re-render.
 *
 * @param {string} playerToken
 * @param {number} [sinceVersion]
 * @returns {Promise<object>}
 */
export async function mpGetGameState(playerToken, sinceVersion) {
  try {
    const params = { player_token: playerToken };
    if (typeof sinceVersion === 'number') params.since_version = sinceVersion;
    const res = await api.get('/mp_getGameState.php', { params });
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

// ===== Actions =====

/**
 * Commit a player's action for the current year. If `commit` is true, this
 * is the "End Year" press; otherwise it's a tentative selection.
 *
 * @param {{ player_token, action, action_data?, commit }} args
 * @returns {Promise<{ ok, committed, state_version }>}
 */
export async function mpCommitAction(args) {
  try {
    const res = await api.post('/mp_commitAction.php', args);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Submit a review verdict on a submission you committed to review.
 * @param {{ player_token, submission_id, verdict, flagged_card_ids?, comment? }} args
 */
export async function mpSubmitReview(args) {
  try {
    const res = await api.post('/mp_submitReview.php', args);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Move a card between zones. Free action (no year cost).
 * @param {{ player_token, card_id, from, to }} args
 */
export async function mpMoveCard(args) {
  try {
    const res = await api.post('/mp_moveCard.php', args);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Pick a stat to upgrade. Consumes pending_upgrade flag.
 * @param {{ player_token, stat }} args
 */
export async function mpUpgradeStat(args) {
  try {
    const res = await api.post('/mp_upgradeStat.php', args);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Acknowledge a resolved submission (dismiss the result dialog).
 * @param {{ player_token, submission_id }} args
 */
export async function mpClaimResultRewards(args) {
  try {
    const res = await api.post('/mp_claimResultRewards.php', args);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Claim the consolation draw for a rejected submission. Immediate; does
 * not advance the year. Disabled (server-side error) if hand is full or
 * if already claimed.
 * @param {{ player_token, submission_id }} args
 */
export async function mpDrawConsolation(args) {
  try {
    const res = await api.post('/mp_drawConsolation.php', args);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Spend an objection token to contest a rejected manuscript.
 * Server runs an algorithmic tag check; if successful, the submission
 * is approved (objection-won) and rejecting reviewers lose 5 prestige.
 * If unsuccessful (objection-lost), the rejection stands.
 */
export async function mpSpendObjection({ player_token, submission_id }) {
  try {
    const res = await api.post('/mp_spendObjection.php', {
      player_token,
      submission_id,
    });
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Concede the game — voluntarily exit. Marks the player game_over with
 * reason 'conceded'. Game continues for remaining live players, or
 * ends if no one is left.
 */
export async function mpConcede(playerToken) {
  try {
    const res = await api.post('/mp_concede.php', { player_token: playerToken });
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Host-only: permanently delete the game (lobby or in-progress). Removes
 * it from the open-games queue and everyone's "your games" list. The
 * server rejects this (403) unless the caller is the host.
 *
 * @param {string} playerToken
 * @returns {Promise<{ ok: boolean, game_id: number, deleted: boolean }>}
 */
export async function mpCancelGame(playerToken) {
  try {
    const res = await api.post('/mp_cancelGame.php', { player_token: playerToken });
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Notify the other players that you've engaged the historical-significance
 * reveal. Display-only — logs an event the others' poll turns into a toast.
 */
export async function mpRevealSignificance(playerToken) {
  try {
    const res = await api.post('/mp_revealSignificance.php', { player_token: playerToken });
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Host-only: set a table-wide display toggle (force tags / significance on for
 * everyone). toggle is 'tags' | 'significance'.
 */
export async function mpSetGameToggle({ player_token, toggle, value }) {
  try {
    const res = await api.post('/mp_setGameToggle.php', { player_token, toggle, value });
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Writer resolves a Revise & Resubmit proposal: 'accept' | 'object' | 'rebuild'.
 * @param {{ player_token, submission_id, decision }} args
 */
export async function mpResolveRevise(args) {
  try {
    const res = await api.post('/mp_resolveRevise.php', args);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Fetch the recent event log for the current game. Used by the action
 * history modal — shows what every player has done, year by year.
 */
export async function mpGetEvents(playerToken, limit = 200) {
  try {
    const res = await api.get('/mp_diagnostic_events.php', {
      params: { player_token: playerToken, limit },
    });
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Add a citation: link one of your projects to a published work.
 * @param {{ player_token, slot_index, cited_work_id }} args
 */
export async function mpAddCitation(args) {
  try {
    const res = await api.post('/mp_addCitation.php', args);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Remove a citation from a project.
 * @param {{ player_token, citation_id }} args
 */
export async function mpRemoveCitation(args) {
  try {
    const res = await api.post('/mp_removeCitation.php', args);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Reclaim evidence cards from a rejected manuscript into your hand.
 * Greedy: takes cards in declared order until hand is full or manuscript
 * is empty. The remaining cards stay bound.
 * @param {{ player_token, submission_id }} args
 */
export async function mpReclaimManuscript(args) {
  try {
    const res = await api.post('/mp_reclaimManuscript.php', args);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * After game-end, push final scores to the shared leaderboard. Idempotent.
 * @param {{ player_token }} args
 */
export async function mpSubmitFinalScore(args) {
  try {
    const res = await api.post('/mp_submitFinalScore.php', args);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * "Your Games" lookup — returns the games the signed-in user has a
 * seat in, regardless of status. Auth-gated; uses the session cookie
 * to resolve identity server-side (no need to pass tokens). Used by
 * Home.jsx to surface in-progress and recently-ended games.
 *
 * @returns {Promise<{ games: Array }>}
 */
export async function mpListMyGames() {
  try {
    const res = await api.get('/mp_listMyGames.php');
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Send a chat message to a game (works for both lobby and active
 * game — the message simply lives in the chat log either way).
 * @param {{ player_token, content }} args
 */
export async function mpSendChatMessage(args) {
  try {
    const res = await api.post('/mp_sendChatMessage.php', args);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

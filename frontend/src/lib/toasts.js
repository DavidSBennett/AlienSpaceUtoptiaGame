/**
 * src/lib/toasts.js
 *
 * Toast manager — a tiny pub/sub for showing transient notifications
 * to the player. Exposes:
 *
 *   useToasts() → { toasts, push, dismiss }
 *   toastFromEvents(events, seenSetRef) → side effect, pushes toasts
 *                                          for any events newer than
 *                                          the last-seen pointer
 *
 * The second function is the integration point with the game-state
 * polling loop: every poll, hand it the events array; it diffs
 * against what we've already seen and pushes toasts for the new
 * ones, optionally playing a sound effect.
 *
 * Implementation: useSyncExternalStore + a module-level store. This
 * lets us trigger toasts from outside React (e.g., inside a network
 * callback) and still have components re-render when the toast list
 * changes.
 */
import { useSyncExternalStore } from 'react';
import {
  playPublishChime, playRejectThud, playYearTick,
  playCommitChirp, playJoinChime, playGameEndFanfare,
  playObjectionWon, playObjectionLost,
} from './sounds.js';


// ─── Module-level store ─────────────────────────────────────────────

let _toasts = [];
const _listeners = new Set();
let _idCounter = 1;

function _emit() { for (const l of _listeners) l(); }

function _subscribe(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

function _getSnapshot() { return _toasts; }


// ─── Public API ─────────────────────────────────────────────────────

/**
 * Push a toast. Returns the toast ID so callers can dismiss it
 * programmatically.
 *
 * @param {object} t
 * @param {string} t.title       — required, ~1 line
 * @param {string} [t.body]      — optional, ~2 lines
 * @param {string} [t.eyebrow]   — small uppercase label, default 'Update'
 * @param {string} [t.variant]   — 'default' | 'success' | 'warning'
 * @param {number} [t.duration]  — ms; default 4000. Pass Infinity for sticky.
 */
export function pushToast(t) {
  const id = _idCounter++;
  _toasts = [..._toasts, { id, duration: 2500, variant: 'default', ...t }];
  _emit();
  return id;
}

export function dismissToast(id) {
  _toasts = _toasts.filter((t) => t.id !== id);
  _emit();
}

/**
 * Hook for components that want to render the current toast stack.
 * Use ToastStack from components/Toast.jsx which uses this internally.
 */
export function useToasts() {
  const toasts = useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);
  return { toasts, push: pushToast, dismiss: dismissToast };
}


// ─── Event-to-toast bridge ──────────────────────────────────────────

/**
 * Inspect a list of action-history events and push a toast for every
 * event newer than what's been seen before. Side-effecting; meant to
 * be called from the game-state polling loop.
 *
 * Callers pass a Set ref tracking which event IDs have already
 * triggered toasts; we mutate it as we process new events.
 *
 * @param {Array}     events   — events array from mp_getGameState
 * @param {object}    seenRef  — { current: Set<number> }  mutable ref
 * @param {number}    youPid   — the local player's player_id, so we
 *                               can avoid self-toasting (the player
 *                               knows they just committed; they don't
 *                               need a toast about it)
 */
export function toastFromEvents(events, seenRef, youPid) {
  if (!Array.isArray(events) || events.length === 0) return;
  if (!seenRef.current) seenRef.current = new Set();

  // Track whether we've already populated this Set at least once.
  // First call: seed the Set with every existing event ID, no toasts
  // pushed. Otherwise the player would get bombarded with toasts for
  // every action that happened before they opened the page.
  if (seenRef.current.size === 0 && !seenRef.bootstrapped) {
    for (const ev of events) seenRef.current.add(ev.event_id);
    seenRef.bootstrapped = true;
    return;
  }

  for (const ev of events) {
    const id = ev.event_id;
    if (seenRef.current.has(id)) continue;
    seenRef.current.add(id);

    const t = _eventToToast(ev, youPid);
    if (t) pushToast(t);
    _eventToSound(ev, youPid);
  }
}


// Returns either a toast spec or null. Self-events (player_id === youPid)
// are mostly suppressed — the player initiated the action, they don't
// need a notification. We do toast self-events for some types
// (publications, game-end) where the result matters.
function _eventToToast(ev, youPid) {
  const isSelf = ev.player_id != null && ev.player_id === youPid;
  const name = ev.player_name || 'Someone';
  const d = ev.event_data || {};

  switch (ev.event_type) {
    case 'action_committed':
      // No toast — each opponent commit would spam the stack, and the
      // OpponentBar already shows everyone's committed/thinking status.
      // (The commit chirp still plays via _eventToSound.)
      return null;

    case 'year_advanced':
      // No toast — this fires every single year; the YearProgressBar and
      // the year-tick sound already mark the transition.
      return null;

    case 'result_dismissed':
      if (!isSelf || !d.objection_token_granted) return null;
      return {
        eyebrow: 'Objection',
        title: '+1 objection token',
        body: 'Accepting the rejection restored a token (max 4).',
        variant: 'success',
      };

    case 'publication_approved':
      // Your own approval is already shown by the auto-popping result
      // dialog — only toast OTHER players' publications (competitive info).
      if (isSelf) return null;
      return {
        eyebrow: 'Publication',
        title: `${name} published ${d.kind ?? 'a work'}.`,
        body: d.title ? `"${d.title}" — +${d.prestige ?? 0} prestige` : undefined,
        variant: 'success',
      };

    case 'publication_rejected':
      // No toast — the writer's own rejection is shown by the auto-popping
      // result dialog, and other players' rejections aren't actionable noise.
      return null;

    case 'publication_auto_rejected':
      // No toast — the result dialog explains the auto-rejection (and its
      // reason) to the writer directly.
      return null;

    case 'objection_won':
      return {
        eyebrow: 'Objection',
        title: isSelf ? 'Your objection succeeded!' : `${name}'s objection succeeded.`,
        body: 'The peer rejection was overridden.',
        variant: 'success',
      };

    case 'objection_lost':
      if (!isSelf) return null;
      return {
        eyebrow: 'Objection',
        title: 'Your objection failed.',
        body: 'No common tag was found. Token spent.',
        variant: 'warning',
      };

    case 'objection_penalty':
      if (!isSelf) return null;
      return {
        eyebrow: 'Penalty',
        title: `You lost ${d.prestige_lost ?? 5} prestige.`,
        body: 'A writer successfully objected to your rejection.',
        variant: 'warning',
      };

    case 'player_joined':
      if (isSelf) return null;
      return { eyebrow: 'Lobby', title: `${name} joined the game.` };

    case 'game_started':
      return { eyebrow: 'Begin', title: 'The game begins.' };

    case 'significance_revealed':
      // No toast — low-signal table chatter.
      return null;

    case 'game_ended':
      // No toast: the ended game state is already conveyed by the UI (final
      // scoreboard / ended screen), and a lingering game-over toast would
      // otherwise carry over visually into the next game you open. The
      // game-end fanfare sound still plays (wired separately in _eventToSound).
      return null;

    case 'renown_bonus_awarded':
      if (!isSelf) return null;
      return {
        eyebrow: 'Renown',
        title: `+${d.bonus ?? 0} prestige from renown!`,
        body: `${d.citations_received ?? 0} citations × renown L${d.renown_level ?? 1}.`,
        variant: 'success',
      };

    default:
      return null;
  }
}


// Map events to sound effects. Plays for both self and others.
function _eventToSound(ev, youPid) {
  const isSelf = ev.player_id != null && ev.player_id === youPid;
  switch (ev.event_type) {
    case 'action_committed':         if (!isSelf) playCommitChirp(); break;
    case 'year_advanced':            playYearTick(); break;
    case 'publication_approved':     playPublishChime(); break;
    case 'publication_rejected':
    case 'publication_auto_rejected':playRejectThud(); break;
    case 'objection_won':            playObjectionWon(); break;
    case 'objection_lost':           if (isSelf) playObjectionLost(); break;
    case 'player_joined':            playJoinChime(); break;
    case 'game_ended':               playGameEndFanfare(); break;
    default: break;
  }
}

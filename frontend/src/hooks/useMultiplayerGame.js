import { useEffect, useRef, useState, useCallback } from 'react';

import { mpGetGameState } from '../api/multiplayer.js';

/**
 * useMultiplayerGame — simple, robust polling hook.
 *
 * Design notes (after debugging painful StrictMode races):
 *
 *   1. NO in-flight lock (no tickingRef). If the request is slow and the
 *      next poll fires, both go to the server. The server is idempotent
 *      and Vite/cPanel can handle 2 concurrent reads. The lock caused
 *      bugs where it'd stay `true` after a mount-unmount-remount cycle.
 *
 *   2. lastPollAt is set in BOTH the success and error finally clauses.
 *      That way the connection pill advances even when the server is
 *      misbehaving — it's a heartbeat, not a success indicator.
 *
 *   3. The polling effect is self-contained. It owns its setTimeout
 *      handle locally, doesn't depend on refs that might get cleared
 *      out from under it. Each instance schedules its own polls, and
 *      a clean cancellation flag prevents double-firing.
 *
 *   4. We always send since_version=undefined now (server ignores it).
 *      Full state every poll. That eliminates the whole class of
 *      stale-version bugs.
 */
export function useMultiplayerGame(playerToken, options = {}) {
  const { intervalMs = 1500, enabled = true } = options;

  const [state, setState]       = useState(null);
  const [error, setError]       = useState(null);
  const [isLoading, setLoading] = useState(true);
  const [lastPollAt, setLastPollAt] = useState(null);

  // Token in a ref so we don't restart polling on every render.
  const tokenRef = useRef(playerToken);
  useEffect(() => { tokenRef.current = playerToken; }, [playerToken]);

  const refresh = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const data = await mpGetGameState(token);
      if (!data.unchanged) {
        setState(data);
        setError(null);
      }
    } catch (e) {
      setError(e.message || 'Poll failed');
    } finally {
      setLastPollAt(Date.now());
      setLoading(false);
    }
  }, []);

  // Polling effect — recursive setTimeout. Survives StrictMode double-mount
  // because each mount has its own cancelled flag and timeout handle.
  useEffect(() => {
    if (!enabled) return;
    if (!playerToken) return;

    let cancelled = false;
    let timeoutHandle = null;

    async function tick() {
      if (cancelled) return;
      try {
        const data = await mpGetGameState(tokenRef.current);
        if (cancelled) return;
        if (!data.unchanged) {
          setState(data);
          setError(null);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e.message || 'Poll failed');
      } finally {
        if (!cancelled) {
          setLastPollAt(Date.now());
          setLoading(false);
          // Always schedule the next tick regardless of visibility.
          // Browsers throttle setTimeout in background tabs (Chrome/Firefox
          // limit to ~1/min when hidden), which slows things but doesn't
          // stop them entirely. For a 2-player game where the user often
          // switches between browser windows side-by-side, we want polls
          // to keep firing as fast as the browser allows.
          timeoutHandle = setTimeout(tick, intervalMs);
        }
      }
    }

    function onVisibility() {
      // When the page becomes visible again, fetch immediately to catch
      // up on whatever happened while the tab was throttled.
      if (!document.hidden && !cancelled) {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        tick();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    // Kick off the first tick.
    tick();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (timeoutHandle) clearTimeout(timeoutHandle);
    };
  }, [enabled, playerToken, intervalMs]);

  return { state, error, isLoading, refresh, lastPollAt };
}

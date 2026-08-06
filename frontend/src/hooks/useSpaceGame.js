import { useEffect, useRef, useState, useCallback } from 'react';
import { spGetGameState } from '../api/space.js';

/**
 * useSpaceGame — polling hook for the space game. Identical architecture to
 * useMultiplayerGame (no in-flight lock, heartbeat on error, visibility
 * catch-up); see that file's header for the rationale.
 */
export function useSpaceGame(playerToken, options = {}) {
  const { intervalMs = 1500, enabled = true } = options;

  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setLoading] = useState(true);
  const [lastPollAt, setLastPollAt] = useState(null);

  const tokenRef = useRef(playerToken);
  useEffect(() => { tokenRef.current = playerToken; }, [playerToken]);

  const refresh = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const data = await spGetGameState(token);
      setState(data);
      setError(null);
    } catch (e) {
      setError(e.message || 'Poll failed');
    } finally {
      setLastPollAt(Date.now());
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !playerToken) return;

    let cancelled = false;
    let timeoutHandle = null;

    async function tick() {
      if (cancelled) return;
      try {
        const data = await spGetGameState(tokenRef.current);
        if (cancelled) return;
        setState(data);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e.message || 'Poll failed');
      } finally {
        if (!cancelled) {
          setLastPollAt(Date.now());
          setLoading(false);
          timeoutHandle = setTimeout(tick, intervalMs);
        }
      }
    }

    function onVisibility() {
      if (!document.hidden && !cancelled) {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        tick();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    tick();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (timeoutHandle) clearTimeout(timeoutHandle);
    };
  }, [enabled, playerToken, intervalMs]);

  return { state, error, isLoading, refresh, lastPollAt };
}

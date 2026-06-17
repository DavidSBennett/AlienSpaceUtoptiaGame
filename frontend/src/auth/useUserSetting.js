/**
 * src/auth/useUserSetting.js
 *
 * Hook for binding a React component to one user setting. Reads from
 * AuthContext.settings; writes through AuthContext.updateSettings
 * (which optimistically updates local state and POSTs to
 * users_updateSettings.php on the server).
 *
 * Usage (boolean toggles):
 *   const [voip, setVoip] = useUserSetting('voip_enabled', false);
 *   <input checked={voip} onChange={() => setVoip(!voip)} />
 *
 * Usage (array-valued like tutorials_dismissed):
 *   const [dismissed, setDismissed] = useUserSetting('tutorials_dismissed', []);
 *   setDismissed([...dismissed, 'draw-zone']);   // adds
 *
 * The default value is returned during the brief boot window before
 * AuthContext finishes its initial me() call. For RequireAuth-gated
 * components this window is invisible (RequireAuth renders a loading
 * placeholder until settings are ready). For Home.jsx and other
 * public surfaces, callers should be tolerant of the default flashing
 * briefly on first paint.
 *
 * If the user isn't signed in at all, setValue is a no-op — the
 * setting can't be persisted. Components that need to function for
 * guests should fall back to local state OR be gated behind
 * RequireAuth so they only ever render for signed-in users (the
 * locked-version pattern).
 */
import { useCallback } from 'react';
import { useAuth } from './AuthContext.jsx';

export default function useUserSetting(key, defaultValue) {
  const { settings, updateSettings, isSignedIn } = useAuth();
  const value = settings && key in settings ? settings[key] : defaultValue;

  const setValue = useCallback(
    (next) => {
      if (!isSignedIn) return;
      const resolved = typeof next === 'function' ? next(value) : next;
      // Fire-and-forget; AuthContext handles optimistic update + error revert.
      updateSettings({ [key]: resolved }).catch(() => { /* swallowed */ });
    },
    [key, value, updateSettings, isSignedIn]
  );

  return [value, setValue];
}


/**
 * Convenience helper for the tutorials_dismissed list: returns
 * { dismissed: Set<string>, dismiss(id), isDismissed(id), resetAll() }.
 * Uses a Set on the read side so callers can do O(1) checks; writes
 * round-trip to the server as an array.
 */
export function useTutorialsDismissed() {
  const [list, setList] = useUserSetting('tutorials_dismissed', []);
  const dismissed = new Set(Array.isArray(list) ? list : []);

  const dismiss = useCallback(
    (id) => {
      if (!id) return;
      if (dismissed.has(id)) return;
      setList([...dismissed, id]);
    },
    [dismissed, setList]
  );
  const isDismissed = useCallback((id) => dismissed.has(id), [dismissed]);
  const resetAll = useCallback(() => setList([]), [setList]);

  return { dismissed, dismiss, isDismissed, resetAll };
}

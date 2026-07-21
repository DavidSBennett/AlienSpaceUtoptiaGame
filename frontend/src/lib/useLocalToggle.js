/**
 * useLocalToggle — a boolean UI preference kept on THIS device.
 *
 * Deliberately not useUserSetting. Server-backed settings are not a generic
 * key-value store: each one is an explicit column in user_settings, written and
 * read by name in users_updateSettings.php. Passing a key with no column behind
 * it looks like it works — AuthContext applies the change optimistically — and
 * then silently reverts when the server's response comes back without it. The
 * visible symptom is a control that flips and immediately flips back.
 *
 * So a preference gets a column (and a migration on every installation's
 * database) or it lives here. Panel-collapsed state is a per-device view
 * preference — a player on a laptop and a phone plausibly wants different
 * answers — so it lives here.
 *
 * Falls back to in-memory state where localStorage is unavailable (private
 * browsing, storage disabled): the toggle still works, it just won't persist.
 */
import { useCallback, useState } from 'react';

export default function useLocalToggle(key, defaultValue = false) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? defaultValue : raw === '1';
    } catch {
      return defaultValue;
    }
  });

  const set = useCallback(
    (next) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        try { window.localStorage.setItem(key, resolved ? '1' : '0'); } catch { /* not persisted */ }
        return resolved;
      });
    },
    [key]
  );

  return [value, set];
}

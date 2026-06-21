/**
 * Narrative-prompt setting — whether the story modals (hiring, tenure,
 * promotions) pop up. Persisted in localStorage so it survives reloads and
 * applies to both single-player and multiplayer. Default ON.
 */
import { useCallback, useState } from 'react';

const KEY = 'historians.narrativeEnabled';

export function getNarrativeEnabled() {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setNarrativeEnabled(on) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* localStorage unavailable — ignore */
  }
}

/** React hook: returns [enabled, toggle]. */
export function useNarrativeEnabled() {
  const [enabled, setEnabled] = useState(getNarrativeEnabled());
  const toggle = useCallback(() => {
    setEnabled((cur) => {
      const next = !cur;
      setNarrativeEnabled(next);
      return next;
    });
  }, []);
  return [enabled, toggle];
}

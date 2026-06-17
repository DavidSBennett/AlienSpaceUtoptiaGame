/**
 * TutorialManager — watches the game state and shows the next eligible
 * tutorial when its trigger condition becomes true.
 *
 * Only one tutorial is visible at a time. The manager re-evaluates on
 * every state change. Once dismissed (via "Got it"), a tutorial's id
 * is added to the localStorage seen-set and never fires again for that
 * player token.
 *
 * Props:
 *   state         — full game state from useMultiplayerGame
 *   playerToken   — used to scope the seen-set
 *   enabled       — global toggle (from useTutorialEnabled)
 */
import { useEffect, useState } from 'react';
import { pickNextTutorial } from '../lib/tutorials.jsx';
import { loadDismissed, markDismissed } from '../lib/tutorialStorage.js';
import TutorialModal from './TutorialModal.jsx';

export default function TutorialManager({ state, playerToken, enabled }) {
  // Set of tutorial ids the player has dismissed. We load from
  // localStorage once per token, then keep an in-memory copy to avoid
  // re-reading on every render.
  const [dismissed, setDismissed] = useState(() => loadDismissed(playerToken));

  // Whatever tutorial is currently shown. May be different from the
  // result of pickNextTutorial() if the player closed (not dismissed)
  // a tutorial — in that case we suppress it just for this rendering
  // pass and let it re-trigger when state changes again.
  const [current, setCurrent] = useState(null);
  // Tutorials closed-but-not-dismissed during this session. Won't fire
  // again until state changes meaningfully (in practice, any state
  // change clears the suppression).
  const [sessionSuppressed, setSessionSuppressed] = useState(new Set());

  // Re-pick whenever state or dismiss-set changes.
  useEffect(() => {
    if (!enabled) {
      setCurrent(null);
      return;
    }
    if (!state) return;
    const next = pickNextTutorial(state, new Set([...dismissed, ...sessionSuppressed]));
    setCurrent(next);
  }, [state, dismissed, sessionSuppressed, enabled]);

  // When token changes (rare — player switches account), reload the
  // dismiss set.
  useEffect(() => {
    setDismissed(loadDismissed(playerToken));
    setSessionSuppressed(new Set());
  }, [playerToken]);

  function handleDismiss() {
    if (!current) return;
    markDismissed(playerToken, current.id);
    setDismissed((prev) => new Set(prev).add(current.id));
    setCurrent(null);
  }

  function handleClose() {
    if (!current) return;
    // Suppress this id for the session but don't persist. It can fire
    // again on the next significant state change — useful if the
    // player clicked away accidentally.
    setSessionSuppressed((prev) => new Set(prev).add(current.id));
    setCurrent(null);
  }

  if (!current) return null;

  return (
    <TutorialModal
      tutorial={current}
      onDismiss={handleDismiss}
      onClose={handleClose}
    />
  );
}

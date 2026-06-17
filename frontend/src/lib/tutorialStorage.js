/**
 * tutorialStorage.js
 *
 * Backwards-compatible shim. Older code (and any code that we missed
 * during the migration) imports these plain functions. In the locked
 * version, tutorial state lives in user_settings server-side; the
 * canonical accessors are the hooks in src/auth/useUserSetting.js:
 *
 *   useUserSetting('tutorial_enabled', true)
 *   useTutorialsDismissed()
 *
 * The functions below remain so imports don't 404, but they are no-ops
 * outside React (no AuthContext available). All callers that USED them
 * should be ported to the hooks; what's left here is defensive scaffolding.
 *
 * If you find yourself reaching for these instead of the hooks, stop —
 * use the hooks. They survive page reloads and sync across devices.
 */

// Default returns matching the old behavior so unported callers don't
// crash. Reads cannot reach the server from a non-React context, so
// they return the defaults and writes are silent no-ops.

export function isTutorialEnabled() { return true; }
export function setTutorialEnabled(_enabled) { /* no-op outside React */ }
export function loadDismissed(_playerToken) { return new Set(); }
export function markDismissed(_playerToken, _tutorialId) { /* no-op */ }
export function clearDismissed(_playerToken) { /* no-op */ }

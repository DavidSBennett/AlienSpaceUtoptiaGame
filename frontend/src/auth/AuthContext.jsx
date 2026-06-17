/**
 * src/auth/AuthContext.jsx
 *
 * Single source of truth for the currently-signed-in user (or null,
 * for guests). Every component that needs to know "is the user signed
 * in?" reads from useAuth(), not from localStorage directly.
 *
 * Lifecycle:
 *
 *   1. On mount, AuthProvider calls api/auth.js → me().
 *      If a session_token is present and valid, the server returns
 *      { user, settings } and we hydrate.
 *      If no token, or token is stale (401), we end up null and the
 *      `loading` flag flips to false.
 *
 *   2. Components call methods on the context to mutate state:
 *      - signIn({ username, password })
 *      - signUp({ username, password, email, invite_code })
 *      - signOut()
 *      - applyCompletedReset({ session_token, user })  // for the
 *        reset-password flow, which lands the user pre-signed-in
 *
 *   3. After signIn/signUp the user object is in context and any
 *      RequireAuth-guarded route renders its children.
 *
 * Things this DOESN'T do (yet — Session 3+):
 *   - Live-sync settings between devices
 *   - Refresh tokens before expiry
 *   - Display "your session is about to expire" warnings
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  me as fetchMe,
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  updateSettings as apiUpdateSettings,
  setSessionToken,
  getSessionToken,
} from '../api/auth.js';

const AuthContext = createContext(null);


export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  // `loading` is true on the very first me() call, before we know
  // whether the existing session_token (if any) is valid. UI that
  // gates on auth should render a neutral spinner while loading is
  // true rather than briefly flashing the signed-out state.
  const [loading, setLoading] = useState(true);
  // `error` surfaces transient auth errors back to forms — login
  // pages, mostly. Forms can also catch errors locally; this is the
  // catch-all bucket.
  const [error, setError] = useState(null);

  // On boot, ask the server who we are.
  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((data) => {
        if (cancelled) return;
        if (data?.user) {
          setUser(data.user);
          setSettings(data.settings);
        } else {
          setUser(null);
          setSettings(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setSettings(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const signIn = useCallback(async ({ username, password }) => {
    setError(null);
    const data = await apiLogin({ username, password });
    setUser(data.user);
    // Login doesn't return settings; pull them via me() now that we're
    // authenticated. Cheap and keeps settings always-fresh on signin.
    const meData = await fetchMe();
    setSettings(meData?.settings ?? null);
    return data;
  }, []);

  const signUp = useCallback(async ({ username, password, email, invite_code }) => {
    setError(null);
    const data = await apiRegister({ username, password, email, invite_code });
    setUser(data.user);
    const meData = await fetchMe();
    setSettings(meData?.settings ?? null);
    return data;
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    await apiLogout();
    setUser(null);
    setSettings(null);
  }, []);

  /**
   * Used by the password-reset completion flow — the server returns
   * a fresh session_token + user; we trust it and update state without
   * re-calling login.
   */
  const applyCompletedReset = useCallback(async ({ session_token, user: nextUser }) => {
    if (session_token) setSessionToken(session_token);
    setUser(nextUser);
    const meData = await fetchMe();
    setSettings(meData?.settings ?? null);
  }, []);

  /**
   * Force a re-fetch of the current user. Useful after operations that
   * change server-side state (email verification, settings updates,
   * admin toggling another user's admin flag, etc.).
   */
  const refresh = useCallback(async () => {
    const data = await fetchMe();
    setUser(data?.user ?? null);
    setSettings(data?.settings ?? null);
  }, []);

  /**
   * Partial update of user settings. Optimistically applies the patch
   * to local state for snappy UI, then writes to the server and
   * replaces local state with the canonical response on success.
   * On failure the optimistic update is reverted.
   *
   * Pass only the fields you want to change, e.g.:
   *   updateSettings({ voip_enabled: true })
   *   updateSettings({ tutorials_dismissed: [...dismissed, 'draw'] })
   */
  const updateSettings = useCallback(async (patch) => {
    if (!user) return;
    const previous = settings;
    // Optimistic update
    setSettings((prev) => ({ ...(prev ?? {}), ...patch }));
    try {
      const res = await apiUpdateSettings(patch);
      setSettings(res.settings);
      return res.settings;
    } catch (err) {
      setSettings(previous);
      throw err;
    }
  }, [user, settings]);

  const value = {
    user,
    settings,
    loading,
    error,
    isSignedIn: !!user,
    isAdmin: !!user?.is_admin,
    sessionToken: getSessionToken(),
    signIn,
    signUp,
    signOut,
    applyCompletedReset,
    refresh,
    updateSettings,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}


export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth() must be called inside <AuthProvider>');
  }
  return ctx;
}

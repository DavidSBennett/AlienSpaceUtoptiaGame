/**
 * src/auth/RequireAuth.jsx
 *
 * Wraps a route element. If the user isn't signed in, redirects them
 * to /login, capturing the current location so we can bounce back
 * after a successful sign-in. While AuthContext is still loading
 * (boot-time me() in flight), renders a minimal placeholder rather
 * than flashing the signed-out state.
 *
 * Usage:
 *   <Route path="/game" element={<RequireAuth><Game /></RequireAuth>} />
 *
 * Or as an admin-only gate:
 *   <Route path="/admin" element={<RequireAuth admin><AdminPage /></RequireAuth>} />
 */
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

export default function RequireAuth({ children, admin = false }) {
  const { user, isAdmin, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center surface-binding">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream-200/60">
          Loading…
        </p>
      </main>
    );
  }

  if (!user) {
    // Stash the location they were trying to reach so we can bounce
    // them back after sign-in. The login page reads location.state.from.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (admin && !isAdmin) {
    // Signed in but not authorized for this route. Send them home
    // rather than to login — they're already signed in, "log in
    // harder" makes no sense.
    return <Navigate to="/" replace />;
  }

  return children;
}

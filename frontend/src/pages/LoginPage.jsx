/**
 * src/pages/LoginPage.jsx
 *
 * Username + password sign-in. On success bounces the user back to
 * whatever location.state.from they were trying to reach (or to home
 * if they came here directly). Surfaces errors from the server inline
 * (bad password, throttled, disabled account, etc.) without revealing
 * which side of the credential failed.
 *
 * Footer links to:
 *   - Forgot password (/forgot-password)
 *   - Create account  (/register)
 */
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import AuthFrame from '../auth/AuthFrame.jsx';

export default function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from?.pathname || '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await signIn({ username: username.trim(), password });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title="Sign In"
      subtitle="Return to your scholarship"
      footer={
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-serif text-cream-200">
            New here?{' '}
            <Link to="/register" className="text-gold-400 hover:text-gold-300 underline">
              Create an account
            </Link>
          </p>
          <p className="font-serif text-cream-200/70 text-xs">
            <Link to="/forgot-password" className="text-cream-200 hover:text-cream-50 underline">
              Forgot your password?
            </Link>
          </p>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          id="username"
          label="Username"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          required
        />
        <Field
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />

        {error && (
          <div className="p-3 bg-oxblood-700/40 border border-oxblood-500 text-oxblood-300 font-serif text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !username.trim() || !password}
          className="btn-primary w-full"
        >
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </AuthFrame>
  );
}


function Field({ id, label, value, onChange, type = 'text', autoComplete, required }) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-2"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        className="input-dark w-full"
      />
    </div>
  );
}

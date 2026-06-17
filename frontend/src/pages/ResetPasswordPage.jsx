/**
 * src/pages/ResetPasswordPage.jsx
 *
 * Lands here from the reset email link, with ?token=... in the URL.
 * Validates the token shape client-side (server validates for real),
 * shows a new-password form, and on success signs the user in
 * automatically.
 */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { completePasswordReset } from '../api/auth.js';
import { useAuth } from '../auth/AuthContext.jsx';
import AuthFrame from '../auth/AuthFrame.jsx';

const MIN_PASSWORD = 8;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const { applyCompletedReset } = useAuth();

  const tokenLooksValid = TOKEN_PATTERN.test(token);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const data = await completePasswordReset({ token, new_password: password });
      // Server returns session_token + user — sign in automatically.
      await applyCompletedReset(data);
      navigate('/', { replace: true, state: { passwordReset: true } });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!tokenLooksValid) {
    return (
      <AuthFrame
        title="Reset Password"
        footer={
          <p className="font-serif text-cream-200 text-sm">
            <Link to="/forgot-password" className="text-gold-400 hover:text-gold-300 underline">
              Request a new link
            </Link>
          </p>
        }
      >
        <div className="p-4 bg-oxblood-700/40 border border-oxblood-500 text-oxblood-300 font-serif text-sm">
          This reset link doesn't look right. It may be malformed, expired,
          or already used. Request a fresh one.
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Reset Password"
      subtitle="Choose a new password to sign in with"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          id="password"
          label="New password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD} characters`}
          required
        />
        <Field
          id="confirm"
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          required
        />

        {error && (
          <div className="p-3 bg-oxblood-700/40 border border-oxblood-500 text-oxblood-300 font-serif text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !password || !confirm}
          className="btn-primary w-full"
        >
          {busy ? 'Resetting…' : 'Reset Password'}
        </button>

        <p className="font-serif italic text-cream-200/60 text-xs text-center">
          Resetting will sign you out of any other devices.
        </p>
      </form>
    </AuthFrame>
  );
}


function Field({ id, label, value, onChange, type = 'text', autoComplete, required, hint }) {
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
      {hint && (
        <p className="font-serif italic text-cream-200/50 text-xs mt-1">{hint}</p>
      )}
    </div>
  );
}

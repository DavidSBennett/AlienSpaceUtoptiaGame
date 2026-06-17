/**
 * src/pages/ForgotPasswordPage.jsx
 *
 * Email-entry form for password reset. Posts to users_requestReset.php
 * and shows the same "if that email is on file, a link is on its way"
 * message whether or not the email actually matches an account. (The
 * server is deliberately non-committal — we mirror that here.)
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestPasswordReset } from '../api/auth.js';
import AuthFrame from '../auth/AuthFrame.jsx';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // `sent` flips to true after the request returns. We don't reveal
  // whether the email actually matched an account.
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset({ email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title="Forgot Password"
      subtitle="We'll send a reset link to your verified email"
      footer={
        <p className="font-serif text-cream-200 text-sm">
          Remembered it?{' '}
          <Link to="/login" className="text-gold-400 hover:text-gold-300 underline">
            Sign in
          </Link>
        </p>
      }
    >
      {sent ? (
        <div className="p-4 bg-verdigris-500/20 border border-verdigris-500 text-cream-50 font-serif text-sm space-y-2">
          <p className="font-display text-base text-verdigris-400">Check your email.</p>
          <p>
            If <span className="font-mono">{email.trim()}</span> matches a verified account,
            a reset link is on its way. The link expires in 1 hour.
          </p>
          <p className="italic text-cream-200/70 text-xs">
            Didn't get it? Check spam, confirm you used the email tied to your account,
            and remember the email must be verified — unverified accounts can't reset by email.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-2"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className="input-dark w-full"
            />
          </div>

          {error && (
            <div className="p-3 bg-oxblood-700/40 border border-oxblood-500 text-oxblood-300 font-serif text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="btn-primary w-full"
          >
            {busy ? 'Sending…' : 'Send Reset Link'}
          </button>
        </form>
      )}
    </AuthFrame>
  );
}

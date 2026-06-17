/**
 * src/pages/VerifyEmailPage.jsx
 *
 * Lands here from the verification email link, with ?token=... in URL.
 * Auto-submits on mount (it's just a single-tap confirmation, no form
 * inputs needed) and shows success/failure state. Then the user can
 * head home.
 *
 * Calls AuthContext.refresh() on success so any signed-in session's
 * email_verified flag updates immediately (otherwise the user would
 * still see "unverified" warnings until next reload).
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { verifyEmail } from '../api/auth.js';
import { useAuth } from '../auth/AuthContext.jsx';
import AuthFrame from '../auth/AuthFrame.jsx';

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { refresh } = useAuth();

  // 'pending' on mount → 'success' or 'error' once the request returns.
  const [status, setStatus] = useState('pending');
  const [errorMessage, setErrorMessage] = useState(null);

  // useRef + useEffect with empty deps to ensure we fire exactly once
  // even in React StrictMode's double-invoke. The endpoint is
  // idempotent on the server side (a second call with the same token
  // gets a clean error rather than a double-verify) but we don't want
  // a stray "this link is used" flash from the second invoke.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    if (!TOKEN_PATTERN.test(token)) {
      setStatus('error');
      setErrorMessage('This verification link is malformed.');
      return;
    }
    verifyEmail({ token })
      .then(() => {
        setStatus('success');
        // Refresh AuthContext so any signed-in session immediately sees
        // email_verified = true. Don't await — we'll surface the
        // success state regardless.
        refresh().catch(() => {});
      })
      .catch((err) => {
        setStatus('error');
        setErrorMessage(err.message);
      });
  }, [token, refresh]);

  return (
    <AuthFrame
      title="Verify Email"
      subtitle={status === 'pending' ? 'Confirming your address…' : undefined}
      footer={
        <p className="font-serif text-cream-200 text-sm">
          <Link to="/" className="text-gold-400 hover:text-gold-300 underline">
            Continue to The Historians
          </Link>
        </p>
      }
    >
      {status === 'pending' && (
        <p className="font-serif italic text-cream-200/70 text-center text-sm">
          Just a moment…
        </p>
      )}

      {status === 'success' && (
        <div className="p-4 bg-verdigris-500/20 border border-verdigris-500 text-cream-50 font-serif text-sm space-y-2 text-center">
          <p className="font-display text-base text-verdigris-400">Email verified.</p>
          <p>You can now use password recovery if you ever need it.</p>
        </div>
      )}

      {status === 'error' && (
        <div className="p-4 bg-oxblood-700/40 border border-oxblood-500 text-oxblood-300 font-serif text-sm text-center">
          {errorMessage ?? 'Verification failed.'} If the link expired,
          request a fresh one from your account settings.
        </div>
      )}
    </AuthFrame>
  );
}

/**
 * src/pages/RegisterPage.jsx
 *
 * Account creation. Invite-gated: every successful registration
 * consumes one use of a valid invite_code. Without a code (or with an
 * exhausted/revoked/expired one) the form returns 404 from the server
 * and we surface that inline.
 *
 * On success the user is immediately signed in (the server hands back
 * a session token alongside the new user) and we route them home. A
 * verification email is sent in the background — we mention it in the
 * success path so the user knows to check their inbox.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import AuthFrame from '../auth/AuthFrame.jsx';

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,32}$/;
const MIN_PASSWORD = 8;

export default function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Local validation so common errors don't round-trip to the server.
  // Server still validates everything; this is just for friendliness.
  function validate() {
    if (!USERNAME_PATTERN.test(username.trim())) {
      return 'Username must be 3–32 characters, letters/digits/underscore only';
    }
    if (password.length < MIN_PASSWORD) {
      return `Password must be at least ${MIN_PASSWORD} characters`;
    }
    if (password !== confirm) {
      return 'Passwords do not match';
    }
    if (!email.trim()) return 'Email is required';
    if (!inviteCode.trim()) return 'Invite code is required';
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const localErr = validate();
    if (localErr) {
      setError(localErr);
      return;
    }
    setBusy(true);
    try {
      await signUp({
        username: username.trim(),
        password,
        email: email.trim(),
        invite_code: inviteCode.trim(),
      });
      navigate('/', { replace: true, state: { justRegistered: true } });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title="Create Account"
      subtitle="Begin your academic career"
      footer={
        <p className="font-serif text-cream-200 text-sm">
          Already have an account?{' '}
          <Link to="/login" className="text-gold-400 hover:text-gold-300 underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          id="username"
          label="Username"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          hint="3–32 characters · letters, digits, underscore"
          required
        />
        <Field
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          hint="Used only for password recovery"
          required
        />
        <Field
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD} characters`}
          required
        />
        <Field
          id="confirm"
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          required
        />
        <Field
          id="invite_code"
          label="Invite code"
          value={inviteCode}
          onChange={setInviteCode}
          autoComplete="off"
          hint="XXXX-XXXX-XXXX · sent to you by an existing scholar"
          required
        />

        {error && (
          <div className="p-3 bg-oxblood-700/40 border border-oxblood-500 text-oxblood-300 font-serif text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="btn-primary w-full"
        >
          {busy ? 'Creating account…' : 'Create Account'}
        </button>

        <p className="font-serif italic text-cream-200/60 text-xs text-center pt-1">
          After registering, check your email for a verification link.
          Password recovery requires a verified email.
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

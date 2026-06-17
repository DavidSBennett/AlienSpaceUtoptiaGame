/**
 * src/pages/AccountPage.jsx
 *
 * Signed-in user's account home. Shows username/email/verification
 * status, a change-password form, and a sign-out button. Admin users
 * also get a quick link into the admin invite-management page.
 *
 * Future additions (deferred): list active sessions, resend
 * verification email, edit email address.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTutorialsDismissed } from '../auth/useUserSetting.js';
import { changePassword } from '../api/auth.js';
import AuthFrame from '../auth/AuthFrame.jsx';

const MIN_PASSWORD = 8;

export default function AccountPage() {
  const { user, signOut, isAdmin } = useAuth();
  const { dismissed, resetAll: resetTutorials } = useTutorialsDismissed();
  const navigate = useNavigate();

  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  async function handleChangePassword(e) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setSuccess(false);
    if (newPw.length < MIN_PASSWORD) {
      setError(`New password must be at least ${MIN_PASSWORD} characters`);
      return;
    }
    if (newPw !== confirm) {
      setError('New passwords do not match');
      return;
    }
    if (newPw === oldPw) {
      setError('New password must differ from current');
      return;
    }
    setBusy(true);
    try {
      await changePassword({ old_password: oldPw, new_password: newPw });
      setSuccess(true);
      setOldPw(''); setNewPw(''); setConfirm('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  if (!user) return null;  // RequireAuth should have redirected, but be safe

  return (
    <AuthFrame
      title="Account"
      subtitle={user.username}
      eyebrow="Settings"
    >
      <div className="space-y-6">

        {/* User info */}
        <section className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
            Email
          </div>
          <div className="font-serif text-cream-50 text-sm flex items-center gap-2">
            {user.email}
            {user.email_verified ? (
              <span className="font-mono text-[9px] uppercase tracking-wider text-verdigris-400 border border-verdigris-500 px-2 py-0.5">
                verified
              </span>
            ) : (
              <span className="font-mono text-[9px] uppercase tracking-wider text-oxblood-300 border border-oxblood-500 px-2 py-0.5">
                unverified
              </span>
            )}
          </div>
          {!user.email_verified && (
            <p className="font-serif italic text-cream-200/60 text-xs">
              Check your inbox for the verification link sent at signup.
              Password recovery is disabled until you verify.
            </p>
          )}
        </section>

        {/* Change password */}
        <section>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-3">
            Change Password
          </div>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <Field
              id="old_pw"
              label="Current password"
              type="password"
              value={oldPw}
              onChange={setOldPw}
              autoComplete="current-password"
            />
            <Field
              id="new_pw"
              label="New password"
              type="password"
              value={newPw}
              onChange={setNewPw}
              autoComplete="new-password"
              hint={`At least ${MIN_PASSWORD} characters`}
            />
            <Field
              id="confirm_pw"
              label="Confirm new password"
              type="password"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
            />
            {error && (
              <div className="p-3 bg-oxblood-700/40 border border-oxblood-500 text-oxblood-300 font-serif text-sm">
                {error}
              </div>
            )}
            {success && (
              <div className="p-3 bg-verdigris-500/20 border border-verdigris-500 text-cream-50 font-serif text-sm">
                Password changed. Other devices have been signed out.
              </div>
            )}
            <button
              type="submit"
              disabled={busy || !oldPw || !newPw || !confirm}
              className="btn-primary w-full"
            >
              {busy ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        </section>

        {/* Tutorials reset */}
        <section className="pt-2 border-t border-gold-500/20">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-2">
            Tutorials
          </div>
          <p className="font-serif italic text-cream-200/70 text-xs mb-3">
            You've dismissed {dismissed.size} tutorial{dismissed.size === 1 ? '' : 's'}.
            Reset to see them again next game.
          </p>
          <button
            onClick={() => resetTutorials()}
            disabled={dismissed.size === 0}
            className="btn-ghost text-sm disabled:opacity-40"
          >
            Reset tutorials
          </button>
        </section>

        {/* Admin shortcut */}
        {isAdmin && (
          <section className="pt-2 border-t border-gold-500/20">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-2">
              Administration
            </div>
            <Link to="/admin/invites" className="btn-ghost inline-block">
              Manage invite codes
            </Link>
          </section>
        )}

        {/* Sign out */}
        <section className="pt-2 border-t border-gold-500/20">
          <button onClick={handleSignOut} className="btn-ghost w-full">
            Sign Out
          </button>
          <p className="font-serif italic text-cream-200/50 text-xs mt-2 text-center">
            Signs out of this device only.
          </p>
        </section>

      </div>
    </AuthFrame>
  );
}


function Field({ id, label, value, onChange, type = 'text', autoComplete, hint }) {
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
        className="input-dark w-full"
      />
      {hint && (
        <p className="font-serif italic text-cream-200/50 text-xs mt-1">{hint}</p>
      )}
    </div>
  );
}

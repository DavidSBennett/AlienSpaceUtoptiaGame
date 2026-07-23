/**
 * src/pages/AdminInvitesPage.jsx
 *
 * Admin-only. Lists all invite codes with status and consumption
 * history, plus a form to mint new ones. Revoke button per row.
 *
 * Gated by RequireAuth admin (in App.jsx).
 */
import { useCallback, useEffect, useState } from 'react';
import { adminGenerateInvite, adminListInvites, adminRevokeInvite } from '../api/auth.js';
import AuthFrame from '../auth/AuthFrame.jsx';

export default function AdminInvitesPage() {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // New-invite form
  const [note, setNote] = useState('');
  const [maxUses, setMaxUses] = useState(1);
  const [expiresDays, setExpiresDays] = useState('');
  const [grantsAdmin, setGrantsAdmin] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Most-recently-minted code, to display prominently for copying.
  const [justMinted, setJustMinted] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const data = await adminListInvites();
      setInvites(Array.isArray(data?.invites) ? data.invites : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleGenerate(e) {
    e.preventDefault();
    if (generating) return;
    setError(null);
    setGenerating(true);
    try {
      const data = await adminGenerateInvite({
        note: note.trim() || null,
        max_uses: Math.max(1, Number(maxUses) || 1),
        expires_days: expiresDays ? Number(expiresDays) : null,
        grants_admin: grantsAdmin,
      });
      setJustMinted(data.invite);
      setNote(''); setMaxUses(1); setExpiresDays(''); setGrantsAdmin(false);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevoke(invite) {
    if (!confirm(`Revoke ${invite.code}? This cannot be undone.`)) return;
    try {
      await adminRevokeInvite({ invite_id: invite.invite_id });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <AuthFrame
      wide
      title="Invite Codes"
      subtitle="Generate, share, revoke"
      eyebrow="Admin"
    >
      <div className="space-y-6">

        {/* Just-minted highlight banner */}
        {justMinted && (
          <div className="p-4 bg-gold-700/30 border border-gold-500 text-cream-50">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-300 mb-2">
              New code · share carefully
            </p>
            <p className="font-display text-2xl text-gold-300 tracking-widest">
              {justMinted.code}
            </p>
            <div className="font-serif italic text-cream-200/70 text-xs mt-2">
              {justMinted.max_uses} use{justMinted.max_uses === 1 ? '' : 's'} ·{' '}
              {justMinted.expires_at
                ? `expires ${new Date(justMinted.expires_at).toLocaleDateString()}`
                : 'never expires'}
              {justMinted.grants_admin ? ' · GRANTS ADMIN' : ''}
            </div>
            <button
              onClick={() => navigator.clipboard?.writeText(justMinted.code)}
              className="btn-ghost mt-3 text-xs"
            >
              Copy to clipboard
            </button>
          </div>
        )}

        {/* Generate form */}
        <section>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-3">
            Generate
          </div>
          <form onSubmit={handleGenerate} className="space-y-3">
            <div>
              <label htmlFor="note" className="block font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-1">
                Note (optional)
              </label>
              <input
                id="note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="for Alex / discord drop / etc."
                maxLength={255}
                className="input-dark w-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="max_uses" className="block font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-1">
                  Max uses
                </label>
                <input
                  id="max_uses"
                  type="number"
                  min={1}
                  max={10000}
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  className="input-dark w-full"
                />
              </div>
              <div>
                <label htmlFor="expires_days" className="block font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-1">
                  Expires in days
                </label>
                <input
                  id="expires_days"
                  type="number"
                  min={1}
                  max={3650}
                  value={expiresDays}
                  onChange={(e) => setExpiresDays(e.target.value)}
                  placeholder="never"
                  className="input-dark w-full"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 font-serif text-sm text-cream-200">
              <input
                type="checkbox"
                checked={grantsAdmin}
                onChange={(e) => setGrantsAdmin(e.target.checked)}
              />
              Grants admin privilege
              <span className="font-mono text-[9px] uppercase tracking-wider text-oxblood-300 ml-1">use sparingly</span>
            </label>

            {error && (
              <div className="p-3 bg-oxblood-700/40 border border-oxblood-500 text-oxblood-300 font-serif text-sm">
                {error}
              </div>
            )}

            <button type="submit" disabled={generating} className="btn-primary w-full">
              {generating ? 'Generating…' : 'Generate Code'}
            </button>
          </form>
        </section>

        {/* List */}
        <section>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-3">
            All Codes
          </div>
          {loading ? (
            <p className="font-serif italic text-cream-200/60 text-sm">Loading…</p>
          ) : invites.length === 0 ? (
            <p className="font-serif italic text-cream-200/60 text-sm">No codes yet.</p>
          ) : (
            <ul className="space-y-2">
              {invites.map((iv) => (
                <li key={iv.invite_id} className="border border-cream-50/10 p-3 bg-ink-900/40">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-display text-base text-cream-50 tracking-wider">
                        {iv.code}
                      </div>
                      <div className="font-serif italic text-cream-200/70 text-xs mt-0.5">
                        {iv.uses_count}/{iv.max_uses} use{iv.max_uses === 1 ? '' : 's'}
                        {iv.expires_at ? ` · expires ${new Date(iv.expires_at).toLocaleDateString()}` : ''}
                        {iv.grants_admin ? ' · grants admin' : ''}
                        {iv.note ? ` · ${iv.note}` : ''}
                      </div>
                      {iv.consumed_by && iv.consumed_by.length > 0 && (
                        <div className="font-mono text-[10px] text-cream-200/50 mt-1">
                          Used by: {iv.consumed_by.map((c) => c.username).join(', ')}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <StatusBadge status={iv.status} />
                      {iv.status === 'active' && (
                        <button
                          onClick={() => handleRevoke(iv)}
                          className="font-mono text-[10px] uppercase tracking-wider text-oxblood-300 hover:text-oxblood-200 underline"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AuthFrame>
  );
}


function StatusBadge({ status }) {
  const map = {
    active:  { label: 'active',  cls: 'text-verdigris-400 border-verdigris-500' },
    used_up: { label: 'used up', cls: 'text-cream-200/50 border-cream-50/15' },
    expired: { label: 'expired', cls: 'text-cream-200/50 border-cream-50/15' },
    revoked: { label: 'revoked', cls: 'text-oxblood-300 border-oxblood-500' },
  };
  const m = map[status] ?? map.active;
  return (
    <span className={`font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 border ${m.cls}`}>
      {m.label}
    </span>
  );
}

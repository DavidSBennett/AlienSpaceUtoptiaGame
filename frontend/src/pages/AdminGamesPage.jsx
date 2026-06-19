/**
 * src/pages/AdminGamesPage.jsx
 *
 * Admin-only. Purge multiplayer games older than a chosen age (by last
 * activity), across every account. Preview first (dry run) to see how many
 * match, then purge. Gated by RequireAuth admin (in App.jsx).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminPurgeOldGames } from '../api/auth.js';
import AuthFrame from '../auth/AuthFrame.jsx';

export default function AdminGamesPage() {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);   // { matched } from a dry run
  const [result, setResult] = useState(null);     // { purged } from a real purge

  const validDays = Number.isFinite(Number(days)) && Number(days) >= 1;

  async function handlePreview() {
    if (!validDays || busy) return;
    setBusy(true); setError(null); setResult(null); setPreview(null);
    try {
      const data = await adminPurgeOldGames({ olderThanDays: Number(days), dryRun: true });
      setPreview(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePurge() {
    if (!validDays || busy) return;
    const n = preview?.matched;
    const msg = typeof n === 'number'
      ? `Permanently delete ${n} game${n === 1 ? '' : 's'} older than ${days} day${Number(days) === 1 ? '' : 's'}? This cannot be undone.`
      : `Permanently delete ALL games older than ${days} day${Number(days) === 1 ? '' : 's'}? This cannot be undone.`;
    if (!confirm(msg)) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const data = await adminPurgeOldGames({ olderThanDays: Number(days), dryRun: false });
      setResult(data);
      setPreview(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title="Purge Old Games"
      subtitle="Delete multiplayer games past a certain age, across all accounts."
    >
      <div className="space-y-5">
        <p className="font-serif text-cream-200/80 text-sm leading-relaxed">
          A game's age is measured from its last activity — when it ended, last
          advanced a year, or (for lobbies that never started) when it was
          created. Purging removes the game and every record tied to it.
        </p>

        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
            Older than (days)
          </span>
          <input
            type="number"
            min="1"
            value={days}
            onChange={(e) => { setDays(e.target.value); setPreview(null); setResult(null); }}
            className="mt-1 w-full bg-teal-950/60 border border-gold-500/40 px-3 py-2 font-mono text-cream-50 focus:border-gold-400 focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handlePreview}
            disabled={!validDays || busy}
            className="btn-ghost"
          >
            {busy ? 'Working…' : 'Preview count'}
          </button>
          <button
            type="button"
            onClick={handlePurge}
            disabled={!validDays || busy}
            className="px-4 py-2 font-mono text-xs uppercase tracking-wider bg-oxblood-600 hover:bg-oxblood-500 text-cream-50 border border-oxblood-700 disabled:opacity-50"
          >
            Purge
          </button>
        </div>

        {preview && (
          <p className="font-serif text-cream-100 text-sm border border-gold-500/30 bg-teal-950/40 px-3 py-2">
            {preview.matched} game{preview.matched === 1 ? '' : 's'} match
            (older than {preview.older_than_days} days · before {preview.cutoff}).
            Nothing has been deleted yet.
          </p>
        )}

        {result && (
          <p className="font-serif text-verdigris-300 text-sm border border-verdigris-500/40 bg-verdigris-500/10 px-3 py-2">
            Purged {result.purged} game{result.purged === 1 ? '' : 's'}.
          </p>
        )}

        {error && (
          <p className="font-serif italic text-oxblood-300 text-sm">{error}</p>
        )}

        <div className="pt-3 border-t border-gold-500/20">
          <Link to="/account" className="font-mono text-[11px] uppercase tracking-wider text-cream-200/70 hover:text-gold-300">
            ← Back to account
          </Link>
        </div>
      </div>
    </AuthFrame>
  );
}

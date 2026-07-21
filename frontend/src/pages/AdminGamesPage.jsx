/**
 * src/pages/AdminGamesPage.jsx
 *
 * Admin-only. Lists every multiplayer game across all accounts — deck, status,
 * phase, year, players, last activity — and, underneath, the age-based purge.
 *
 * The page used to be purge-only: a count of games older than N days and a
 * delete button. That meant purging blind, and gave no way to answer the
 * question that actually matters before deleting a deck — which games are
 * still using it. Cards cascade with their deck and the mp_* tables hold bare
 * idCard integers, so that delete corrupts live games silently rather than
 * failing. The list is what makes that visible.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminListGames, adminPurgeOldGames } from '../api/auth.js';
import AuthFrame from '../auth/AuthFrame.jsx';

const STATUS_STYLE = {
  lobby:  'text-gold-300 border-gold-500/50',
  active: 'text-verdigris-300 border-verdigris-500/50',
  ended:  'text-cream-200/50 border-cream-200/25',
};

function whenText(iso) {
  if (!iso) return '—';
  const then = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(then.getTime())) return iso;
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export default function AdminGamesPage() {
  // ── Game list ──
  const [games, setGames] = useState(null);
  const [filter, setFilter] = useState('');       // '' | lobby | active | ended
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setListError(null);
    try {
      const data = await adminListGames({ status: filter });
      setGames(data.games || []);
    } catch (e) {
      setListError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // ── Purge ──
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  const validDays = Number.isFinite(Number(days)) && Number(days) >= 1;

  async function handlePreview() {
    if (!validDays || busy) return;
    setBusy(true); setError(null); setResult(null); setPreview(null);
    try {
      setPreview(await adminPurgeOldGames({ olderThanDays: Number(days), dryRun: true }));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
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
      setResult(await adminPurgeOldGames({ olderThanDays: Number(days), dryRun: false }));
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const live = (games || []).filter((g) => g.is_live);

  return (
    <AuthFrame
      title="Games"
      subtitle="Every multiplayer game, across all accounts."
    >
      <div className="space-y-6">

        {/* ── Filter + counts ── */}
        <div className="flex flex-wrap items-center gap-2">
          {['', 'lobby', 'active', 'ended'].map((s) => (
            <button
              key={s || 'all'}
              type="button"
              onClick={() => setFilter(s)}
              className={`px-3 py-1 font-mono text-[10px] uppercase tracking-wider border transition-colors ${
                filter === s
                  ? 'bg-gold-500 border-gold-500 text-teal-950'
                  : 'border-gold-500/40 text-cream-200 hover:border-gold-400'
              }`}
            >
              {s || 'all'}
            </button>
          ))}
          <button
            type="button"
            onClick={load}
            className="ml-auto font-mono text-[10px] uppercase tracking-wider text-cream-200/70 hover:text-gold-300"
          >
            ↻ Refresh
          </button>
        </div>

        {games && games.length > 0 && (
          <p className="font-serif text-cream-200/70 text-xs">
            {games.length} game{games.length === 1 ? '' : 's'} shown
            {live.length > 0 && ` · ${live.length} still unfinished`}
          </p>
        )}

        {/* ── The list ── */}
        {loading && <p className="font-serif italic text-cream-200/60 text-sm">Reading the table…</p>}
        {listError && <p className="font-serif italic text-oxblood-300 text-sm">{listError}</p>}

        {games && games.length === 0 && !loading && (
          <p className="font-serif italic text-cream-200/60 text-sm">No games match.</p>
        )}

        {games && games.length > 0 && (
          <div className="overflow-x-auto border border-gold-500/25">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-teal-950/60 font-mono text-[9px] uppercase tracking-[0.15em] text-gold-400">
                  <th className="py-2 px-3">#</th>
                  <th className="py-2 px-3">Deck</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Year</th>
                  <th className="py-2 px-3">Players</th>
                  <th className="py-2 px-3">Last activity</th>
                </tr>
              </thead>
              <tbody className="font-serif text-sm">
                {games.map((g) => (
                  <tr
                    key={g.game_id}
                    className={`border-t border-gold-500/15 ${g.is_live ? '' : 'opacity-55'}`}
                  >
                    <td className="py-2 px-3 font-mono text-xs text-cream-200/70">{g.game_id}</td>
                    <td className="py-2 px-3 text-cream-100">
                      {g.deck_name || (
                        <span className="italic text-oxblood-300" title="The deck this game used has been deleted">
                          deck deleted (#{g.idDeck})
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`font-mono text-[9px] uppercase tracking-wider border px-1.5 py-0.5 ${STATUS_STYLE[g.status] || ''}`}>
                        {g.status}
                      </span>
                      {g.phase && g.status === 'active' && (
                        <span className="ml-1.5 font-mono text-[9px] uppercase tracking-wider text-cream-200/60">
                          {g.phase}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 font-mono text-xs text-cream-200/80 tabular-nums">
                      {g.current_year}
                    </td>
                    <td className="py-2 px-3 text-cream-200/85">
                      {g.player_count === 0
                        ? <span className="italic text-cream-200/40">none</span>
                        : g.players.map((p) => (
                            <span
                              key={p.player_id}
                              className={p.is_out || p.is_ghost ? 'line-through opacity-50' : ''}
                              title={p.is_ghost ? 'ghosted' : p.is_out ? 'out' : ''}
                            >
                              {p.player_name}
                              {p !== g.players[g.players.length - 1] && ', '}
                            </span>
                          ))}
                    </td>
                    <td className="py-2 px-3 font-mono text-xs text-cream-200/60" title={g.last_activity_at || ''}>
                      {whenText(g.last_activity_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Purge ── */}
        <div className="pt-5 border-t border-gold-500/20 space-y-4">
          <h2 className="font-display text-lg text-cream-50">Purge old games</h2>
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
            <button type="button" onClick={handlePreview} disabled={!validDays || busy} className="btn-ghost">
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

          {error && <p className="font-serif italic text-oxblood-300 text-sm">{error}</p>}
        </div>

        <div className="pt-3 border-t border-gold-500/20">
          <Link to="/account" className="font-mono text-[11px] uppercase tracking-wider text-cream-200/70 hover:text-gold-300">
            ← Back to account
          </Link>
        </div>
      </div>
    </AuthFrame>
  );
}

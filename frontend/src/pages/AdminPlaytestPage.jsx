import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { adminListPlaytestFeedback, adminPurgePlaytestFeedback, adminDeletePlaytestFeedback } from '../api/auth.js';
import { LIKERT_ITEMS, LIKERT_SCALE } from '../lib/playtestQuestions.js';

/**
 * AdminPlaytestPage — compiles every anonymous playtest submission into one
 * print-ready report: summary statistics, a full per-response data table,
 * and free-text comments. Admin only (route-guarded). The on-screen
 * toolbar (Print / Copy) is hidden in print so the saved PDF is clean.
 */

// Compact column codes for the dense per-response table, keyed by question id.
const LIKERT_SHORT = {
  draw: 'Draw', publish: 'Pub', peer_review: 'Peer', historian: 'Hist',
  learned: 'Learn', enjoyed: 'Enjoy', play_again: 'Again',
};
// Built from the shared questionnaire so `label` is the EXACT statement asked.
const LIKERT_COLS = LIKERT_ITEMS.map((it) => ({
  key: `likert_${it.id}`,
  short: LIKERT_SHORT[it.id] || it.id,
  label: it.label,
}));

const SELF_COLS = [
  { key: 'self_prestige',  short: 'Prest' },
  { key: 'self_articles',  short: 'Art' },
  { key: 'self_books',     short: 'Bk' },
  { key: 'self_citations', short: 'Cit' },
  { key: 'self_research',  short: 'Res' },
  { key: 'self_notebook',  short: 'Note' },
  { key: 'self_influence', short: 'Infl' },
  { key: 'self_workspaces',short: 'Work' },
  { key: 'self_reputation',short: 'Rep' },
  { key: 'self_renown',    short: 'Ren' },
];

const CSV_COLUMNS = [
  'id', 'created_at', 'mode', 'deck_id', 'final_year', 'player_count',
  'had_technical_errors', 'technical_errors_detail',
  ...LIKERT_COLS.map((c) => c.key),
  'free_enjoyed', 'free_confusing', 'free_other',
  'self_prestige', 'self_articles', 'self_books', 'self_citations', 'self_stage',
  'self_game_over_reason', 'self_research', 'self_notebook', 'self_influence',
  'self_workspaces', 'self_reputation', 'self_renown',
];

export default function AdminPlaytestPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState(null);
  const [selected, setSelected] = useState(() => new Set());  // ids ticked for deletion
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminListPlaytestFeedback();
      setRows(Array.isArray(data?.feedback) ? data.feedback : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { document.title = 'The Historians — Playtest Data'; }, []);

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      const allOn = rows.length > 0 && rows.every((r) => prev.has(r.id));
      return allOn ? new Set() : new Set(rows.map((r) => r.id));
    });
  }

  async function doDeleteSelected() {
    setDeleting(true);
    setError(null);
    setPurgeMsg(null);
    try {
      const ids = Array.from(selected);
      const res = await adminDeletePlaytestFeedback({ ids });
      setConfirmDelete(false);
      setSelected(new Set());
      setPurgeMsg(`Deleted ${res?.deleted ?? 0} response${(res?.deleted ?? 0) === 1 ? '' : 's'}.`);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleting(false);
    }
  }

  async function doPurge() {
    setPurging(true);
    setError(null);
    setPurgeMsg(null);
    try {
      const res = await adminPurgePlaytestFeedback();
      setConfirmPurge(false);
      setPurgeMsg(`Deleted ${res?.purged ?? 0} response${(res?.purged ?? 0) === 1 ? '' : 's'}.`);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setPurging(false);
    }
  }

  async function copy(label, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1800);
    } catch {
      setError('Copy failed — clipboard access was blocked. Select the text manually.');
    }
  }

  const n = rows.length;
  const allSelected = n > 0 && rows.every((r) => selected.has(r.id));
  const csv = buildCSV(rows);
  const json = JSON.stringify(rows, null, 2);

  const byMode = countBy(rows, 'mode');
  const byDeck = countBy(rows, 'deck_id');
  const errYes = rows.filter((r) => r.had_technical_errors === 1).length;
  const errNo = rows.filter((r) => r.had_technical_errors === 0).length;

  return (
    <main style={S.wrap}>
      <style>{PRINT_CSS}</style>

      <div className="no-print" style={S.toolbar}>
        <button type="button" onClick={() => window.print()} style={S.btnPrimary}>⎙ Print / Save as PDF</button>
        <button type="button" onClick={() => copy('csv', csv)} style={S.btn}>{copied === 'csv' ? '✓ Copied CSV' : 'Copy CSV (all)'}</button>
        <button type="button" onClick={() => copy('json', json)} style={S.btn}>{copied === 'json' ? '✓ Copied JSON' : 'Copy JSON (all)'}</button>
        <button type="button" onClick={refresh} style={S.btn}>Refresh</button>

        {n > 0 && (
          confirmPurge ? (
            <>
              <span style={S.purgeWarn}>Permanently delete all {n}?</span>
              <button type="button" onClick={doPurge} disabled={purging} style={S.btnDanger}>
                {purging ? 'Deleting…' : 'Yes, delete all'}
              </button>
              <button type="button" onClick={() => setConfirmPurge(false)} disabled={purging} style={S.btn}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => { setConfirmPurge(true); setPurgeMsg(null); }} style={S.btnDangerOutline}>
              Purge all data
            </button>
          )
        )}
        {purgeMsg && <span style={S.purgeDone}>{purgeMsg}</span>}

        <Link to="/" style={S.btnLink}>Return to Lobby</Link>
      </div>

      <header style={S.header}>
        <p style={S.eyebrow}>The Historians · Compiled Playtest Report</p>
        <h1 style={S.h1}>Playtest Data</h1>
        <p style={S.subtle}>Generated {new Date().toLocaleString()} · {n} response{n === 1 ? '' : 's'} · all responses anonymous</p>
      </header>

      {loading && <p style={S.muted}>Loading…</p>}
      {error && <p style={S.error}>{error}</p>}

      {!loading && !error && n === 0 && (
        <p style={S.muted}>No playtest responses have been submitted yet.</p>
      )}

      {!loading && !error && n > 0 && (
        <>
          {/* Summary */}
          <section>
            <h2 style={S.h2}>Summary</h2>
            <table style={S.metaTable}>
              <tbody>
                <Meta k="Total responses" v={n} />
                <Meta k="By mode" v={Object.entries(byMode).map(([k, c]) => `${k || '—'}: ${c}`).join(' · ')} />
                <Meta k="By deck (idDeck)" v={Object.entries(byDeck).map(([k, c]) => `${k}: ${c}`).join(' · ')} />
                <Meta k="Technical errors" v={`${errYes} yes · ${errNo} no · ${n - errYes - errNo} unanswered`} />
              </tbody>
            </table>

            <h3 style={S.h3}>
              Likert means ({LIKERT_SCALE.map((s) => `${s.v} = ${s.label}`).join(' · ')})
            </h3>
            <table style={S.table}>
              <thead>
                <tr><th scope="col" style={S.th}>Statement (exact wording)</th><th scope="col" style={S.thNum}>Mean</th><th scope="col" style={S.thNum}>n</th></tr>
              </thead>
              <tbody>
                {LIKERT_COLS.map((c) => {
                  const { mean, count } = meanOf(rows, c.key);
                  return (
                    <tr key={c.key}>
                      <td style={S.td}>
                        <span style={S.codeTag}>{c.short}</span>{' '}{c.label}
                      </td>
                      <td style={S.tdNum}>{count ? mean.toFixed(2) : '—'}</td>
                      <td style={S.tdNum}>{count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* Per-response data table */}
          <section>
            <h2 style={S.h2}>All responses</h2>

            {/* Curation bar — tick rows, then delete the ones to drop. */}
            <div className="no-print" style={S.curateBar}>
              {selected.size > 0 ? (
                confirmDelete ? (
                  <>
                    <span style={S.purgeWarn}>Delete {selected.size} selected response{selected.size === 1 ? '' : 's'}?</span>
                    <button type="button" onClick={doDeleteSelected} disabled={deleting} style={S.btnDanger}>
                      {deleting ? 'Deleting…' : 'Yes, delete selected'}
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting} style={S.btn}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => { setConfirmDelete(true); setPurgeMsg(null); }} style={S.btnDangerOutline}>
                      Delete selected ({selected.size})
                    </button>
                    <button type="button" onClick={() => setSelected(new Set())} style={S.btn}>Clear selection</button>
                  </>
                )
              ) : (
                <span style={S.muted}>Tick rows to curate, then delete the ones you don’t want to keep.</span>
              )}
            </div>

            <div style={S.tableScroll}>
              <table style={S.tableTight}>
                <thead>
                  <tr>
                    <th scope="col" className="no-print" style={S.thT}>
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all responses" />
                    </th>
                    <th scope="col" style={S.thT}>#</th>
                    <th scope="col" style={S.thT}>Date</th>
                    <th scope="col" style={S.thT}>Mode</th>
                    <th scope="col" style={S.thTNum}>Deck</th>
                    <th scope="col" style={S.thTNum}>Yr</th>
                    <th scope="col" style={S.thTNum}>Pl</th>
                    <th scope="col" style={S.thT}>Err</th>
                    {LIKERT_COLS.map((c) => <th key={c.key} scope="col" style={S.thTNum} title={c.label}>{c.short}</th>)}
                    <th scope="col" style={S.thT}>Stage</th>
                    <th scope="col" style={S.thT}>Outcome</th>
                    {SELF_COLS.map((c) => <th key={c.key} scope="col" style={S.thTNum}>{c.short}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={selected.has(r.id) ? S.rowSelected : undefined}>
                      <td className="no-print" style={S.tdT}>
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} aria-label={`Select response ${r.id}`} />
                      </td>
                      <td style={S.tdT}>{r.id}</td>
                      <td style={S.tdT}>{shortDate(r.created_at)}</td>
                      <td style={S.tdT}>{r.mode === 'multiplayer' ? 'MP' : r.mode === 'solo' ? 'Solo' : '—'}</td>
                      <td style={S.tdTNum}>{dash(r.deck_id)}</td>
                      <td style={S.tdTNum}>{dash(r.final_year)}</td>
                      <td style={S.tdTNum}>{dash(r.player_count)}</td>
                      <td style={S.tdT}>{r.had_technical_errors === 1 ? 'Y' : r.had_technical_errors === 0 ? 'N' : '—'}</td>
                      {LIKERT_COLS.map((c) => <td key={c.key} style={S.tdTNum}>{dash(r[c.key])}</td>)}
                      <td style={S.tdT}>{r.self_stage || '—'}</td>
                      <td style={S.tdT}>{r.self_game_over_reason || '—'}</td>
                      {SELF_COLS.map((c) => <td key={c.key} style={S.tdTNum}>{dash(r[c.key])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Comments */}
          {rows.some(hasText) && (
            <section>
              <h2 style={S.h2}>Comments &amp; error reports</h2>
              {rows.filter(hasText).map((r) => (
                <div key={r.id} style={S.comment}>
                  <div style={S.commentHead}>#{r.id} · {r.mode === 'multiplayer' ? 'MP' : 'Solo'} · deck {dash(r.deck_id)} · {shortDate(r.created_at)}</div>
                  {r.technical_errors_detail && <Field k="Technical errors" v={r.technical_errors_detail} />}
                  {r.free_enjoyed && <Field k="Enjoyed most" v={r.free_enjoyed} />}
                  {r.free_confusing && <Field k="Confusing / frustrating" v={r.free_confusing} />}
                  {r.free_other && <Field k="Other thoughts" v={r.free_other} />}
                </div>
              ))}
            </section>
          )}

          {/* Screen-only raw export */}
          <section className="no-print">
            <h2 style={S.h2}>Raw export <span style={S.subtle}>(hidden when printed)</span></h2>
            <h3 style={S.h3}>CSV — one row per response</h3>
            <pre style={S.pre}>{csv}</pre>
          </section>
        </>
      )}
    </main>
  );
}

function Meta({ k, v }) {
  return (<tr><th scope="row" style={S.metaKey}>{k}</th><td style={S.metaVal}>{v}</td></tr>);
}
function Field({ k, v }) {
  return (<div style={S.field}><span style={S.fieldKey}>{k}:</span> {v}</div>);
}
function dash(v) { return v === null || v === undefined ? '—' : v; }
function shortDate(s) { if (!s) return '—'; const d = new Date(s.replace(' ', 'T')); return isNaN(d) ? s : d.toLocaleDateString(); }
function hasText(r) { return r.technical_errors_detail || r.free_enjoyed || r.free_confusing || r.free_other; }

function meanOf(rows, key) {
  const vals = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
  if (vals.length === 0) return { mean: 0, count: 0 };
  return { mean: vals.reduce((a, b) => a + Number(b), 0) / vals.length, count: vals.length };
}
function countBy(rows, key) {
  const out = {};
  for (const r of rows) { const k = r[key]; out[k] = (out[k] || 0) + 1; }
  return out;
}
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function buildCSV(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return lines.join('\n');
}

const INK = '#1a1714';
const RULE = '#c9bfa9';
const S = {
  wrap: { maxWidth: 1100, margin: '0 auto', padding: '32px 28px 64px', color: INK, background: '#fbf8f0', fontFamily: 'Georgia, "Times New Roman", serif', lineHeight: 1.45 },
  toolbar: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 24 },
  btnPrimary: { padding: '9px 16px', background: INK, color: '#fbf8f0', border: 'none', borderRadius: 2, cursor: 'pointer', fontSize: 14 },
  btn: { padding: '9px 16px', background: 'transparent', color: INK, border: `1px solid ${INK}`, borderRadius: 2, cursor: 'pointer', fontSize: 14 },
  btnDangerOutline: { padding: '9px 16px', background: 'transparent', color: '#7a1f1f', border: '1px solid #7a1f1f', borderRadius: 2, cursor: 'pointer', fontSize: 14 },
  btnDanger: { padding: '9px 16px', background: '#7a1f1f', color: '#fbf8f0', border: '1px solid #7a1f1f', borderRadius: 2, cursor: 'pointer', fontSize: 14 },
  purgeWarn: { color: '#7a1f1f', fontStyle: 'italic', fontSize: 13 },
  purgeDone: { color: '#1f4f4a', fontStyle: 'italic', fontSize: 13 },
  curateBar: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '0 0 8px' },
  rowSelected: { background: '#f3e6e6' },
  btnLink: { padding: '9px 16px', background: '#1f4f4a', color: '#fbf8f0', border: '1px solid #b8923a', borderRadius: 2, textDecoration: 'none', fontSize: 14, marginLeft: 'auto' },
  header: { borderBottom: `2px solid ${INK}`, paddingBottom: 14, marginBottom: 20 },
  eyebrow: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#6b5d44', margin: 0 },
  h1: { fontSize: 30, margin: '6px 0 6px' },
  h2: { fontSize: 19, margin: '26px 0 10px', borderBottom: `1px solid ${RULE}`, paddingBottom: 4 },
  h3: { fontSize: 13, fontFamily: 'ui-monospace, Menlo, monospace', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#6b5d44', margin: '16px 0 6px' },
  metaTable: { borderCollapse: 'collapse', fontSize: 14 },
  metaKey: { textAlign: 'left', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6b5d44', padding: '2px 16px 2px 0', verticalAlign: 'top', whiteSpace: 'nowrap' },
  metaVal: { padding: '2px 0', verticalAlign: 'top' },
  tableScroll: { overflowX: 'auto' },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13, marginTop: 4 },
  th: { textAlign: 'left', borderBottom: `2px solid ${INK}`, padding: '6px 8px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, textTransform: 'uppercase' },
  thNum: { textAlign: 'right', borderBottom: `2px solid ${INK}`, padding: '6px 8px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, textTransform: 'uppercase' },
  td: { textAlign: 'left', borderBottom: `1px solid ${RULE}`, padding: '6px 8px' },
  tdNum: { textAlign: 'right', borderBottom: `1px solid ${RULE}`, padding: '6px 8px', fontVariantNumeric: 'tabular-nums' },
  tableTight: { borderCollapse: 'collapse', width: '100%', fontSize: 10.5, marginTop: 4 },
  thT: { textAlign: 'left', borderBottom: `2px solid ${INK}`, padding: '3px 5px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 9.5, textTransform: 'uppercase', whiteSpace: 'nowrap' },
  thTNum: { textAlign: 'right', borderBottom: `2px solid ${INK}`, padding: '3px 5px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 9.5, textTransform: 'uppercase', whiteSpace: 'nowrap' },
  tdT: { textAlign: 'left', borderBottom: `1px solid ${RULE}`, padding: '3px 5px', whiteSpace: 'nowrap' },
  tdTNum: { textAlign: 'right', borderBottom: `1px solid ${RULE}`, padding: '3px 5px', fontVariantNumeric: 'tabular-nums' },
  comment: { borderLeft: `3px solid ${RULE}`, padding: '6px 12px', margin: '0 0 12px' },
  commentHead: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: '#6b5d44', marginBottom: 4 },
  field: { fontSize: 14, margin: '2px 0' },
  fieldKey: { fontWeight: 'bold' },
  subtle: { color: '#6b5d44', fontStyle: 'italic', fontSize: 12 },
  codeTag: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 10.5, background: '#f0e6c8', border: '1px solid #d8cdb4', padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap' },
  pre: { background: '#f2ecdd', border: `1px solid ${RULE}`, padding: 12, fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto' },
  error: { color: '#7a1f1f', fontStyle: 'italic' },
  muted: { color: '#6b5d44', fontStyle: 'italic' },
};

const PRINT_CSS = `
@media print {
  .no-print { display: none !important; }
  body { background: #fff !important; }
  @page { margin: 10mm; size: landscape; }
}
`;

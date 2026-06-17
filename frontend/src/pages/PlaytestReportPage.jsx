import { useEffect, useState } from 'react';
import { reportToCSV } from '../lib/playtestReport.js';
import { submitPlaytestFeedback } from '../api/client.js';

/* Questionnaire definition — edit wording / add or remove items here.
   Each Likert id must match a column in the playtest_feedback table
   (likert_<id>) and the key the endpoint reads under `likert`. */
const LIKERT_ITEMS = [
  { id: 'draw',        label: 'Drawing and collecting evidence cards was enjoyable.' },
  { id: 'publish',     label: 'Assembling and publishing research projects was satisfying.' },
  { id: 'peer_review', label: 'The peer review process was engaging.' },
  { id: 'historian',   label: 'The game made me feel like I was a historian.' },
  { id: 'learned',     label: 'I learned something from the game.' },
  { id: 'enjoyed',     label: 'Overall, I enjoyed playing the game.' },
  { id: 'play_again',  label: 'I would play this game again.' },
];
const LIKERT_SCALE = [
  { v: 1, label: 'Strongly disagree' },
  { v: 2, label: 'Disagree' },
  { v: 3, label: 'Neutral' },
  { v: 4, label: 'Agree' },
  { v: 5, label: 'Strongly agree' },
];
const FREE_FIELDS = [
  { id: 'enjoyed',   label: 'What did you enjoy most?' },
  { id: 'confusing', label: 'What was confusing or frustrating?' },
  { id: 'other',     label: 'Any other thoughts or suggestions?' },
];

/**
 * PlaytestReportPage — print-ready, aggregation-friendly summary of a
 * finished game (solo or multiplayer). Opened in a new tab; data arrives
 * via sessionStorage under 'historians:playtest' (see lib/playtestReport.js).
 *
 * The on-screen "Print / Save as PDF" and "Copy JSON/CSV" controls are
 * hidden in print (class "no-print"), so the saved PDF is a clean report
 * while the live page lets you grab structured data for a spreadsheet.
 */
export default function PlaytestReportPage() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);

  // ── Questionnaire state ──────────────────────────────────────────────
  const [hadErrors, setHadErrors] = useState(null);   // 'yes' | 'no' | null
  const [errorDetail, setErrorDetail] = useState('');
  const [likert, setLikert] = useState({});           // { itemId: 1..5 }
  const [free, setFree] = useState({});               // { fieldId: text }
  const [submitState, setSubmitState] = useState('idle'); // idle|submitting|done|error
  const [submitError, setSubmitError] = useState(null);

  async function handleSubmitFeedback() {
    if (!report) return;
    setSubmitState('submitting');
    setSubmitError(null);
    const self = report.players.find((p) => p.is_self) || report.players[0] || {};
    const payload = {
      context: {
        mode: report.mode,
        deck_id: report.deck_id,
        final_year: report.final_year,
        player_count: report.player_count,
      },
      self_outcome: {
        prestige: self.prestige ?? null,
        articles: self.articles_published ?? null,
        books: self.books_published ?? null,
        citations: self.citations_received ?? null,
        stage: self.stage ?? null,
        game_over_reason: self.game_over_reason ?? null,
        research: self.stat_research ?? null,
        notebook: self.stat_notebook ?? null,
        influence: self.stat_influence ?? null,
        workspaces: self.stat_workspaces ?? null,
        reputation: self.stat_reputation ?? null,
        renown: self.stat_renown ?? null,
      },
      had_technical_errors: hadErrors === null ? null : hadErrors === 'yes',
      technical_errors_detail: errorDetail,
      likert,
      free,
    };
    try {
      await submitPlaytestFeedback(payload);
      setSubmitState('done');
    } catch (e) {
      setSubmitError(e.message);
      setSubmitState('error');
    }
  }

  useEffect(() => {
    document.documentElement.lang = 'en';
    try {
      const raw = sessionStorage.getItem('historians:playtest');
      if (!raw) {
        setError('No playtest data found. Please open this page from a finished game.');
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.players)) {
        setError('The playtest data could not be read.');
        return;
      }
      setReport(parsed);
      const deckLabel = parsed.deck_name || (parsed.deck_id != null ? `Deck ${parsed.deck_id}` : 'Unknown deck');
      document.title = `Playtest Report — ${deckLabel} — ${parsed.report_id}`;
    } catch (err) {
      console.error('Failed to load playtest data:', err);
      setError('Could not load playtest data.');
    }
  }, []);

  async function copy(label, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1800);
    } catch {
      setError('Copy failed — your browser blocked clipboard access. Select the text manually.');
    }
  }

  if (error) {
    return (
      <main style={S.wrap}>
        <h1 style={S.h1}>Playtest Report</h1>
        <p style={S.error}>{error}</p>
      </main>
    );
  }
  if (!report) {
    return <main style={S.wrap}><p style={S.muted}>Loading…</p></main>;
  }

  const json = JSON.stringify(report, null, 2);
  const csv = reportToCSV(report);
  const isMP = report.mode === 'multiplayer';
  const deckLabel = report.deck_name || (report.deck_id != null ? `Deck ${report.deck_id}` : '—');
  const gen = new Date(report.generated_at);

  return (
    <main style={S.wrap}>
      <style>{PRINT_CSS}</style>

      {/* Screen-only toolbar */}
      <div className="no-print" style={S.toolbar}>
        <button type="button" onClick={() => window.print()} style={S.btnPrimary}>⎙ Print / Save as PDF</button>
        <button type="button" onClick={() => copy('json', json)} style={S.btn}>{copied === 'json' ? '✓ Copied JSON' : 'Copy JSON'}</button>
        <button type="button" onClick={() => copy('csv', csv)} style={S.btn}>{copied === 'csv' ? '✓ Copied CSV' : 'Copy CSV'}</button>
      </div>

      <header style={S.header}>
        <p style={S.eyebrow}>The Historians · Playtest Report</p>
        <h1 style={S.h1}>{deckLabel}</h1>
        <table style={S.metaTable}>
          <tbody>
            <Meta k="Report ID" v={report.report_id} />
            <Meta k="Generated" v={gen.toLocaleString()} />
            <Meta k="Mode" v={isMP ? 'Multiplayer' : 'Solo'} />
            <Meta k="Deck" v={`${deckLabel}${report.deck_id != null ? ` (idDeck ${report.deck_id})` : ''}`} />
            <Meta k="Final year" v={`${report.final_year} of ${report.total_years}`} />
            <Meta k="Players" v={report.player_count} />
          </tbody>
        </table>
      </header>

      <section>
        <h2 style={S.h2}>Final Standings</h2>
        <div style={S.tableScroll}>
          <table style={S.table}>
            <thead>
              <tr>
                <th scope="col" style={S.th}>#</th>
                <th scope="col" style={S.th}>Player</th>
                <th scope="col" style={S.thNum}>Prestige</th>
                <th scope="col" style={S.thNum}>Articles</th>
                <th scope="col" style={S.thNum}>Books</th>
                {isMP && <th scope="col" style={S.thNum}>Citations</th>}
                <th scope="col" style={S.th}>Stage</th>
                <th scope="col" style={S.th}>Outcome</th>
                <th scope="col" style={S.thNum} title="Research">Res</th>
                <th scope="col" style={S.thNum} title="Notebook capacity">Note</th>
                <th scope="col" style={S.thNum} title="Influence">Infl</th>
                <th scope="col" style={S.thNum} title="Workspaces">Work</th>
                <th scope="col" style={S.thNum} title="Reputation">Rep</th>
                {isMP && <th scope="col" style={S.thNum} title="Renown">Ren</th>}
              </tr>
            </thead>
            <tbody>
              {report.players.map((p) => (
                <tr key={`${p.rank}-${p.name}`} style={p.is_self ? S.selfRow : undefined}>
                  <td style={S.td}>{p.rank}</td>
                  <td style={S.td}>{p.name}{p.is_self ? ' ★' : ''}</td>
                  <td style={S.tdNum}>{p.prestige}</td>
                  <td style={S.tdNum}>{p.articles_published}</td>
                  <td style={S.tdNum}>{p.books_published}</td>
                  {isMP && <td style={S.tdNum}>{p.citations_received ?? '—'}</td>}
                  <td style={S.td}>{p.stage_label || '—'}</td>
                  <td style={S.td}>{p.game_over_label || '—'}</td>
                  <td style={S.tdNum}>{dash(p.stat_research)}</td>
                  <td style={S.tdNum}>{dash(p.stat_notebook)}</td>
                  <td style={S.tdNum}>{dash(p.stat_influence)}</td>
                  <td style={S.tdNum}>{dash(p.stat_workspaces)}</td>
                  <td style={S.tdNum}>{dash(p.stat_reputation)}</td>
                  {isMP && <td style={S.tdNum}>{dash(p.stat_renown)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {isMP && report.awards.length > 0 && (
        <section>
          <h2 style={S.h2}>Awards</h2>
          <table style={S.table}>
            <thead>
              <tr>
                <th scope="col" style={S.th}>Award</th>
                <th scope="col" style={S.th}>Winner</th>
                <th scope="col" style={S.th}>Score</th>
                <th scope="col" style={S.th}>Field</th>
              </tr>
            </thead>
            <tbody>
              {report.awards.map((a) => (
                <tr key={a.id}>
                  <td style={S.td}><strong>{a.name}</strong><div style={S.subtle}>{a.description}</div></td>
                  <td style={S.td}>{a.winner || <span style={S.subtle}>not awarded</span>}</td>
                  <td style={S.td}>{a.winner_score_label || '—'}</td>
                  <td style={S.td}>
                    {a.runners_up.length === 0
                      ? <span style={S.subtle}>—</span>
                      : a.runners_up.map((r) => `${r.name}: ${r.score_label}`).join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Screen-only anonymous questionnaire */}
      <section className="no-print" style={S.survey}>
        <h2 style={S.h2}>Playtest Feedback</h2>
        <p style={S.anon}>
          Your responses are <strong>anonymous</strong> and are not linked to your account.
        </p>

        {submitState === 'done' ? (
          <p style={S.thanks}>✓ Thank you — your feedback was submitted anonymously.</p>
        ) : (
          <>
            {/* Technical errors */}
            <fieldset style={S.fieldset}>
              <legend style={S.legend}>Did you run into any technical problems or bugs?</legend>
              <label style={S.radioInline}>
                <input type="radio" name="techerr" checked={hadErrors === 'yes'} onChange={() => setHadErrors('yes')} /> Yes
              </label>
              <label style={S.radioInline}>
                <input type="radio" name="techerr" checked={hadErrors === 'no'} onChange={() => setHadErrors('no')} /> No
              </label>
              <textarea
                style={S.textarea}
                rows={2}
                placeholder="If yes, please describe what happened."
                value={errorDetail}
                onChange={(e) => setErrorDetail(e.target.value)}
              />
            </fieldset>

            {/* Likert battery */}
            <fieldset style={S.fieldset}>
              <legend style={S.legend}>How much do you agree with each statement?</legend>
              <div style={S.scaleKey}>1 = Strongly disagree · 5 = Strongly agree</div>
              {LIKERT_ITEMS.map((item) => (
                <div key={item.id} style={S.likertRow}>
                  <div style={S.likertLabel}>{item.label}</div>
                  <div style={S.likertOpts}>
                    {LIKERT_SCALE.map((s) => (
                      <label key={s.v} style={S.likertOpt} title={s.label}>
                        <input
                          type="radio"
                          name={`lik_${item.id}`}
                          checked={likert[item.id] === s.v}
                          onChange={() => setLikert((m) => ({ ...m, [item.id]: s.v }))}
                        />
                        <span style={S.likertNum}>{s.v}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>

            {/* Free text */}
            <fieldset style={S.fieldset}>
              <legend style={S.legend}>In your own words</legend>
              {FREE_FIELDS.map((f) => (
                <label key={f.id} style={S.freeLabel}>
                  {f.label}
                  <textarea
                    style={S.textarea}
                    rows={3}
                    value={free[f.id] || ''}
                    onChange={(e) => setFree((m) => ({ ...m, [f.id]: e.target.value }))}
                  />
                </label>
              ))}
            </fieldset>

            {submitState === 'error' && (
              <p style={S.error}>Could not submit: {submitError}</p>
            )}
            <button
              type="button"
              onClick={handleSubmitFeedback}
              disabled={submitState === 'submitting'}
              style={{ ...S.btnPrimary, opacity: submitState === 'submitting' ? 0.6 : 1 }}
            >
              {submitState === 'submitting' ? 'Submitting…' : 'Submit anonymous feedback'}
            </button>
          </>
        )}
      </section>

      {/* Screen-only raw data for aggregation */}
      <section className="no-print">
        <h2 style={S.h2}>Structured data <span style={S.subtle}>(for aggregation — hidden when printed)</span></h2>
        <h3 style={S.h3}>CSV — one row per player</h3>
        <pre style={S.pre}>{csv}</pre>
        <h3 style={S.h3}>JSON</h3>
        <pre style={S.pre}>{json}</pre>
      </section>

      <footer className="no-print" style={S.footer}>
        Generated client-side from the finished game. Save as PDF for your records, or copy the CSV/JSON into your aggregation spreadsheet.
      </footer>
    </main>
  );
}

function Meta({ k, v }) {
  return (
    <tr>
      <th scope="row" style={S.metaKey}>{k}</th>
      <td style={S.metaVal}>{v}</td>
    </tr>
  );
}

function dash(v) {
  return v === null || v === undefined ? '—' : v;
}

/* Plain, high-contrast, print-first styling — no Tailwind dependency so
   the printed PDF is deterministic. */
const INK = '#1a1714';
const RULE = '#c9bfa9';
const S = {
  wrap: { maxWidth: 920, margin: '0 auto', padding: '32px 28px 64px', color: INK, background: '#fbf8f0', fontFamily: 'Georgia, "Times New Roman", serif', lineHeight: 1.45 },
  toolbar: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 },
  btnPrimary: { padding: '9px 16px', background: INK, color: '#fbf8f0', border: 'none', borderRadius: 2, cursor: 'pointer', fontSize: 14, letterSpacing: '0.03em' },
  btn: { padding: '9px 16px', background: 'transparent', color: INK, border: `1px solid ${INK}`, borderRadius: 2, cursor: 'pointer', fontSize: 14 },
  header: { borderBottom: `2px solid ${INK}`, paddingBottom: 16, marginBottom: 24 },
  eyebrow: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#6b5d44', margin: 0 },
  h1: { fontSize: 30, margin: '6px 0 14px' },
  h2: { fontSize: 19, margin: '28px 0 10px', borderBottom: `1px solid ${RULE}`, paddingBottom: 4 },
  h3: { fontSize: 13, fontFamily: 'ui-monospace, Menlo, monospace', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#6b5d44', margin: '16px 0 6px' },
  metaTable: { borderCollapse: 'collapse', fontSize: 14 },
  metaKey: { textAlign: 'left', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6b5d44', padding: '2px 16px 2px 0', verticalAlign: 'top', whiteSpace: 'nowrap' },
  metaVal: { padding: '2px 0', verticalAlign: 'top' },
  tableScroll: { overflowX: 'auto' },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13, marginTop: 4 },
  th: { textAlign: 'left', borderBottom: `2px solid ${INK}`, padding: '6px 8px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' },
  thNum: { textAlign: 'right', borderBottom: `2px solid ${INK}`, padding: '6px 8px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' },
  td: { textAlign: 'left', borderBottom: `1px solid ${RULE}`, padding: '6px 8px', verticalAlign: 'top' },
  tdNum: { textAlign: 'right', borderBottom: `1px solid ${RULE}`, padding: '6px 8px', fontVariantNumeric: 'tabular-nums' },
  selfRow: { background: '#f0e9d6' },
  subtle: { color: '#6b5d44', fontStyle: 'italic', fontSize: 12 },
  pre: { background: '#f2ecdd', border: `1px solid ${RULE}`, padding: 12, fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto' },
  footer: { marginTop: 32, paddingTop: 12, borderTop: `1px solid ${RULE}`, fontSize: 12, color: '#6b5d44', fontStyle: 'italic' },
  error: { color: '#7a1f1f', fontStyle: 'italic' },
  muted: { color: '#6b5d44', fontStyle: 'italic' },
  // Questionnaire
  survey: { marginTop: 32, paddingTop: 16, borderTop: `2px solid ${INK}` },
  anon: { fontSize: 13, color: '#3a5a3a', background: '#e7f0e3', border: '1px solid #b9d3b0', padding: '8px 12px', borderRadius: 2, margin: '0 0 16px' },
  thanks: { fontSize: 16, color: '#2f5d2f', fontWeight: 'bold', padding: '16px 0' },
  fieldset: { border: `1px solid ${RULE}`, borderRadius: 2, padding: '12px 14px', margin: '0 0 16px' },
  legend: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6b5d44', padding: '0 6px' },
  radioInline: { marginRight: 20, fontSize: 14, cursor: 'pointer' },
  scaleKey: { fontSize: 12, color: '#6b5d44', fontStyle: 'italic', marginBottom: 10 },
  likertRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: `1px solid #eadfca`, flexWrap: 'wrap' },
  likertLabel: { flex: '1 1 280px', fontSize: 14 },
  likertOpts: { display: 'flex', gap: 4, flexShrink: 0 },
  likertOpt: { display: 'inline-flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', padding: '0 4px' },
  likertNum: { fontSize: 11, color: '#6b5d44' },
  freeLabel: { display: 'block', fontSize: 14, marginBottom: 12 },
  textarea: { display: 'block', width: '100%', marginTop: 6, padding: 8, fontSize: 14, fontFamily: 'Georgia, serif', border: `1px solid ${RULE}`, borderRadius: 2, boxSizing: 'border-box', background: '#fffdf8' },
};

const PRINT_CSS = `
@media print {
  .no-print { display: none !important; }
  body { background: #fff !important; }
  @page { margin: 14mm; }
}
`;

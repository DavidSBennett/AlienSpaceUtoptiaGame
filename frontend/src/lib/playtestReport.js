/**
 * Playtest report — captures the structured outcome of a finished game
 * (solo or multiplayer) into one normalized schema that can be aggregated
 * across sessions for the press submission / balance analysis.
 *
 * Mechanism mirrors publicationsPDF.js: the launching end-screen builds a
 * normalized report object, we stash it in sessionStorage under
 * 'historians:playtest', then open the /playtest-report route in a new
 * tab. PlaytestReportPage reads it and renders a print-ready document
 * (Print → Save as PDF) plus copy-to-clipboard JSON/CSV for aggregation.
 *
 * The schema is intentionally MODE-AGNOSTIC: solo games produce a single
 * player row with citations/renown = null (those mechanics are MP-only),
 * so every report — solo or MP — has the same columns and can be stacked
 * in one spreadsheet.
 */

export const PLAYTEST_REPORT_SCHEMA_VERSION = 1;
const TOTAL_YEARS = 25;

const STAGE_LABELS = {
  'graduate-student': 'Grad student',
  'abd': 'ABD',
  'assistant-professor': 'Assistant professor',
  'associate-professor': 'Associate professor',
  'full-professor': 'Full professor',
  'endowed-professor': 'Endowed professor',
  'retired': 'Retired',
};

const OUTCOME_LABELS = {
  'failed-comps': 'Failed comps',
  'tenure-denied': 'Tenure denied',
  'conceded': 'Conceded',
};

export function stageLabel(stage) {
  if (!stage) return '';
  return STAGE_LABELS[stage] || stage;
}

export function outcomeLabel(reason) {
  if (!reason) return 'Completed';
  return OUTCOME_LABELS[reason] || reason;
}

function statsFrom(levels) {
  const l = levels || {};
  return {
    stat_research:   numOrNull(l.research),
    stat_notebook:   numOrNull(l.notebookCapacity),
    stat_influence:  numOrNull(l.influence),
    stat_workspaces: numOrNull(l.workspaces),
    stat_reputation: numOrNull(l.reputation),
    stat_renown:     numOrNull(l.renown),
  };
}

function numOrNull(v) {
  return v === undefined || v === null ? null : Number(v);
}

function makeReportId(mode, deckId) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${mode}-deck${deckId ?? 'NA'}-${stamp}`;
}

/* ── Solo ────────────────────────────────────────────────────────────── */

export function buildSoloReport({ state, deck }) {
  const deckId = deck?.idDeck ?? null;
  const reason = state?.gameOver?.reason ?? null;
  const finalYear = Number(state?.gameOver?.year ?? state?.year ?? 0);

  const player = {
    rank: 1,
    seat: 0,
    name: state?.playerName || 'Anonymous Historian',
    is_self: true,
    prestige: Number(state?.prestige ?? 0),
    articles_published: Number(state?.articlesPublished ?? 0),
    books_published: Number(state?.booksPublished ?? 0),
    citations_received: null, // MP-only mechanic
    stage: state?.stage ?? null,
    stage_label: stageLabel(state?.stage),
    game_over_reason: reason,
    game_over_label: outcomeLabel(reason),
    ...statsFrom(state?.statLevels),
  };

  return {
    schema_version: PLAYTEST_REPORT_SCHEMA_VERSION,
    report_id: makeReportId('solo', deckId),
    generated_at: new Date().toISOString(),
    mode: 'solo',
    deck_id: deckId,
    deck_name: deck?.nameDeck || '',
    final_year: finalYear,
    total_years: TOTAL_YEARS,
    player_count: 1,
    players: [player],
    awards: [],
  };
}

/* ── Multiplayer ─────────────────────────────────────────────────────── */

export function buildMultiplayerReport({ state, awards, computeStandings }) {
  const game = state?.game || {};
  const deckId = game.idDeck ?? null;
  const selfId = state?.you?.player_id;

  const ranked = [state?.you, ...(state?.opponents || [])]
    .filter(Boolean)
    .sort((a, b) => Number(b.prestige ?? 0) - Number(a.prestige ?? 0));

  const players = ranked.map((p, i) => ({
    rank: i + 1,
    seat: p.seat_index ?? null,
    name: p.player_name || `Player ${i + 1}`,
    is_self: p.player_id === selfId,
    prestige: Number(p.prestige ?? 0),
    articles_published: Number(p.articles_published ?? 0),
    books_published: Number(p.books_published ?? 0),
    citations_received: Number(p.citations_received_count ?? 0),
    stage: p.stage ?? null,
    stage_label: stageLabel(p.stage),
    game_over_reason: p.game_over_reason ?? null,
    game_over_label: outcomeLabel(p.game_over_reason),
    ...statsFrom(p.stat_levels),
  }));

  // Awards are computed by the caller (it owns the AWARDS table +
  // computeAwardStandings import) and passed in, so this lib stays free
  // of game-rule dependencies.
  let awardRows = [];
  if (Array.isArray(awards) && typeof computeStandings === 'function') {
    const standings = computeStandings(ranked, { publishedWorks: state?.published_works || [] });
    awardRows = awards.map((award) => {
      const rankedScores = standings[award.id] || [];
      const leader = rankedScores[0];
      const hasWinner = leader && leader.score > 0 && leader.score !== -Infinity;
      return {
        id: award.id,
        name: award.name,
        description: award.description,
        winner: hasWinner ? leader.playerName : null,
        winner_score: hasWinner ? leader.score : null,
        winner_score_label: hasWinner ? safeFormat(award, leader.score) : null,
        runners_up: hasWinner
          ? rankedScores.slice(1)
              .filter((r) => r.score > 0 && r.score !== -Infinity)
              .map((r) => ({ name: r.playerName, score: r.score, score_label: safeFormat(award, r.score) }))
          : [],
      };
    });
  }

  return {
    schema_version: PLAYTEST_REPORT_SCHEMA_VERSION,
    report_id: makeReportId('mp', deckId),
    generated_at: new Date().toISOString(),
    mode: 'multiplayer',
    deck_id: deckId,
    deck_name: '', // not surfaced in MP state; deck_id is the aggregation key
    final_year: Number(game.current_year ?? 0),
    total_years: TOTAL_YEARS,
    player_count: players.length,
    players,
    awards: awardRows,
  };
}

function safeFormat(award, score) {
  try { return award.format(score); } catch { return String(score); }
}

/* ── CSV (one row per player; identical columns for solo + MP) ───────── */

const CSV_COLUMNS = [
  'report_id', 'generated_at', 'mode', 'deck_id', 'deck_name',
  'final_year', 'total_years', 'player_count',
  'rank', 'seat', 'player', 'is_self',
  'prestige', 'articles_published', 'books_published', 'citations_received',
  'stage', 'game_over_reason',
  'research', 'notebook', 'influence', 'workspaces', 'reputation', 'renown',
];

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCSV(report) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const p of report.players) {
    rows.push([
      report.report_id, report.generated_at, report.mode, report.deck_id, report.deck_name,
      report.final_year, report.total_years, report.player_count,
      p.rank, p.seat, p.name, p.is_self ? 1 : 0,
      p.prestige, p.articles_published, p.books_published, p.citations_received,
      p.stage, p.game_over_reason,
      p.stat_research, p.stat_notebook, p.stat_influence, p.stat_workspaces, p.stat_reputation, p.stat_renown,
    ].map(csvCell).join(','));
  }
  return rows.join('\n');
}

/* ── Opener ──────────────────────────────────────────────────────────── */

export function openPlaytestReport(report) {
  try {
    sessionStorage.setItem('historians:playtest', JSON.stringify(report));
  } catch (err) {
    console.error('Could not save playtest report to sessionStorage:', err);
    alert('Could not prepare the playtest report. Your browser may have storage disabled.');
    return;
  }
  // Mirror publicationsPDF.js: use the app base path so this resolves
  // under a subdirectory deployment as well as at the domain root.
  const base = import.meta.env.BASE_URL || '/';
  const url = `${base.replace(/\/$/, '')}/playtest-report`;
  const newTab = window.open(url, '_blank');
  if (!newTab) {
    alert('Your browser blocked the new tab. Please allow popups for this site and try again.');
  }
}

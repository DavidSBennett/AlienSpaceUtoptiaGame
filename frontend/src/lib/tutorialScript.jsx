/**
 * Strict step script for the in-game Tutorial mode (the REAL solo game, run
 * with a fixed deck and locked one step at a time).
 *
 * Each step declares:
 *   allow   — which year-advancing buttons are enabled this step
 *             ({ draw, publish, conference }); building (drag) is always free.
 *   target  — data-tutorial anchor to spotlight (optional).
 *   done(state, start) — advance when true. `start` is a snapshot taken when
 *             the step began, so we can advance on deltas (year/article/book/
 *             citation/upgrade counts) which is robust regardless of which
 *             card was drawn.
 *   info    — a text-only step advanced with a button (intro/outro).
 */

export function snapshot(s) {
  return {
    year: s.year,
    articles: s.articlesPublished || 0,
    books: s.booksPublished || 0,
    citations: s.citations || 0,
    pending: s.pendingUpgrades || 0,
  };
}

const hasEvidence = (s, n) => (s.projects || []).some((p) => (p.evidence?.length ?? 0) >= n);
const hasValid = (s, n) => (s.projects || []).some((p) => (p.evidence?.length ?? 0) >= n && !!p.conclusion);

export const TUTORIAL_SCRIPT = [
  {
    id: 'intro',
    info: true,
    allow: {},
    title: 'Welcome — let’s learn the game',
    body: 'This is the real game, just guided. You begin as a Visiting Assistant Professor. At each step only the right button works, and I’ll tell you what to do. Click Begin.',
    cta: 'Begin',
  },
  {
    id: 'draw',
    allow: { draw: true },
    target: 'draw-zone',
    title: 'Turn 1 — Draw research',
    body: 'Click the Archive deck (bottom-left of your Research Notebook) to draw evidence cards. Each draw advances one year.',
    done: (s, st) => s.year > st.year,
  },
  {
    id: 'build',
    allow: {},
    target: 'draw-zone',
    title: 'Build a project',
    body: 'Drag TWO evidence cards from your notebook up into a project row to start an argument.',
    done: (s) => hasEvidence(s, 2),
  },
  {
    id: 'conclusion',
    allow: {},
    target: 'conclusion-rail',
    title: 'Set a conclusion',
    body: 'Every project needs a conclusion — the thesis your evidence supports. Drag one from the rail on the left into your project’s conclusion slot.',
    done: (s) => hasValid(s, 2),
  },
  {
    id: 'publish-article',
    allow: { publish: true },
    target: 'publish-button',
    title: 'Turn 2 — Publish an article',
    body: 'A project with fewer than 6 evidence cards is an article. Click Submit for Review to publish — your first article wins a tenure-track post (Assistant Professor).',
    done: (s, st) => s.articles > st.articles,
  },
  {
    id: 'upgrade',
    allow: {},
    title: 'Invest your funding',
    body: 'Your promotion brought new money to invest. Choose one upgrade in the window that opened — how you invest shapes the research you can do.',
    done: (s, st) => s.pending < st.pending || s.pending === 0,
  },
  {
    id: 'conference',
    allow: { conference: true },
    title: 'Turn 3 — Attend a conference',
    body: 'Stage at least one evidence card in a project, then click Attend Conference on that row. Conferences earn citation tokens (prestige at game’s end).',
    done: (s, st) => s.citations > st.citations || s.year > st.year,
  },
  {
    id: 'draw2',
    allow: { draw: true },
    target: 'draw-zone',
    title: 'Turn 4 — Draw again',
    body: 'A book is a bigger argument — 6 or more evidence cards. Draw again to gather more research.',
    done: (s, st) => s.year > st.year,
  },
  {
    id: 'build-book',
    allow: {},
    target: 'draw-zone',
    title: 'Build a book',
    body: 'Assemble a larger project: drag SIX evidence cards into a row and set a conclusion.',
    done: (s) => hasValid(s, 6),
  },
  {
    id: 'publish-book',
    allow: { publish: true },
    target: 'publish-button',
    title: 'Turn 5 — Publish a book',
    body: 'Six evidence cards make this a book. Click Submit for Review — your first book earns you tenure and promotion to Associate Professor.',
    done: (s, st) => s.books > st.books,
  },
  {
    id: 'outro',
    info: true,
    allow: {},
    title: 'You’ve got it — tenure!',
    body: 'You’ve drawn research, built and published an article and a book, invested an upgrade, and attended a conference — the whole loop. You’re ready for a real game.',
    cta: 'Finish',
  },
];

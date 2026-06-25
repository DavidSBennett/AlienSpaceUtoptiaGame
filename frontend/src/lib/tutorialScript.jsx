/**
 * Strict step script for the in-game Guided Walkthrough (the REAL solo game,
 * run with a fixed deck and locked one step at a time).
 *
 * Per step:
 *   allow   — which year-advancing buttons are enabled ({ draw, publish,
 *             conference }). Building (drag) is always free.
 *   mask    — 'hole' (block all but the spotlighted control), 'none' (no
 *             block; for drag steps or when a game modal is already focused),
 *             or omitted for info steps (full backdrop + centered modal).
 *   target  — data-tutorial anchor to spotlight / cut the hole around.
 *   done(state, start) — advance when true. `start` is a snapshot taken when
 *             the step began, so we advance on deltas (year/article/book/
 *             citation/upgrade counts) regardless of which card was drawn.
 *   info    — text-only step shown as a centered modal, advanced with a button.
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
    id: 'intro', info: true, allow: {},
    title: 'Welcome to the Guided Walkthrough',
    body: 'This is the real game, just guided. You begin as a Visiting Assistant Professor. At each step only the right control works, and I’ll tell you what to do. Tip: every card here carries the same tag — that’s how you know they belong in one argument.',
    cta: 'Begin',
  },
  {
    id: 'draw', allow: { draw: true }, mask: 'hole', target: 'draw-zone',
    title: 'Turn 1 — Draw research',
    body: 'Click the Archive deck (bottom-left of your notebook) to draw evidence into your hand. Each draw advances one year. Nothing else is clickable yet.',
    done: (s, st) => s.year > st.year,
  },
  {
    id: 'build', allow: {}, mask: 'none', target: 'project-area',
    title: 'Build a project',
    body: 'Now drag TWO evidence cards from your notebook up into a project row. (The turn buttons are locked until you do.)',
    done: (s) => hasEvidence(s, 2),
  },
  {
    id: 'conclusion', allow: {}, mask: 'none', target: 'conclusion-rail',
    title: 'Set a conclusion',
    body: 'Every project needs a conclusion — the thesis your evidence supports. Drag one from the rail on the left into your project’s conclusion slot. It shares the cards’ tag, so they match.',
    done: (s) => hasValid(s, 2),
  },
  {
    id: 'publish-article', allow: { publish: true }, mask: 'hole', target: 'publish-button',
    title: 'Turn 2 — Publish an article',
    body: 'A project with fewer than 6 evidence cards is an article. Click Submit for Review — your first article wins a tenure-track post (Assistant Professor).',
    done: (s, st) => s.articles > st.articles,
  },
  {
    id: 'upgrade', allow: {}, mask: 'none',
    title: 'Invest your funding',
    body: 'Your promotion brought money to invest. In the window that just opened, click ONE upgrade to choose it — how you invest shapes the research you can do.',
    done: (s, st) => s.pending < st.pending || s.pending === 0,
  },
  {
    id: 'conf-stage', allow: {}, mask: 'none', target: 'project-area',
    title: 'Turn 3 — Prepare a conference',
    body: 'Conferences spread your work for citation tokens. First, drag ONE evidence card into a project to present.',
    done: (s) => hasEvidence(s, 1),
  },
  {
    id: 'conf-attend', allow: { conference: true }, mask: 'hole', target: 'conference-button',
    title: 'Attend the conference',
    body: 'Now click Attend Conference on that project row to present your card.',
    done: (s) => !!s.conference,
  },
  {
    id: 'conf-draft', allow: {}, mask: 'none',
    title: 'Draft from the conference',
    body: 'In this window you draft cards to bring home — you may keep up to as many as you sent, and you can choose more than one. Pick the cards you want, then confirm. You also earn citation tokens.',
    done: (s) => !s.conference,
  },
  {
    id: 'draw2', allow: { draw: true }, mask: 'hole', target: 'draw-zone',
    title: 'Turn 4 — Draw again',
    body: 'A book is a bigger argument — 6 or more evidence cards. Draw again to gather more research.',
    done: (s, st) => s.year > st.year,
  },
  {
    id: 'build-book', allow: {}, mask: 'none', target: 'project-area',
    title: 'Build a book',
    body: 'Assemble a larger project: drag SIX evidence cards into a row and set a conclusion.',
    done: (s) => hasValid(s, 6),
  },
  {
    id: 'publish-book', allow: { publish: true }, mask: 'hole', target: 'publish-button',
    title: 'Turn 5 — Publish a book',
    body: 'Six evidence cards make this a book. Click Submit for Review — your first book earns you tenure and promotion to Associate Professor.',
    done: (s, st) => s.books > st.books,
  },
  {
    id: 'outro', info: true, allow: {},
    title: 'You’ve got it — tenure!',
    body: 'You drew research, built and published an article and a book, invested an upgrade, and attended a conference — the whole loop. You’re ready to start a real game from the home screen.',
    cta: 'Finish',
  },
];

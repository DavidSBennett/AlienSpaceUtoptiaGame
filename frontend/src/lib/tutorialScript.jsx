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

// Snapshot uses the SAME field names as the live game state so the done()
// predicates can compare `state.X > start.X` without a naming mismatch.
export function snapshot(s) {
  return {
    year: s.year,
    articlesPublished: s.articlesPublished || 0,
    booksPublished: s.booksPublished || 0,
    citations: s.citations || 0,
    pendingUpgrades: s.pendingUpgrades || 0,
  };
}

const hasEvidence = (s, n) => (s.projects || []).some((p) => (p.evidence?.length ?? 0) >= n);
const hasValid = (s, n) => (s.projects || []).some((p) => (p.evidence?.length ?? 0) >= n && !!p.conclusion);

// A fake opponent manuscript shown in the peer-review demo step. Shape matches
// what ReviewSubmissionDialog expects.
export const TUTORIAL_REVIEW_SUBMISSION = {
  writer_name: 'Prof. Hutchinson',
  writer_seat: 1,
  kind: 'article',
  year_submitted: 3,
  conclusion: {
    title: 'The Stamp Act crisis sparked the Revolution',
    description: 'A focused thesis: the 1765 tax crisis set the break with Britain in motion.',
    argument: 'economic',
  },
  argument_text:
    'The Stamp Act provoked the first colony-wide resistance. Taken with the boycotts that followed, it shows the Revolution began as a tax revolt.',
  evidence: [
    { idCard: 9001, title: 'The Stamp Act', author: 'Parliament', argument: 'economic', sub_argument: 'colonial' },
    { idCard: 9002, title: 'A merchants’ non-importation agreement', author: 'Boston merchants', argument: 'economic', sub_argument: 'colonial' },
    { idCard: 9003, title: 'A pamphlet against the tax', author: 'A Freeholder', argument: 'colonial', sub_argument: '' },
  ],
  citations: [],
};

export const TUTORIAL_SCRIPT = [
  {
    id: 'intro', info: true, allow: {},
    title: 'Welcome to the Guided Walkthrough',
    body: 'This is the real game, just guided. You’re a historian of the American Revolution, beginning as a Visiting Assistant Professor. At each step only the right control works. You’ll first build a focused economic argument, then a broad book — learning how evidence and conclusions must match.',
    cta: 'Begin',
  },
  {
    id: 'draw', allow: { draw: true }, mask: 'hole', target: 'draw-zone',
    title: 'Turn 1 — Draw research',
    body: 'Click the Archive deck (bottom-left of your notebook) to draw evidence into your hand. Each draw advances one year. Nothing else is clickable yet.',
    done: (s, st) => s.year > st.year,
  },
  {
    id: 'build', allow: {}, mask: 'none', target: 'project-area', dragGroup: 'economic',
    title: 'Build an economic argument',
    body: 'Two of these sources are ECONOMIC — about taxes: the Stamp Act and the Townshend Duties. Drag BOTH of them up into a project. The other cards are dimmed and locked for this step.',
    done: (s) => hasEvidence(s, 2),
  },
  {
    id: 'conclusion', allow: {}, mask: 'none', target: 'conclusion-rail', dragGroup: 'economic',
    title: 'Set the matching conclusion',
    body: 'Two conclusions are offered. Drag the ECONOMIC one (“Taxes and trade laws angered the colonists”) into your project’s conclusion slot — it matches your economic sources. The broad conclusion is locked for now.',
    done: (s) => hasValid(s, 2),
  },
  {
    id: 'publish-article', allow: { publish: true }, mask: 'hole', target: 'publish-button',
    title: 'Turn 2 — Publish an article',
    body: 'A project with fewer than 6 evidence cards is an article. Click Submit for Review — your first article wins a tenure-track post (Assistant Professor).',
    done: (s, st) => s.articlesPublished > st.articlesPublished,
  },
  {
    id: 'upgrade', allow: {}, mask: 'none',
    title: 'Invest your funding',
    body: 'Close the publish notice and the promotion pop-up first. An “Invest your funding” window then opens — click ONE upgrade to choose it. How you invest shapes the research you can do.',
    done: (s, st) => s.pendingUpgrades < st.pendingUpgrades || s.pendingUpgrades === 0,
  },
  {
    // Peer review is a MULTIPLAYER mechanic; here it’s a no-stakes demo so the
    // student sees the module. Advanced by submitting a verdict in the dialog.
    id: 'peer-review', allow: {}, mask: 'none',
    title: 'Peer review (multiplayer)',
    body: 'In a MULTIPLAYER game, after everyone submits, you review one another’s manuscripts. Here’s an opponent’s article to try it on — a demo, so your choice changes nothing. Read it, then pick a verdict: APPROVE (the evidence supports the thesis — it gets published), REVISE (send it back to add or cut evidence), or REJECT (turn it down — you must flag the weak evidence). Submit your verdict to continue.',
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
    id: 'build-book', allow: {}, mask: 'none', target: 'project-area', dragGroup: 'colonial',
    title: 'Build a book',
    body: 'A book is a broad argument. Drag SIX of the remaining COLONIAL sources into a project, and add the broad “Many grievances…” conclusion — it accepts many kinds of evidence.',
    done: (s) => hasValid(s, 6),
  },
  {
    id: 'publish-book', allow: { publish: true }, mask: 'hole', target: 'publish-button',
    title: 'Turn 5 — Publish a book',
    body: 'Six evidence cards make this a book. Click Submit for Review — your first book earns you tenure and promotion to Associate Professor.',
    done: (s, st) => s.booksPublished > st.booksPublished,
  },
  {
    id: 'outro', info: true, allow: {},
    title: 'You’ve got it — tenure!',
    body: 'You drew research, built and published an article and a book, invested an upgrade, and attended a conference — the whole loop. You’re ready to start a real game from the home screen.',
    cta: 'Finish',
  },
];

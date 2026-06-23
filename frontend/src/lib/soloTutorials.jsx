/**
 * Single-player tutorial registry. Same shape as lib/tutorials.jsx, but the
 * conditions read the SOLO reducer state (state.year, state.hand,
 * state.projects, state.articlesPublished, …) and the copy follows the solo
 * career narrative: you start as a Visiting Assistant Professor, publish an
 * article for a tenure-track post, a book to earn tenure, then climb the ranks.
 *
 * Consumed by <TutorialManager tutorials={SOLO_TUTORIALS} …/> in Game.jsx.
 */

const over = (s) => !!s?.gameOver;

export const SOLO_TUTORIALS = [
  // ── Collapsing sections (first thing a new player sees) ──────────────
  {
    id: 'solo-chevrons',
    order: 5,
    targetAttr: null,
    title: 'Collapsing Sections',
    body: (
      <>
        <p>
          Welcome! This board packs a lot in. Notice the small ▾ chevrons on the
          header, each project row, and the notebook.
        </p>
        <p className="mt-2">Click any chevron to fold a section away and keep your view focused.</p>
      </>
    ),
    condition: (s) => !over(s) && s?.year === 1,
  },

  // ── Welcome / draw ───────────────────────────────────────────────────
  {
    id: 'solo-welcome-draw',
    order: 10,
    targetAttr: 'draw-zone',
    title: 'Your First Post',
    body: (
      <>
        <p>
          You begin your career as a <strong>Visiting Assistant Professor</strong>.
          A few evidence cards are already in your notebook — the interests that
          brought you to the field.
        </p>
        <p className="mt-2">
          Your goals: publish your <strong>first article</strong> for a
          tenure-track post (Assistant Professor), then your{' '}
          <strong>first book</strong> to earn tenure (Associate Professor).
          Click the deck to <strong>draw</strong> more evidence — each draw costs a year.
        </p>
      </>
    ),
    condition: (s) => !over(s) && s?.year === 1,
  },

  // ── Significance toggle (teaching notes) ─────────────────────────────
  {
    id: 'solo-significance',
    order: 12,
    targetAttr: 'significance-toggle',
    title: 'Read the History',
    body: (
      <>
        <p>
          Turn on <strong>Significance</strong> (in the header) to reveal the
          historical-significance note behind each source.
        </p>
        <p className="mt-2">
          With it on, click any card to open it and read why that piece of
          evidence matters — a great way to learn the history as you play. Use
          <strong> Tags</strong> the same way to see each card’s themes.
        </p>
      </>
    ),
    condition: (s) => !over(s) && (s?.year ?? 1) === 1,
  },

  // ── Build a project ──────────────────────────────────────────────────
  {
    id: 'solo-build-project',
    order: 20,
    targetAttr: null,
    title: 'Building a Project',
    body: (
      <>
        <p>Drag a card from your notebook up into one of the project rows to start building an argument.</p>
        <p className="mt-2">Placed cards collapse to thin spines to save space — click a spine to read it, right-click to send it back.</p>
      </>
    ),
    condition: (s) =>
      !over(s) &&
      (s?.hand?.length ?? 0) > 0 &&
      !(s?.projects || []).some((p) => (p.evidence?.length ?? 0) > 0),
  },

  // ── Set a conclusion ─────────────────────────────────────────────────
  {
    id: 'solo-set-conclusion',
    order: 30,
    targetAttr: 'conclusion-rail',
    title: 'Setting a Conclusion',
    body: (
      <>
        <p>A project also needs a <strong>conclusion</strong> — the historical question your evidence is meant to answer.</p>
        <p className="mt-2">Drag a conclusion from the rail on the left into the conclusion slot of your project. Every piece of evidence must share a tag with it.</p>
      </>
    ),
    condition: (s) =>
      !over(s) &&
      (s?.projects || []).some((p) => (p.evidence?.length ?? 0) > 0) &&
      !(s?.projects || []).some((p) => !!p.conclusion),
  },

  // ── Publish to get hired ─────────────────────────────────────────────
  {
    id: 'solo-publish-hired',
    order: 40,
    targetAttr: 'publish-button',
    title: 'Publish to Advance',
    body: (
      <>
        <p>
          Your project has enough evidence. Click <strong>Submit for Review</strong> to
          publish it. Your <strong>first article</strong> (under 6 evidence) wins a
          tenure-track post (Assistant Professor); your <strong>first book</strong> (6+)
          earns tenure (Associate Professor).
        </p>
        <p className="mt-2">Publishing costs a year and earns prestige.</p>
      </>
    ),
    condition: (s) => {
      if (over(s)) return false;
      const ready = (s?.projects || []).some((p) => p.conclusion && (p.evidence?.length ?? 0) >= 2);
      const published = (s?.articlesPublished ?? 0) + (s?.booksPublished ?? 0);
      return ready && published === 0;
    },
  },

  // ── Book deadline (after the first article) ──────────────────────────
  {
    id: 'solo-book-deadline',
    order: 45,
    targetAttr: null,
    title: 'Now, a Book',
    body: (
      <>
        <p>You're on the tenure track! Your next milestone is a <strong>book</strong> (a project with 6+ evidence) — your first book earns you <strong>tenure</strong> as Associate Professor.</p>
        <p className="mt-2">After that, more books earn promotions: 4 → Full Professor, 7 → an Endowed Chair.</p>
      </>
    ),
    condition: (s) =>
      !over(s) && (s?.articlesPublished ?? 0) >= 1 && (s?.booksPublished ?? 0) === 0,
  },

  // ── Attend a conference ──────────────────────────────────────────────
  {
    id: 'solo-conference',
    order: 50,
    targetAttr: null,
    title: 'Attend a Conference',
    body: (
      <>
        <p>Stage evidence in a project and click <strong>Attend Conference</strong> to swap those cards for a fresh selection from the archive — and bank <strong>citation tokens</strong>.</p>
        <p className="mt-2">Your Association Memberships set how big the swap pool is; at the end of the game your Publicist turns citations into prestige.</p>
      </>
    ),
    condition: (s) =>
      !over(s) &&
      (s?.articlesPublished ?? 0) + (s?.booksPublished ?? 0) >= 1 &&
      (s?.projects || []).some((p) => (p.evidence?.length ?? 0) >= 1),
  },

  // ── Invest your funding (first upgrade) ──────────────────────────────
  {
    id: 'solo-invest',
    order: 55,
    targetAttr: null,
    title: 'Money to Invest',
    body: (
      <>
        <p>You've come into some money — a <strong>grant</strong> while you're job-hunting, or a <strong>pay raise</strong> once you're employed. Every other year brings more, and every promotion adds a bonus.</p>
        <p className="mt-2">Spend it on one upgrade. How you invest shapes the kind of research you'll be able to do.</p>
      </>
    ),
    condition: (s) => !over(s) && (s?.pendingUpgrades ?? 0) > 0,
  },
];

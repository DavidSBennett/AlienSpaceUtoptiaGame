/**
 * Tutorial registry — the master list of tutorial moments. Each entry
 * describes ONE thing the player learns the first time they encounter it.
 *
 * Schema for each entry:
 *   id           — stable string identifier; used as the dismiss-key
 *                  in localStorage. Never reuse or rename ids; doing so
 *                  re-fires the tutorial for players who already saw it.
 *   title        — short header shown in the modal
 *   body         — explanation text (string or JSX)
 *   targetAttr   — value of `data-tutorial` on the element to point to,
 *                  or null if the modal floats centrally without an arrow
 *   condition    — function(state) returning true when the tutorial
 *                  should fire. `state` is the full game state object
 *                  (state.you, state.game, state.opponents, etc).
 *   order        — priority for fire-order; lower fires first when
 *                  multiple are eligible at once
 *
 * The TutorialManager loops over this registry on every state change,
 * checks each entry's condition against current state and the dismiss
 * set, and shows the first match.
 */

export const TUTORIALS = [
  // ─── Chevrons / collapse hints (shown FIRST) ──────────────────────
  // This is the very first thing a new player sees: the board is dense,
  // so we orient them to the collapse controls before anything else.
  {
    id: 'chevrons',
    order: 5,
    targetAttr: null,
    title: 'Collapsing Sections',
    body: (
      <>
        <p>
          Welcome! This board packs a lot in. Before you dive in, note the
          small ▾ chevrons on the header bar, each project row, the
          notebook, and the library at the bottom.
        </p>
        <p className="mt-2">
          Click any chevron to collapse or expand that section. Use them to
          keep your view focused on whatever you're working on right now.
        </p>
      </>
    ),
    condition: (state) => {
      const you = state?.you;
      if (!you) return false;
      if (you.game_over_reason) return false;
      // Fire at the very start of the game, before any other hint.
      return (state.game?.current_year ?? 1) === 1;
    },
  },

  // ─── Welcome / Draw ────────────────────────────────────────────────
  {
    id: 'welcome-draw',
    order: 10,
    title: 'Welcome — Drawing Cards',
    targetAttr: 'draw-zone',
    body: (
      <>
        <p>
          You begin your career as a <strong>Visiting Assistant Professor</strong>.
          You start with a few evidence cards already in your notebook below: the
          interests that brought you to the field.
        </p>
        <p className="mt-2">
          Publish your first article for a tenure-track post (Assistant
          Professor), and your first book to earn tenure (Associate Professor) —
          there are no deadlines. Each year you take ONE action: draw research,
          develop a project, or peer-review someone's work. To draw, click the
          deck to mark "Draw," then "End Year" to advance — fresh evidence flows
          into your notebook.
        </p>
      </>
    ),
    condition: (state) => {
      // First moment of the game — no action chosen yet. (Hands now start
      // seeded with a few cards, so we no longer gate on an empty hand.)
      const you = state?.you;
      if (!you) return false;
      if (you.game_over_reason) return false;
      return (
        (you.pending_action ?? null) === null &&
        state.game?.current_year === 1
      );
    },
  },

  // ─── Drag evidence into a project ─────────────────────────────────
  {
    id: 'drag-evidence',
    order: 20,
    title: 'Building a Project',
    targetAttr: null, // no specific button — points to hand→project relationship
    body: (
      <>
        <p>
          Your notebook now has evidence cards. To build a research
          project, drag a card from the notebook into one of the
          project rows above.
        </p>
        <p className="mt-2">
          Cards inside a project show as thin vertical spines to save
          space. Click a spine to read the card; right-click to send it
          back to the notebook.
        </p>
      </>
    ),
    condition: (state) => {
      const you = state?.you;
      if (!you) return false;
      if (you.game_over_reason) return false;
      // Has cards in hand, but no project has any evidence yet.
      const hasHand = (you.hand?.length ?? 0) > 0;
      const anyEvidence = (you.projects || []).some((p) => (p.evidence?.length ?? 0) > 0);
      return hasHand && !anyEvidence;
    },
  },

  // ─── Drag conclusion ──────────────────────────────────────────────
  {
    id: 'drag-conclusion',
    order: 30,
    title: 'Setting a Conclusion',
    targetAttr: 'conclusion-rail',
    body: (
      <>
        <p>
          A project also needs a <strong>conclusion</strong> — the broad
          historical question your research is meant to answer.
        </p>
        <p className="mt-2">
          Conclusion tiles live in the rail above. Drag one into the
          conclusion slot on the left of your project row.
        </p>
      </>
    ),
    condition: (state) => {
      const you = state?.you;
      if (!you) return false;
      if (you.game_over_reason) return false;
      // Player has placed at least one evidence card, but no project
      // has a conclusion yet.
      const anyEvidence = (you.projects || []).some((p) => (p.evidence?.length ?? 0) > 0);
      const anyConclusion = (you.projects || []).some((p) => !!p.conclusion);
      return anyEvidence && !anyConclusion;
    },
  },

  // ─── Submit for peer review ───────────────────────────────────────
  {
    id: 'submit-for-review',
    order: 40,
    targetAttr: 'publish-button',
    title: 'Submitting for Peer Review',
    body: (
      <>
        <p>
          Your project has enough evidence to publish. Click the
          highlighted "Publish" button to submit it for peer review.
        </p>
        <p className="mt-2">
          Reviewers will see your project's titles, authors, and tags,
          plus a written argument from you. If you'd rather explain by
          voice (Discord, Zoom, in person), check the VOIP box in the
          submit dialog — the textbox becomes optional.
        </p>
      </>
    ),
    condition: (state) => {
      const you = state?.you;
      if (!you) return false;
      if (you.game_over_reason) return false;
      // A project meets the minimum publish criteria, AND the player
      // hasn't submitted anything yet this game. (Fixed threshold: 2 evidence.)
      const articleMin = 2;
      const ready = (you.projects || []).some((p) =>
        p.conclusion && (p.evidence?.length ?? 0) >= articleMin
      );
      const hasEverPublished = (you.articles_published ?? 0) + (you.books_published ?? 0) > 0;
      const hasEverSubmitted = (state.your_submissions?.length ?? 0) > 0;
      const hasResolved = (state.resolved_submissions_for_you?.length ?? 0) > 0;
      return ready && !hasEverPublished && !hasEverSubmitted && !hasResolved;
    },
  },

  // ─── Manuscript inbox / review flow ───────────────────────────────
  {
    id: 'manuscript-inbox',
    order: 50,
    targetAttr: 'manuscript-inbox',
    title: 'Reviewing a Manuscript',
    body: (
      <>
        <p>
          Another player has submitted a manuscript and you can review
          it. Click the spine in the inbox to open the review dialog.
        </p>
        <p className="mt-2">
          You'll see the title, evidence, and the author's argument —
          but not the actual card contents. Decide whether to approve,
          revise-and-resubmit, or reject. A rejection requires you to
          flag at least one piece of evidence as the reason.
        </p>
      </>
    ),
    condition: (state) => {
      // There's at least one pending submission for me to review, and
      // I haven't recorded any review yet. (Reviews aren't surfaced
      // directly in state.you, but the inbox panel only shows when
      // pending_submissions has items.)
      const you = state?.you;
      if (!you) return false;
      if (you.game_over_reason) return false;
      const inboxCount = state.pending_submissions?.length ?? 0;
      if (inboxCount === 0) return false;
      // Use a localStorage marker so we don't try to detect "has
      // reviewed before" from state alone (server doesn't expose it
      // cleanly). The dismiss key itself handles that.
      return true;
    },
  },

  // ─── First upgrade — "money to invest" ────────────────────────────
  {
    id: 'first-upgrade',
    order: 60,
    targetAttr: null,
    title: 'Money to Invest',
    body: (
      <>
        <p>
          You've come into some money — a raise (once you're on the tenure
          track), a bonus, or a grant. Every couple of years brings more.
        </p>
        <p className="mt-2">
          Invest it in one upgrade — <strong>Research Funding</strong> (draw
          more), <strong>Personal Archive</strong> (hold more),{' '}
          <strong>Literary Agent</strong> (prestige per evidence card),{' '}
          <strong>Workspaces</strong> (more projects at once),{' '}
          <strong>Association Memberships</strong> (your payoff at conferences),
          or <strong>Publicist</strong> (what your citations are worth at game
          end). How you invest the money shapes the kind of historical research
          you'll achieve.
        </p>
      </>
    ),
    condition: (state) => {
      const you = state?.you;
      if (!you) return false;
      if (you.game_over_reason) return false;
      return (you.pending_upgrade ?? 0) > 0;
    },
  },

  // ─── History button ───────────────────────────────────────────────
  {
    id: 'history-button',
    order: 70,
    targetAttr: 'history-button',
    title: 'Action History',
    body: (
      <>
        <p>
          The History button shows every action every player has taken,
          grouped by year. Open it any time to see what you (or your
          opponents) did and when.
        </p>
      </>
    ),
    condition: (state) => {
      // Fire once at least one year has advanced (so there's actual
      // history to look at).
      return (state?.game?.current_year ?? 1) >= 2;
    },
  },
];

/**
 * Return the first tutorial whose condition is true and which hasn't
 * been dismissed yet. Sorted by `order` to give a stable rotation.
 */
export function pickNextTutorial(state, dismissedIds, tutorials = TUTORIALS) {
  if (!state) return null;
  const candidates = tutorials
    .filter((t) => !dismissedIds.has(t.id))
    .filter((t) => {
      try {
        return t.condition(state);
      } catch (e) {
        // Defensive — never let a buggy tutorial condition crash the page
        console.warn(`Tutorial condition for ${t.id} threw:`, e);
        return false;
      }
    })
    .sort((a, b) => a.order - b.order);
  return candidates[0] || null;
}

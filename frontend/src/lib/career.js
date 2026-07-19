/**
 * Career progression — shared stage labels, rank order, and narrative copy
 * used by both single-player and multiplayer.
 *
 * The career arc:
 *   Visiting Assistant Professor (start)
 *     → publish 1st article  → Assistant Professor (tenure track)
 *     → publish 1st book      → Associate Professor (tenured)
 *     → 4 books               → Full Professor
 *     → 7 books               → Endowed Professor
 *
 * No deadlines — the career never ends early; it runs to retirement.
 */

// Rank ladder, low → high. Used to detect promotions and gate employment text.
// 'recent-graduate' is kept only so legacy saves map cleanly; new careers start
// at Visiting Assistant Professor.
export const RANK_ORDER = [
  'recent-graduate',
  'visiting-assistant-professor',
  'assistant-professor',
  'associate-professor',
  'full-professor',
  'endowed-professor',
];

export const STAGE_LABELS = {
  'recent-graduate':              'Recent Graduate',
  'visiting-assistant-professor': 'Visiting Assistant Professor',
  'assistant-professor':          'Assistant Professor',
  'associate-professor':          'Associate Professor',
  'full-professor':               'Full Professor',
  'endowed-professor':            'Endowed Professor',
  'retired':                      'Retired',
  // Failure / exit stages
  'failed-comps':                 'Left Academia',
  'tenure-denied':                'Denied a Position',
  'conceded':                     'Withdrew',
  // Legacy stages from games created before the career rework — map them to
  // the closest current label so they never render as a raw key.
  'graduate-student':             'Recent Graduate',
  'abd':                          'Recent Graduate',
};

export function stageLabel(stage) {
  return STAGE_LABELS[stage] || stage || '—';
}

export function rankIndex(stage) {
  return RANK_ORDER.indexOf(stage);
}

/** Did the player move UP the rank ladder (a promotion worth celebrating)? */
export function isPromotion(prevStage, nextStage) {
  const a = rankIndex(prevStage);
  const b = rankIndex(nextStage);
  return a >= 0 && b >= 0 && b > a;
}

/** Employed = hired into a post (anything past Recent Graduate). */
export function isEmployed(stage) {
  return rankIndex(stage) >= 1;
}

/** The career stage implied by how much a player has published. */
export function computeStage(articles, books) {
  const a = Number(articles) || 0;
  const b = Number(books) || 0;
  if (b >= 7) return 'endowed-professor';
  if (b >= 4) return 'full-professor';
  if (b >= 1) return 'associate-professor';   // first book → tenure
  if (a >= 1) return 'assistant-professor';    // first article → tenure track
  return 'visiting-assistant-professor';       // start
}

/**
 * Narrative-modal copy for each rank you can be promoted INTO. Keyed by the
 * stage the player just reached.
 */
export const STAGE_NARRATIVE = {
  'visiting-assistant-professor': {
    eyebrow: 'A new post',
    title: 'Visiting Assistant Professor',
    body: 'You begin your career with a Visiting Assistant Professorship — a foot in the door. Publish to make your name.',
  },
  'assistant-professor': {
    eyebrow: 'Tenure track',
    title: 'Assistant Professor',
    body: 'Your first article is in print. On the strength of it you win a permanent, tenure-track appointment as Assistant Professor.',
  },
  'associate-professor': {
    eyebrow: 'Tenured',
    title: 'Associate Professor',
    body: 'Your first book earns you tenure and promotion to Associate Professor — your standing in the field is secure.',
  },
  'full-professor': {
    eyebrow: 'Promotion',
    title: 'Full Professor',
    body: 'With four books to your name, the university makes you a Full Professor — a senior voice in your discipline.',
  },
  'endowed-professor': {
    eyebrow: 'The pinnacle',
    title: 'An Endowed Chair',
    body: 'Seven books. You are granted an endowed chair — the summit of an academic career.',
  },
};

/**
 * Reason text for the upgrade chooser. `reason` is 'promotion' or 'biennial';
 * `stage` is the player's current stage (drives the grant-vs-raise wording).
 */
export function upgradeReasonText(reason, stage) {
  if (reason === 'promotion') {
    return `Your promotion to ${stageLabel(stage)} comes with new money to invest in your research.`;
  }
  if (reason === 'publish') {
    return 'Publishing your work brought in fresh funding. How you invest it shapes the research you can do.';
  }
  if (reason === 'conference') {
    return 'Presenting at the conference brought in fresh funding. How you invest it shapes the research you can do.';
  }
  // Generic grant / pay raise.
  return isEmployed(stage)
    ? 'A pay raise has come through. How you invest it shapes the research you can do.'
    : "You've won a grant. How you invest it shapes the research you can do.";
}

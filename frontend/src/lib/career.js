/**
 * Career progression — shared stage labels, rank order, and narrative copy
 * used by both single-player and multiplayer.
 *
 * The career arc (no more "graduate student"):
 *   Recent Graduate (start, unemployed)
 *     → publish 1st article  → Visiting Assistant Professor (hired)
 *     → publish 1st book      → Assistant Professor (tenure track)
 *     → 2 books               → Associate Professor
 *     → 4 books               → Full Professor
 *     → 7 books               → Endowed Professor
 *
 * Deadlines: at least one article by year 3, at least one book by year 6.
 */

// Rank ladder, low → high. Used to detect promotions and gate employment text.
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
  if (b >= 2) return 'associate-professor';
  if (b >= 1) return 'assistant-professor';
  if (a >= 1) return 'visiting-assistant-professor';
  return 'recent-graduate';
}

/**
 * Narrative-modal copy for each rank you can be promoted INTO. Keyed by the
 * stage the player just reached.
 */
export const STAGE_NARRATIVE = {
  'visiting-assistant-professor': {
    eyebrow: 'You are hired',
    title: 'A Foot in the Door',
    body: 'Your first article is in print. On the strength of it, a university takes you on as a Visiting Assistant Professor — your first real post in the field.',
  },
  'assistant-professor': {
    eyebrow: 'Tenure track',
    title: 'Assistant Professor',
    body: 'Your first book wins you a permanent, tenure-track appointment as Assistant Professor. You belong here now.',
  },
  'associate-professor': {
    eyebrow: 'Promotion',
    title: 'Associate Professor',
    body: 'A second book earns your promotion to Associate Professor — your standing in the field is secure.',
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
  // Regular every-other-year money.
  return isEmployed(stage)
    ? 'A pay raise has come through. How you invest it shapes the research you can do.'
    : "You've won a grant. How you invest it shapes the research you can do.";
}

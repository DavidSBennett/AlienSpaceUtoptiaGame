import { getCardTags } from './tags.js';

/**
 * Argument validation — the core game-logic gate.
 *
 * RULE (locked in 2026-04 per design conversation):
 *   A published argument validates iff:
 *     1. There are at least 2 evidence cards.
 *     2. The intersection of all card tag sets — including the conclusion's
 *        tags — is non-empty (≥ 1 tag is present in every card AND in the
 *        conclusion).
 *
 * The conclusion is one card; the evidence is an array of cards. Both
 * contribute tags to the intersection. A non-empty intersection means
 * there exists a common tag tying every piece of evidence to the conclusion.
 *
 * This function is intentionally PURE — same input, same output, no
 * side effects. UI calls it; UI does not contain this logic.
 *
 * @param {Object} conclusion         the conclusion card (type === 'conclusion')
 * @param {Object[]} evidence         array of evidence cards (type === 'archive')
 * @returns {{
 *   ok: boolean,
 *   reason: 'ok' | 'no-conclusion' | 'too-few-evidence' | 'no-common-tag',
 *   commonTags: string[],            // sorted list of tags shared by all
 *   evidenceCount: number,
 * }}
 */
/**
 * Validate whether an argument is publishable.
 *
 * Used both for the live "Publish" preview (e.g. disabling the button)
 * and at publish-time inside the reducer.
 *
 * Rules:
 *   - Must have a conclusion in the project's conclusion slot.
 *   - Must have at least `minEvidence` evidence cards (default 2; lowered
 *     by Reputation level — when articles can be only 1 card long, the
 *     minimum drops to 1).
 *   - Conclusion AND every evidence card must share at least one tag
 *     (argument letter), implying they cohere as one argument.
 *
 * @param {Object} conclusion         the conclusion card (type === 'conclusion')
 * @param {Object[]} evidence         array of evidence cards (type === 'archive')
 * @param {number} [minEvidence=2]    minimum evidence-card count for a valid argument
 */
export function validateArgument(conclusion, evidence, minEvidence = 2) {
  const evidenceList = Array.isArray(evidence) ? evidence : [];

  if (!conclusion) {
    return {
      ok: false,
      reason: 'no-conclusion',
      commonTags: [],
      evidenceCount: evidenceList.length,
    };
  }

  if (evidenceList.length < minEvidence) {
    return {
      ok: false,
      reason: 'too-few-evidence',
      commonTags: [],
      evidenceCount: evidenceList.length,
    };
  }

  // Compute intersection across conclusion + every evidence card.
  let common = getCardTags(conclusion);
  for (const card of evidenceList) {
    const cardTags = getCardTags(card);
    const next = new Set();
    for (const t of common) {
      if (cardTags.has(t)) next.add(t);
    }
    common = next;
  }

  const commonTags = Array.from(common).sort();

  if (commonTags.length === 0) {
    return {
      ok: false,
      reason: 'no-common-tag',
      commonTags: [],
      evidenceCount: evidenceList.length,
    };
  }

  return {
    ok: true,
    reason: 'ok',
    commonTags,
    evidenceCount: evidenceList.length,
  };
}

/**
 * Compute the prestige award for a successful publish.
 *
 *   prestige = (evidence_count + total_bonus + influence) × 2 IF a "shared
 *   context" exists across all evidence cards — either the same value for
 *   location, author, date, source_type, or citation, OR at least one common
 *   context tag (the pipe-separated context_tags field). Otherwise no doubling.
 *
 * The doubling is a separate check from the tag-intersection check above:
 * the argument can be valid (shared argument tag) without sharing context.
 * The doubling rewards arguments that are also evidentially coherent.
 *
 * @param {Object[]} evidence
 * @param {Object} conclusion         (its `bonus` is added to the score)
 * @param {number} influenceBonus     from player stats
 * @returns {{
 *   base: number,
 *   doubled: boolean,
 *   contextField: string|null,
 *   total: number,
 * }}
 */
// Single-value context fields — all evidence must share the same non-empty
// value for the publication to double on that dimension.
const CONTEXT_FIELDS = ['location', 'author', 'date', 'source_type', 'citation'];

/**
 * Find the context dimension that all evidence cards share (which triggers the
 * prestige "doubling"), or null if none.
 *
 * Two kinds of dimension:
 *   - single-value fields (location, author, date, source_type, citation):
 *     every card has the SAME non-empty value.
 *   - context_tags: a PIPE-separated list per card (like the title pools);
 *     every card shares at least one common tag.
 *
 * @param {Object[]} evidence
 * @returns {string|null}  the matched field name, 'context tags', or null
 */
export function findSharedContext(evidence) {
  const list = Array.isArray(evidence) ? evidence : [];
  if (list.length === 0) return null;

  for (const field of CONTEXT_FIELDS) {
    const first = (list[0]?.[field] ?? '').toString().trim();
    if (!first) continue;
    if (list.every((c) => (c?.[field] ?? '').toString().trim() === first)) {
      return field;
    }
  }

  // context_tags: doubled when every card shares at least one common tag.
  const parse = (c) =>
    String(c?.context_tags ?? '')
      .split('|')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  let inter = parse(list[0]);
  for (let i = 1; i < list.length && inter.length > 0; i++) {
    const s = new Set(parse(list[i]));
    inter = inter.filter((t) => s.has(t));
  }
  if (inter.length > 0) return 'context tags';

  return null;
}

export function computePrestige(evidence, conclusion, influenceBonus = 0) {
  const evidenceList = Array.isArray(evidence) ? evidence : [];

  const totalBonus = evidenceList.reduce((sum, c) => {
    const n = Number(c?.bonus);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  const cb = Number(conclusion?.bonus);
  const conclusionBonus = Number.isFinite(cb) ? cb : 0;

  const base = evidenceList.length + totalBonus + conclusionBonus + (influenceBonus || 0);

  const contextField = findSharedContext(evidenceList);
  const doubled = contextField !== null;
  const total = doubled ? base * 2 : base;

  return { base, doubled, contextField, total, conclusionBonus };
}


/**
 * computePrestigeMpPreview — multiplayer-aware estimator. Mirrors the
 * server-side mp_compute_prestige logic so the publish dialog can
 * show a live estimated score before submitting.
 *
 * Differences from the solo computePrestige:
 *   - Accepts citations array (live mp_citations rows) and applies
 *     the floor(N/2) effective-evidence rule.
 *   - Doubling check runs only against REAL evidence (citations
 *     ignored).
 *   - bonus_sum only from real evidence (citations don't bring it).
 *   - Influence L4 scaling uses EFFECTIVE evidence count.
 *
 * Assumes the publication WILL be approved — this is the optimistic
 * "if all tags line up" estimate. If your citations are tag-mismatched
 * the actual result will be auto-rejection (0 prestige); the dialog
 * is responsible for warning the player separately.
 *
 * @param {Array}  evidence     — real evidence cards (with bonus / location / author / etc.)
 * @param {Array}  citations    — array of {cited_evidence_count} from
 *                                 mp_getGameState project.citations
 * @param {number} influenceLvl — 1-4
 * @returns {{
 *   realEvidenceCount: number,
 *   citationEvidence:  number,
 *   effectiveEvidence: number,
 *   bonusSum:          number,
 *   influenceBonus:    number,
 *   base:              number,
 *   doubled:           boolean,
 *   contextField:      string|null,
 *   total:             number
 * }}
 */
export function computePrestigeMpPreview(evidence, citations, influenceLvl, conclusionBonus = 0) {
  const evList = Array.isArray(evidence) ? evidence : [];
  const citList = Array.isArray(citations) ? citations : [];

  const realCount = evList.length;

  // Each citation adds a flat prestige bonus = its recorded prestige_contrib
  // (half the cited work's conclusion prestige contribution). Citations are
  // no longer counted as evidence.
  const citationBonus = citList.reduce((sum, c) => {
    const n = Number(c?.prestige_contrib ?? 0);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  const bonusSum = evList.reduce((sum, c) => {
    const n = Number(c?.bonus);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  const cb = Number(conclusionBonus);
  const concBonus = Number.isFinite(cb) ? cb : 0;

  // Influence is a per-card bonus, and a cited work counts as a card for it —
  // matching mp_apply_approval server-side.
  const INF_TABLE = [0, 1, 2, 4];
  const lvl = Math.max(1, Math.min(4, Number(influenceLvl) || 1));
  const influenceBonus = INF_TABLE[lvl - 1] * (realCount + citList.length);

  // Doubling check — REAL evidence only (citations excluded). The cited works
  // may span many contexts, so they can't speak to whether THIS argument is
  // focused; they still ride the multiplier once it's earned.
  const contextField = findSharedContext(evList);
  const doubled = contextField !== null;

  // The citation bonus is inside the base, so a coherent argument doubles it
  // with everything else — mirrors mp_compute_prestige.
  const base = realCount + bonusSum + concBonus + influenceBonus + citationBonus;
  const total = doubled ? base * 2 : base;

  return {
    realEvidenceCount: realCount,
    citationBonus,
    bonusSum,
    conclusionBonus: concBonus,
    influenceBonus,
    base,
    doubled,
    contextField,
    total,
  };
}


/**
 * Critique — for a FAILED argument, identify the clearest way to explain
 * what went wrong. Returns a structured diagnosis the UI can use to
 * generate a peer-reviewer response with specific card titles.
 *
 * Strategy: try multiple approaches in priority order, return the first
 * one that produces a clear story. The goal isn't algorithmic precision —
 * it's pedagogical clarity. Sometimes there are multiple valid framings;
 * we pick the one that names the smallest number of "problem cards."
 *
 * @param {Object} conclusion         the conclusion card
 * @param {Object[]} evidence         array of evidence cards
 * @returns {{
 *   kind: 'no-conclusion-support'    // conclusion has no tags in common with any evidence
 *       | 'single-outlier'           // one specific card breaks the chain
 *       | 'few-outliers'             // 2-3 cards break a clear consensus
 *       | 'evidence-conclusion-mismatch'  // evidence coheres but doesn't match the conclusion
 *       | 'no-coherence'             // no through-line at all
 *       | 'too-few-evidence',
 *   problemCards: Object[],          // the cards to name in the critique (may be empty)
 *   evidenceTheme: string|null,      // for evidence-conclusion-mismatch: what the evidence IS about
 * }}
 */
export function critiqueArgument(conclusion, evidence) {
  const evidenceList = Array.isArray(evidence) ? evidence : [];

  if (evidenceList.length < 2) {
    return { kind: 'too-few-evidence', problemCards: [], evidenceTheme: null };
  }

  const conclusionTags = conclusion ? getCardTags(conclusion) : new Set();
  const evidenceTagSets = evidenceList.map((c) => ({ card: c, tags: getCardTags(c) }));

  // Strategy 1: Does the conclusion share NO tags with any evidence at all?
  // This is the cleanest critique — "your evidence doesn't speak to your thesis."
  const evidenceCardsRelatedToConclusion = evidenceTagSets.filter(({ tags }) =>
    [...tags].some((t) => conclusionTags.has(t))
  );
  if (evidenceCardsRelatedToConclusion.length === 0) {
    return {
      kind: 'no-conclusion-support',
      problemCards: [],
      evidenceTheme: null,
    };
  }

  // Strategy 2: Is there a "consensus tag" in the evidence that the conclusion
  // doesn't share? If so, the evidence coheres around something — but it's not
  // what the conclusion is arguing.
  // Find the tag that the most evidence cards share (excluding conclusion's tags).
  const evidenceTagCounts = new Map();
  for (const { tags } of evidenceTagSets) {
    for (const t of tags) {
      evidenceTagCounts.set(t, (evidenceTagCounts.get(t) || 0) + 1);
    }
  }
  // Find the most-popular tag that ALL evidence shares but the conclusion lacks
  let evidenceConsensusTag = null;
  for (const [tag, count] of evidenceTagCounts) {
    if (count === evidenceList.length && !conclusionTags.has(tag)) {
      evidenceConsensusTag = tag;
      break;
    }
  }
  if (evidenceConsensusTag) {
    return {
      kind: 'evidence-conclusion-mismatch',
      problemCards: [],
      evidenceTheme: evidenceConsensusTag,
    };
  }

  // Strategy 3: Find the conclusion-tag that the MOST evidence cards share.
  // The cards that DON'T share that tag are the outliers.
  // If exactly 1 outlier → "single-outlier" critique.
  // If 2-3 outliers → "few-outliers" critique.
  // If most cards are outliers → fall through to "no-coherence."
  let bestTag = null;
  let bestSharedCount = 0;
  for (const tag of conclusionTags) {
    const sharedCount = evidenceTagSets.filter(({ tags }) => tags.has(tag)).length;
    if (sharedCount > bestSharedCount) {
      bestSharedCount = sharedCount;
      bestTag = tag;
    }
  }

  if (bestTag !== null && bestSharedCount >= Math.ceil(evidenceList.length * 0.6)) {
    // The majority of evidence shares a tag with the conclusion; outliers are the rest
    const outliers = evidenceTagSets
      .filter(({ tags }) => !tags.has(bestTag))
      .map(({ card }) => card);

    if (outliers.length === 1) {
      return { kind: 'single-outlier', problemCards: outliers, evidenceTheme: null };
    }
    if (outliers.length <= 3) {
      return { kind: 'few-outliers', problemCards: outliers, evidenceTheme: null };
    }
  }

  // Strategy 4: No clear consensus, no clear outlier. The evidence just
  // doesn't cohere — name the conclusion title and note the lack of through-line.
  return { kind: 'no-coherence', problemCards: [], evidenceTheme: null };
}

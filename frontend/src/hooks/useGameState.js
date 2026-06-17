import { useReducer, useCallback, useMemo } from 'react';

import { shuffle } from '../lib/shuffle.js';
import { validateArgument, computePrestige, critiqueArgument } from '../lib/validation.js';

/**
 * useGameState — the central state machine for The Historians.
 *
 * Owns:
 *   - year (1..25)
 *   - archive deck (shuffled remaining archive-type cards)
 *   - conclusion shelf (all conclusion-type cards, always available)
 *   - hand (drawn archive cards in the Research Notebook)
 *   - prestige score
 *   - stats: research, notebook capacity, influence, workspaces
 *
 * IMPORTANT — year-tick rules:
 *   Per design (locked in 2026-04), year advances ONLY on:
 *     - drawing cards (one tick per draw action, regardless of count drawn)
 *     - publishing an argument (success OR failure both tick)
 *   All other actions are FREE (dragging, opening modals, toggling tags).
 *
 * The reducer is the single source of truth for state transitions; callers
 * never mutate state directly.
 */

// ===== Stat tables (from design doc) =====

export const STAT_TABLES = {
  // Research L4 is special — it draws cards equal to the player's CURRENT
  // notebook capacity, not a fixed number. The 'capacity' marker here is
  // a sentinel; derived.drawCount handles it (see useGameState hook).
  research:        [3, 5, 7, 'capacity'],
  // Notebook L4 jumped from 19 to 25 in Phase 10.5 (huge endgame capacity).
  notebookCapacity:[7, 11, 15, 25],
  influence:       [0, 1, 2, 3],         // prestige bonus per publish (L4 is per-CARD)
  // Workspaces tops out at 3 project slots. L1-L3 unlock projects;
  // L4 doesn't unlock another slot (Project 4 was removed in Phase 10.4)
  // but instead removes the year cost from publishing. The slot count
  // value at L4 stays at 3 — the L4 effect lives in the publish reducer.
  workspaces:      [1, 2, 3, 3],
  // Reputation — added in Phase 10.3 — lowers publication-threshold
  // requirements. L1 = baseline (no reduction), each level past that
  // lowers either the article or book minimum:
  //   L1: article ≥ 3, book ≥ 6
  //   L2: article ≥ 2, book ≥ 6      (article reduction)
  //   L3: article ≥ 2, book ≥ 5      (book reduction)
  //   L4: article ≥ 1, book ≥ 3      (one more article -1, two more book)
  // The numeric values in this array are not directly meaningful as
  // tooltips; the StatStrip and chooser dialog read the level and produce
  // descriptive text via reputationThresholds() below.
  reputation:      [0, 1, 2, 3],
  // Renown — at end of game, each player gets bonus prestige equal to
  // citations_received × this multiplier. Citations RECEIVED means
  // other players cited one of your published works. L1 (default) is
  // still a positive payout (each citation = +1 at L1), so renown is
  // always worth something if your work gets cited; L4 turns each
  // citation into +6. See mp_apply_renown_bonuses() server-side.
  renown:          [1, 2, 3, 6],
};

// Helper — derive article/book thresholds from reputation level (1-4).
// Returns { articleMin, bookMin } usable both in validation and classification.
export function reputationThresholds(level) {
  // L1 (default): article ≥ 3, book ≥ 6
  // L2: article ≥ 2
  // L3: book ≥ 5
  // L4: article ≥ 1, book ≥ 3 (book drops two more — was 5 at L3, 4 was
  //                              the prior L4, now 3)
  switch (level) {
    case 1: return { articleMin: 3, bookMin: 6 };
    case 2: return { articleMin: 2, bookMin: 6 };
    case 3: return { articleMin: 2, bookMin: 5 };
    case 4: return { articleMin: 1, bookMin: 3 };
    default: return { articleMin: 3, bookMin: 6 };
  }
}

export const TOTAL_YEARS = 25;

// ===== Initial state factory =====

// Stopwords used by the title-matcher — common English words that don't
// carry topical signal. Kept short; the goal is to keep proper nouns
// (Payamataha, Dunmore, Suffolk) as the matching drivers.
const TITLE_MATCH_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'by', 'from', 'as', 'is', 'was', 'were', 'be', 'been', 'being',
  'are', 'am', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'this', 'that', 'these', 'those', 'his', 'her', 'their',
  'its', 'it', 'they', 'them', 'we', 'us', 'our', 'you', 'your', 'he', 'she',
  'who', 'what', 'where', 'when', 'why', 'how', 'not', 'no', 's', 't', 'll',
  've', 're', 'd', 'm', 'about', 'against', 'between', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'up', 'down', 'over',
  'under', 'than', 'so', 'such', 'only', 'own', 'same', 'too', 'very', 'can',
  'just', 'also', 'while', 'because', 'until', 'if', 'each', 'some', 'all',
  'any', 'most', 'more', 'less', 'many', 'few', 'one', 'two', 'three',
]);

/**
 * Tokenize a string into a Set of significant lower-case words.
 *
 * Strips punctuation, lowercases, drops stopwords and very short tokens.
 * Returns a Set for O(1) intersection checks.
 */
function tokenize(text) {
  if (!text || typeof text !== 'string') return new Set();
  return new Set(
    text
      .toLowerCase()
      .replace(/['']/g, '')           // strip apostrophes so "henry's" → "henrys"
      .replace(/[^a-z0-9\s]/g, ' ')    // punctuation → spaces
      .split(/\s+/)
      .filter((w) => w.length > 2 && !TITLE_MATCH_STOPWORDS.has(w)),
  );
}

/**
 * Score a title by how many of its significant words overlap with the
 * combined words from the argument's evidence (titles + content). Higher
 * is better.
 */
function scoreTitle(title, evidenceWords) {
  const titleWords = tokenize(title);
  let score = 0;
  for (const w of titleWords) {
    if (evidenceWords.has(w)) score++;
  }
  return score;
}

/**
 * Pick a random element from an array. Returns undefined if empty.
 */
function pickRandom(arr) {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Pick a publication title based on word-overlap relevance to the evidence
 * cards in the argument being published.
 *
 * Per design (Phase 10.9):
 *   1. Score every title in the conclusion's pool by word-overlap with the
 *      evidence cards (matching against titles AND content text). Score is
 *      the count of significant words shared between title and evidence.
 *   2. Among UNUSED titles, pick the highest-scoring one. Random tiebreak.
 *   3. If all unused titles score zero AND a USED title scores higher,
 *      revisit that used title with a "Pt. N" suffix (the higher-scoring
 *      topic is more relevant than a zero-overlap unused title).
 *   4. If everything scores zero, fall back to a random unused title.
 *
 * @param conclusion       conclusion card
 * @param kind             'article' | 'book'
 * @param currentUsed      array of strings already used for this conclusion+kind
 * @param evidence         array of evidence cards in the argument (for matching)
 * @returns { title, nextUsed }
 */
function pickPublicationTitle(conclusion, kind, currentUsed, evidence = []) {
  const poolKey = kind === 'book' ? 'book_titles' : 'article_titles';
  const rawPool = conclusion?.[poolKey];

  // Normalize the pool — backend may send it as:
  //   1. Array (rare; depends on backend serialization)
  //   2. JSON-array string: '["a","b","c"]'
  //   3. Pipe-separated string: 'a|b|c'  (easiest for CSV-driven editing)
  //   4. Single title string: 'just one title' (no separators)
  //   5. null / empty
  let pool = [];
  if (Array.isArray(rawPool)) {
    pool = rawPool.filter((t) => typeof t === 'string' && t.trim().length > 0);
  } else if (typeof rawPool === 'string' && rawPool.trim().length > 0) {
    const s = rawPool.trim();

    // Heuristic: if it starts with '[' and ends with ']', try JSON first.
    if (s.startsWith('[') && s.endsWith(']')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          pool = parsed.filter((t) => typeof t === 'string' && t.trim().length > 0);
        }
      } catch {
        // Fall through to pipe-split below
      }
    }

    // Otherwise (or if JSON parsing failed), treat as pipe-separated.
    if (pool.length === 0) {
      pool = s.split('|').map((t) => t.trim()).filter((t) => t.length > 0);
    }
  }

  // Fallback: no titles defined → use conclusion's question text.
  if (pool.length === 0) {
    const fallback = conclusion?.title || `Untitled ${kind}`;
    return { title: fallback, nextUsed: [...currentUsed, fallback] };
  }

  // ===== Score every title against the argument's evidence =====
  // Combine all evidence card titles + content into a single word set.
  const evidenceWords = new Set();
  for (const card of evidence) {
    if (card?.title) {
      for (const w of tokenize(card.title)) evidenceWords.add(w);
    }
    if (card?.content) {
      for (const w of tokenize(card.content)) evidenceWords.add(w);
    }
  }

  // Build scored entries for each title in the pool.
  const scored = pool.map((title) => ({
    title,
    score: scoreTitle(title, evidenceWords),
  }));

  // Sort by score (desc), keeping original order for ties.
  scored.sort((a, b) => b.score - a.score);

  // ===== Pick the title =====
  // First check: is there a top-scoring UNUSED title with score > 0?
  // If so, pick among the unused titles that tie for top score.
  const unusedScored = scored.filter((s) => !currentUsed.includes(s.title));

  if (unusedScored.length > 0 && unusedScored[0].score > 0) {
    // Find all unused titles that match the top unused score and pick one.
    const topScore = unusedScored[0].score;
    const tied = unusedScored.filter((s) => s.score === topScore);
    const chosen = pickRandom(tied).title;
    return { title: chosen, nextUsed: [...currentUsed, chosen] };
  }

  // Otherwise: see if a USED title scores higher than any unused titles.
  // (Means a "Pt. N" revisit is more topically relevant than picking an
  // unused-but-zero title.)
  const usedScored = scored.filter((s) => currentUsed.includes(s.title));
  const bestUsedScore = usedScored.length > 0 ? usedScored[0].score : 0;
  const bestUnusedScore = unusedScored.length > 0 ? unusedScored[0].score : 0;

  if (bestUsedScore > bestUnusedScore && bestUsedScore > 0) {
    // Reuse the best-scoring used title with a Pt. N suffix.
    const tiedUsed = usedScored.filter((s) => s.score === bestUsedScore);
    const baseTitle = pickRandom(tiedUsed).title;

    // Figure out the next available "Pt. N" — look at currentUsed for any
    // entries starting with this baseTitle and find the max suffix number.
    let maxPart = 1;
    for (const used of currentUsed) {
      if (used === baseTitle) continue;  // the base itself counts as 1
      const m = used.match(new RegExp('^' + baseTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ', Pt\\. (\\d+)$'));
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxPart) maxPart = n;
      }
    }
    const cycled = `${baseTitle}, Pt. ${maxPart + 1}`;
    return { title: cycled, nextUsed: [...currentUsed, cycled] };
  }

  // Fallback: all unused titles score zero AND no used title scores higher.
  // Pick a random unused title if any are available.
  if (unusedScored.length > 0) {
    const chosen = pickRandom(unusedScored).title;
    return { title: chosen, nextUsed: [...currentUsed, chosen] };
  }

  // Final fallback: every title in the pool has been used, all score zero.
  // Pick a random title from the pool and add a "Pt. N" suffix.
  let maxPart = 1;
  for (const used of currentUsed) {
    const m = used.match(/, Pt\. (\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxPart) maxPart = n;
    }
  }
  const base = pickRandom(pool);
  const cycled = `${base}, Pt. ${maxPart + 1}`;
  return { title: cycled, nextUsed: [...currentUsed, cycled] };
}


/**
 * Build the initial game state from a list of cards (loaded from API).
 * Splits archive vs conclusion, shuffles archive, sets stats to level 1.
 */
function initialState({ playerName, deck, allCards }) {
  const archiveCards = allCards.filter((c) => c.type === 'archive');
  const conclusionCards = allCards.filter((c) => c.type === 'conclusion');

  return {
    // Setup
    playerName,
    deck,                             // { idDeck, nameDeck, ... }

    // Career
    year: 1,
    prestige: 0,
    stage: 'graduate-student',           // see computeStage() for transitions
    articlesPublished: 0,
    booksPublished: 0,
    compsEventFired: false,              // so the year-3 comps event only fires once

    // Stat levels (1..4)
    statLevels: {
      research: 1,
      notebookCapacity: 1,
      influence: 1,
      workspaces: 1,
      reputation: 1,
    },

    // Cards
    archiveDeck: shuffle(archiveCards),  // shuffled, drawn from the front
    conclusionShelf: conclusionCards,    // all conclusions, always available
    hand: [],                            // archive cards drawn into the notebook
    discard: [],                         // played/discarded archive cards

    // Projects — fixed-length array of 3 slots; only `workspaces` stat
    // determines how many are unlocked. Each project has its own conclusion
    // slot and an evidence array. nullable conclusion = empty slot.
    // (Phase 10.4: Project 4 was removed. Workspaces L4 still exists but
    // now grants free publishing instead of unlocking a 4th project.)
    projects: [
      { id: 0, conclusion: null, evidence: [] },
      { id: 1, conclusion: null, evidence: [] },
      { id: 2, conclusion: null, evidence: [] },
    ],

    // UI / meta
    showTags: false,                     // global tag-visibility toggle
    showSignificance: false,             // global significance-visibility toggle (gated)
    gameOver: null,                      // null | { reason, year }
    lastPublishResult: null,             // null | full result object — shown in result dialog
    lastStageAdvancement: null,          // null | { from, to, year, kind? } — drives advancement banner
    pendingUpgrade: false,               // true when a successful publish has earned an upgrade choice

    // Bookshelf (Phase 10.8) — each successful publication produces a
    // record here. Used by the bookshelf UI and the end-of-game PDF.
    // Shape per entry:
    //   {
    //     id: string,         // unique per publication (year + nonce)
    //     kind: 'article' | 'book',
    //     title: string,      // random selection from the conclusion's title pool
    //                         // (or fallback to conclusion title, or "Pt. N" suffix)
    //     description: string,  // copied from conclusion at publish time
    //     conclusionId: string,
    //     evidence: Array<{ title, content, significance }>,
    //     year: number,       // game year published
    //     prestige: number,   // prestige gained by this publication
    //   }
    publications: [],

    // Tracks which titles have been used per conclusion per kind so we
    // don't repeat. Shape: { [conclusionId]: { article: [...used], book: [...used] } }
    // When a pool is exhausted, we append "Pt. 2", "Pt. 3", etc. to the
    // most-recently-cycled title (handled inside the reducer).
    usedTitles: {},
  };
}

// ===== Reducer =====

function reducer(state, action) {
  switch (action.type) {

    // ---- Card flow ----

    case 'DRAW_CARDS': {
      // Draw N cards from the archive deck where N = research stat.
      // Respects notebook capacity. Year advances by 1 (per design rule).
      // At Research L4 the research-stat value is the sentinel 'capacity',
      // meaning "draw a full notebook's worth" — resolved here.
      //
      // Phase 10.6: when the deck empties mid-draw (or starts empty), the
      // discard pile is shuffled and becomes the new deck — drawing
      // continues from the reshuffled cards. This keeps gameplay flowing
      // through year 25 even with a small base deck.
      if (state.gameOver) return state;

      const capacity = STAT_TABLES.notebookCapacity[state.statLevels.notebookCapacity - 1];
      const researchRaw = STAT_TABLES.research[state.statLevels.research - 1];
      const drawCount = researchRaw === 'capacity' ? capacity : researchRaw;
      const room = capacity - state.hand.length;

      // Cards we WANT to draw, before deck/discard limits.
      const targetDraw = Math.min(drawCount, room);

      if (targetDraw <= 0) {
        // Notebook full or research = 0; still ticks the year.
        return advanceYear(state);
      }

      // Walk the draw with reshuffle support. We track deck and discard
      // as mutable copies, peel cards off the deck, and if it empties
      // before we've drawn enough, we shuffle the discard back into
      // the deck and keep going. Loop terminates when we've drawn
      // enough OR both piles are empty.
      let deck = state.archiveDeck.slice();
      let discard = state.discard.slice();
      const drawn = [];

      while (drawn.length < targetDraw) {
        if (deck.length === 0) {
          if (discard.length === 0) break;  // nothing more to draw, ever
          // Reshuffle discard → new deck. The discard pile becomes the
          // fresh draw stack; existing discard array is emptied.
          deck = shuffle(discard);
          discard = [];
        }
        drawn.push(deck.shift());
      }

      // Year always advances on a Draw action (attempted, that's the action).
      return advanceYear({
        ...state,
        archiveDeck: deck,
        discard,
        hand: [...state.hand, ...drawn],
      });
    }

    // ---- UI ----

    case 'TOGGLE_TAGS': {
      return { ...state, showTags: !state.showTags };
    }

    case 'TOGGLE_SIGNIFICANCE': {
      return { ...state, showSignificance: !state.showSignificance };
    }

    // ---- Card movement (drag-and-drop) ----
    //
    // All movements are FREE — they don't tick the year. Only DRAW_CARDS and
    // PUBLISH_ARGUMENT do. The reducer just relocates cards between zones.
    //
    // Action shape:
    //   { type: 'MOVE_CARD', cardId, from, to }
    //
    //   from / to: { kind: 'hand' }
    //              | { kind: 'projectConclusion', projectId }
    //              | { kind: 'projectEvidence', projectId }
    //              | { kind: 'conclusionShelf' }   (read-only source: cards
    //                                               aren't removed from here)
    //
    // We resolve each move in two steps: REMOVE from `from`, ADD to `to`.
    // The conclusion shelf is special — picking a conclusion from it doesn't
    // remove it (the shelf is a library, not a hand).

    case 'MOVE_CARD': {
      if (state.gameOver) return state;
      const { cardId, from, to } = action;

      // Resolve the actual card being moved by looking it up in `from`
      const card = findCardAt(state, from, cardId);
      if (!card) return state;

      // If source and destination are the same project's same zone, no-op
      // (drop on self) — common when a drag is released on its origin.
      if (
        from.kind === to.kind &&
        from.projectId === to.projectId
      ) {
        return state;
      }

      // Remove from source. Conclusion shelf is the only zone where
      // we DON'T remove (see comment above).
      let next = state;
      if (from.kind !== 'conclusionShelf') {
        next = removeCardFrom(next, from, cardId);
      }

      // Add to destination
      next = addCardTo(next, to, card);

      return next;
    }

    case 'REMOVE_FROM_PROJECT': {
      // Convenience action for removing a card from a project back to the
      // hand. (Same as MOVE_CARD with to='hand', kept for clearer intent.)
      if (state.gameOver) return state;
      const { cardId, from } = action;
      const card = findCardAt(state, from, cardId);
      if (!card) return state;

      let next = removeCardFrom(state, from, cardId);
      // For conclusions, returning means the slot empties — no destination.
      // For evidence, return to the hand.
      if (from.kind === 'projectEvidence') {
        next = addCardTo(next, { kind: 'hand' }, card);
      }
      return next;
    }

    // ---- Publishing ----

    case 'PUBLISH_ARGUMENT': {
      // Player has hit "Submit for Publication" on a project.
      //
      // Flow:
      //   1. Validate the argument
      //   2. On success: compute prestige, add to player's score, discard
      //      conclusion + evidence (cards consumed by publication), empty project.
      //      On failure: critique for the result dialog. Evidence stays in place
      //      so the player can revise. The conclusion "unsticks" — its slot
      //      empties — so the player can try a different thesis with the same
      //      evidence, or re-place the same conclusion after fixing the evidence.
      //      (The conclusion shelf itself is unchanged either way; it's a library.)
      //   3. Year advances by 1 in BOTH cases.
      //   4. lastPublishResult is set so the UI can show the result dialog.

      if (state.gameOver) return state;
      const { projectId } = action;
      const project = state.projects[projectId];
      if (!project) return state;

      const { conclusion, evidence } = project;

      // Compute reputation-derived thresholds first — the validator's
      // minimum-evidence rule depends on the player's articleMin (which
      // drops to 1 at Reputation L2+).
      const { articleMin, bookMin } = reputationThresholds(state.statLevels.reputation || 1);

      // Run validation. We allow the caller to publish even when missing
      // pieces — the result dialog explains the failure.
      const validation = validateArgument(conclusion, evidence, articleMin);

      let prestigeResult = null;
      let critique = null;

      if (validation.ok) {
        // Influence: L1-L3 give a flat per-publish bonus (0/+1/+2). L4 changes
        // semantics — it's "+3 prestige PER CARD in the argument" rather than
        // a single flat add. We scale the bonus by evidence count at L4 so
        // computePrestige still sees a single additive number.
        const flatBonus = STAT_TABLES.influence[state.statLevels.influence - 1];
        const influenceBonus = state.statLevels.influence >= 4
          ? flatBonus * (evidence?.length || 0)
          : flatBonus;
        prestigeResult = computePrestige(evidence, conclusion, influenceBonus);
      } else {
        critique = critiqueArgument(conclusion, evidence);
      }

      // Classify the publication. Article = under bookMin, book = at or
      // above. Reputation lowers bookMin from the L1 default of 6 down
      // to 4 at max (L4). See reputationThresholds() for the table.
      const publicationKind = validation.ok
        ? (evidence.length >= bookMin ? 'book' : 'article')
        : null;

      const result = {
        ok: validation.ok,
        validation,
        prestige: prestigeResult,
        critique,
        kind: publicationKind,                // 'article' | 'book' | null
        conclusion: conclusion ? { id: conclusion.id, title: conclusion.title } : null,
        evidence: evidence.map((c) => ({ id: c.id, title: c.title })),
        projectId,
      };

      // Branch on outcome:
      //   Success → both conclusion and evidence consumed; project empties;
      //             evidence cards go into the discard pile.
      //   Failure → evidence stays in the project; conclusion unsticks
      //             (slot empties); nothing is discarded; player can revise.
      let projects;
      let newDiscard = state.discard;

      if (validation.ok) {
        // Empty the whole project, push evidence to discard
        projects = state.projects.map((p, i) =>
          i === projectId ? { id: p.id, conclusion: null, evidence: [] } : p
        );
        newDiscard = [...state.discard, ...evidence];
      } else {
        // Keep evidence; unstick the conclusion only
        projects = state.projects.map((p, i) =>
          i === projectId ? { ...p, conclusion: null } : p
        );
      }

      // Successful publication earns the player an upgrade choice — UNLESS
      // every stat is already at max level. The UpgradeChooserDialog will
      // show only the upgradable stats; if none, we skip the dialog entirely
      // by leaving pendingUpgrade false.
      const hasUpgradableStat = validation.ok && Object.values(state.statLevels).some((lvl) => lvl < 4);

      // Build a publication record for the bookshelf (Phase 10.8). Only
      // successful publishes go on the shelf — failures vanish without trace
      // (they're already represented by the critique dialog).
      let nextPublications = state.publications;
      let nextUsedTitles = state.usedTitles;
      if (validation.ok && conclusion) {
        const concId = conclusion.id;
        const usedForCard = state.usedTitles[concId] || { article: [], book: [] };
        const usedForKind = publicationKind === 'book' ? usedForCard.book : usedForCard.article;
        const { title: pubTitle, nextUsed } = pickPublicationTitle(
          conclusion,
          publicationKind,
          usedForKind,
          evidence,
        );

        // Snapshot the evidence by title/content/significance/date so the
        // bookshelf entry survives even after the cards return to the
        // discard pile. The date is included so the PDF can sort by it
        // (and the modal can show it for context).
        const evidenceSnapshot = evidence.map((c) => ({
          title: c?.title || '',
          content: c?.content || '',
          significance: c?.significance || '',
          date: c?.date || '',
          citation: c?.citation || '',
        }));

        nextPublications = [
          ...state.publications,
          {
            id: `pub-y${state.year}-${state.publications.length + 1}`,
            kind: publicationKind,
            title: pubTitle,
            // Description comes from the conclusion's `description` column,
            // falling back to `content` if that's empty. This supports a
            // simplified data model where the description for conclusions
            // can be stored in the same `content` column that holds source
            // passages on archive cards.
            description: conclusion?.description || conclusion?.content || '',
            conclusionId: concId,
            conclusionTitle: conclusion?.title || '',
            evidence: evidenceSnapshot,
            year: state.year,
            prestige: prestigeResult?.total || 0,
          },
        ];

        // Merge the new used list back into usedTitles for this conclusion+kind.
        nextUsedTitles = {
          ...state.usedTitles,
          [concId]: {
            article: publicationKind === 'article' ? nextUsed : usedForCard.article,
            book:    publicationKind === 'book'    ? nextUsed : usedForCard.book,
          },
        };
      }

      let next = {
        ...state,
        projects,
        discard: newDiscard,
        prestige: state.prestige + (prestigeResult?.total || 0),
        // Track articles and books separately. Per design, the stage gates
        // care about books specifically (tenure requires a book), but
        // articles count for graduate-student advancement.
        articlesPublished:
          validation.ok && publicationKind === 'article'
            ? state.articlesPublished + 1
            : state.articlesPublished,
        booksPublished:
          validation.ok && publicationKind === 'book'
            ? state.booksPublished + 1
            : state.booksPublished,
        lastPublishResult: result,
        pendingUpgrade: hasUpgradableStat,
        publications: nextPublications,
        usedTitles: nextUsedTitles,
      };

      // After publishing, the state may have crossed stage thresholds —
      // advanceYear handles that gate logic and may also set gameOver.
      //
      // Phase 10.4: Workspaces L4 grants "free publishing" — submitting for
      // review no longer costs a year (success or failure). We skip the
      // advanceYear call in that case, but we still must check stage gates
      // since publishing can change publishable counts that affect career
      // stage. For now we simply return the state without year-advance —
      // stage checks fire the next time the player draws (which still
      // costs a year). This matches the design goal: drawing is the
      // remaining year-cost activity at this level.
      const freePublishing = state.statLevels.workspaces >= 4;
      return freePublishing ? next : advanceYear(next);
    }

    case 'DISMISS_PUBLISH_RESULT': {
      return { ...state, lastPublishResult: null };
    }

    case 'DISMISS_STAGE_ADVANCEMENT': {
      return { ...state, lastStageAdvancement: null };
    }

    // ---- Stat upgrades ----

    case 'UPGRADE_STAT': {
      // Player has chosen which stat to upgrade after a successful publication.
      // Increment that stat by one level (capped at 4) and clear pendingUpgrade.
      // The player's notebook capacity / draw count / influence bonus / workspace
      // count update immediately — the UI re-renders with the new derived values.
      const { stat } = action;
      const currentLevel = state.statLevels[stat];
      if (typeof currentLevel !== 'number' || currentLevel >= 4) {
        // Defensive: don't upgrade an already-maxed stat or an unknown stat
        return { ...state, pendingUpgrade: false };
      }

      return {
        ...state,
        statLevels: {
          ...state.statLevels,
          [stat]: currentLevel + 1,
        },
        pendingUpgrade: false,
      };
    }

    // ---- Reset / setup ----

    case 'RESET': {
      // The Game.jsx wrapper handles the routing; this just clears state.
      // Returning the initial state restarts everything.
      return initialState(action.payload);
    }

    default:
      // Unknown action — ignore. In a richer setup we'd warn.
      return state;
  }
}

/**
 * Helper: advance the year by 1 and check for game-over conditions
 * AND career-stage advancement.
 *
 * Centralized so all year-ticking actions go through the same gate.
 * The order of checks matters:
 *   1. Bump the year counter.
 *   2. Check for game-over by stage failure (failed comps at year 5,
 *      tenure denied at year 12). These are HARD failures — game ends.
 *   3. Check for stage advancement (positive transitions): the comps
 *      event at year 3, ABD → Assistant at year 6 (after passing year 5),
 *      and post-tenure book-count advancements (Associate → Full → Endowed).
 *   4. Check for retirement at year 25.
 *
 * Stage state is derived from year + publication counts. We compute the
 * appropriate stage label and write it into state, plus set
 * `lastStageAdvancement` if it changed (so the UI can fire a banner).
 */
function advanceYear(state) {
  const nextYear = state.year + 1;
  const previousStage = state.stage;
  let next = { ...state, year: nextYear };

  // ----- HARD GATE: Year 5 — must have published at least one (article or book) -----
  // Per design: "Year 5 failure = Game Over"
  // We check this when ENDING year 5, i.e. when nextYear becomes 6.
  if (nextYear === 6 && state.articlesPublished === 0 && state.booksPublished === 0) {
    return {
      ...next,
      stage: 'failed-comps',
      gameOver: { reason: 'failed-comps', year: 5 },
    };
  }

  // ----- HARD GATE: Year 12 — Assistant Professor must have published a book -----
  // Per design: "Must publish 1 book by year 12. Failure = Game Over."
  // We check this when ENDING year 12, i.e. when nextYear becomes 13.
  if (nextYear === 13 && state.booksPublished === 0) {
    return {
      ...next,
      stage: 'tenure-denied',
      gameOver: { reason: 'tenure-denied', year: 12 },
    };
  }

  // ----- END OF GAME: Year 25 — retirement -----
  if (nextYear > TOTAL_YEARS) {
    return {
      ...next,
      year: TOTAL_YEARS,
      stage: 'retired',
      gameOver: { reason: 'retired', year: TOTAL_YEARS },
    };
  }

  // ----- STAGE PROGRESSION: positive advancements -----
  // Compute what stage the player SHOULD be in given current state, then
  // check if it differs from previous so we can fire an advancement banner.
  const computedStage = computeStage(nextYear, state.booksPublished);
  if (computedStage !== previousStage) {
    next.stage = computedStage;
    next.lastStageAdvancement = {
      from: previousStage,
      to: computedStage,
      year: nextYear,
    };
  }

  // ----- COMPS EVENT: at start of year 3, fire a one-time celebratory banner -----
  // The design calls this "Year 2: Dialogue praising comps → ABD"; in our
  // implementation, the player advances to ABD when nextYear becomes 3
  // (i.e., they've completed years 1 and 2 of coursework).
  if (nextYear === 3 && !state.compsEventFired) {
    next.compsEventFired = true;
    next.lastStageAdvancement = {
      from: previousStage,
      to: 'abd',
      year: nextYear,
      kind: 'comps',  // tells UI to use celebratory copy specific to comps
    };
    next.stage = 'abd';
  }

  return next;
}

/**
 * Pure function: given current year and book count, what stage SHOULD
 * the player be in (assuming they're still in the game)?
 *
 * Stages are mostly year-driven up through year 12, then book-count-driven
 * post-tenure. Comps advancement (graduate-student → ABD at year 3) is
 * handled separately because it's a one-time event.
 */
function computeStage(year, booksPublished) {
  // Years 1–2: graduate student (years 3+ are ABD, but only after comps
  // event fires; computeStage assumes comps has fired at year 3)
  if (year <= 2) return 'graduate-student';
  if (year <= 5) return 'abd';

  // Year 6 onward — assistant professor until tenure check at year 12.
  // (At year 13 we either advance to associate professor or game-over.)
  if (year <= 12) return 'assistant-professor';

  // Post-tenure: book count drives advancement
  // 1 book published (the tenure book) = Associate
  // 1 + 2 = 3 books = Full
  // 3 + 2 = 5 books = Endowed
  if (booksPublished >= 5) return 'endowed-professor';
  if (booksPublished >= 3) return 'full-professor';
  return 'associate-professor';
}

// ===== Card-movement helpers =====
//
// These resolve a "location descriptor" — { kind, projectId? } — to either
// retrieve a card, or return new state with the card added/removed at that
// location. They live outside the reducer for testability and to keep
// reducer cases readable.

/**
 * Find a card at a given location. Returns the card object or null.
 */
function findCardAt(state, loc, cardId) {
  switch (loc.kind) {
    case 'hand':
      return state.hand.find((c) => c.id === cardId) || null;
    case 'conclusionShelf':
      return state.conclusionShelf.find((c) => c.id === cardId) || null;
    case 'projectConclusion':
      return state.projects[loc.projectId]?.conclusion?.id === cardId
        ? state.projects[loc.projectId].conclusion
        : null;
    case 'projectEvidence':
      return state.projects[loc.projectId]?.evidence.find((c) => c.id === cardId) || null;
    default:
      return null;
  }
}

/**
 * Return a new state with the card removed from the given location.
 * No-op if the card isn't there.
 */
function removeCardFrom(state, loc, cardId) {
  switch (loc.kind) {
    case 'hand':
      return { ...state, hand: state.hand.filter((c) => c.id !== cardId) };

    case 'projectConclusion':
      return {
        ...state,
        projects: state.projects.map((p, i) =>
          i === loc.projectId ? { ...p, conclusion: null } : p
        ),
      };

    case 'projectEvidence':
      return {
        ...state,
        projects: state.projects.map((p, i) =>
          i === loc.projectId
            ? { ...p, evidence: p.evidence.filter((c) => c.id !== cardId) }
            : p
        ),
      };

    case 'conclusionShelf':
      // The shelf is a library — we never remove from it. Returning state
      // unchanged so MOVE_CARD's "remove then add" pattern is uniform.
      return state;

    default:
      return state;
  }
}

/**
 * Return a new state with the card added at the given location.
 * For conclusion slots: replaces whatever was there (the previous conclusion
 * is just dropped — UI should warn before overwriting if desired).
 */
function addCardTo(state, loc, card) {
  switch (loc.kind) {
    case 'hand':
      // Conclusions don't go in the hand. If a conclusion is dragged onto
      // the notebook, treat it as removal-only (reducer dropped it from
      // its previous slot, but we don't add it here). It's still available
      // on the conclusion shelf because the shelf is a read-only library.
      if (card.type === 'conclusion') return state;
      // Don't double-add if it's already in the hand (defensive)
      if (state.hand.find((c) => c.id === card.id)) return state;
      return { ...state, hand: [...state.hand, card] };

    case 'projectConclusion':
      return {
        ...state,
        projects: state.projects.map((p, i) =>
          i === loc.projectId ? { ...p, conclusion: card } : p
        ),
      };

    case 'projectEvidence':
      // Conversely, conclusions shouldn't go in evidence slots — those are
      // only for archive cards. Phase 5's publish gate would reject this
      // anyway, but block at placement time for cleaner UX.
      if (card.type === 'conclusion') return state;
      return {
        ...state,
        projects: state.projects.map((p, i) => {
          if (i !== loc.projectId) return p;
          if (p.evidence.find((c) => c.id === card.id)) return p;
          return { ...p, evidence: [...p.evidence, card] };
        }),
      };

    case 'conclusionShelf':
      // The shelf is read-only — we never add to it from gameplay.
      // Conclusions return to availability by simply being un-placed
      // (their slot empties; the shelf never lost them in the first place).
      return state;

    default:
      return state;
  }
}

// ===== Hook =====

/**
 * useGameState — instantiate the game state machine.
 *
 * @param {{ playerName, deck, allCards }} setup
 * @returns {{
 *   state,
 *   drawCards: () => void,
 *   toggleTags: () => void,
 *   reset: (newSetup) => void,
 *   derived: { drawCount, capacity, workspaces, influenceBonus, deckRemaining }
 * }}
 */
export function useGameState(setup) {
  const [state, dispatch] = useReducer(
    reducer,
    setup,
    initialState,
  );

  // Bound action creators — stable references via useCallback so memoized
  // children don't re-render unnecessarily.
  const drawCards = useCallback(() => dispatch({ type: 'DRAW_CARDS' }), []);
  const toggleTags = useCallback(() => dispatch({ type: 'TOGGLE_TAGS' }), []);
  const toggleSignificance = useCallback(() => dispatch({ type: 'TOGGLE_SIGNIFICANCE' }), []);
  const reset = useCallback(
    (newSetup) => dispatch({ type: 'RESET', payload: newSetup }),
    []
  );
  const moveCard = useCallback(
    (cardId, from, to) => dispatch({ type: 'MOVE_CARD', cardId, from, to }),
    []
  );
  const removeFromProject = useCallback(
    (cardId, from) => dispatch({ type: 'REMOVE_FROM_PROJECT', cardId, from }),
    []
  );
  const publishArgument = useCallback(
    (projectId) => dispatch({ type: 'PUBLISH_ARGUMENT', projectId }),
    []
  );
  const dismissPublishResult = useCallback(
    () => dispatch({ type: 'DISMISS_PUBLISH_RESULT' }),
    []
  );
  const dismissStageAdvancement = useCallback(
    () => dispatch({ type: 'DISMISS_STAGE_ADVANCEMENT' }),
    []
  );
  const upgradeStat = useCallback(
    (stat) => dispatch({ type: 'UPGRADE_STAT', stat }),
    []
  );

  // Derived values — convenient for UI without re-reading the lookup tables
  const derived = useMemo(() => {
    const { articleMin, bookMin } = reputationThresholds(state.statLevels.reputation || 1);
    const capacity = STAT_TABLES.notebookCapacity[state.statLevels.notebookCapacity - 1];
    // Research L4 special-case: instead of a fixed number, draw a full
    // notebook's worth. The STAT_TABLES.research[3] entry is a sentinel
    // ('capacity') used elsewhere for display; the actual numeric draw
    // count at L4 is the player's current notebook capacity.
    const researchRaw = STAT_TABLES.research[state.statLevels.research - 1];
    const drawCount = researchRaw === 'capacity' ? capacity : researchRaw;
    return {
      drawCount,
      capacity,
      workspaces: STAT_TABLES.workspaces[state.statLevels.workspaces - 1],
      influenceBonus: STAT_TABLES.influence[state.statLevels.influence - 1],
      articleMin,
      bookMin,
      // Legacy alias kept for backward compatibility — book threshold
      // used to be called bookThreshold during Phase 10.2; keep both
      // names working so any code reading either still functions.
      bookThreshold: bookMin,
      deckRemaining: state.archiveDeck.length,
      handFull: state.hand.length >= capacity,
    };
  }, [state.statLevels, state.archiveDeck.length, state.hand.length]);

  return {
    state,
    drawCards,
    toggleTags,
    toggleSignificance,
    moveCard,
    removeFromProject,
    publishArgument,
    dismissPublishResult,
    dismissStageAdvancement,
    upgradeStat,
    reset,
    derived,
  };
}

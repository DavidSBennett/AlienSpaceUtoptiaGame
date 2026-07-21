import { useReducer, useCallback, useMemo } from 'react';

import { shuffle, shuffleWith } from '../lib/shuffle.js';
import { hashSeed, nextInt } from '../lib/seededRng.js';
import { validateArgument, computePrestige, critiqueArgument } from '../lib/validation.js';
import { bonusAt } from '../lib/cardBonus.js';
import { computeStage, isPromotion } from '../lib/career.js';
import { cardIdentifier } from '../lib/cardIdentifier.js';

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
  // Matches multiplayer (mp_resolveYear.php's $notebookCapTable). Solo used to
  // run 7/11/15/25 — a far larger endgame hand than a multiplayer player ever
  // sees, which made the two versions of the same stat mean different things.
  notebookCapacity:[7, 9, 11, 15],
  // Per-CARD prestige bonus, at every level — same table and same semantics as
  // multiplayer ($infTable × evidence count in mp_apply_approval). Solo used to
  // add this flat per publish until L4, so an upgrade bought something
  // different depending on which version you were playing.
  influence:       [0, 1, 2, 4],
  // Workspaces tops out at 3 project slots. L1-L3 unlock projects;
  // L4 doesn't unlock another slot (Project 4 was removed in Phase 10.4)
  // but instead removes the year cost from publishing. The slot count
  // value at L4 stays at 3 — the L4 effect lives in the publish reducer.
  workspaces:      [1, 2, 3, 3],
  // Reputation — now drives the "Attend a Conference" action (it no longer
  // lowers publication thresholds; those are fixed, see PUBLISH_THRESHOLDS).
  // The value is the number of CITATION TOKENS a conference grants you at
  // that level (1/2/3/6). Reputation also controls the conference's pool
  // size via CONFERENCE_FRESH below. Mirrors the multiplayer reputation.
  reputation:      [1, 2, 3, 6],
  // Renown — at end of game, you gain bonus prestige equal to your banked
  // citation tokens × this multiplier (×1/2/3/5). In solo, citations come
  // from attending conferences. Mirrors mp_apply_renown_bonuses() server-side.
  renown:          [1, 2, 3, 5],
};

// Fixed publication thresholds. Reputation used to lower these; it now powers
// conferences instead, so the article/book split is a constant (mirrors the
// multiplayer MP_ARTICLE_MIN / MP_BOOK_MIN).
export const PUBLISH_THRESHOLDS = { articleMin: 2, bookMin: 6 };

// Conference fresh-card pool bonus by reputation level (1-4): the pool you
// draft from is (cards you staged) + this many extra fresh cards.
export const CONFERENCE_FRESH = [1, 2, 3, 4];

/**
 * How many archive piles a normal game splits the deck into. The guided
 * walkthrough always uses a SINGLE pile so its scripted draw order is
 * unchanged (and the board still shows one deck there).
 */
export const ARCHIVE_PILE_COUNT = 4;

/** Total cards left across every archive pile. */
export function totalInPiles(piles) {
  return (piles || []).reduce((n, p) => n + p.length, 0);
}

/** Deal cards round-robin into `count` piles, so they stay even (±1). */
function dealIntoPiles(cards, count) {
  const piles = Array.from({ length: Math.max(1, count) }, () => []);
  (cards || []).forEach((card, i) => piles[i % piles.length].push(card));
  return piles;
}

/** Citation tokens a conference grants, by reputation level (1-4). */
export function conferenceCitations(level) {
  return STAT_TABLES.reputation[Math.max(0, Math.min(3, (level || 1) - 1))];
}

/** Extra fresh cards a conference adds to the pool, by reputation level. */
export function conferenceFresh(level) {
  return CONFERENCE_FRESH[Math.max(0, Math.min(3, (level || 1) - 1))];
}

/** Renown multiplier (×1/2/3/5) applied to banked citations at game end. */
export function renownMultiplier(level) {
  return STAT_TABLES.renown[Math.max(0, Math.min(3, (level || 1) - 1))];
}

export const TOTAL_YEARS = 15;

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
function initialState({ playerName, deck, allCards, totalYears, tutorial, seed }) {
  const archiveCards = allCards.filter((c) => cardIdentifier(c) === 'archive');
  const conclusionCards = allCards.filter((c) => cardIdentifier(c) === 'conclusion');

  // Seed mode: a non-empty seed makes the whole game reproducible. rngState is
  // the running mulberry32 state, threaded through every shuffle/pick below.
  // Null rngState = a normal game on Math.random (unchanged for real players).
  const hasSeed = seed !== undefined && seed !== null && String(seed).trim() !== '';
  let rngState = hasSeed ? hashSeed(String(seed).trim()) : null;

  // Deal a small starting hand. Each historian begins grad school with a few
  // evidence cards already in their Research Notebook to represent the
  // interests that brought them to the field. They come off the top of the
  // freshly shuffled archive (no year tick — this is the game's setup).
  const STARTING_HAND_SIZE = 3;
  // The walkthrough deals in deck order (economic sources first) so its early
  // steps are predictable; a normal game shuffles.
  let shuffledArchive;
  if (tutorial) {
    shuffledArchive = archiveCards.slice();
  } else if (rngState != null) {
    [shuffledArchive, rngState] = shuffleWith(archiveCards, rngState);
  } else {
    shuffledArchive = shuffle(archiveCards);
  }
  const startingHand = shuffledArchive.slice(0, STARTING_HAND_SIZE);
  const remainingArchive = shuffledArchive.slice(STARTING_HAND_SIZE);

  return {
    // Setup
    playerName,
    deck,                             // { idDeck, nameDeck, ... }
    // Career length in years. Chosen on the home screen (Short 8 / Medium 12
    // / Long 15); falls back to the full career if unset.
    totalYears: Number(totalYears) > 0 ? Number(totalYears) : TOTAL_YEARS,
    // Tutorial mode — suppresses the regular upgrade drip so the only upgrade
    // is the promotion one (keeps the guided script predictable).
    tutorial: !!tutorial,

    // Seed mode (reproducible games). `seed` is the admin-entered value; `rngState`
    // is the running PRNG state threaded through every shuffle/pick. Both null in
    // a normal game.
    seed: hasSeed ? String(seed).trim() : null,
    rngState,

    // Career
    year: 1,
    prestige: 0,
    stage: 'visiting-assistant-professor',   // see computeStage() in lib/career.js
    articlesPublished: 0,
    booksPublished: 0,

    // Stat levels (1..4)
    statLevels: {
      research: 1,
      notebookCapacity: 1,
      influence: 1,
      workspaces: 1,
      reputation: 1,
      renown: 1,
    },

    // Banked citation tokens (from attending conferences). At game end each
    // is worth renownMultiplier(renown) prestige.
    citations: 0,

    // Active conference draft session (null when not at a conference). Shape:
    //   { projectId, pool: [cards], keepLimit: int, citationGrant: int }
    conference: null,

    // Cards
    // The archive is split into several piles whose top cards sit face-up —
    // a market you pick specific cards from. The walkthrough keeps ONE pile and
    // the old batch-draw, so its scripted order is untouched.
    archivePiles: dealIntoPiles(remainingArchive, tutorial ? 1 : ARCHIVE_PILE_COUNT),

    // An in-progress draw: { remaining } picks left this turn. null when not
    // drawing. The year advances when the draw ends (allowance spent, notebook
    // full, archive empty, or the player stops early).
    drawSession: null,
    conclusionShelf: conclusionCards,    // all conclusions, always available
    hand: startingHand,                  // archive cards in the notebook (seeded with a starting hand)
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
    lastStageAdvancement: null,          // null | { from, to, year } — drives the narrative modal on a promotion
    // Upgrades you've earned but not yet spent. Count + a parallel FIFO queue
    // of reasons ('promotion' | 'biennial') so the chooser can explain each.
    pendingUpgrades: 0,
    pendingUpgradeReasons: [],

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

      // Walk the draw with reshuffle support. Cards come off the pile the
      // player clicked; if that pile empties mid-draw we fall through to the
      // other piles, and when every pile is empty the discard is shuffled and
      // dealt back across them. Loop ends when we've drawn enough OR
      // everything is exhausted.
      const pileIndex = Number.isInteger(action.pileIndex) ? action.pileIndex : 0;
      let piles = state.archivePiles.map((p) => p.slice());
      let discard = state.discard.slice();
      let rngState = state.rngState;
      const drawn = [];

      // Prefer the clicked pile, then any pile with cards left.
      const takeCard = () => {
        if (piles[pileIndex] && piles[pileIndex].length > 0) return piles[pileIndex].shift();
        const i = piles.findIndex((p) => p.length > 0);
        return i >= 0 ? piles[i].shift() : null;
      };

      while (drawn.length < targetDraw) {
        let card = takeCard();
        if (!card) {
          if (discard.length === 0) break;  // nothing more to draw, ever
          let reshuffled;
          if (rngState == null) {
            reshuffled = shuffle(discard);
          } else {
            [reshuffled, rngState] = shuffleWith(discard, rngState);
          }
          piles = dealIntoPiles(reshuffled, piles.length);
          discard = [];
          card = takeCard();
          if (!card) break;
        }
        drawn.push(card);
      }

      // Year always advances on a Draw action (attempted, that's the action).
      return advanceYear({
        ...state,
        archivePiles: piles,
        discard,
        hand: [...state.hand, ...drawn],
        rngState,
      });
    }

    // ---- Market draw (multi-pile archive) ----
    //
    // The four piles show their top card face-up. Taking one puts it straight
    // in the notebook and flips the next card of that pile up in its place.
    // The first pick opens a draw session worth `research` cards; the year
    // advances when the session ends.
    case 'TAKE_ARCHIVE_CARD': {
      if (state.gameOver) return state;
      const { pileIndex } = action;
      const current = state.archivePiles || [];
      if (!current[pileIndex] || current[pileIndex].length === 0) return state;

      const capacity = STAT_TABLES.notebookCapacity[state.statLevels.notebookCapacity - 1];
      if (state.hand.length >= capacity) return state;   // notebook full

      const researchRaw = STAT_TABLES.research[state.statLevels.research - 1];
      const drawCount = researchRaw === 'capacity' ? capacity : researchRaw;
      const allowance = state.drawSession ? state.drawSession.remaining : drawCount;
      if (allowance <= 0) return state;

      let piles = current.map((p) => p.slice());
      let discard = state.discard.slice();
      let rngState = state.rngState;

      const hand = [...state.hand, piles[pileIndex].shift()];
      const remaining = allowance - 1;

      // Once every pile is spent, reshuffle the discard back across them so the
      // market refills mid-draw.
      if (totalInPiles(piles) === 0 && discard.length > 0) {
        let reshuffled;
        if (rngState == null) {
          reshuffled = shuffle(discard);
        } else {
          [reshuffled, rngState] = shuffleWith(discard, rngState);
        }
        piles = dealIntoPiles(reshuffled, piles.length);
        discard = [];
      }

      const done = remaining <= 0
        || hand.length >= capacity
        || totalInPiles(piles) === 0;

      const next = {
        ...state,
        archivePiles: piles,
        discard,
        hand,
        rngState,
        drawSession: done ? null : { remaining },
      };
      return done ? advanceYear(next) : next;
    }

    // Stop drawing early — spend the year with whatever you've taken.
    case 'END_DRAW': {
      if (!state.drawSession) return state;
      return advanceYear({ ...state, drawSession: null });
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

    case 'REORDER_HAND': {
      // Move a hand card to sit just before another hand card (drag-to-reorder
      // within the Research Notebook). Free action — no year tick.
      if (state.gameOver) return state;
      const { cardId, beforeCardId } = action;
      if (cardId === beforeCardId) return state;

      const hand = state.hand.slice();
      const fromIdx = hand.findIndex((c) => c.id === cardId);
      if (fromIdx === -1) return state;
      const [moved] = hand.splice(fromIdx, 1);

      // Find the target's position AFTER removal so the index is correct.
      let toIdx = hand.findIndex((c) => c.id === beforeCardId);
      if (toIdx === -1) toIdx = hand.length;   // target gone → append
      hand.splice(toIdx, 0, moved);

      return { ...state, hand };
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

      // Fixed publication thresholds (reputation now powers conferences, not
      // these). articleMin gates publishing at all; bookMin splits article/book.
      const { articleMin, bookMin } = PUBLISH_THRESHOLDS;

      // Run validation. We allow the caller to publish even when missing
      // pieces — the result dialog explains the failure.
      const validation = validateArgument(conclusion, evidence, articleMin);

      let prestigeResult = null;
      let critique = null;

      if (validation.ok) {
        // Influence is a PER-CARD bonus at every level, matching multiplayer
        // (mp_apply_approval multiplies its table by the evidence count). It
        // used to be flat here until L4, which meant the same upgrade bought
        // something different in solo than it did at a table. Scaled by
        // evidence count so computePrestige still sees one additive number.
        const perCard = STAT_TABLES.influence[state.statLevels.influence - 1];
        const influenceBonus = perCard * (evidence?.length || 0);
        prestigeResult = computePrestige(evidence, conclusion, influenceBonus);
      } else {
        critique = critiqueArgument(conclusion, evidence);
      }

      // Classify the publication. Article = under bookMin, book = at or
      // above (fixed thresholds — see PUBLISH_THRESHOLDS).
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
        // Full cards (with tags) so the result dialog can fan them out and show
        // which evidence supported the conclusion and which didn't.
        conclusionCard: conclusion || null,
        evidenceCards: evidence,
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
        // Track articles and books separately. Articles get you hired; books
        // drive the professor ranks (see lib/career.js computeStage).
        articlesPublished:
          validation.ok && publicationKind === 'article'
            ? state.articlesPublished + 1
            : state.articlesPublished,
        booksPublished:
          validation.ok && publicationKind === 'book'
            ? state.booksPublished + 1
            : state.booksPublished,
        lastPublishResult: result,
        publications: nextPublications,
        usedTitles: nextUsedTitles,
      };

      // Upgrades are earned per-publication: a successful publish grants one
      // stat upgrade. (Promotions and the old every-third-year drip no longer
      // grant upgrades — see advanceYear / applyStageProgression.)
      if (validation.ok) {
        next = grantUpgrade(next, 'publish');
      }

      // Phase 10.4: Workspaces L4 grants "free publishing" — submitting no
      // longer costs a year. We skip advanceYear in that case, but a book
      // can still trigger a promotion, so we apply stage progression directly.
      const freePublishing = state.statLevels.workspaces >= 4;
      return freePublishing ? applyStageProgression(next, state.stage) : advanceYear(next);
    }

    case 'DISMISS_PUBLISH_RESULT': {
      return { ...state, lastPublishResult: null };
    }

    // ---- Conferences ----
    //
    // "Attend a Conference" mirrors the multiplayer SOLO-attendee branch: the
    // evidence you stage in a project is sent to the conference (discarded),
    // and in exchange you draft from a fresh pool of (staged + reputation
    // bonus) cards, keeping up to as many as you staged. You also bank
    // citation tokens by your reputation level. Resolving the draft costs the
    // year (like a draw or publish).

    case 'ATTEND_CONFERENCE': {
      if (state.gameOver) return state;
      if (state.conference) return state;          // already at one
      const { projectId } = action;
      const project = state.projects[projectId];
      if (!project) return state;

      const staged = project.evidence;
      if (!staged || staged.length === 0) return state;  // need ≥1 staged card

      const rep = state.statLevels.reputation || 1;
      const keepLimit = staged.length;
      const poolSize = keepLimit + conferenceFresh(rep);

      // Empty the project's evidence (its conclusion, if any, stays put).
      const projects = state.projects.map((p, i) =>
        i === projectId ? { ...p, evidence: [] } : p
      );

      // Draw the fresh pool from the archive, taking from whichever pile has
      // cards and reshuffling the discard back across them if they all run dry
      // (same walk as DRAW_CARDS).
      let piles = state.archivePiles.map((p) => p.slice());
      let discard = state.discard.slice();
      let rngState = state.rngState;
      const pool = [];

      const takeCard = () => {
        const i = piles.findIndex((p) => p.length > 0);
        return i >= 0 ? piles[i].shift() : null;
      };

      while (pool.length < poolSize) {
        let card = takeCard();
        if (!card) {
          if (discard.length === 0) break;
          let reshuffled;
          if (rngState == null) {
            reshuffled = shuffle(discard);
          } else {
            [reshuffled, rngState] = shuffleWith(discard, rngState);
          }
          piles = dealIntoPiles(reshuffled, piles.length);
          discard = [];
          card = takeCard();
          if (!card) break;
        }
        pool.push(card);
      }

      // Send the staged cards to the conference (discarded) AFTER drawing the
      // pool, so they can never be reshuffled into the pool you draft from.
      discard = [...discard, ...staged];

      return {
        ...state,
        projects,
        archivePiles: piles,
        discard,
        rngState,
        conference: {
          projectId,
          pool,
          keepLimit,
          citationGrant: conferenceCitations(rep),
        },
      };
    }

    case 'CONFERENCE_KEEP': {
      // Resolve the draft: take the chosen cards into the hand, return the
      // rest to the discard, bank the citation tokens, and advance the year.
      if (!state.conference) return state;
      const { keepIds } = action;
      const { pool, keepLimit, citationGrant } = state.conference;

      const capacity = STAT_TABLES.notebookCapacity[state.statLevels.notebookCapacity - 1];
      const room = Math.max(0, capacity - state.hand.length);
      const maxKeep = Math.min(keepLimit, room);

      const wanted = new Set(keepIds || []);
      const kept = pool.filter((c) => wanted.has(c.id)).slice(0, maxKeep);
      const keptIds = new Set(kept.map((c) => c.id));
      const returned = pool.filter((c) => !keptIds.has(c.id));

      // Conference publication: award one random leftover (un-kept) pool card
      // as a single-evidence "conference paper" on the bookshelf. Presenting is
      // publishing, so the paper pays out the card's own bonus prestige.
      let rngState = state.rngState;
      let publications = state.publications;
      let conferencePrestige = 0;
      if (returned.length > 0) {
        let paper;
        if (rngState == null) {
          paper = pickRandom(returned);
        } else {
          let idx;
          [idx, rngState] = nextInt(rngState, returned.length);
          paper = returned[idx];
        }
        conferencePrestige = bonusAt(paper?.bonus, 0);
        publications = [
          ...state.publications,
          {
            id: `conf-y${state.year}-${state.publications.length + 1}`,
            kind: 'conference',
            title: paper?.title || 'Conference paper',
            description: 'A paper presented at a conference.',
            conclusionId: null,
            conclusionTitle: '',
            evidence: [{
              title: paper?.title || '',
              content: paper?.content || '',
              significance: paper?.significance || '',
              date: paper?.date || '',
              citation: paper?.citation || '',
            }],
            year: state.year,
            prestige: conferencePrestige,
          },
        ];
      }

      let next = {
        ...state,
        hand: [...state.hand, ...kept],
        discard: [...state.discard, ...returned],
        citations: (state.citations || 0) + (citationGrant || 0),
        // The paper's bonus is banked now, not at scoring time, so the running
        // prestige total on the board reflects it immediately.
        prestige: state.prestige + conferencePrestige,
        conference: null,
        publications,
        rngState,
      };

      // Attending a conference grants a stat upgrade. Skip in the guided
      // walkthrough so the upgrade chooser doesn't interrupt the scripted flow.
      if (!state.tutorial) {
        next = grantUpgrade(next, 'conference');
      }

      return advanceYear(next);
    }

    case 'DISMISS_STAGE_ADVANCEMENT': {
      return { ...state, lastStageAdvancement: null };
    }

    // ---- Stat upgrades ----

    case 'UPGRADE_STAT': {
      // Player has chosen which stat to raise with one pending upgrade.
      // Increment that stat by one level (capped at 4) and consume one pending
      // upgrade from the queue (count + its reason).
      const { stat } = action;
      const currentLevel = state.statLevels[stat];
      const remaining = Math.max(0, (state.pendingUpgrades || 0) - 1);
      const reasons = (state.pendingUpgradeReasons || []).slice(1);

      if (typeof currentLevel !== 'number' || currentLevel >= 4) {
        // Defensive: don't upgrade an already-maxed/unknown stat, but still
        // consume the pending upgrade so the dialog closes.
        return { ...state, pendingUpgrades: remaining, pendingUpgradeReasons: reasons };
      }

      return {
        ...state,
        statLevels: {
          ...state.statLevels,
          [stat]: currentLevel + 1,
        },
        pendingUpgrades: remaining,
        pendingUpgradeReasons: reasons,
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
 * Grant one pending upgrade with a reason ('promotion' | 'biennial'), unless
 * every stat is already maxed (then there's nothing to spend it on).
 */
function grantUpgrade(state, reason) {
  const hasUpgradable = Object.values(state.statLevels).some((lvl) => lvl < 4);
  if (!hasUpgradable) return state;
  return {
    ...state,
    pendingUpgrades: (state.pendingUpgrades || 0) + 1,
    pendingUpgradeReasons: [...(state.pendingUpgradeReasons || []), reason],
  };
}

/**
 * Recompute the player's career stage from their publications. On a promotion
 * (stages only ever rise), record it for the narrative modal and grant a bonus
 * upgrade. Returns the (possibly updated) state.
 */
function applyStageProgression(state, previousStage) {
  const newStage = computeStage(state.articlesPublished, state.booksPublished);
  if (newStage === previousStage) return state;

  let next = { ...state, stage: newStage };
  if (isPromotion(previousStage, newStage)) {
    // Record the promotion for the narrative modal. Promotions no longer grant
    // a bonus upgrade — upgrades come only from publishing and conferences.
    next.lastStageAdvancement = { from: previousStage, to: newStage, year: next.year };
  }
  return next;
}

/**
 * Helper: advance the year by 1, then apply career deadlines, retirement,
 * promotions, and the regular every-other-year upgrade.
 *
 * Deadlines (hard game-over):
 *   - End of year 3: must have published at least one article (or book).
 *   - End of year 6: must have published at least one book.
 * Retirement at year 25. Promotions and the biennial upgrade only matter while
 * the career continues.
 */
function advanceYear(state) {
  const nextYear = state.year + 1;
  const previousStage = state.stage;
  const totalYears = state.totalYears || TOTAL_YEARS;
  let next = { ...state, year: nextYear };

  // Banked citation tokens cash in at game end: each is worth the renown
  // multiplier in prestige. Applied to whichever game-over branch fires below,
  // so the recorded final prestige includes the conference payout.
  const citationBonus = (state.citations || 0) * renownMultiplier(state.statLevels.renown || 1);
  const finalPrestige = state.prestige + citationBonus;

  // No mid-career deadlines — the career never ends early. The only ending is
  // retirement at the final year (below).

  // ----- END OF GAME: final year — retirement -----
  if (nextYear > totalYears) {
    return {
      ...next,
      year: totalYears,
      prestige: finalPrestige,
      stage: 'retired',
      gameOver: { reason: 'retired', year: totalYears },
    };
  }

  // ----- Promotions (rank-ups record a narrative beat; no bonus upgrade) -----
  next = applyStageProgression(next, previousStage);

  // Upgrades are earned per-publication and per-conference now — there is no
  // longer a regular every-third-year drip.

  return next;
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
      if (cardIdentifier(card) === 'conclusion') return state;
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
      if (cardIdentifier(card) === 'conclusion') return state;
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
  // pileIndex selects which archive pile to draw from (defaults to the first).
  // Used by the walkthrough's single-pile batch draw.
  const drawCards = useCallback(
    (pileIndex = 0) => dispatch({ type: 'DRAW_CARDS', pileIndex }),
    []
  );
  // Market draw: take the face-up card off a given pile.
  const takeArchiveCard = useCallback(
    (pileIndex) => dispatch({ type: 'TAKE_ARCHIVE_CARD', pileIndex }),
    []
  );
  const endDraw = useCallback(() => dispatch({ type: 'END_DRAW' }), []);
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
  const reorderHand = useCallback(
    (cardId, beforeCardId) => dispatch({ type: 'REORDER_HAND', cardId, beforeCardId }),
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
  const attendConference = useCallback(
    (projectId) => dispatch({ type: 'ATTEND_CONFERENCE', projectId }),
    []
  );
  const conferenceKeep = useCallback(
    (keepIds) => dispatch({ type: 'CONFERENCE_KEEP', keepIds }),
    []
  );

  // Derived values — convenient for UI without re-reading the lookup tables
  const derived = useMemo(() => {
    const { articleMin, bookMin } = PUBLISH_THRESHOLDS;
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
      deckRemaining: totalInPiles(state.archivePiles),
      handFull: state.hand.length >= capacity,
      // Conference / citation economy (reputation + renown).
      conferenceFresh: conferenceFresh(state.statLevels.reputation || 1),
      conferenceCitations: conferenceCitations(state.statLevels.reputation || 1),
      renownMultiplier: renownMultiplier(state.statLevels.renown || 1),
      // End-game projection: prestige + banked citations × renown.
      projectedPrestige:
        state.prestige + (state.citations || 0) * renownMultiplier(state.statLevels.renown || 1),
    };
  }, [state.statLevels, state.archivePiles, state.hand.length, state.prestige, state.citations]);

  return {
    state,
    drawCards,
    takeArchiveCard,
    endDraw,
    toggleTags,
    toggleSignificance,
    moveCard,
    removeFromProject,
    reorderHand,
    publishArgument,
    dismissPublishResult,
    dismissStageAdvancement,
    upgradeStat,
    attendConference,
    conferenceKeep,
    reset,
    derived,
  };
}

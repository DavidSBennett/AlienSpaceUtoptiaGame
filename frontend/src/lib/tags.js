/**
 * Tag utilities — pure functions for parsing tags from card data.
 *
 * SINGLE SOURCE OF TRUTH for "what tags does a card have?". Every other
 * module (validation, UI tag-toggle display, scoring) calls these functions
 * rather than re-implementing the parse logic. If we ever change how tags
 * are stored or interpreted, this is the only file that needs editing.
 *
 * RULES (per design, locked in 2026-04):
 *   - A card has tags from BOTH `argument` and `sub_argument` fields.
 *   - BOTH fields may contain comma-separated values:
 *       argument='A,B' means the card has tags A and B from its argument field.
 *       sub_argument='D,F' means the card has tags D and F.
 *   - Whitespace around tags is trimmed; empty strings are dropped.
 *   - Tags are case-sensitive uppercase by convention (A, B, C…), but we
 *     don't normalize — if a deck uses lowercase, that's the deck's choice.
 */

/**
 * Parse a string field into an array of tags.
 * Handles null, undefined, empty strings, and comma-separated lists.
 *
 * @param {string|null|undefined} value
 * @returns {string[]} array of trimmed non-empty tag strings
 */
export function parseTagField(value) {
  if (value == null) return [];
  if (typeof value !== 'string') return [];

  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Get the full set of tags belonging to a single card.
 * Combines `argument` and `sub_argument`, deduped. Both may be comma-separated.
 *
 * @param {Object} card  a card row from listCards.php
 * @returns {Set<string>}  the card's tag set
 */
export function getCardTags(card) {
  const tags = new Set();

  for (const t of parseTagField(card?.argument)) tags.add(t);
  for (const t of parseTagField(card?.sub_argument)) tags.add(t);

  return tags;
}

/**
 * Get tags as a sorted array (useful for stable display/comparison).
 * @param {Object} card
 * @returns {string[]}
 */
export function getCardTagList(card) {
  return Array.from(getCardTags(card)).sort();
}

/**
 * Get tags broken out by which field they came from. Useful when the UI
 * wants to render argument tags differently from sub_argument tags
 * (e.g., different color or shape).
 *
 * @param {Object} card
 * @returns {{ argument: string[], subArgument: string[] }}
 */
export function getCardTagsByField(card) {
  return {
    argument: parseTagField(card?.argument),
    subArgument: parseTagField(card?.sub_argument),
  };
}

/**
 * Build a lookup map from argument tag → its "owning" conclusion card.
 *
 * The game's design treats conclusions as the canonical vocabulary for
 * its themes (every conclusion has exactly one tag, and that tag is the
 * thematic identity of the conclusion). This lookup is what lets the
 * peer-reviewer dialog say "unified by the Political Frame of the War"
 * instead of "unified by 'p'" — players never see tag letters; they see
 * conclusion titles.
 *
 * Only the `argument` field of conclusions is considered, not sub_argument
 * (per design: conclusions only ever have one tag, in argument).
 *
 * @param {Object[]} conclusions  array of conclusion-type cards
 * @returns {Map<string, Object>}  tag → conclusion card
 */
export function buildTagToConclusionMap(conclusions) {
  const map = new Map();
  if (!Array.isArray(conclusions)) return map;

  for (const c of conclusions) {
    const tags = parseTagField(c?.argument);
    // Per design, exactly one tag per conclusion. If somehow there's more,
    // the first wins; if there's none, skip.
    if (tags.length > 0) {
      const tag = tags[0];
      // Don't overwrite if multiple conclusions claim the same tag
      // (shouldn't happen per design, but defend against bad data)
      if (!map.has(tag)) {
        map.set(tag, c);
      }
    }
  }

  return map;
}

/**
 * Resolve a tag to its conclusion title, falling back to the tag string
 * itself if no conclusion claims it. Convenience wrapper for UI copy.
 *
 * @param {string} tag
 * @param {Map<string, Object>} tagToConclusion  from buildTagToConclusionMap
 * @returns {string}  the conclusion title, or the raw tag if unmapped
 */
export function tagAsConclusionLabel(tag, tagToConclusion) {
  if (!tagToConclusion) return tag;
  const conclusion = tagToConclusion.get(tag);
  return conclusion?.title || tag;
}

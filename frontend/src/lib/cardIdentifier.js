/**
 * The archive/conclusion flag on a card. This column was renamed from `type`
 * to `card_identifier` (DB migration 26); the backend emits both names during
 * the transition, so read the new name first and fall back to the old one.
 *
 * @param {Object} card
 * @returns {string} 'archive' | 'conclusion' | ''
 */
export function cardIdentifier(card) {
  return String(card?.card_identifier ?? card?.type ?? '');
}

/** True when the card is a conclusion (thesis) rather than evidence. */
export function isConclusionCard(card) {
  return cardIdentifier(card).toLowerCase() === 'conclusion';
}

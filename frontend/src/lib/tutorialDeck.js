/**
 * A small, fixed deck for the Guided Walkthrough.
 *
 * Every card carries the SAME tag ("print") and is plainly about one topic —
 * the spread of printing in the colonies — so it is obvious they belong in one
 * argument, and a project can never get stuck on a tag mismatch. (Tags are
 * shown on the cards during the walkthrough.) The set is large enough to draw a
 * hand, publish an article, attend a conference, and build a 6-card book.
 *
 * Card shape matches listCards.php / useGameState: `id`, the archive/conclusion
 * flag under both `card_identifier` and `type`, and an `argument` tag.
 */

const TAG = 'print';

// Each evidence card is clearly a *printed source* about colonial print culture,
// so the shared theme is legible at a glance.
const EVIDENCE_SEED = [
  ['Town broadside on the Stamp Act', 'A single sheet printed overnight and nailed up in the square so the whole town could read the news by morning.', '1765', 'Town Printer', 'Boston'],
  ['Pamphlet: “Rights of the Colonies”', 'A cheap pamphlet arguing the colonists’ case, printed in the thousands and passed hand to hand.', '1764', 'A Freeholder', 'Boston'],
  ['The Gazette, front page', 'The week’s front page of a colonial newspaper, carrying news reprinted from three other towns.', '1765', 'The Gazette', 'New York'],
  ['Letter to the printer', 'A reader’s letter set in type and printed in full, answering last week’s essay.', '1765', 'A Citizen', 'Philadelphia'],
  ['Printed sermon on liberty', 'A minister’s sermon set in type so it could be read aloud in distant congregations.', '1766', 'Rev. J. Mayhew', 'Boston'],
  ['Almanac with a printed calendar', 'A best-selling almanac mixing weather, dates, and pointed political verse.', '1766', 'R. Saunders', 'Philadelphia'],
  ['Bookseller’s printed catalogue', 'A printed list of titles for sale, showing how widely political works circulated.', '1765', 'Booksellers’ Row', 'Boston'],
  ['Handbill for a town meeting', 'A small printed handbill calling neighbors to a meeting that evening.', '1765', 'Committee of Correspondence', 'Boston'],
  ['Printed petition for signatures', 'A petition set in type so identical copies could be carried door to door.', '1766', 'The Assembly', 'Williamsburg'],
  ['Reprinted London essay', 'An essay first printed in London, reset and reprinted for colonial readers within weeks.', '1765', 'A Correspondent', 'New York'],
  ['Printer’s apprentice indenture', 'A printed contract binding a boy to learn the trade — evidence the craft was spreading.', '1764', 'Master Printer', 'Philadelphia'],
  ['Printed ballad sheet', 'A topical ballad printed on cheap paper and sung in the streets.', '1766', 'Anonymous', 'Boston'],
  ['Subscription notice', 'A printed notice inviting readers to subscribe to a forthcoming political volume.', '1765', 'The Publisher', 'New York'],
  ['Trade circular among printers', 'A circular passed among print shops sharing news of paper, type, and ink.', '1765', 'Printers’ Guild', 'Philadelphia'],
  ['Broadside reprint from Virginia', 'A Boston shop reprints a Virginia broadside, showing how fast print traveled between colonies.', '1766', 'Town Printer', 'Boston'],
  ['Newspaper advertisement', 'A printed advertisement that helped pay for the paper and kept it in business.', '1765', 'The Gazette', 'New York'],
  ['Printed minutes of a meeting', 'The minutes of a public meeting, set in type so absent neighbors could read them.', '1766', 'Town Clerk', 'Boston'],
  ['Almanac cover engraving', 'The engraved, printed cover of the year’s almanac — a small object that reached many homes.', '1766', 'R. Saunders', 'Philadelphia'],
];

const CONCLUSION_SEED = [
  ['Cheap print shaped public opinion', 'Inexpensive printed sources reached ordinary colonists and shaped what they believed and argued.'],
  ['Print tied the colonies together', 'Newspapers, pamphlets, and broadsides reprinted each other, knitting distant towns into one debate.'],
  ['A printing trade took root', 'Printers, booksellers, and readers formed a working trade that carried ideas across the colonies.'],
];

function evidenceCard(i, seed) {
  const [title, content, date, author, location] = seed;
  return {
    id: 1000 + i,
    idCard: 1000 + i,
    idDeck: 0,
    card_identifier: 'archive',
    type: 'archive',
    title,
    content,
    date,
    author,
    location,
    source_type: 'Printed source',
    significance: 'Printed sources reached wide audiences cheaply, so they both shaped and recorded public opinion.',
    citation: `${author}, “${title},” ${location}, ${date}.`,
    argument: TAG,
    sub_argument: '',
    bonus: '',
    context_tags: '',
    description: '',
    sequence_number: i + 1,
    image_url: '',
  };
}

function conclusionCard(i, seed) {
  const [title, description] = seed;
  return {
    id: 2000 + i,
    idCard: 2000 + i,
    idDeck: 0,
    card_identifier: 'conclusion',
    type: 'conclusion',
    title,
    content: '',
    date: '',
    author: '',
    location: '',
    source_type: '',
    significance: '',
    citation: '',
    argument: TAG,
    sub_argument: '',
    bonus: '',
    context_tags: '',
    description,
    sequence_number: 100 + i,
    image_url: '',
  };
}

export const TUTORIAL_DECK = { idDeck: 0, nameDeck: 'Guided Walkthrough — The Printed Word' };

export const TUTORIAL_CARDS = [
  ...EVIDENCE_SEED.map((s, i) => evidenceCard(i, s)),
  ...CONCLUSION_SEED.map((s, i) => conclusionCard(i, s)),
];

export const TUTORIAL_TAG = TAG;

/**
 * A small, fixed deck used by the guided Tutorial mode.
 *
 * Every evidence card and every conclusion shares the SAME tag ("press"), so
 * any project the student assembles is always valid — the scripted steps can
 * never get stuck on a tag mismatch. The set is large enough to draw a hand,
 * build an article (2 cards), attend a conference, and build a book (6 cards).
 *
 * Card shape matches what listCards.php returns / useGameState expects: each
 * card has `id`, the archive/conclusion flag under both `card_identifier` and
 * `type`, and an `argument` tag.
 */

const TAG = 'press';

// Short, interchangeable primary-source style evidence cards. Content is kept
// simple — the tutorial teaches mechanics, not this specific history.
const EVIDENCE_SEED = [
  ['A printer’s broadside', 'A single-sheet notice printed for public posting in a town square.', '1776', 'Town Printer', 'Boston'],
  ['A pamphlet, first edition', 'A cheaply printed pamphlet arguing a point of the day, sold for a few pence.', '1776', 'Anonymous', 'Philadelphia'],
  ['A newspaper column', 'A column from a weekly paper reporting local events and opinion.', '1775', 'The Gazette', 'New York'],
  ['A letter to the editor', 'A reader’s letter, printed in full, responding to an earlier column.', '1775', 'A Citizen', 'Boston'],
  ['A printed sermon', 'The text of a sermon, set in type and distributed to congregations.', '1774', 'Rev. T. Hale', 'Hartford'],
  ['An almanac entry', 'A page from a popular almanac mixing weather, dates, and aphorisms.', '1776', 'R. Saunders', 'Philadelphia'],
  ['A bookseller’s catalogue', 'A list of titles offered for sale, with prices noted in the margin.', '1773', 'Booksellers’ Row', 'Boston'],
  ['A handbill', 'A small printed handbill advertising a public meeting.', '1775', 'Committee of Correspondence', 'Boston'],
  ['A printed petition', 'A petition set in type so copies could be carried for signatures.', '1774', 'The Assembly', 'Williamsburg'],
  ['A type specimen sheet', 'A printer’s sample showing the fonts available at the shop.', '1772', 'Master Printer', 'Philadelphia'],
  ['A subscription notice', 'A notice inviting readers to subscribe to a forthcoming volume.', '1773', 'The Publisher', 'New York'],
  ['A printed ballad', 'A popular ballad printed on cheap paper and sold in the street.', '1776', 'Anonymous', 'Boston'],
  ['A trade circular', 'A circular sent among printers sharing news of paper and ink.', '1774', 'Printers’ Guild', 'Philadelphia'],
  ['A reprinted essay', 'An essay first printed abroad, reset and reprinted for local readers.', '1775', 'A Correspondent', 'New York'],
  ['A printed almanac cover', 'The decorated cover sheet of the year’s almanac.', '1776', 'R. Saunders', 'Philadelphia'],
  ['A bound newspaper run', 'A binder’s set collecting a full year of a weekly paper.', '1775', 'The Gazette', 'New York'],
];

const CONCLUSION_SEED = [
  ['The press shaped public opinion', 'Cheap print let ideas travel fast and far, shaping what ordinary people believed and argued.'],
  ['Print built a shared conversation', 'Newspapers, pamphlets, and broadsides knit distant towns into one ongoing public debate.'],
  ['A printing trade took root', 'Printers, booksellers, and readers formed a working trade that spread the printed word.'],
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
    significance: 'Printed sources reached wide audiences cheaply, so they shaped — and recorded — public opinion.',
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

export const TUTORIAL_DECK = { idDeck: 0, nameDeck: 'Tutorial — The Printed Word' };

export const TUTORIAL_CARDS = [
  ...EVIDENCE_SEED.map((s, i) => evidenceCard(i, s)),
  ...CONCLUSION_SEED.map((s, i) => conclusionCard(i, s)),
];

export const TUTORIAL_TAG = TAG;

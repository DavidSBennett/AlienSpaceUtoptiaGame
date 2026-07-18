/**
 * A small fixed deck for the Guided Walkthrough — American Revolution sources.
 *
 * Two conclusions are offered:
 *   • Economic (specific) — matched only by the ECONOMIC sources (taxes/trade).
 *   • Colonial (broad)    — matched by ALL the sources.
 *
 * Tags drive matching for real (they are NOT shown by default): economic cards
 * carry both 'economic' and 'colonial'; the other cards carry only 'colonial'.
 * So the economic article needs the economic conclusion + economic cards, and
 * the broad colonial book accepts the wider set. Each card has a
 * `tutorialGroup` ('economic' | 'colonial') the walkthrough uses to gate which
 * cards/conclusions can be dragged at each step.
 *
 * The deck is dealt in order (not shuffled) in tutorial mode, with the economic
 * sources first, so the early steps are predictable.
 */

// ── ECONOMIC sources (taxes & trade) — match BOTH conclusions. ──
const ECONOMIC = [
  {
    title: 'The Stamp Act',
    content: 'Parliament taxes every printed paper in the colonies — newspapers, legal documents, even playing cards — payable in scarce British coin.',
    date: '1765', author: 'Parliament', location: 'London',
    significance: 'The first direct tax on the colonists; “no taxation without representation” became a rallying cry.',
  },
  {
    title: 'The Townshend Duties',
    content: 'New duties are placed on imported glass, paint, paper, and tea, to be collected at colonial ports.',
    date: '1767', author: 'Parliament', location: 'London',
    significance: 'Taxing trade goods provoked boycotts of British imports across the colonies.',
  },
];

// ── COLONIAL (political/social grievances) — match the BROAD conclusion. ──
const COLONIAL = [
  {
    title: 'The Boston Tea Party',
    content: 'Colonists dump a shipment of taxed East India Company tea into Boston Harbor in protest.',
    date: '1773', author: 'Sons of Liberty', location: 'Boston',
    significance: 'A dramatic protest that triggered harsh British reprisals and united the colonies.',
  },
  {
    title: 'The Boston Massacre',
    content: 'British soldiers fire into a crowd of colonists, killing five. Engravings of the scene spread quickly.',
    date: '1770', author: 'Eyewitness account', location: 'Boston',
    significance: 'Propaganda from the killings hardened colonial opinion against the troops.',
  },
  {
    title: 'Committees of Correspondence',
    content: 'Colonists set up networks to share news and coordinate resistance between the colonies.',
    date: '1772', author: 'Samuel Adams', location: 'Boston',
    significance: 'Linked distant colonies into a single political movement.',
  },
  {
    title: 'The Coercive (Intolerable) Acts',
    content: 'Parliament closes Boston’s port and curtails Massachusetts self-government as punishment.',
    date: '1774', author: 'Parliament', location: 'London',
    significance: 'Punitive measures united the colonies in sympathy with Massachusetts.',
  },
  {
    title: 'The First Continental Congress',
    content: 'Delegates from twelve colonies meet to coordinate a response to British policy.',
    date: '1774', author: 'Continental Congress', location: 'Philadelphia',
    significance: 'The colonies began to act as one body.',
  },
  {
    title: 'Lexington and Concord',
    content: 'The first shots of the war are fired as British troops march to seize colonial arms.',
    date: '1775', author: 'Militia accounts', location: 'Massachusetts',
    significance: 'Turned political resistance into armed revolution.',
  },
  {
    title: 'Common Sense',
    content: 'A widely read pamphlet argues plainly for independence from Britain.',
    date: '1776', author: 'Thomas Paine', location: 'Philadelphia',
    significance: 'Shifted public opinion decisively toward independence.',
  },
  {
    title: 'The Declaration of Independence',
    content: 'The colonies formally declare themselves free and independent states.',
    date: '1776', author: 'Continental Congress', location: 'Philadelphia',
    significance: 'The founding statement of American independence.',
  },
  {
    title: 'Patrick Henry’s “Give Me Liberty” Speech',
    content: 'A Virginia delegate rouses the colonists to arm themselves, closing with “Give me liberty, or give me death!”',
    date: '1775', author: 'Patrick Henry', location: 'Virginia',
    significance: 'Gave voice to the colonial resolve to resist Britain by force.',
  },
  {
    title: 'The Sons of Liberty',
    content: 'An organized colonial group stages protests and enforces boycotts against British measures.',
    date: '1765', author: 'Boston organizers', location: 'Boston',
    significance: 'Gave colonial resistance organized muscle.',
  },
];

// Card title → uploaded image file (in /cardimages/tutorial/).
const IMAGES = {
  'The Stamp Act': 'stamp-act.jpg',
  'The Townshend Duties': 'townshend-duties.jpg',
  'The Boston Tea Party': 'boston-tea-party.jpg',
  'The Boston Massacre': 'boston-massacre.jpg',
  'Committees of Correspondence': 'committees-of-correspondence.jpg',
  'The Coercive (Intolerable) Acts': 'coercive-acts.jpg',
  'The First Continental Congress': 'first-continental-congress.jpg',
  'Lexington and Concord': 'lexington-and-concord.jpg',
  'Common Sense': 'common-sense.jpg',
  'The Declaration of Independence': 'declaration-of-independence.jpg',
  'Patrick Henry’s “Give Me Liberty” Speech': 'give-me-liberty.jpg',
  'The Sons of Liberty': 'sons-of-liberty.jpg',
};

function evidenceCard(i, c, group, tags) {
  const file = IMAGES[c.title];
  return {
    id: 1000 + i,
    idCard: 1000 + i,
    idDeck: 0,
    card_identifier: 'archive',
    type: 'archive',
    title: c.title,
    content: c.content,
    date: c.date,
    author: c.author,
    location: c.location,
    source_type: 'Historical event / source',
    significance: c.significance,
    citation: `${c.author}, “${c.title},” ${c.location}, ${c.date}.`,
    argument: tags[0],
    sub_argument: tags[1] || '',
    bonus: '',
    context_tags: '',
    description: '',
    tutorialGroup: group,
    sequence_number: i + 1,
    image_url: file ? `/cardimages/tutorial/${file}` : '',
  };
}

function conclusionCard(i, title, description, group, tag, bonus = 0) {
  return {
    id: 2000 + i,
    idCard: 2000 + i,
    idDeck: 0,
    card_identifier: 'conclusion',
    type: 'conclusion',
    title,
    content: '', date: '', author: '', location: '',
    source_type: '', significance: '', citation: '',
    argument: tag,
    sub_argument: '',
    bonus,                 // flat prestige added to any publication using this thesis
    context_tags: '',
    description,
    tutorialGroup: group,
    sequence_number: 100 + i,
    image_url: '',
  };
}

export const TUTORIAL_DECK = { idDeck: 0, nameDeck: 'Graduate School — The American Revolution' };

// Economic sources FIRST so they land in the opening hand (deck isn't shuffled
// in tutorial mode).
export const TUTORIAL_CARDS = [
  ...ECONOMIC.map((c, i) => evidenceCard(i, c, 'economic', ['economic', 'colonial'])),
  ...COLONIAL.map((c, i) => evidenceCard(ECONOMIC.length + i, c, 'colonial', ['colonial'])),
  conclusionCard(0, 'Taxes and trade laws angered the colonists', 'A focused, economic explanation: new taxes and trade restrictions were the spark.', 'economic', 'economic', 5),
  conclusionCard(1, 'Many grievances pushed the colonies to revolution', 'A broad explanation: economic, political, and social grievances together drove the break with Britain.', 'colonial', 'colonial', 10),
];

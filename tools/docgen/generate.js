/* Generates the two class handouts as .docx using docx-js. */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType, ShadingType,
  PageBreak, ExternalHyperlink,
} = require('docx');

const OUT = path.resolve(__dirname, '../../docs');

const PAGE = {
  size: { width: 12240, height: 15840 }, // US Letter
  margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
};
const CONTENT_W = 9360;

const numbering = {
  config: [
    { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
    { reference: 'dash', levels: [{ level: 0, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 900, hanging: 270 } } } }] },
    { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
  ],
};

const styles = {
  default: { document: { run: { font: 'Arial', size: 22 } } }, // 11pt
  paragraphStyles: [
    { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { size: 44, bold: true, font: 'Arial', color: '1F3A4D' },
      paragraph: { spacing: { after: 80 } } },
    { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal',
      run: { size: 24, italics: true, color: '5A6B73' }, paragraph: { spacing: { after: 240 } } },
    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { size: 30, bold: true, font: 'Arial', color: '1F3A4D' },
      paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 0,
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C8A23A', space: 4 } } } },
    { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { size: 25, bold: true, font: 'Arial', color: '2E5266' },
      paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 1 } },
    { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { size: 23, bold: true, font: 'Arial', color: '2E5266' },
      paragraph: { spacing: { before: 140, after: 60 }, outlineLevel: 2 } },
  ],
};

// ── helpers ────────────────────────────────────────────────────────────────
const title = (t) => new Paragraph({ style: 'Title', children: [new TextRun(t)] });
const subtitle = (t) => new Paragraph({ style: 'Subtitle', children: [new TextRun(t)] });
const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const h3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });

// p(text) or p([{t,bold,italics}, ...])
function p(runs, opts = {}) {
  const arr = Array.isArray(runs) ? runs : [{ t: runs }];
  return new Paragraph({
    spacing: { after: 120, line: 276 },
    ...opts,
    children: arr.map((r) => new TextRun({ text: r.t, bold: r.bold, italics: r.italics, color: r.color })),
  });
}
function bullet(runs, ref = 'bullets', level = 0) {
  const arr = Array.isArray(runs) ? runs : [{ t: runs }];
  return new Paragraph({ numbering: { reference: ref, level }, spacing: { after: 60, line: 276 },
    children: arr.map((r) => new TextRun({ text: r.t, bold: r.bold, italics: r.italics })) });
}
const step = (runs) => bullet(runs, 'steps');
const dash = (runs) => bullet(runs, 'dash');
const spacer = () => new Paragraph({ children: [new TextRun('')] });

function table(headers, rows, widths) {
  const border = { style: BorderStyle.SINGLE, size: 1, color: 'C9CDD2' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const margins = { top: 60, bottom: 60, left: 110, right: 110 };
  const headRow = new TableRow({
    tableHeader: true,
    children: headers.map((htext, i) => new TableCell({
      borders, width: { size: widths[i], type: WidthType.DXA }, margins,
      shading: { fill: '1F3A4D', type: ShadingType.CLEAR },
      children: [new Paragraph({ children: [new TextRun({ text: htext, bold: true, color: 'FFFFFF', size: 20 })] })],
    })),
  });
  const bodyRows = rows.map((cells, ri) => new TableRow({
    children: cells.map((c, i) => new TableCell({
      borders, width: { size: widths[i], type: WidthType.DXA }, margins,
      shading: { fill: ri % 2 ? 'F2EFE6' : 'FFFFFF', type: ShadingType.CLEAR },
      children: [new Paragraph({ children: [new TextRun({ text: String(c), size: 20 })] })],
    })),
  }));
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths, rows: [headRow, ...bodyRows] });
}

const SITE = 'https://thehistorians.org';
const link = (text, url) => new ExternalHyperlink({ link: url, children: [new TextRun({ text, style: 'Hyperlink' })] });

// ════════════════════════════════════════════════════════════════════════════
// DOCUMENT 1 — ASSIGNMENT
// ════════════════════════════════════════════════════════════════════════════
const assignment = [
  title('The Historians — Playtest & High-Score Assignment'),
  subtitle('Deck: Early American History Study Guide'),

  h1('Overview'),
  p('The Historians is a browser-based card game in which you build a career as an academic historian. You draw on a shared archive of primary-source evidence, assemble that evidence into arguments, publish articles and books, and earn prestige. For this assignment you will play the game using the Early American History Study Guide deck, push for the highest score you can, and (optionally) tell us what you thought of it.'),
  p('A companion handout, "The Historians — How to Play," walks you through the controls and the rules for both solo and multiplayer.'),

  h1('Learning Goals'),
  p('By completing this assignment you will:'),
  bullet('Engage directly with primary sources from early American history and judge how they fit together.'),
  bullet('Practice the core move of historical thinking — marshalling evidence in support of a clear thesis (conclusion).'),
  bullet('Experience the rhythm of scholarly work: research, drafting, publication, and peer review.'),
  bullet('Reflect on your own learning and give structured feedback on the experience.'),

  h1('What To Do'),
  step([{ t: 'Get access. ', bold: true }, { t: `Go to ${SITE.replace('https://','')} and create an account using the invite code your instructor provides, then sign in. (Save your username — you will need it visible in your screenshot.)` }]),
  step([{ t: 'Choose the deck. ', bold: true }, { t: 'On the home screen, select the "Early American History Study Guide" deck from the deck dropdown.' }]),
  step([{ t: 'Play the game. ', bold: true }, { t: 'Play through a full career. You may play on your own (Solo) or, if you can find a classmate to play with, as a Multiplayer game (see "Play With a Classmate" below). Use the in-game tutorial hints and the "How to Play" handout if you get stuck, and aim for the highest prestige you can.' }]),
  step([{ t: 'Capture your score. ', bold: true }, { t: 'When your career ends, your Final Prestige is shown on the results screen, and your score is recorded in the Hall of Scholars leaderboard. Take a screenshot that clearly shows BOTH your score and your username.' }]),

  h1('Play With a Classmate (Optional)'),
  p('You are welcome to experience the multiplayer mode instead of — or in addition to — a solo game. Multiplayer needs 2 to 5 players, so you will need to coordinate with classmates.'),
  bullet([{ t: 'Find a partner on D2L. ', bold: true }, { t: 'Use the D2L discussion forum to find one or more classmates to play with and agree on a time to meet online.' }]),
  bullet([{ t: 'Use the same deck. ', bold: true }, { t: 'Whoever hosts should create the game with the Early American History Study Guide deck. The others join the open game from the multiplayer panel on the home screen.' }]),
  bullet([{ t: 'Pick a length. ', bold: true }, { t: 'A Short (10-year) game is the quickest way to experience peer review, conferences, and the end-of-game awards together.' }]),
  bullet([{ t: 'Same deliverable. ', bold: true }, { t: 'A multiplayer game still produces a final score with your username, recorded on the multiplayer leaderboard for the length you played — screenshot it the same way.' }]),
  p([{ t: 'Either mode satisfies the assignment. ', bold: true }, { t: 'A solo game is always enough; multiplayer is an option for those who want the full experience.' }]),

  h1('Required Deliverable'),
  p([{ t: 'A single image (screenshot) of your high score with your username clearly visible.', bold: true }]),
  p('Either of these is acceptable, as long as your username and your prestige score are both legible:'),
  dash('Your end-of-game "Final Prestige" results screen, or'),
  dash('Your entry on the Hall of Scholars leaderboard, filtered to the Early American History Study Guide deck.'),

  h1('Extra Credit (+10 points)'),
  p('After your game ends, click the "Playtest Report" button on the results screen. This opens a short survey (seven quick rating questions and three short-answer boxes). Fill it out honestly and submit it.'),
  p([{ t: 'To earn the extra credit, also submit a screenshot showing that you completed and submitted the survey', bold: true }, { t: ' (the confirmation/"thank you" message after you press submit).' }]),

  h1('How To Submit'),
  p('Submit your screenshot(s) here: ____________________________ (your instructor will specify the location — e.g., the course LMS dropbox).'),
  bullet('Required: the high-score image (username + score visible).'),
  bullet('Optional, for +10: the survey-completion screenshot.'),
  p([{ t: 'Due date: ', bold: true }, { t: '____________________________' }]),

  h1('Grading'),
  table(
    ['Item', 'Points', 'Requirement'],
    [
      ['High-score screenshot', 'Base credit', 'A legible image showing your username and your prestige score on the Early American History Study Guide deck.'],
      ['Playtest survey (extra credit)', '+10', 'Survey completed and submitted in-game, with a screenshot of the confirmation.'],
    ],
    [2600, 1500, 5260],
  ),
  spacer(),

  h1('Tips'),
  bullet([{ t: 'Turn on "Significance." ', bold: true }, { t: 'In the game header, click the Significance button, then click a card to open it and read the historical-significance note behind each source — a quick way to learn the history (and to judge which evidence fits your argument).' }]),
  bullet('Read the cards. The evidence only counts toward a thesis when it shares a tag (theme) with the conclusion — and grouping evidence that shares the same author, place, date, or source type can double your prestige.'),
  bullet('Publish early to get hired (an article by year 3) and keep your career alive (a book by year 6).'),
  bullet([{ t: 'Keep a study guide. ', bold: true }, { t: 'When your game ends, click "View / Print My Works" on the results screen (in multiplayer, the Final Standings screen) to open your published articles and books as a printable document. Each one lists its thesis and a table of all its evidence with the historical-significance notes — save it as a PDF and you have a ready-made review sheet for the deck’s material.' }]),
  bullet('Turn on tutorial hints from the header if you want step-by-step guidance, and open "How to Play" any time for a quick reference.'),

  p([{ t: 'Need help getting in? ', bold: true }, { t: 'If you do not have an invite code, contact your instructor.' }]),
];

// ════════════════════════════════════════════════════════════════════════════
// DOCUMENT 2 — HOW TO PLAY
// ════════════════════════════════════════════════════════════════════════════
const guide = [
  title('The Historians — How to Play'),
  subtitle('An introductory guide to the game, its interface, and the rules (solo & multiplayer)'),

  h1('What This Game Is'),
  p('You play a historian building an academic career. You collect primary-source evidence cards, combine them with a conclusion (a thesis), and publish them as articles and books. Strong, well-supported publications earn prestige. The historian with the most distinguished career wins.'),

  h1('Getting Started'),
  step([{ t: 'Sign in. ', bold: true }, { t: `Go to ${SITE.replace('https://','')}, create an account with your invite code, and sign in.` }]),
  step([{ t: 'Pick a deck. ', bold: true }, { t: 'On the home screen, choose a deck from the dropdown (for this assignment, "Early American History Study Guide").' }]),
  step([{ t: 'Start playing. ', bold: true }, { t: 'Click Solo to play on your own, or use the multiplayer panel to create or join a game with others.' }]),

  h1('The Cards'),
  p([{ t: 'Evidence cards (the "archive"). ', bold: true }, { t: 'Historical sources you draw into your hand and place into your projects. Each carries hidden properties: one or more tags (its themes), context fields (location, author, date, source type, citation, and "context tags"), and sometimes a small bonus.' }]),
  p([{ t: 'Conclusion cards (your theses). ', bold: true }, { t: 'The questions or claims your research answers. These live in a library on the left and can be reused. Each conclusion has exactly one tag — its theme.' }]),
  p([{ t: 'Tip: turn on "Significance" in the header, then click a card to open it and read the historical-significance note behind that source. ', bold: true }, { t: 'Turn on "Tags" the same way to reveal each card’s themes. Both are great for learning the history as you play.' }]),

  h1('Building & Publishing an Argument'),
  p('A project needs a conclusion plus several pieces of evidence. To publish, three things must be true:'),
  bullet('The project has a conclusion.'),
  bullet('It has enough evidence (at least 2 cards for an article; 6 or more makes it a book).'),
  bullet([{ t: 'Every card — the conclusion and each evidence card — shares at least one common tag.', bold: true }, { t: ' Mismatched evidence can’t be published (and in multiplayer a reviewer can reject it for exactly that).' }]),
  p([{ t: 'Prestige', bold: true }, { t: ' comes from the size of the argument plus card and conclusion bonuses and your Literary Agent (Influence) bonus. It ' }, { t: 'doubles', italics: true }, { t: ' if every piece of evidence shares one common context — the same location, author, date, source type, citation, or context tag. So a focused argument is worth far more.' }]),

  h1('The Interface, Top to Bottom'),
  bullet([{ t: 'Header toggles: ', bold: true }, { t: 'Tags, Significance, Story (career pop-ups on/off), Tutorial (hints on/off), How to Play (this reference), and Lobby (leave the game).' }]),
  bullet([{ t: 'Timeline bar: ', bold: true }, { t: 'your name, Prestige (your score), Citations, your six upgrade stats, your current Goal, your Stage (rank), and the Year.' }]),
  bullet([{ t: 'Conclusions rail (left): ', bold: true }, { t: 'your library of theses. Drag one into a project’s conclusion slot.' }]),
  bullet([{ t: 'Project rows (center): ', bold: true }, { t: 'your workspaces. Drop a conclusion and evidence here, then Submit for Review (publish) or Attend Conference.' }]),
  bullet([{ t: 'Research Notebook (bottom): ', bold: true }, { t: 'your hand of evidence and the Archive deck. Click the deck to draw. Drag cards within the hand to reorder them.' }]),
  bullet([{ t: 'Bookshelf: ', bold: true }, { t: 'your published works. You can print or save them as a study guide — see "Save Your Works as a Study Guide" below.' }]),

  // ── SOLO ──
  new Paragraph({ children: [new PageBreak()] }),
  h1('Playing Solo'),
  p('A solo career runs 25 years. Time only passes when you take one of these actions:'),
  bullet([{ t: 'Draw', bold: true }, { t: ' — refill your hand from the Archive (costs 1 year).' }]),
  bullet([{ t: 'Publish', bold: true }, { t: ' — submit a project (costs 1 year, whether it succeeds or not).' }]),
  bullet([{ t: 'Attend a Conference', bold: true }, { t: ' — stage a project’s evidence and swap it for a fresh selection from the archive, banking citation tokens (costs 1 year).' }]),
  p('Dragging cards, opening cards, and toggling settings are all free.'),

  h2('Your Career'),
  p('You begin as a recent PhD looking for work. Your career advances by what you publish:'),
  table(
    ['Milestone', 'How you reach it'],
    [
      ['Hired (Visiting Assistant Professor)', 'Publish your first article.'],
      ['Assistant Professor (tenure track)', 'Publish your first book.'],
      ['Associate Professor', '2 books published.'],
      ['Full Professor', '4 books published.'],
      ['Endowed Professor', '7 books published.'],
    ],
    [4200, 5160],
  ),
  spacer(),
  p([{ t: 'Two deadlines can end your career early: ', bold: true }, { t: 'you must publish at least one article by year 3 (to get hired), and at least one book by year 6 (for a permanent post). Miss either and the game ends.' }]),

  h2('Upgrades (Money to Invest)'),
  p('Every third year you come into money — a grant while you’re job-hunting, or a pay raise once you’re employed — and every promotion adds a bonus. A counter near the top of the screen shows how many years until your next one. You invest each one in a single upgrade:'),
  table(
    ['Upgrade', 'What it does'],
    [
      ['Research Funding', 'How many cards you draw at a time.'],
      ['Personal Archive', 'How many cards you can hold in your notebook.'],
      ['Literary Agent', 'Bonus prestige on every publication.'],
      ['Workspaces', 'How many projects you can run at once.'],
      ['Association Memberships', 'Your payoff at conferences (more cards to draft, more citations).'],
      ['Publicist', 'How much each banked citation is worth at game’s end.'],
    ],
    [3000, 6360],
  ),
  spacer(),
  p([{ t: 'Citations & the endgame: ', bold: true }, { t: 'attending conferences banks citation tokens. At retirement, each token is multiplied by your Publicist level and added to your prestige — so conferences are a long game. Your final prestige (including the citation payout) is your score.' }]),

  // ── MULTIPLAYER ──
  new Paragraph({ children: [new PageBreak()] }),
  h1('Playing Multiplayer'),
  p('2 to 5 historians share one archive and compete. From the home screen you can create a game (pick a deck and a length — Short 10 years, Medium 18, or Long 25) or join an open lobby. The host starts the game once everyone is in.'),

  h2('The Year and Its Phases'),
  p('Unlike solo, everyone acts at the same time. Each year runs through up to three phases:'),
  bullet([{ t: 'Action phase ', bold: true }, { t: '— every player secretly commits ONE action (Draw, Publish, Review, Attend a Conference, or Pass), then clicks End Year. The year resolves once everyone has committed.' }]),
  bullet([{ t: 'Review phase ', bold: true }, { t: '— if anyone published, the table peer-reviews each manuscript one at a time.' }]),
  bullet([{ t: 'Conference phase ', bold: true }, { t: '— if anyone attended a conference, the card draft runs.' }]),

  h2('Peer Review'),
  p('When you publish in multiplayer, your manuscript goes to the table instead of publishing directly. Reviewers see a limited view and vote:'),
  dash([{ t: 'Approve', bold: true }, { t: ' — publish it.' }]),
  dash([{ t: 'Reject', bold: true }, { t: ' — flag the evidence that sinks it.' }]),
  dash([{ t: 'Revise & Resubmit', bold: true }, { t: ' — propose cuts/additions for the writer to decide next.' }]),
  p('The majority decides (ties lean to Revise). An approved manuscript is published; a rejected one keeps its evidence for you to reclaim, plus a consolation draw. You can spend objection tokens to contest a rejection the rules say was unfair.'),

  h2('Citations, Conferences & Awards'),
  bullet([{ t: 'Citing others: ', bold: true }, { t: 'drag a published work from the library into your project to cite it. You gain prestige; the cited author gains a citation token.' }]),
  bullet([{ t: 'Conferences: ', bold: true }, { t: 'attendees draft cards from a shared pool in order of Association Memberships, and everyone earns citation tokens.' }]),
  bullet([{ t: 'End of game: ', bold: true }, { t: 'banked citations pay out (tokens × Publicist), and five awards grant bonus prestige (e.g., most publications, most citations, first to publish a book). Final scores post to a Hall of Scholars leaderboard kept separately for each game length.' }]),

  h1('Save Your Works as a Study Guide'),
  p('Everything you publish is collected into a printable "Collected Works" document. Each publication appears with its thesis and a table of every piece of evidence behind it — the date, title, content, historical-significance note, and citation. Because it gathers the sources and their significance in one place, it doubles as a ready-made review sheet for the material you covered.'),
  bullet([{ t: 'Solo: ', bold: true }, { t: 'click "View / Print Works" on the Bookshelf during the game, or "View / Print My Works" on the final results screen.' }]),
  bullet([{ t: 'Multiplayer: ', bold: true }, { t: 'on the Final Standings screen, click "View / Print My Works" to export your own publications.' }]),
  p([{ t: 'The document opens in a new browser tab. ', bold: true }, { t: 'Use your browser’s Print command and choose "Save as PDF" as the destination to download it. The significance notes are included automatically, so the saved PDF works as a study guide for the topics in your deck.' }]),

  h1('Tips for a High Score'),
  bullet('Focus your arguments — all evidence sharing one place, author, date, source type, or context tag doubles the prestige.'),
  bullet('Hit the deadlines: an article by year 3, a book by year 6.'),
  bullet('Invest upgrades to match your style — Literary Agent for raw prestige, or Association Memberships + Publicist to win the long citation game.'),
  bullet('Turn on the in-game tutorial for guided hints, and open "How to Play" any time.'),
];

// ── build & write ───────────────────────────────────────────────────────────
function build(children) {
  return new Document({ styles, numbering, sections: [{ properties: { page: PAGE }, children }] });
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const jobs = [
    ['The-Historians-Assignment.docx', assignment],
    ['The-Historians-How-To-Play.docx', guide],
  ];
  for (const [name, children] of jobs) {
    const buf = await Packer.toBuffer(build(children));
    fs.writeFileSync(path.join(OUT, name), buf);
    console.log('wrote', path.join(OUT, name), `(${buf.length} bytes)`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

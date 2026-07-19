import UpgradeBoard from './UpgradeBoard.jsx';
import { STAT_TABLES, CONFERENCE_FRESH } from '../hooks/useGameState.js';

/**
 * UpgradeChooserDialog — appears after a successful publication (or conference)
 * so the player invests their funding in one practice area.
 *
 * This is now a thin wrapper: it maps the SOLO stat tables into the shared
 * UpgradeBoard's data shape and hands off the desk rendering + click-to-buy.
 * Each track's `cells` are the four short per-level labels shown on the board.
 *
 * @param {Object}   props.statLevels  current state.statLevels
 * @param {Function} props.onUpgrade   (statName) => void
 */
export default function UpgradeChooserDialog({ statLevels, onUpgrade, reason = 'publish', stage = 'recent-graduate' }) {
  const r = STAT_TABLES.research;        // [3, 5, 7, 'capacity']
  const n = STAT_TABLES.notebookCapacity; // [7, 11, 15, 25]
  const inf = STAT_TABLES.influence;      // [0, 1, 2, 3]  (L4 is per-card)
  const rep = STAT_TABLES.reputation;     // [1, 2, 3, 6]  citation tokens
  const ren = STAT_TABLES.renown;         // [1, 2, 3, 5]  multiplier

  const stats = [
    {
      key: 'research',
      title: 'Research Funding',
      subtitle: 'Cards Drawn Per Action',
      cells: [r[0], r[1], r[2], 'Full'],
      lead: 'How many archive cards you draw at a time. The final level draws a full notebook.',
    },
    {
      key: 'notebookCapacity',
      title: 'Personal Archive',
      subtitle: 'Card Hand Limit',
      cells: [n[0], n[1], n[2], n[3]],
      lead: 'How many cards you can keep in your Research Notebook at once.',
    },
    {
      key: 'influence',
      title: 'Literary Agent',
      subtitle: 'Prestige Per Publish',
      cells: [`+${inf[0]}`, `+${inf[1]}`, `+${inf[2]}`, `+${inf[3]}/card`],
      lead: 'Bonus prestige added to every publication. The final level pays out per card in the argument.',
    },
    {
      key: 'workspaces',
      title: 'Workspaces',
      subtitle: 'Concurrent Projects',
      cells: ['1', '2', '3', 'Free'],
      lead: 'How many projects you can run at once. The final level makes publishing free of a year.',
    },
    {
      key: 'reputation',
      title: 'Association Memberships',
      subtitle: 'Conference Rewards',
      cells: [rep[0], rep[1], rep[2], rep[3]],
      lead: `Citation tokens earned at a conference (${CONFERENCE_FRESH[0]}–${CONFERENCE_FRESH[3]} fresh cards added to the draft pool too).`,
    },
    {
      key: 'renown',
      title: 'Publicist',
      subtitle: 'Final Citation Prestige',
      cells: [`×${ren[0]}`, `×${ren[1]}`, `×${ren[2]}`, `×${ren[3]}`],
      lead: 'How much each banked citation token is worth in prestige when you retire.',
    },
  ];

  return (
    <UpgradeBoard
      stats={stats}
      statLevels={statLevels}
      reason={reason}
      stage={stage}
      onChoose={onUpgrade}
    />
  );
}

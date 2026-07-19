import UpgradeBoard from './UpgradeBoard.jsx';

/**
 * MultiplayerUpgradeChooser — opens whenever the player has pending_upgrade>0.
 * Maps the MULTIPLAYER stat tables into the shared UpgradeBoard's data shape
 * and talks to mp_upgradeStat.php via onChoose.
 *
 * The reason drives the flavor line ('publish', 'conference', 'review-approve',
 * 'review-reject', 'review-revise', 'reject-writer', 'promotion').
 *
 * Props:
 *   statLevels — { research, notebookCapacity, influence, workspaces, reputation, renown }
 *   reason     — see above
 *   onChoose   — async (statKey) => void
 *   onClose    — () => void (used when every track is maxed, just acknowledge)
 *   busy       — bool
 *   error      — string | null
 */
export default function MultiplayerUpgradeChooser({
  statLevels,
  reason,
  stage = 'recent-graduate',
  onChoose,
  onClose,
  busy,
  error,
}) {
  const stats = [
    {
      key: 'research',
      title: 'Research Funding',
      subtitle: 'Cards Drawn Per Action',
      cells: [3, 5, 7, 'Full'],
      lead: 'How many archive cards you draw at a time. The final level draws a full notebook.',
    },
    {
      key: 'notebookCapacity',
      title: 'Personal Archive',
      subtitle: 'Card Hand Limit',
      cells: [7, 9, 11, 15],
      lead: 'Your hand limit — how many cards you can keep in your Research Notebook.',
    },
    {
      key: 'influence',
      title: 'Literary Agent',
      subtitle: 'Prestige Per Card',
      cells: ['+0', '+1', '+2', '+4'],
      lead: 'A prestige bonus added to every evidence card in a publication, so it grows with article size.',
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
      cells: [1, 2, 3, 6],
      lead: 'Citation tokens earned at a conference (1–4 fresh cards added to the draft pool too).',
    },
    {
      key: 'renown',
      title: 'Publicist',
      subtitle: 'Final Citation Prestige',
      cells: ['×1', '×2', '×3', '×5'],
      lead: 'At game end, your total citation tokens pay out at this multiplier.',
    },
  ];

  return (
    <UpgradeBoard
      stats={stats}
      statLevels={statLevels}
      reason={reason}
      stage={stage}
      onChoose={onChoose}
      onClose={onClose}
      busy={busy}
      error={error}
    />
  );
}

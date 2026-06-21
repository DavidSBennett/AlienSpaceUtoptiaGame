/**
 * NarrativeToggle — a small header control to turn the story modals on/off.
 * Matches the other header text toggles.
 */
export default function NarrativeToggle({ enabled, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="font-mono text-xs uppercase tracking-wider text-cream-200 hover:text-gold-300 transition-colors"
      title={
        enabled
          ? 'Story prompts are ON — click to stop the career story modals'
          : 'Story prompts are OFF — click to show the career story modals'
      }
    >
      Story: {enabled ? 'On' : 'Off'}
    </button>
  );
}

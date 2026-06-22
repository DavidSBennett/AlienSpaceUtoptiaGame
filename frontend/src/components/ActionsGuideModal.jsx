/**
 * ActionsGuideModal — an at-a-glance overlay explaining the actions a
 * player can take and exactly where on the board to click for each.
 *
 * Opened from the "How to Play" button in the header. Unlike the
 * TutorialManager hints (which fire contextually, one at a time), this is
 * a single reference card the player can summon any time they forget what
 * a control does.
 *
 * Props:
 *   mode     — 'single' | 'multiplayer'; selects which action list to show
 *   onClose  — () => void
 */

// Each entry: a short label, where to click/do it, and a marker glyph.
const GUIDE = {
  single: [
    {
      glyph: '🃏',
      label: 'Draw research',
      where:
        'Click the Archive deck on the left of your Research Notebook (bottom of the screen). Each draw advances one year.',
    },
    {
      glyph: '🧩',
      label: 'Build a project',
      where:
        'Drag evidence cards from your notebook into a project row. Drag a conclusion tile from the rail on the left into the project’s conclusion slot. (Or open a card and use the "Place in Project" buttons.)',
    },
    {
      glyph: '📰',
      label: 'Publish',
      where:
        'When a project has a conclusion and enough matching evidence, click Publish on that project row. Publishing advances one year.',
    },
    {
      glyph: '⭐',
      label: 'Invest new funding',
      where:
        'Every third year money comes your way — a raise (once you’re tenure-track), a bonus, or a grant — and a promotion adds one too. You invest it in one upgrade: Research Funding, Personal Archive, Literary Agent, Workspaces, Association Memberships, or Publicist. How you invest shapes the kind of research you’ll do. The header shows how long until your next one.',
    },
    {
      glyph: '▾',
      label: 'Collapse sections',
      where:
        'Click the ▾ chevrons on the header, project rows, notebook, and bookshelf to fold them away and focus your view.',
    },
    {
      glyph: '🎯',
      label: 'Your goal',
      where:
        'Start as a recent PhD: publish an article by year 3 to get hired, a book by year 6 for a tenure-track post, then climb the ranks (Associate, Full, Endowed) by publishing more books until retirement at year 15.',
    },
  ],
  multiplayer: [
    {
      glyph: '🃏',
      label: 'Draw research',
      where:
        'Click the Archive deck on the left of your Research Notebook to set your action to "Draw," then click End Year to resolve it. Fresh evidence flows into your notebook.',
    },
    {
      glyph: '🧩',
      label: 'Build a project',
      where:
        'Drag evidence cards from your notebook into a project row. Drag a conclusion tile from the rail at the top into the project’s conclusion slot.',
    },
    {
      glyph: '📰',
      label: 'Submit for peer review',
      where:
        'When a project has a conclusion and enough matching evidence, click Publish on that row to send it to the other historians for review.',
    },
    {
      glyph: '🔍',
      label: 'Review a manuscript',
      where:
        'After everyone ends the year, the review phase opens automatically — read each new manuscript and vote approve, revise, or reject.',
    },
    {
      glyph: '🎤',
      label: 'Attend a conference',
      where:
        'Stage cards into a project and click "Attend Conference" on that row. After the year ends, you swap your cards for others from a shared pool and earn citation tokens by your Association Memberships.',
    },
    {
      glyph: '⭐',
      label: 'Invest new funding',
      where:
        'Every third year money comes your way — a raise (once you’re tenure-track), a bonus, or a grant — and a promotion adds one too. You invest it in one upgrade: Research Funding, Personal Archive, Literary Agent, Workspaces, Association Memberships, or Publicist. How you invest shapes the kind of research you’ll do. The header shows how long until your next one.',
    },
    {
      glyph: '📚',
      label: 'Cite published work',
      where:
        'Drag a book or article spine from the Library of Publications at the bottom onto a project to cite it — its tags must match your conclusion.',
    },
    {
      glyph: '⏭️',
      label: 'End the year',
      where:
        'Click End Year in the action bar to lock in your chosen action. The year advances once every active player has committed.',
    },
    {
      glyph: '▾',
      label: 'Collapse sections',
      where:
        'Click the ▾ chevrons on the header, project rows, notebook, and library to fold them away and focus your view.',
    },
  ],
};

export default function ActionsGuideModal({ mode = 'multiplayer', onClose }) {
  const entries = GUIDE[mode] || GUIDE.multiplayer;

  return (
    <div
      className="fixed inset-0 z-[120] bg-teal-950/80 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="actions-guide-title"
    >
      <div
        className="relative surface-paper max-w-2xl w-full my-6 animate-fade-up"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(184, 146, 58, 0.5)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Inner gilt frame */}
        <div className="absolute inset-2 border border-gold-500/30 pointer-events-none" />

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-30 px-4 py-2 bg-cream-50 border border-gold-500 text-ink-900 hover:bg-oxblood-500 hover:text-cream-50 hover:border-oxblood-500 transition-colors font-mono text-sm uppercase tracking-wider shadow-md"
          aria-label="Close"
        >
          ✕ Close
        </button>

        <div className="px-10 py-9">
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-700 mb-2">
            Quick Reference
          </p>
          <h2 id="actions-guide-title" className="font-display text-3xl font-bold text-ink-900 leading-tight">
            How to Play
          </h2>
          <p className="font-serif italic text-ink-700 mt-2 mb-6">
            Your available actions and where to click for each.
          </p>

          <dl className="flex flex-col divide-y divide-gold-500/20">
            {entries.map((entry) => (
              <div key={entry.label} className="flex gap-4 py-3.5 items-start">
                <span className="text-2xl leading-none mt-0.5 select-none" aria-hidden="true">
                  {entry.glyph}
                </span>
                <div className="min-w-0">
                  <dt className="font-display text-lg font-bold text-ink-900 leading-snug">
                    {entry.label}
                  </dt>
                  <dd className="font-serif text-sm text-ink-800 leading-relaxed mt-0.5">
                    {entry.where}
                  </dd>
                </div>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

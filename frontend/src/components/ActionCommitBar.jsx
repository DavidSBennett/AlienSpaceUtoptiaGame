/**
 * ActionCommitBar — the strip directly above the notebook that shows
 * the player's pending action and the End Year / Uncommit controls.
 *
 * Action selection is IMPLICIT — the player's most recent click on
 * Draw / Publish / Review sets pending_action server-side. This bar
 * just reflects that selection and offers commit / uncommit / quick
 * picks for Draw and Pass (since those don't have a natural "click here"
 * UI element elsewhere on the board).
 *
 * Props:
 *   pendingAction          — null | 'draw' | 'publish' | 'review' | 'pass'
 *   pendingActionData      — object | null
 *   pendingActionCommitted — bool (true → year is locked from this player's side)
 *   timerSecondsRemaining  — int (seconds until auto-resolve)
 *   opponents              — state.opponents (for waiting-on list)
 *   busy                   — bool (disables buttons during requests)
 *   onCommit               — () => void (clicks End Year)
 *   onUncommit             — () => void
 *   onSelectDraw           — () => void
 *   onSelectPass           — () => void
 *   drawCount              — int (cards drawn on a Draw action)
 *   activeOnly             — bool (false if this player is game-over'd or ghosted)
 */
export default function ActionCommitBar({
  pendingAction,
  pendingActionData,
  pendingActionCommitted,
  timerSecondsRemaining,
  opponents,
  busy,
  onCommit,
  onUncommit,
  drawCount,
  activeOnly,
}) {
  if (!activeOnly) {
    return (
      <div className="surface-binding border-t border-edge-on-dark px-6 py-2">
        <p className="font-serif italic text-cream-200/60 text-sm text-center">
          Your career has ended. The other historians play on.
        </p>
      </div>
    );
  }

  const waitingOn = (opponents || []).filter(
    (op) => !op.has_committed && !op.is_ghost && !op.game_over_reason
  );

  // Color and label for the prominent action banner. Keeps each action
  // visually distinct so a player can't mistake Pass for Publish at a
  // glance.
  const banner = bannerFor(pendingAction);

  return (
    <div className="surface-binding border-t border-edge-on-dark">

      {/* PROMINENT ACTION BANNER + End Year button on the same line.
          The big color-coded label shows what's queued for this year so
          a player can't mistake one action for another. */}
      {/* One line. The reminder subline is gone — it told an experienced
          player nothing and cost the bar half its height. */}
      <div className={`px-4 py-1.5 border-b ${banner.borderClass} ${banner.bgClass}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2 min-w-0 flex-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-gold-400 flex-shrink-0">
              This year you will
            </span>
            <span className={`font-display text-base truncate ${banner.textClass}`}>
              {banner.label}
            </span>
          </div>

          {/* Right-side controls on the same line as the banner */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {pendingActionCommitted ? (
              <>
                <span className="font-mono text-[9px] uppercase tracking-wider text-verdigris-400">
                  ✓ committed
                  {waitingOn.length > 0 && (
                    <span className="text-cream-200/70 ml-1">
                      · waiting on {waitingOn.map((o) => o.player_name).join(', ')}
                    </span>
                  )}
                </span>
                <button
                  onClick={onUncommit}
                  disabled={busy}
                  className="btn-ghost text-xs px-2.5 py-1"
                >
                  Uncommit
                </button>
              </>
            ) : (
              <button
                onClick={onCommit}
                disabled={busy || !pendingAction}
                className="btn-primary text-xs px-4 py-1.5"
              >
                {busy ? 'Working…' : 'End Year'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


/**
 * Returns banner styling + label keyed off the player's currently
 * selected action. Used by the prominent banner at the top of the
 * commit bar.
 */
function bannerFor(action) {
  switch (action) {
    case 'draw': return {
      label: 'Draw cards',
      textClass: 'text-verdigris-400',
      bgClass:   'bg-teal-900/60',
      borderClass: 'border-verdigris-400/40',
    };
    case 'publish': return {
      label: 'Submit a manuscript',
      textClass: 'text-oxblood-300',
      bgClass:   'bg-oxblood-700/30',
      borderClass: 'border-oxblood-500/50',
    };
    case 'review': return {
      label: 'Review a manuscript',
      textClass: 'text-periwinkle-300',
      bgClass:   'bg-periwinkle-600/20',
      borderClass: 'border-periwinkle-400/40',
    };
    case 'attend_conference': return {
      label: 'Attend a conference',
      textClass: 'text-gold-200',
      bgClass:   'bg-gold-700/20',
      borderClass: 'border-gold-500/50',
    };
    case null:
    case undefined: return {
      label: '— no action chosen yet —',
      textClass: 'text-gold-300',
      bgClass:   'bg-gold-700/15',
      borderClass: 'border-gold-500/40',
    };
    default: return {
      label: action,
      textClass: 'text-cream-50',
      bgClass:   'bg-teal-900/40',
      borderClass: 'border-gold-500/20',
    };
  }
}

/**
 * MultiplayerResultDialog — writer's post-resolution modal.
 *
 * Visually matches the single-player PublishResultDialog (the gilt
 * "Editorial Decision" letter on parchment) while keeping every piece of
 * multiplayer-specific data and machinery: per-reviewer verdicts and
 * comments, prestige earned, cards still bound to a rejected manuscript,
 * the consolation draw, manuscript reclaim, and the objection-token appeal.
 *
 * Shown when:
 *   - A submission resolves (approve/reject/auto-rejected/objection-lost)
 *     and writer_seen_result is 0 → auto-pop on the writer's next poll
 *   - Writer clicks a manuscript spine in their "Out for Review" list
 *     while it still has bound cards or unclaimed consolation
 *
 * Props:
 *   submission        — object from state.resolved_submissions_for_you
 *   you               — state.you (for hand-room calc)
 *   onDismiss         — async () => void
 *   onDrawConsolation — async () => void
 *   onReclaim         — async () => void
 *   onObject          — async () => void
 *   objectionOutcome  — { outcome: 'won'|'lost' } | null
 *   busy              — bool
 *   error             — string | null
 */
import { useState } from 'react';
import CornerOrnament from './CornerOrnament.jsx';
import FleuronDivider from './FleuronDivider.jsx';
import { STAT_TABLES } from '../hooks/useGameState.js';

// Ink-on-parchment ghost button — the multiplayer dialog needs several
// action buttons where solo has one, so they share a restrained outline style.
const GHOST =
  'font-mono text-xs uppercase tracking-wider px-3 py-2 border border-ink-700/40 ' +
  'text-ink-900 hover:bg-ink-900/5 hover:border-ink-700 transition-colors ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

export default function MultiplayerResultDialog({
  submission,
  you,
  onDismiss,
  onDrawConsolation,
  onReclaim,
  onObject,
  objectionOutcome = null,
  busy,
  error,
}) {
  const isApproved = ['approved', 'auto-approved', 'objection-won'].includes(submission.status);
  const isRejection = submission.is_rejection;

  // Confirmation state for the destructive objection action — we don't want a
  // misclick to burn precious tokens. First click sets "confirming"; second commits.
  const [objConfirming, setObjConfirming] = useState(false);

  // Hand-room calc — drives the disabled state for Draw / Reclaim buttons.
  const capacity = STAT_TABLES.notebookCapacity[(you.stat_levels.notebookCapacity || 1) - 1];
  const room = capacity - (you.hand?.length || 0);
  const handIsFull = room <= 0;

  const consolationDisabled = submission.consolation_drawn || handIsFull;
  const consolationTip = submission.consolation_drawn
    ? 'Consolation already claimed for this manuscript'
    : (handIsFull ? 'Hand is full; place or play cards first' : null);

  const reclaimCount = submission.bound_evidence?.length || 0;
  const reclaimDisabled = reclaimCount === 0 || handIsFull;
  const reclaimTip = reclaimCount === 0
    ? 'No cards left to reclaim'
    : (handIsFull ? 'Hand is full; place or play cards first' : null);

  const kindNoun = submission.kind === 'book' ? 'Book' : 'Article';

  return (
    <div
      className="fixed inset-0 z-[70] bg-teal-950/80 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in"
      onClick={() => { if (!busy) onDismiss(); }}
    >
      <article
        className="relative surface-paper max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-fade-up"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(184, 146, 58, 0.5)' }}
      >
        {/* Inner gilt frame and corner ornaments */}
        <div className="absolute inset-2 border border-gold-500/30 pointer-events-none" />
        <div className="absolute top-3 left-3 text-gold-500 pointer-events-none"><CornerOrnament corner="tl" size={24} /></div>
        <div className="absolute top-3 right-3 text-gold-500 pointer-events-none"><CornerOrnament corner="tr" size={24} /></div>
        <div className="absolute bottom-3 left-3 text-gold-500 pointer-events-none"><CornerOrnament corner="bl" size={24} /></div>
        <div className="absolute bottom-3 right-3 text-gold-500 pointer-events-none"><CornerOrnament corner="br" size={24} /></div>

        <div className="px-10 py-9">

          {/* Eyebrow */}
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-700 mb-3">
            Peer Review · Editorial Decision
          </p>

          {/* Headline */}
          <h2 className={`font-display text-4xl font-bold leading-tight ${isApproved ? 'text-verdigris-600' : 'text-oxblood-500'}`}>
            {isApproved ? `${kindNoun} Accepted for Publication` : 'Revisions Required'}
          </h2>

          {/* Title (approved) + metadata line */}
          {isApproved && submission.publication_title && (
            <p className="font-serif italic text-ink-700 text-base mt-2">
              re:&nbsp;<span className="not-italic font-semibold">{submission.publication_title}</span>
            </p>
          )}
          <p className="font-serif italic text-ink-700 text-sm mt-1">
            Submitted year {submission.year_submitted} · Resolved year {submission.resolved_year} · {submission.kind}
          </p>

          <FleuronDivider className="my-6" />

          {/* Approved: prestige panel (mirrors solo) */}
          {isApproved && (
            <div className="my-6 border-t border-b border-gold-500/30 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-700 mb-2 text-center">
                Prestige Earned
              </p>
              <p className="font-display text-5xl font-bold text-ink-900 text-center leading-none">
                +{submission.prestige_granted}
              </p>
            </div>
          )}

          {/* Peer reviews */}
          <section className="mb-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-700 mb-2">
              Peer Reviews
            </p>
            {submission.reviews.length === 0 ? (
              <p className="font-serif italic text-ink-700 text-sm">No reviews were recorded.</p>
            ) : (
              <ul className="space-y-2">
                {submission.reviews.map((r, i) => (
                  <li key={i} className={`p-3 border ${
                    r.verdict === 'approve'
                      ? 'border-verdigris-500/50 bg-verdigris-500/10'
                      : 'border-oxblood-500/50 bg-oxblood-500/10'
                  }`}>
                    <div className="flex justify-between items-baseline">
                      <span className="font-display font-semibold text-ink-900">{r.reviewer_name}</span>
                      <span className={`font-mono text-xs uppercase tracking-wider ${
                        r.verdict === 'approve' ? 'text-verdigris-700' : 'text-oxblood-700'
                      }`}>
                        {r.verdict === 'approve' ? '✓ Approve' : '✗ Reject'}
                      </span>
                    </div>
                    {r.flagged_card_ids && r.flagged_card_ids.length > 0 && (
                      <div className="font-serif text-xs text-ink-700 mt-1">
                        Flagged {r.flagged_card_ids.length} card{r.flagged_card_ids.length === 1 ? '' : 's'}
                      </div>
                    )}
                    {r.comment && (
                      <div className="font-serif italic text-sm text-ink-800 mt-1">"{r.comment}"</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Rejection: cards still bound to the manuscript */}
          {isRejection && submission.bound_evidence && submission.bound_evidence.length > 0 && (
            <section className="mb-5 border border-gold-500/30 bg-cream-100/60 p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-700 mb-2">
                Cards Bound to This Manuscript
              </p>
              <ul className="space-y-1 font-serif text-sm">
                {submission.bound_evidence.map((card) => (
                  <li key={card.idCard} className="text-ink-900">
                    {card.title}
                    {card.author && <span className="text-ink-700"> — {card.author}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {error && (
            <p className="font-serif italic text-oxblood-700 text-sm mb-3">{error}</p>
          )}

          {/* Objection outcome banners */}
          {objectionOutcome && objectionOutcome.outcome === 'won' && (
            <div className="mb-4 p-3 border border-verdigris-500 bg-verdigris-500/10 font-serif text-sm text-ink-900">
              <strong className="font-display text-verdigris-700">✓ Objection sustained.</strong>{' '}
              The board found a tag common to every piece of evidence and your conclusion. Your
              publication is approved and the rejecting reviewer(s) lost 5 prestige each.
            </div>
          )}
          {objectionOutcome && objectionOutcome.outcome === 'lost' && (
            <div className="mb-4 p-3 border border-oxblood-500 bg-oxblood-500/10 font-serif text-sm text-ink-900">
              <strong className="font-display text-oxblood-700">✗ Objection denied.</strong>{' '}
              No tag was common to every piece of evidence and the conclusion. The rejection stands
              and your tokens are spent.
            </div>
          )}

          {/* Sign-off */}
          <div className="mt-8 pt-4 border-t border-gold-500/30">
            <p className="font-serif italic text-ink-700 text-sm text-right">— The Editorial Board</p>
          </div>

          {/* Buttons */}
          {isApproved ? (
            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={onDismiss}
                disabled={busy}
                className="font-display font-bold uppercase tracking-[0.15em] text-sm
                           px-6 py-2 border-2 border-ink-900 text-ink-900
                           hover:bg-ink-900 hover:text-cream-50
                           transition-colors duration-200 disabled:opacity-50"
              >
                {busy ? 'Closing…' : 'Continue Career'}
              </button>
            </div>
          ) : (
            <div className="mt-6 flex flex-wrap gap-2 justify-center">
              <button type="button" onClick={onDismiss} disabled={busy} className={GHOST}>
                Set aside
              </button>
              <button
                type="button"
                onClick={onDrawConsolation}
                disabled={busy || consolationDisabled}
                title={consolationTip || undefined}
                className={GHOST}
              >
                Draw consolation
                {submission.consolation_drawn && <span className="ml-1 opacity-50">(claimed)</span>}
              </button>
              <button
                type="button"
                onClick={onReclaim}
                disabled={busy || reclaimDisabled}
                title={reclaimTip || undefined}
                className={GHOST}
              >
                Reclaim manuscript ({reclaimCount})
              </button>
              <ObjectionButton
                submission={submission}
                objConfirming={objConfirming}
                setObjConfirming={setObjConfirming}
                onObject={onObject}
                busy={busy}
              />
            </div>
          )}
        </div>
      </article>
    </div>
  );
}


/**
 * ObjectionButton — three visual states (ink-on-parchment):
 *   1. Wrong status (auto-rejected, or already objected): disabled with tooltip
 *   2. Idle: enabled ghost, "Object to the rejection" → sets confirming
 *   3. Confirming: oxblood confirm + cancel link → commits via onObject()
 * Once spent (status objection-won/lost) it stays visible but disabled,
 * showing the outcome so the writer sees a stable record of their choice.
 */
function ObjectionButton({
  submission,
  objConfirming,
  setObjConfirming,
  onObject,
  busy,
}) {
  const alreadySpent = ['objection-won', 'objection-lost'].includes(submission.status);
  const isAutoRejected = submission.status === 'auto-rejected';
  const isPeerRejected = submission.status === 'rejected';
  const canSpend = isPeerRejected && !alreadySpent;

  const tooltip = alreadySpent
    ? `Objection already spent on this manuscript (${submission.status === 'objection-won' ? 'won' : 'lost'}).`
    : isAutoRejected
    ? 'Auto-rejections cannot be appealed — the algorithm already evaluated the tags.'
    : !isPeerRejected
    ? null
    : 'If the board finds a tag common to every piece of evidence and the conclusion, the rejection is overridden and each rejecting reviewer loses 5 prestige.';

  if (!canSpend) {
    return (
      <button disabled title={tooltip || undefined} className={GHOST}>
        {alreadySpent
          ? (submission.status === 'objection-won' ? '✓ Objection won' : '✗ Objection lost')
          : 'Object to the rejection'}
      </button>
    );
  }

  if (objConfirming) {
    return (
      <span className="flex items-center gap-2">
        <button
          onClick={() => { setObjConfirming(false); onObject(); }}
          disabled={busy}
          title="Stake the rejection on the tag check"
          className="px-3 py-2 font-mono text-xs uppercase tracking-wider
                     bg-oxblood-600 hover:bg-oxblood-500 text-cream-50
                     border border-oxblood-700 disabled:opacity-50"
        >
          Object?
        </button>
        <button
          onClick={() => setObjConfirming(false)}
          disabled={busy}
          className="font-mono text-[10px] uppercase tracking-wider text-ink-700 hover:text-ink-900 underline"
        >
          cancel
        </button>
      </span>
    );
  }

  return (
    <button onClick={() => setObjConfirming(true)} disabled={busy} title={tooltip} className={GHOST}>
      Object to the rejection
    </button>
  );
}

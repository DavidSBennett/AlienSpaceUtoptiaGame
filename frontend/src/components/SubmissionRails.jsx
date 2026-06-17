/**
 * SubmissionRails — two stacked spine-list panels for the left sidebar.
 *
 * 1. OutForReview — YOUR currently-active submissions (pending + still-bound
 *    rejected manuscripts). Click a spine → opens the result dialog.
 * 2. ManuscriptInbox — OTHER players' pending submissions you can choose
 *    to review. Click → opens the review dialog.
 *
 * Each section renders submissions as stacked book-style spines, color-
 * coded by author seat.
 *
 * Props:
 *   yourSubmissions     — state.your_submissions
 *   pendingSubmissions  — state.pending_submissions (others' work)
 *   opponents           — state.opponents (for color lookup of inbox spines)
 *   yourSeat            — your seat_index (for color of out-for-review)
 *   onOpenYour          — (submission) => void
 *   onOpenInbox         — (submission) => void
 *   committedReviewSubmissionId — int|null (highlight what you're reviewing)
 *   showInbox           — bool (default true). False since peer review moved
 *                         to the synchronous review phase, which removed the
 *                         always-on inbox.
 */
import { colorForSeat } from '../lib/playerColors.js';

export default function SubmissionRails({
  yourSubmissions,
  pendingSubmissions,
  opponents,
  yourSeat,
  onOpenYour,
  onOpenInbox,
  committedReviewSubmissionId,
  showInbox = true,
}) {
  const yourColor = colorForSeat(yourSeat);

  return (
    <div className="space-y-3">
      {/* ── OUT FOR REVIEW (yours) ── */}
      <section>
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-1.5 px-1">
          Out for Review
        </h3>
        {yourSubmissions.length === 0 ? (
          <p className="px-1 text-xs italic text-cream-200/60">
            No manuscripts in review.
          </p>
        ) : (
          <ul className="space-y-1">
            {yourSubmissions.map((sub) => (
              <SpineButton
                key={sub.submission_id}
                submission={sub}
                color={yourColor}
                onClick={() => onOpenYour(sub)}
                showStatus
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── MANUSCRIPT INBOX (others') ──
          Hidden when peer review runs in the synchronous review phase. */}
      {showInbox && (
      <section data-tutorial="manuscript-inbox">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-1.5 px-1">
          Manuscript Inbox
        </h3>
        {pendingSubmissions.length === 0 ? (
          <p className="px-1 text-xs italic text-cream-200/60">
            No manuscripts to review.
          </p>
        ) : (
          <ul className="space-y-1">
            {pendingSubmissions.map((sub) => {
              const writerSeat = sub.writer_seat;
              const col = colorForSeat(writerSeat);
              const youReviewing = committedReviewSubmissionId === sub.submission_id;
              return (
                <SpineButton
                  key={sub.submission_id}
                  submission={{
                    submission_id:    sub.submission_id,
                    status:           sub.status,
                    conclusion_title: sub.conclusion?.title || 'Untitled',
                    kind:             sub.kind,
                    evidence_count:   sub.evidence?.length || 0,
                    writer_name:      sub.writer_name,
                    is_rejection:     false,
                  }}
                  color={col}
                  onClick={() => onOpenInbox(sub)}
                  isCommittedReview={youReviewing}
                  showWriter
                />
              );
            })}
          </ul>
        )}
      </section>
      )}
    </div>
  );
}


/**
 * A single manuscript spine — looks like a book spine standing upright.
 * Color comes from the writer's seat. Click anywhere to act.
 */
function SpineButton({ submission, color, onClick, isCommittedReview, showStatus, showWriter }) {
  const isRejection = submission.is_rejection;
  return (
    <li>
      <button
        onClick={onClick}
        className={`
          w-full text-left px-2 py-1.5 border-l-4 ${color.spineEdge} ${color.accentBg}
          hover:bg-teal-800/40 transition-colors
          ${isCommittedReview ? 'ring-1 ring-gold-400' : ''}
        `}
      >
        <div className="flex items-baseline gap-2">
          <span className={`w-3 h-3 ${color.spineBg} flex-shrink-0`} aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <div className="font-display text-sm text-cream-50 truncate">
              {submission.conclusion_title}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-cream-200/70 truncate">
              {showWriter && <span>{submission.writer_name} · </span>}
              {submission.kind}
              {' · '}
              {submission.evidence_count} ev
              {showStatus && isRejection && <span className="text-oxblood-300 ml-1">· rejected</span>}
              {showStatus && !isRejection && submission.status === 'pending' && (
                <span className="text-cream-200/50 ml-1">· awaiting</span>
              )}
            </div>
          </div>
        </div>
      </button>
    </li>
  );
}

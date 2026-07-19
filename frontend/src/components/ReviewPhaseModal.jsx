/**
 * ReviewPhaseModal — the synchronous peer-review interstitial.
 *
 * Between years, when manuscripts have been published, every player is pulled
 * into this full-screen modal. It walks the table through each manuscript one
 * at a time:
 *   • The WRITER of the current manuscript sees their full evidence (content +
 *     significance) and simply acknowledges.
 *   • Everyone else sees the reviewer-safe view (title / author / tags) and must
 *     cast a verdict (Approve / Revise & Resubmit) before continuing.
 *
 * A per-manuscript barrier holds until every live player clicks the action
 * button ("Continue to Next Manuscript", or "Start Next Year" on the last one).
 * Outcomes resolve quietly once the phase ends; rewards, rejections, and revise
 * decisions surface at the start of the next year via the existing dialogs.
 *
 * Props:
 *   reviewPhase    — state.review_phase { current_index, total, manuscripts, live_players }
 *   you            — state.you
 *   busy           — bool (a network call is in flight)
 *   onSubmitReview — async ({ submission_id, verdict, flagged_card_ids, comment }) => void
 *   onContinue     — async () => void  (marks you ready for the current manuscript)
 *   showTags, showSignificance — display toggles (writer view honors significance)
 */
import { useEffect, useMemo, useState } from 'react';
import { colorForSeat } from '../lib/playerColors.js';
import FleuronDivider from './FleuronDivider.jsx';
import MinimizedInterstitialBar from './MinimizedInterstitialBar.jsx';
import EvidenceFan from './EvidenceFan.jsx';

const VERDICTS = [
  { key: 'approve', label: 'Approve', help: 'Publish it as is.' },
  { key: 'revise',  label: 'Revise & Resubmit', help: 'Flag what should be cut; the writer decides next year.' },
];

export default function ReviewPhaseModal({
  reviewPhase,
  you,
  busy,
  onSubmitReview,
  onContinue,
  showSignificance = false,
}) {
  const manuscripts = reviewPhase?.manuscripts || [];
  const index = reviewPhase?.current_index ?? 0;
  const total = reviewPhase?.total ?? manuscripts.length;
  const current = manuscripts[index] || null;

  const youId = you?.player_id;
  const isWriter = !!current?.is_writer;
  const isLast = index >= total - 1;
  const youReady = !!current?.ready_player_ids?.includes(youId);

  // Local verdict state for reviewers — seeded from any verdict already on file
  // and reset whenever the manuscript under review changes.
  const [verdict, setVerdict] = useState(null);
  const [flagged, setFlagged] = useState(() => new Set());
  const [flaggedWorks, setFlaggedWorks] = useState(() => new Set());
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const currentSid = current?.submission_id;
  useEffect(() => {
    const v = current?.your_verdict;
    setVerdict(v?.verdict ?? null);
    setFlagged(new Set(v?.flagged_card_ids ?? []));
    setFlaggedWorks(new Set(v?.flagged_work_ids ?? []));
    setComment(v?.comment ?? '');
    setError(null);
  }, [currentSid]);

  const needsFlags = verdict === 'revise';
  // A revise verdict needs at least one flagged card OR citation.
  const flagsOk = !needsFlags || flagged.size >= 1 || flaggedWorks.size >= 1;
  const verdictReady = isWriter || (verdict && flagsOk);

  // Who are we still waiting on for this manuscript?
  const waitingOn = useMemo(() => {
    const ready = new Set(current?.ready_player_ids || []);
    return (reviewPhase?.live_players || []).filter((p) => !ready.has(p.player_id));
  }, [reviewPhase, current]);

  if (!current) return null;

  const writerColor = colorForSeat(current.writer_seat);

  function toggleFlag(idCard) {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(idCard)) next.delete(idCard);
      else next.add(idCard);
      return next;
    });
  }

  function toggleFlagWork(workId) {
    setFlaggedWorks((prev) => {
      const next = new Set(prev);
      if (next.has(workId)) next.delete(workId);
      else next.add(workId);
      return next;
    });
  }

  async function handleContinue() {
    if (youReady || busy || submitting) return;
    setError(null);
    if (!isWriter) {
      if (!verdict) { setError('Choose a verdict first.'); return; }
      if (needsFlags && flagged.size < 1 && flaggedWorks.size < 1) {
        setError('Flag at least one piece of evidence or citation.');
        return;
      }
    }
    setSubmitting(true);
    try {
      if (!isWriter) {
        await onSubmitReview({
          submission_id: current.submission_id,
          verdict,
          flagged_card_ids: needsFlags ? [...flagged] : [],
          flagged_work_ids: needsFlags ? [...flaggedWorks] : [],
          comment: comment.trim() || null,
        });
      }
      await onContinue();
    } catch (e) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  const continueLabel = isLast ? 'Start Next Year' : 'Continue to Next Manuscript';

  // Minimized: collapse to a bar so the player can see their hand below.
  if (minimized) {
    return (
      <MinimizedInterstitialBar
        label={`Peer Review · ${Math.min(index + 1, total)} of ${total}`}
        hint={isWriter ? 'your manuscript' : (youReady ? 'waiting for others' : 'your review is needed')}
        onRestore={() => setMinimized(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[120] bg-teal-950/90 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto animate-fade-in">
      <div
        className="relative surface-paper max-w-4xl w-full my-6 animate-fade-up"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(184, 146, 58, 0.5)' }}
      >
        <div className="absolute inset-2 border border-gold-500/30 pointer-events-none" />

        {/* Minimize — peek at your hand without losing the review. */}
        <button
          type="button"
          onClick={() => setMinimized(true)}
          title="Minimize — check your hand"
          className="absolute top-3 right-3 z-30 px-3 py-1 font-mono text-[10px] uppercase tracking-wider bg-cream-50 border border-gold-500 text-ink-900 hover:bg-gold-500 hover:text-teal-950 transition-colors"
        >
          — Minimize
        </button>

        <div className="px-10 py-8">
          {/* Header */}
          <div className="flex items-baseline justify-between gap-4 flex-wrap pr-28">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-700 mb-1">
                Peer Review
              </p>
              <h2 className="font-display text-3xl font-bold text-ink-900 leading-tight">
                Manuscript {Math.min(index + 1, total)} of {total}
              </h2>
            </div>
            <div className="text-right">
              <div className={`font-mono text-[10px] uppercase tracking-[0.15em] ${writerColor.accent}`}>
                {current.kind === 'book' ? 'Book' : 'Article'} · Year {current.year_submitted}
              </div>
              <div className="font-display text-lg text-ink-900">
                {current.writer_name}{isWriter && <span className="text-gold-700"> (you)</span>}
              </div>
            </div>
          </div>

          {/* Conclusion + argument */}
          <div className="mt-4">
            <h3 className="font-display text-2xl font-bold text-ink-900">
              {current.conclusion?.title || 'Untitled'}
            </h3>
            {/* Tags are hidden scaffolding — reviewers see them to judge the
                argument, but never the writer (of their own manuscript). */}
            {!isWriter && (() => {
              const concTags = [current.conclusion?.argument, current.conclusion?.sub_argument]
                .filter(Boolean).join(', ');
              return concTags ? (
                <p className="font-mono text-xs uppercase tracking-[0.15em] text-ink-900 mt-1">
                  Conclusion tag:{' '}
                  <span className="font-bold text-gold-800">{concTags}</span>
                </p>
              ) : null;
            })()}
            {current.conclusion?.description && (
              <p className="font-serif italic text-ink-800 mt-1">{current.conclusion.description}</p>
            )}
            {current.argument_text
              ? <p className="font-serif text-ink-900 mt-3 leading-relaxed">{current.argument_text}</p>
              : <p className="font-serif italic text-ink-800 mt-3">The writer will explain by voice.</p>}
          </div>

          <FleuronDivider className="my-5" />

          {/* Evidence. Reviewers get the fanned visualization (which exposes the
              cards' tags to judge support) and can flag off-topic cards. The
              WRITER never sees the fan — tags stay hidden from them — only their
              own full content + significance table. */}
          <h3 className="font-display text-lg font-bold uppercase tracking-widest text-ink-900 mb-2">
            Evidence
          </h3>

          {!isWriter && (
            <>
              <div className="mb-2">
                <EvidenceFan
                  evidence={current.evidence || []}
                  citations={current.citations || []}
                  conclusion={current.conclusion}
                  flaggable={needsFlags}
                  flagged={flagged}
                  onToggleFlag={toggleFlag}
                  worksFlaggable={needsFlags}
                  flaggedWorks={flaggedWorks}
                  onToggleFlagWork={toggleFlagWork}
                />
              </div>
              {needsFlags && (
                <p className="font-serif italic text-ink-700 text-xs text-center mb-2">
                  Click any card — evidence or a cited work — to flag what doesn't fit the conclusion
                  ({flagged.size + flaggedWorks.size} flagged).
                </p>
              )}
            </>
          )}

          {/* The writer sees full content + significance — no tags. */}
          {isWriter && (
            <WriterEvidence evidence={current.evidence} showSignificance={showSignificance} />
          )}

          {/* Reviewer verdict controls */}
          {!isWriter && (
            <div className="mt-5">
              <div className="flex flex-wrap gap-2">
                {VERDICTS.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setVerdict(v.key)}
                    disabled={youReady}
                    className={`px-4 py-2 font-mono text-xs uppercase tracking-wider border transition-colors ${
                      verdict === v.key
                        ? 'bg-teal-800 text-cream-50 border-gold-500'
                        : 'bg-cream-50 text-ink-900 border-cream-300 hover:border-gold-500'
                    } disabled:opacity-50`}
                    title={v.help}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              {verdict && (
                <p className="font-serif italic text-ink-800 text-sm mt-2">
                  {VERDICTS.find((v) => v.key === verdict)?.help}
                  {needsFlags && ` (${flagged.size} flagged)`}
                </p>
              )}
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={youReady}
                maxLength={500}
                placeholder="Optional note to the writer…"
                className="mt-3 w-full surface-paper border border-cream-300 px-3 py-2 font-serif text-sm text-ink-900 focus:border-gold-500 focus:outline-none disabled:opacity-60"
                rows={2}
              />
            </div>
          )}

          {error && (
            <p className="font-serif italic text-oxblood-600 text-sm mt-3">{error}</p>
          )}

          <FleuronDivider className="my-5" />

          {/* Barrier — readiness + continue */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-900">
              {waitingOn.length === 0
                ? 'Everyone is ready…'
                : <>Waiting on: {waitingOn.map((p) => p.player_name).join(' · ')}</>}
            </p>
            {isWriter ? (
              // The writer of this manuscript doesn't vote or confirm — the
              // reviewers decide and the round moves on automatically.
              <p className="font-serif italic text-ink-800 text-sm">
                You wrote this — the reviewers are deciding. You'll move on automatically.
              </p>
            ) : (
              <button
                type="button"
                onClick={handleContinue}
                disabled={youReady || busy || submitting || !verdictReady}
                className="px-6 py-3 font-mono text-sm uppercase tracking-wider bg-gold-500 hover:bg-gold-400 text-teal-950 border border-gold-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {youReady ? 'Waiting for others…' : (submitting ? 'Submitting…' : continueLabel)}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


/** Full evidence table — the writer's own manuscript. */
function WriterEvidence({ evidence, showSignificance }) {
  if (!evidence || evidence.length === 0) {
    return <p className="font-serif italic text-ink-800">No evidence recorded.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-cream-200/60 border-b border-gold-500/50 text-left">
            <th className="font-display font-bold px-3 py-2 text-ink-900 text-xs uppercase tracking-wider w-[22%]">Title</th>
            <th className="font-display font-bold px-3 py-2 text-ink-900 text-xs uppercase tracking-wider w-[44%]">Content</th>
            {showSignificance && (
              <th className="font-display font-bold px-3 py-2 text-ink-900 text-xs uppercase tracking-wider w-[34%]">Significance</th>
            )}
          </tr>
        </thead>
        <tbody>
          {evidence.map((ev, i) => (
            <tr key={ev.idCard ?? i} className="border-b border-gold-500/20 align-top">
              <td className="font-serif px-3 py-2 text-ink-900">
                <span className="font-semibold">{ev.title || '—'}</span>
                {ev.author && <span className="block font-mono text-[10px] text-ink-700">{ev.author}</span>}
              </td>
              <td className="font-serif px-3 py-2 text-ink-900 leading-relaxed">{ev.content || '—'}</td>
              {showSignificance && (
                <td className="font-serif px-3 py-2 text-ink-900 italic leading-relaxed">{ev.significance || '—'}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}



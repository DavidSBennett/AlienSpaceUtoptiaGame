import { useState } from 'react';
import MinimizedInterstitialBar from './MinimizedInterstitialBar.jsx';

/**
 * AftermathPhaseModal — the final-year writer-response window.
 *
 * On the last year, a manuscript can still come back as a Revise & Resubmit, or
 * as a peer rejection the writer could contest with objection tokens. Normally
 * that reply happens "next year"; on the final year there is none — so the game
 * holds in this phase until every writer has resolved or signed off.
 *
 * Resolution reuses the normal dialogs: clicking an open item asks the parent
 * to pop the Revise & Resubmit decision dialog or the publication-result dialog
 * (with its Object button). The modal collapses to a bar (Use the board) so the
 * writer can reach those dialogs and their hand, then sign off here.
 *
 * Props:
 *   aftermath — { you_ready, your_open: [{submission_id, kind, conclusion_title, resp_type}], waiting_on: [name] }
 *   busy      — disables actions while a request is in flight
 *   onResolve — (item) => void   open the right dialog for one open manuscript
 *   onFinish  — () => void       sign off ("end the game")
 */
export default function AftermathPhaseModal({ aftermath, busy, onResolve, onFinish }) {
  const [minimized, setMinimized] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const open = aftermath?.your_open || [];
  const waiting = aftermath?.waiting_on || [];
  const hasOpen = open.length > 0;
  const youReady = !!aftermath?.you_ready;

  if (minimized) {
    return (
      <MinimizedInterstitialBar
        label="Final Decisions"
        hint={hasOpen ? `${open.length} awaiting your decision` : 'waiting on the table'}
        onRestore={() => setMinimized(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-teal-950/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg surface-binding border border-gold-500/50 p-6 shadow-card-hover animate-fade-up">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-400 text-center mb-1">
          The Final Year Is Over
        </p>
        <h2 className="font-display text-2xl text-cream-50 text-center mb-3">
          Last Words on Your Work
        </h2>

        <p className="font-serif text-cream-200/80 text-sm text-center mb-5">
          Before the game closes, settle any manuscript still awaiting your
          response. Resolve them below, then end the game.
        </p>

        {youReady ? (
          <>
            <p className="font-serif italic text-cream-200/80 text-sm text-center mb-4">
              You've signed off.{' '}
              {waiting.length > 0
                ? 'The game will end once the others finish.'
                : 'Wrapping up the final standings…'}
            </p>
            {waiting.length > 0 && (
              <p className="font-mono text-[10px] uppercase tracking-wider text-cream-200/50 text-center mb-4">
                Waiting on: {waiting.join(' · ')}
              </p>
            )}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setMinimized(true)}
                className="font-mono text-[10px] uppercase tracking-wider px-3 py-2
                           text-cream-200/70 hover:text-cream-50 underline"
              >
                Use the board ▾
              </button>
            </div>
          </>
        ) : (
        <>
        {hasOpen ? (
          <ul className="space-y-2 mb-5">
            {open.map((item) => (
              <li
                key={item.submission_id}
                className="surface-well p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-display text-cream-50 truncate">
                    {item.conclusion_title}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-cream-200/60">
                    {item.kind}{' · '}
                    {item.resp_type === 'revise'
                      ? 'Revise & Resubmit — your decision'
                      : 'Rejected — you may contest it'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onResolve(item)}
                  disabled={busy}
                  className="flex-shrink-0 font-mono text-[10px] uppercase tracking-wider px-3 py-2
                             bg-gold-500 hover:bg-gold-400 text-teal-950 border border-gold-700
                             disabled:opacity-50"
                >
                  {item.resp_type === 'revise' ? 'Decide' : 'Review'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-serif italic text-cream-200/70 text-sm text-center mb-5">
            You've settled all of your manuscripts.
          </p>
        )}

        {waiting.length > 0 && (
          <p className="font-mono text-[10px] uppercase tracking-wider text-cream-200/50 text-center mb-4">
            Waiting on: {waiting.join(' · ')}
          </p>
        )}

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="font-mono text-[10px] uppercase tracking-wider px-3 py-2
                       text-cream-200/70 hover:text-cream-50 underline"
          >
            Use the board ▾
          </button>

          {confirming ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setConfirming(false); onFinish(); }}
                disabled={busy}
                className="font-mono text-[10px] uppercase tracking-wider px-3 py-2
                           bg-oxblood-600 hover:bg-oxblood-500 text-cream-50
                           border border-oxblood-700 disabled:opacity-50"
              >
                End anyway?
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="font-mono text-[10px] uppercase tracking-wider text-cream-200/70 hover:text-cream-50 underline"
              >
                cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => (hasOpen ? setConfirming(true) : onFinish())}
              disabled={busy}
              className="font-mono text-[10px] uppercase tracking-wider px-4 py-2
                         bg-gold-500 hover:bg-gold-400 text-teal-950 border border-gold-700
                         disabled:opacity-50"
            >
              {hasOpen ? 'End the game' : "I'm done — end the game"}
            </button>
          )}
        </div>

        {hasOpen && (
          <p className="font-serif italic text-cream-200/50 text-[11px] text-center mt-3">
            Ending now lets the current outcomes stand on anything you leave unresolved.
          </p>
        )}
        </>
        )}
      </div>
    </div>
  );
}

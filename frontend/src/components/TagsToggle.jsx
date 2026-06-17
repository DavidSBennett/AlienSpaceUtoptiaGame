import { useState } from 'react';
import { verifyTagCode } from '../api/client.js';

/**
 * TagsToggle — the "Tags · On/Off" button with an inline unlock gate.
 *
 * Behavior:
 *   - Locked by default. Clicking the button shows an inline code input.
 *   - Submitting the correct code unlocks tags for the rest of the game session.
 *   - Once unlocked, the button toggles freely (no further prompt).
 *   - Wrong codes shake the input and show a "Invalid code" hint.
 *   - The unlock state lives in component state — refreshing the page
 *     (which destroys the React tree) re-locks. This is intentional;
 *     per design, the unlock is per-game-session.
 *
 * The actual tag visibility lives in useGameState (state.showTags) so the
 * rest of the app already responds to it. This component just gates the
 * toggle action.
 *
 * @param {boolean}  showTags    current visibility state from useGameState
 * @param {Function} onToggle    callback to flip showTags (the dispatcher)
 */
export default function TagsToggle({ showTags, onToggle }) {
  // Has the player ever entered the correct code this session?
  const [unlocked, setUnlocked] = useState(false);

  // Is the inline code prompt currently visible?
  const [prompting, setPrompting] = useState(false);

  // What the player has typed so far
  const [codeInput, setCodeInput] = useState('');

  // Verification status — visible feedback during/after submit
  const [verifyStatus, setVerifyStatus] = useState('idle');  // 'idle' | 'verifying' | 'invalid' | 'network-error'
  const [verifyError, setVerifyError] = useState(null);

  // The button click: if already unlocked, just toggle. Otherwise reveal
  // the code prompt (deferring the actual toggle until they verify).
  function handleButtonClick() {
    if (unlocked) {
      onToggle();
      return;
    }
    // Open the prompt — but if it's already open, just close it without action.
    setPrompting((p) => !p);
    setCodeInput('');
    setVerifyStatus('idle');
    setVerifyError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const code = codeInput.trim();
    if (code === '') return;

    setVerifyStatus('verifying');
    setVerifyError(null);

    try {
      const result = await verifyTagCode(code);
      if (result?.valid) {
        // Unlock! Hide the prompt and toggle on the same action.
        setUnlocked(true);
        setPrompting(false);
        setCodeInput('');
        setVerifyStatus('idle');
        onToggle();
      } else {
        setVerifyStatus('invalid');
        // Clear the input so they can try again without backspacing
        setCodeInput('');
      }
    } catch (err) {
      setVerifyStatus('network-error');
      setVerifyError(err.message);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={handleButtonClick}
        className={`
          font-mono text-xs uppercase tracking-wider px-3 py-1 border transition-colors
          ${showTags
            ? 'bg-gold-500 text-teal-950 border-gold-400'
            : 'border-gold-500/40 text-cream-200 hover:border-gold-400 hover:text-cream-50'
          }
        `}
        title={
          unlocked
            ? (showTags ? 'Tags are visible' : 'Tags are hidden')
            : 'Tags locked — instructor code required'
        }
      >
        {showTags ? 'Tags · On' : (unlocked ? 'Tags · Off' : 'Tags · 🔒')}
      </button>

      {/* Inline code prompt — anchored below the button, floats above other
          content. Only rendered while prompting=true. */}
      {prompting && (
        <div
          className="absolute right-0 top-full mt-2 z-[60] w-72 surface-paper p-4 shadow-lg"
          style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
        >
          <div className="absolute inset-1 border border-gold-500/30 pointer-events-none" />

          <p className="font-mono text-[10px] uppercase tracking-widest text-gold-700 mb-2 relative">
            Instructor Code Required
          </p>
          <p className="font-serif italic text-ink-700 text-xs mb-3 relative leading-snug">
            Ask your instructor for the code to reveal tags.
          </p>

          <form onSubmit={handleSubmit} className="relative">
            <input
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="Enter code"
              maxLength={50}
              className="w-full mb-2 px-3 py-2 font-sans text-sm bg-cream-50 text-ink-900 border border-cream-300 focus:border-gold-500 focus:outline-none placeholder:text-ink-700/80"
              autoFocus
              disabled={verifyStatus === 'verifying'}
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={codeInput.trim() === '' || verifyStatus === 'verifying'}
                className="flex-1 px-3 py-1.5 font-sans text-sm text-cream-50 bg-teal-800 border border-gold-500 hover:bg-teal-700 hover:border-gold-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ letterSpacing: '0.04em' }}
              >
                {verifyStatus === 'verifying' ? 'Checking…' : 'Unlock'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPrompting(false);
                  setVerifyStatus('idle');
                  setCodeInput('');
                }}
                className="px-3 py-1.5 font-sans text-sm text-ink-700 border border-cream-300 hover:border-ink-700 hover:text-ink-900 transition-colors flex-shrink-0"
                style={{ letterSpacing: '0.04em' }}
              >
                Cancel
              </button>
            </div>
          </form>

          {verifyStatus === 'invalid' && (
            <p className="font-serif italic text-oxblood-500 text-xs mt-2 relative">
              Incorrect code. Try again.
            </p>
          )}
          {verifyStatus === 'network-error' && (
            <p className="font-serif italic text-oxblood-500 text-xs mt-2 relative">
              Could not reach the server. {verifyError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

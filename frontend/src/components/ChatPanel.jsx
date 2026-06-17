/**
 * ChatPanel — slide-in chat overlay. Mirrors ActionHistoryModal's
 * pattern but enters from the RIGHT instead of the left, so both can
 * be open simultaneously without overlapping.
 *
 * Inputs come from the polled game state (chat_messages on the
 * mp_getGameState response). Sending is fire-and-forget — the message
 * appears in your panel on the next poll, like everyone else's.
 *
 * Unread tracking: when the panel is closed and new messages arrive,
 * we badge the toggle button. The parent component owns the open/
 * closed state and the seenMessageId pointer; this component just
 * renders and emits.
 *
 * Props:
 *   open         — bool; whether the panel is visible
 *   onClose      — () => void
 *   messages     — array of { message_id, player_id, player_name, content, created_at }
 *   youPlayerId  — for "your own messages" alignment styling
 *   onSend       — async (text) => void
 *   playPing     — optional () => void — called when a new incoming
 *                  message arrives while the panel is open
 */
import { useEffect, useRef, useState } from 'react';

export default function ChatPanel({ open, onClose, messages = [], youPlayerId, onSend, playPing }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const lastSeenIdRef = useRef(0);

  // Auto-scroll to bottom when new messages arrive AND the panel is
  // open. If the panel is closed, we skip the scroll (no point) but
  // still fire the ping sound for incoming messages.
  useEffect(() => {
    if (messages.length === 0) return;
    const lastId = messages[messages.length - 1].message_id;
    const isFirstLoad = lastSeenIdRef.current === 0;
    const isNew = lastId > lastSeenIdRef.current;
    lastSeenIdRef.current = lastId;
    if (!isFirstLoad && isNew) {
      // Incoming ping — but only for messages not from YOU (you don't
      // need to hear your own message arrive). Also only when the
      // last message is from someone else.
      const last = messages[messages.length - 1];
      if (last.player_id !== youPlayerId && playPing) {
        playPing();
      }
    }
    if (open && scrollRef.current) {
      // Defer to next frame so the new message DOM is in place.
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }
  }, [messages, open, youPlayerId, playPing]);

  async function handleSend(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setError(null);
    setBusy(true);
    try {
      await onSend(text);
      setDraft('');
    } catch (err) {
      setError(err.message || 'Failed to send');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Backdrop — same dim as the action history modal for visual
          consistency. Clicking it closes the panel. */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        // Slides in from the right via translate-x. Closed state is
        // off-screen-right (translate-x-full); open is translate-x-0.
        className={`
          fixed right-0 top-0 bottom-0 z-50 w-96 max-w-[90vw]
          surface-binding border-l border-gold-500/40
          transition-transform duration-300 ease-desk
          ${open ? 'translate-x-0' : 'translate-x-full'}
          flex flex-col
        `}
        aria-label="Chat"
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-gold-500/30">
          <p className="font-display text-lg text-cream-50">Chat</p>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[10px] uppercase tracking-wider text-cream-200 hover:text-gold-300"
          >
            Close ✕
          </button>
        </header>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-2"
        >
          {messages.length === 0 ? (
            <p className="font-serif italic text-cream-200/60 text-sm text-center mt-4">
              No messages yet. Say something.
            </p>
          ) : (
            messages.map((m) => (
              <ChatMessage key={m.message_id} msg={m} isYou={m.player_id === youPlayerId} />
            ))
          )}
        </div>

        <form
          onSubmit={handleSend}
          className="border-t border-gold-500/30 p-3 flex gap-2"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Say something…"
            maxLength={500}
            className="input-dark flex-1 text-sm"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || draft.trim().length === 0}
            className="btn-primary text-sm px-3"
          >
            Send
          </button>
        </form>

        {error && (
          <div className="px-3 pb-3 font-serif italic text-oxblood-300 text-xs">
            {error}
          </div>
        )}
      </aside>
    </>
  );
}


function ChatMessage({ msg, isYou }) {
  // Render times in HH:MM local — full timestamps clutter the panel.
  let timeLabel = '';
  if (msg.created_at) {
    const d = new Date(msg.created_at.replace(' ', 'T') + 'Z');
    if (!isNaN(d)) {
      timeLabel = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  return (
    <div className={`flex flex-col ${isYou ? 'items-end' : 'items-start'}`}>
      <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-cream-200/60 mb-0.5">
        {isYou ? 'You' : (msg.player_name || 'Unknown')}
        {timeLabel && <span className="ml-2 text-cream-200/40">{timeLabel}</span>}
      </div>
      <div
        className={`
          max-w-[80%] px-3 py-2 border text-sm font-serif
          ${isYou
            ? 'bg-gold-700/30 border-gold-500/40 text-cream-50'
            : 'bg-ink-900/60 border-cream-50/15 text-cream-50'}
        `}
      >
        {msg.content}
      </div>
    </div>
  );
}

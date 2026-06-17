import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';

import { useMultiplayerGame } from '../hooks/useMultiplayerGame.js';
import { mpStartGame, mpSendChatMessage, mpCancelGame, mpSetGameToggle } from '../api/multiplayer.js';
import { loadSession, clearSession } from '../api/mpSession.js';
import FleuronDivider from '../components/FleuronDivider.jsx';
import CornerOrnament from '../components/CornerOrnament.jsx';
import { isTutorialEnabled, setTutorialEnabled } from '../lib/tutorialStorage.js';
import useUserSetting from '../auth/useUserSetting.js';
import ChatPanel from '../components/ChatPanel.jsx';
import { playChatPing } from '../lib/sounds.js';

/**
 * MultiplayerWaitingRoom — the lobby for a specific gameId. Shows the
 * gathered players. Host sees a Start button (disabled until 2+ players).
 * Non-hosts wait. When the host clicks Start, status flips to 'active'
 * and all clients auto-navigate to the game page.
 */
export default function MultiplayerWaitingRoom() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Chat panel state — same pattern as MultiplayerGame.
  const [chatOpen, setChatOpen] = useState(false);
  const [lastSeenChatId, setLastSeenChatId] = useState(0);

  // Tutorial setting — persisted to user_settings via useUserSetting.
  // Mirrored on the create-game screen; this one exists so a player
  // who joined directly via shared lobby link can still opt out.
  const [tutorialOn, setTutorialOn] = useUserSetting('tutorial_enabled', true);
  function toggleTutorial() {
    setTutorialOn(!tutorialOn);
  }

  const session = loadSession(gameId);
  const playerToken = session?.player_token;

  const { state, error: pollError, isLoading, refresh } = useMultiplayerGame(playerToken, {
    intervalMs: 5000,
    enabled: !!playerToken,
  });

  useEffect(() => {
    if (!playerToken) navigate('/multiplayer');
  }, [playerToken, navigate]);

  useEffect(() => {
    if (state?.game?.status === 'active') {
      navigate(`/multiplayer/game/${gameId}`);
    } else if (state?.game?.status === 'ended') {
      clearSession(gameId);
      navigate('/multiplayer');
    }
  }, [state?.game?.status, gameId, navigate]);

  async function handleSetToggle(toggle, value) {
    setError(null);
    try {
      await mpSetGameToggle({ player_token: playerToken, toggle, value });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleStart() {
    setError(null);
    setBusy(true);
    try {
      await mpStartGame({ player_token: playerToken });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!window.confirm('Delete this game for everyone? This cannot be undone.')) return;
    setError(null);
    setBusy(true);
    try {
      await mpCancelGame(playerToken);
      navigate('/multiplayer');
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (!playerToken) return null;
  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 py-12">
        <p className="font-serif italic text-cream-200/70">Loading lobby…</p>
      </main>
    );
  }
  if (pollError) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 py-12">
        <div className="text-center">
          <p className="font-serif italic text-oxblood-300 mb-4">Lost connection: {pollError}</p>
          <Link to="/" className="btn-primary inline-block">Return to Lobby</Link>
        </div>
      </main>
    );
  }
  if (!state) return null;

  const isHost = state.game.host_player_id === session.player_id;
  const players = [state.you, ...state.opponents].sort((a, b) => a.seat_index - b.seat_index);
  const canStart = isHost && players.length >= 2;

  // Unread chat count — messages from others newer than last-seen pointer.
  const unreadChat = Math.max(0,
    (state.chat_messages || [])
      .filter((m) => m.message_id > lastSeenChatId && m.player_id !== state.you.player_id)
      .length
  );

  function openChat() {
    setChatOpen(true);
    const last = state.chat_messages?.[state.chat_messages.length - 1];
    if (last) setLastSeenChatId(last.message_id);
  }
  function closeChat() {
    const last = state.chat_messages?.[state.chat_messages.length - 1];
    if (last) setLastSeenChatId(last.message_id);
    setChatOpen(false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="relative max-w-2xl w-full">
        <div className="relative border border-gold-500/40 px-10 py-10 surface-binding">
          <div className="absolute inset-2 border border-gold-500/20 pointer-events-none" />

          <div className="absolute top-3 left-3 text-gold-400 pointer-events-none">
            <CornerOrnament corner="tl" size={28} />
          </div>
          <div className="absolute top-3 right-3 text-gold-400 pointer-events-none">
            <CornerOrnament corner="tr" size={28} />
          </div>
          <div className="absolute bottom-3 left-3 text-gold-400 pointer-events-none">
            <CornerOrnament corner="bl" size={28} />
          </div>
          <div className="absolute bottom-3 right-3 text-gold-400 pointer-events-none">
            <CornerOrnament corner="br" size={28} />
          </div>

          <div className="text-center relative z-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-400 mb-3">
              Awaiting Scholars
            </p>
            <h1 className="font-display text-4xl text-cream-50">Waiting Room</h1>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream-200/60 mt-2">
              Game #{gameId} · {players.length} of 5
              {isHost && <span className="ml-2 text-gold-400">· you host</span>}
            </p>

            {/* Chat toggle — placed in the title block so it's the only
                player-visible "active" UI besides Start/Tutorial. Unread
                badge mirrors the in-game pattern. */}
            <button
              type="button"
              onClick={openChat}
              className="relative mt-3 font-mono text-[10px] uppercase tracking-wider text-cream-200 hover:text-gold-300 underline-offset-2 hover:underline"
            >
              💬 Chat
              {unreadChat > 0 && (
                <span
                  className="absolute -top-1 -right-3 min-w-[16px] h-[16px] px-1 flex items-center justify-center bg-oxblood-500 text-cream-50 font-mono text-[9px] rounded-full"
                  aria-hidden="true"
                >
                  {unreadChat > 99 ? '99+' : unreadChat}
                </span>
              )}
            </button>
          </div>

          <FleuronDivider className="my-6" />

          <ul className="mb-6 space-y-2">
            {players.map((p) => (
              <li
                key={p.player_id || p.seat_index}
                className="surface-well p-3 flex justify-between items-center"
              >
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-gold-400 mr-3">
                    Seat {p.seat_index + 1}
                  </span>
                  <span className="font-display text-cream-50">{p.player_name}</span>
                </div>
                <div className="flex gap-3 font-mono text-[10px] uppercase tracking-[0.15em] text-cream-200/60">
                  {p.seat_index === 0 && <span>host</span>}
                  {p.player_id === session.player_id && <span className="text-gold-400">you</span>}
                </div>
              </li>
            ))}
          </ul>

          {error && (
            <div className="mb-4 p-3 bg-oxblood-700/40 border border-oxblood-500 text-oxblood-300 font-serif">
              {error}
            </div>
          )}

          {/* Tutorial toggle — last chance to opt out before game starts.
              Per-player; affects only the player viewing this screen. */}
          <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={tutorialOn}
              onChange={toggleTutorial}
              className="accent-gold-500"
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
              Show tutorial hints
            </span>
          </label>

          {/* Table settings — host-controlled, apply to EVERY player.
              Non-hosts see the current state but can't change it. */}
          <div className="mb-4 surface-well p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-2">
              Table settings{!isHost && ' · host controls'}
            </p>
            <label className={`flex items-center gap-2 mb-1.5 select-none ${isHost ? 'cursor-pointer' : 'opacity-70 cursor-not-allowed'}`}>
              <input
                type="checkbox"
                checked={!!state.game.force_show_tags}
                disabled={!isHost || busy}
                onChange={(e) => handleSetToggle('tags', e.target.checked)}
                className="accent-gold-500"
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-cream-200">
                Show tags to all players
              </span>
            </label>
            <label className={`flex items-center gap-2 select-none ${isHost ? 'cursor-pointer' : 'opacity-70 cursor-not-allowed'}`}>
              <input
                type="checkbox"
                checked={!!state.game.force_show_significance}
                disabled={!isHost || busy}
                onChange={(e) => handleSetToggle('significance', e.target.checked)}
                className="accent-gold-500"
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-cream-200">
                Show significance notes to all players
              </span>
            </label>
          </div>

          {isHost ? (
            <div>
              <button
                onClick={handleStart}
                disabled={!canStart || busy}
                className="btn-primary w-full"
              >
                {busy ? 'Starting…' : 'Begin the Game'}
              </button>
              {!canStart && players.length < 2 && (
                <p className="font-serif italic text-cream-200/70 text-sm text-center mt-3">
                  Waiting for at least one more scholar to join…
                </p>
              )}
              <button
                onClick={handleCancel}
                disabled={busy}
                className="btn-ghost w-full mt-3 text-oxblood-300"
              >
                {busy ? 'Working…' : 'Cancel & delete this game'}
              </button>
            </div>
          ) : (
            <p className="font-serif italic text-cream-200/70 text-center">
              The host will begin when ready.
            </p>
          )}
        </div>

        <div className="text-center mt-4">
          <Link to="/" className="btn-primary inline-block">
            Return to Lobby
          </Link>
        </div>
      </div>

      <ChatPanel
        open={chatOpen}
        onClose={closeChat}
        messages={state.chat_messages || []}
        youPlayerId={state.you.player_id}
        onSend={(content) => mpSendChatMessage({ player_token: session.player_token, content })}
        playPing={playChatPing}
      />
    </main>
  );
}

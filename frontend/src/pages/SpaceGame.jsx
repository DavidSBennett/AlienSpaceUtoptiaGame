import { useMemo, useState, useCallback, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSpaceGame } from '../hooks/useSpaceGame.js';
import { spPlayCard, spConcede } from '../api/space.js';
import { loadSpSession } from '../api/spSession.js';

/**
 * SpaceGame — v4: THE ICC (Interstellar Cultural Council).
 *
 * No map, no resources, no modules. A shared MISSION DOCKET of cultural
 * crises sits center stage; each mission offers three competing solutions
 * (Xenogeology / Xenoanthropology / Exobiology). The first solve writes
 * that culture's story permanently, moves the shared chaos/order track,
 * and may chain follow-up missions. Server-authoritative throughout.
 */

const PANEL = 'rounded-lg border border-[#26365a] bg-[#0a1120]/90 backdrop-blur-sm';
const BTN = 'px-3 py-1.5 rounded border border-[#2f4b6e] bg-[#122036] hover:bg-[#1a2c4a] text-[#dbe4f0] text-sm disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_ACCENT = 'px-3 py-1.5 rounded border border-[#79c9d6]/70 bg-[#12454f] hover:bg-[#186273] text-[#d6f2f7] text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed';
const T_HEAD = 'text-[#79c9d6]';
const T_GOLD = 'text-[#e0b45c]';
const T_MUted = 'text-[#8593ad]';
const T_BAD = 'text-[#e58787]';
const T_GOOD = 'text-[#7fd8a0]';

const SEAT_COLORS = ['#f0c14b', '#6fce93', '#e06666', '#7f9df0', '#b8cf7a'];

const DISCIPLINES = {
  survey:      { key: 'geo',    label: 'Xenogeology',      icon: '⛏', color: '#e58787', track: 'military' },
  ethnography: { key: 'anthro', label: 'Xenoanthropology', icon: '📜', color: '#79c9d6', track: 'diplomacy' },
  biology:     { key: 'bio',    label: 'Exobiology',       icon: '🧬', color: '#7fd8a0', track: 'trade' },
};
const DISC_BY_KEY = {
  geo:    DISCIPLINES.survey,
  anthro: DISCIPLINES.ethnography,
  bio:    DISCIPLINES.biology,
};
const TIER_STYLE = {
  minor:    { label: 'MINOR',    color: '#7fd8a0' },
  major:    { label: 'MAJOR',    color: '#e0b45c' },
  critical: { label: 'CRITICAL', color: '#e58787' },
};

const AFFILIATION_LABELS = {
  wealth: 'Foundation', diplomatic_corps: 'Xenoanthropology Circle',
  trade_guild: 'Exobiology Institute', war_college: 'Xenogeology Guild',
  trophy: 'Trophy', collapse: 'ICC Collapse',
};
const AFFILIATION_SCORING = {
  wealth: 'Scores once for everyone: 1 VP per 10 credits at game end.',
  diplomatic_corps: 'At game end this card scores VP equal to your Xenoanthropology track.',
  trade_guild: 'At game end this card scores VP equal to your Exobiology track.',
  war_college: 'At game end this card scores VP equal to your Xenogeology track.',
};
const ACTION_LABELS = {
  reset: 'Regroup', survey: 'Geo solution', ethnography: 'Anthro solution',
  biology: 'Bio solution', recruit: 'Hire (2)', recruit_free: 'Hire (1, free position)',
  copy: 'Peer review',
};

const emptyDraft = { mission: null, commits: [], charter: 0, picks: [], copyTarget: null };

// ── tooltips ─────────────────────────────────────────────────────────────

function TooltipLayer({ tip }) {
  if (!tip) return null;
  const pad = 14;
  const style = {
    position: 'fixed', zIndex: 60, pointerEvents: 'none',
    left: Math.min(tip.x + pad, window.innerWidth - 360),
    top: Math.min(tip.y + pad, window.innerHeight - 300),
    maxWidth: 340,
  };
  return (
    <div style={style}
      className="rounded border border-[#79c9d6]/50 bg-[#060b16]/95 shadow-xl px-3 py-2 text-[11px] leading-snug text-[#dbe4f0]">
      {tip.node}
    </div>
  );
}

function CardTooltip({ cardKey, cards }) {
  const c = cards[cardKey];
  if (!c) return null;
  const disc = DISCIPLINES[c.action];
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-3">
        <b className={T_HEAD + ' text-[12px]'}>{c.name}</b>
        <span className={T_MUted}>{c.stage ? `Market stage ${['I', 'II', 'III', 'IV', 'V'][c.stage - 1]}` : 'Founding team'}</span>
      </div>
      <div className={T_MUted}>{ACTION_LABELS[c.action]}</div>
      <div>
        <span className={T_BAD}>⛏ {c.stats[0]}</span>{' · '}
        <span className={T_HEAD}>📜 {c.stats[1]}</span>{' · '}
        <span className={T_GOOD}>🧬 {c.stats[2]}</span>
      </div>
      <div>{c.text}</div>
      {disc && <div style={{ color: disc.color }}>Solves missions the {disc.label} way.</div>}
      {c.rider_credits > 0 && <div className={T_GOLD}>Pockets {c.rider_credits} credits.</div>}
      {c.kind !== 'starter' && (
        <div>Hiring cost: {c.cost_credits}c <span className={T_MUted}>(+ position surcharge)</span></div>
      )}
      <div className="border-t border-[#26365a] pt-1">
        <b className={T_GOLD}>{AFFILIATION_LABELS[c.affiliation]}.</b>{' '}
        {AFFILIATION_SCORING[c.affiliation] || ''}
      </div>
    </div>
  );
}

function SolutionTooltip({ mission, discKey, sol }) {
  const d = DISC_BY_KEY[discKey];
  return (
    <div className="space-y-1">
      <b style={{ color: d.color }} className="text-[12px]">{d.icon} The {d.label} way</b>
      <div className={T_MUted}>"{mission.title}" — {mission.culture}</div>
      <div className="italic">{sol.text}</div>
      <div>
        Difficulty <b className={T_GOLD}>{sol.difficulty}</b>
        {sol.difficulty !== sol.base_difficulty && (
          <span className={T_MUted}> (base {sol.base_difficulty}, chaos-adjusted)</span>
        )}
        {' · '}pays <b className={T_GOLD}>{sol.credits}c</b>
        {' · '}
        {sol.chaos > 0 && <b className={T_BAD}>chaos +{sol.chaos}</b>}
        {sol.chaos < 0 && <b className={T_GOOD}>order {Math.abs(sol.chaos)}</b>}
        {sol.chaos === 0 && <span className={T_MUted}>no unrest</span>}
      </div>
      {sol.has_follow && <div className={T_GOLD}>⛓ This choice will have consequences…</div>}
    </div>
  );
}

// ── chaos track ──────────────────────────────────────────────────────────

function ChaosBar({ chaos, mod, tipHandlers }) {
  const cells = [];
  for (let v = -10; v <= 10; v++) {
    const active = v === chaos;
    let bg = '#1a2740';
    if (v < 0) bg = active ? '#2f7d54' : '#12301f';
    if (v > 0) bg = active ? '#a83232' : '#301616';
    if (v === 0) bg = active ? '#8593ad' : '#1a2740';
    cells.push(
      <span key={v}
        className={'inline-block h-3 mr-px rounded-sm ' + (active ? 'w-4 ring-1 ring-[#f0f4fa]' : 'w-2.5')}
        style={{ backgroundColor: bg }} />
    );
  }
  return (
    <div className="flex items-center gap-2 text-[11px]"
      {...tipHandlers(
        <div className="space-y-1">
          <b className={T_HEAD + ' text-[12px]'}>The ICC — chaos {chaos > 0 ? `+${chaos}` : chaos}</b>
          <div>Every solution nudges this shared track: reckless interventions add CHAOS, respectful ones restore ORDER.</div>
          <div className={mod !== 0 ? T_GOLD : T_MUted}>
            Current effect: all mission difficulties {mod > 0 ? `+${mod}` : mod < 0 ? mod : '±0'} (1 per 3 chaos).
          </div>
          <div className={T_BAD}>At +10 the ICC COLLAPSES: the game ends at once and every player loses 10 VP.</div>
        </div>
      )}>
      <span className={T_GOOD}>ORDER</span>
      <span>{cells}</span>
      <span className={T_BAD}>COLLAPSE</span>
      <span className={'font-mono ' + (chaos >= 7 ? T_BAD : chaos <= -4 ? T_GOOD : T_MUted)}>
        {chaos > 0 ? `+${chaos}` : chaos}{mod !== 0 ? ` (diff ${mod > 0 ? '+' : ''}${mod})` : ''}
      </span>
    </div>
  );
}

// ── mission card ─────────────────────────────────────────────────────────

function MissionCard({ m, activeDisc, targeted, onClick, tipHandlers }) {
  const tier = TIER_STYLE[m.tier] || TIER_STYLE.minor;
  return (
    <button type="button" onClick={onClick}
      className={
        'text-left rounded-lg border p-3 w-full transition-colors ' +
        (targeted ? 'border-[#79c9d6] bg-[#0f1e33]/95 ' :
         'border-[#26365a] bg-[#0a1120]/90 hover:border-[#8593ad] ')
      }>
      <div className="flex justify-between items-baseline gap-2">
        <b className={'text-[13px] ' + T_HEAD}>{m.title}</b>
        <span className="text-[10px] font-mono" style={{ color: tier.color }}>
          {m.chained ? '⛓ ' : ''}{tier.label}
        </span>
      </div>
      <div className={'text-[10px] mb-1 ' + T_MUted}>{m.culture}</div>
      <div className="text-[11px] leading-snug mb-2">{m.problem}</div>
      <div className="space-y-0.5">
        {['geo', 'anthro', 'bio'].map((dk) => {
          const sol = m.solutions[dk];
          if (!sol) return null;
          const d = DISC_BY_KEY[dk];
          const isActive = activeDisc === dk;
          const handlers = tipHandlers(<SolutionTooltip mission={m} discKey={dk} sol={sol} />);
          return (
            <div key={dk} {...handlers}
              className={
                'flex items-center gap-2 text-[11px] rounded px-1.5 py-0.5 ' +
                (isActive ? 'bg-[#12303a] ring-1 ring-[#79c9d6]/60' : '')
              }>
              <span style={{ color: d.color }} className="w-4">{d.icon}</span>
              <span className="font-mono w-8">vs {sol.difficulty}</span>
              <span className={'font-mono w-9 ' + T_GOLD}>+{sol.credits}c</span>
              <span className={'font-mono w-14 ' + (sol.chaos > 0 ? T_BAD : sol.chaos < 0 ? T_GOOD : T_MUted)}>
                {sol.chaos > 0 ? `chaos +${sol.chaos}` : sol.chaos < 0 ? `order ${-sol.chaos}` : '—'}
              </span>
              {dk === 'bio' && m.your_cultures > 0 && (
                <span className={T_GOOD}>🧪+{m.your_cultures}</span>
              )}
              {sol.has_follow && <span className={T_GOLD}>⛓</span>}
            </div>
          );
        })}
      </div>
    </button>
  );
}

// ── small pieces ─────────────────────────────────────────────────────────

function CardChip({ cardKey, cards, onClick, onCommit, committed, selected, disabled, small, tipHandlers }) {
  const c = cards[cardKey];
  if (!c) return null;
  const disc = DISCIPLINES[c.action];
  return (
    <div className="relative w-28"
      {...tipHandlers(<CardTooltip cardKey={cardKey} cards={cards} />)}>
      <button type="button" onClick={onClick} disabled={disabled}
        className={
          'w-full text-left rounded-md border px-1.5 py-1 transition-colors shadow-lg ' +
          (selected ? 'border-[#79c9d6] bg-[#123143] ' :
           committed ? 'border-[#e0b45c] bg-[#2a2338] ' :
           'border-[#2f4b6e] bg-[#0c1424]/95 hover:border-[#8593ad] ') +
          (disabled ? 'opacity-50 cursor-not-allowed ' : '')
        }>
        <div className="font-semibold text-[10px] leading-tight truncate">{c.name}</div>
        <div className="flex justify-between items-baseline gap-1">
          <span className={'text-[9px] truncate ' + (disc ? '' : T_MUted)}
            style={disc ? { color: disc.color } : undefined}>
            {disc ? `${disc.icon} ${disc.label.slice(0, 8)}` : ACTION_LABELS[c.action]}
          </span>
          <span className="text-[9px] font-mono whitespace-nowrap">
            <span className={T_BAD}>{c.stats[0]}</span>/
            <span className={T_HEAD}>{c.stats[1]}</span>/
            <span className={T_GOOD}>{c.stats[2]}</span>
          </span>
        </div>
      </button>
      {onCommit && (
        <button type="button" onClick={onCommit}
          className={
            'absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[10px] leading-none border z-10 ' +
            (committed
              ? 'bg-[#e0b45c] text-[#05070f] border-[#f5d28a]'
              : 'bg-[#122036] text-[#dbe4f0] border-[#2f4b6e] hover:border-[#e0b45c]')
          }
          title={committed ? 'Keep this colleague' : 'Consult (+1 anthropology; returns on Regroup)'}>
          {committed ? '✓' : '+'}
        </button>
      )}
    </div>
  );
}

function TrackBar({ label, color, step, tipHandlers }) {
  const cells = [];
  for (let i = 1; i <= 12; i++) {
    const gate = i === 5 || i === 9;
    cells.push(
      <span key={i}
        className={
          'inline-block w-2.5 h-2.5 mr-0.5 rounded-sm ' +
          (i <= step ? 'bg-[#e0b45c] ' : 'bg-[#1a2740] ') +
          (gate ? 'ring-1 ring-[#e58787] ' : '')
        } />
    );
  }
  const handlers = tipHandlers ? tipHandlers(
    <div className="space-y-1">
      <b style={{ color }} className="text-[12px]">{label} — step {step}/12</b>
      <div>+1 per mission solved your way.</div>
      <div>Gates (red rings): step 5 needs a MAJOR solve, step 9 a CRITICAL solve. Breaking them grants research grants (+10c / +15c).</div>
      <div className={T_MUted}>Step 12 triggers the endgame (+7 VP trophy). Matching cards score VP × this number.</div>
    </div>
  ) : {};
  return (
    <div className="flex items-center gap-1.5 text-[11px]" {...handlers}>
      <span className="w-6" style={{ color }}>{label.slice(0, 2)}</span>
      <span className="whitespace-nowrap">{cells}</span>
      <span className={'font-mono ' + T_MUted}>{step}</span>
    </div>
  );
}

function Collapsible({ title, badge, open, onToggle, children }) {
  return (
    <div className={PANEL}>
      <button type="button" onClick={onToggle}
        className={'w-full flex justify-between items-center px-3 py-1.5 text-sm font-semibold ' + T_HEAD}>
        <span>{title}{badge ? <span className={'ml-2 text-[10px] font-normal ' + T_MUted}>{badge}</span> : null}</span>
        <span className={T_MUted}>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-3 pb-2">{children}</div>}
    </div>
  );
}

// ── main page ────────────────────────────────────────────────────────────

export default function SpaceGame() {
  const { gameId } = useParams();
  const session = useMemo(() => loadSpSession(gameId), [gameId]);
  const { state, error, isLoading, refresh } = useSpaceGame(session?.player_token);

  const [selectedCard, setSelectedCard] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tip, setTip] = useState(null);
  const [panels, setPanels] = useState({ council: true, market: false, story: true, log: false });
  const [handOpen, setHandOpen] = useState(true);

  const tipHandlers = useCallback((node) => ({
    onMouseEnter: (e) => setTip({ x: e.clientX, y: e.clientY, node }),
    onMouseMove: (e) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t)),
    onMouseLeave: () => setTip(null),
  }), []);

  const resetDraft = useCallback(() => {
    setSelectedCard(null);
    setDraft(emptyDraft);
    setActionError(null);
  }, []);

  // Opt out of the Historians' :root zoom while mounted.
  useEffect(() => {
    const prev = document.documentElement.style.zoom;
    document.documentElement.style.zoom = '1';
    return () => { document.documentElement.style.zoom = prev; };
  }, []);

  if (!session) {
    return (
      <Shell>
        <p>No session for this game on this device. Open it from the
          {' '}<Link className="underline" to="/space">ICC lobby</Link> to adopt it.</p>
      </Shell>
    );
  }
  if (isLoading && !state) return <Shell><p>Convening the Council…</p></Shell>;
  if (error && !state) return <Shell><p className={T_BAD}>{error}</p></Shell>;
  if (state?.message && !state.docket) {
    return (
      <Shell>
        <p>{state.message}</p>
        <Link className={BTN_ACCENT + ' inline-block'} to="/space">Back to the lobby</Link>
      </Shell>
    );
  }
  if (!state || !state.docket) {
    return (
      <Shell>
        <p>The game hasn't started yet.
          {' '}<Link className="underline" to="/space">Back to the lobby</Link>.</p>
      </Shell>
    );
  }

  const { game, cards } = state;
  const you = state.you;
  const mySeat = you.seat;
  const myTurn = game.status === 'active' && game.current_seat === mySeat;
  const activeCardDef = selectedCard ? cards[selectedCard] : null;

  const copyTargetPlayer = draft.copyTarget !== null
    ? state.players.find((p) => p.seat === draft.copyTarget) : null;
  const copiedKey = copyTargetPlayer?.discard_top || null;
  const effectiveAction = activeCardDef?.action === 'copy'
    ? (copiedKey ? cards[copiedKey].action : null)
    : activeCardDef?.action;
  const effectiveCardKey = activeCardDef?.action === 'copy' ? copiedKey : selectedCard;
  const effectiveCard = effectiveCardKey ? cards[effectiveCardKey] : null;
  const activeDiscMeta = effectiveAction ? DISCIPLINES[effectiveAction] : null;
  const activeDisc = activeDiscMeta?.key || null;

  const targetMission = draft.mission
    ? state.docket.find((m) => m.key === draft.mission) : null;
  const targetSolution = targetMission && activeDisc ? targetMission.solutions[activeDisc] : null;

  const statIdx = effectiveAction === 'survey' ? 0 : effectiveAction === 'ethnography' ? 1 : 2;
  let solveTotal = null;
  if (effectiveCard && activeDisc) {
    solveTotal = effectiveCard.stats[statIdx];
    if (activeDisc === 'geo') solveTotal += Math.floor(draft.charter / state.geo_credits_per_point);
    if (activeDisc === 'anthro') solveTotal += draft.commits.length;
    if (activeDisc === 'bio') solveTotal += (targetMission?.your_cultures || 0);
  }

  const picking = effectiveAction === 'recruit' || effectiveAction === 'recruit_free';

  function onMissionClick(key) {
    if (!activeDisc) return;
    setDraft((dr) => ({ ...dr, mission: dr.mission === key ? null : key }));
  }

  function toggleCommit(key) {
    if (activeDisc !== 'anthro') return;
    setDraft((dr) => ({
      ...dr,
      commits: dr.commits.includes(key)
        ? dr.commits.filter((k) => k !== key)
        : [...dr.commits, key],
    }));
  }

  function togglePick(key) {
    const maxPicks = activeCardDef?.action === 'recruit' ? 2 : 1;
    setDraft((dr) => {
      const has = dr.picks.includes(key);
      if (!has && dr.picks.length >= maxPicks) return dr;
      return { ...dr, picks: has ? dr.picks.filter((k) => k !== key) : [...dr.picks, key] };
    });
  }

  function buildParams() {
    const a = activeCardDef.action;
    const inner = () => {
      if (effectiveAction === 'survey') return { mission: draft.mission, charter_credits: draft.charter };
      if (effectiveAction === 'ethnography') return { mission: draft.mission, commits: draft.commits };
      if (effectiveAction === 'biology') return { mission: draft.mission };
      if (effectiveAction === 'recruit' || effectiveAction === 'recruit_free') {
        return { picks: draft.picks.map((key) => ({ card: key })) };
      }
      return {};
    };
    if (a === 'copy') return { target_seat: draft.copyTarget, params: inner() };
    return inner();
  }

  async function handleConfirm() {
    setBusy(true);
    setActionError(null);
    try {
      await spPlayCard(session.player_token, selectedCard, buildParams());
      resetDraft();
      await refresh();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConcede() {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Withdraw your team from the Council?')) return;
    try {
      await spConcede(session.player_token);
      await refresh();
    } catch (e) {
      setActionError(e.message);
    }
  }

  const blockReason = (() => {
    if (!activeCardDef) return null;
    if (!myTurn) return game.status === 'ended' ? 'The game has ended.' : 'Not your turn yet.';
    if (activeCardDef.action === 'copy' && draft.copyTarget === null) return 'Choose whose last action to peer-review.';
    if (activeDisc) {
      if (!draft.mission) return 'Click a mission on the docket to target it.';
      if (!targetSolution) return 'That mission has no solution for this discipline.';
      if (activeDisc === 'geo' && draft.charter > you.credits) return 'Charter exceeds your credits.';
      return null;
    }
    if (picking) {
      if (draft.picks.length === 0) return 'Pick a researcher from the Market panel.';
      if (you.roster + draft.picks.length > state.crew_cap) {
        return `Team roster full (${state.crew_cap} max).`;
      }
      const cost = draft.picks.reduce((sum, key) => {
        const pos = state.market.display.indexOf(key);
        return sum + cards[key].cost_credits
          + (effectiveAction === 'recruit' ? (state.position_costs[pos] || 0) : 0);
      }, 0);
      if (cost > you.credits) return `Not enough credits (${cost}c needed).`;
      return null;
    }
    return null;
  })();
  const confirmReady = activeCardDef && !blockReason;

  const ended = game.status === 'ended';
  const collapsed = game.endgame_trigger === 'chaos_collapse';

  return (
    <div className="h-screen overflow-hidden relative text-[#dbe4f0]"
      style={{ background: 'radial-gradient(ellipse at 30% 20%, #0b1226 0%, #070d1c 50%, #03060d 100%)' }}>
      <TooltipLayer tip={tip} />

      {/* top bar */}
      <div className="absolute top-0 inset-x-0 z-40 flex items-center justify-between px-4 py-1.5 bg-[#060b16]/85 backdrop-blur border-b border-[#1d2c4c]">
        <div className="flex items-center gap-4 text-sm">
          <Link to="/space" className={'underline ' + T_MUted}>← Lobby</Link>
          <span className={'font-semibold ' + T_HEAD}>THE ICC</span>
          <span className={T_MUted}>session #{game.game_id} · turn {game.turn_number}</span>
          {game.endgame_trigger && !ended && (
            <span className={T_BAD}>Final turns! ({game.final_turns_remaining} remaining)</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          {!ended && (
            <span className={myTurn ? T_GOLD + ' font-semibold' : T_MUted}>
              {myTurn ? 'YOUR TURN' : `Waiting on ${state.players.find((p) => p.seat === game.current_seat)?.name || '…'}`}
            </span>
          )}
          {!ended && <button className={BTN} onClick={handleConcede}>Concede</button>}
        </div>
      </div>

      {actionError && (
        <div className="absolute top-11 inset-x-0 z-40 px-4 py-2 bg-[#3a1420]/95 border-b border-[#e58787] text-sm">
          ⚠ {actionError}
          <button className={'ml-3 underline ' + T_MUted} onClick={() => setActionError(null)}>dismiss</button>
        </div>
      )}

      {/* chaos bar */}
      <div className="absolute top-11 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 rounded-b-lg border border-t-0 border-[#26365a] bg-[#0a1120]/90">
        <ChaosBar chaos={state.chaos} mod={state.chaos_mod} tipHandlers={tipHandlers} />
      </div>

      {/* THE DOCKET */}
      <div className="absolute top-24 bottom-40 left-2 right-[19rem] z-10 overflow-y-auto pr-1">
        <div className={'text-[11px] mb-1 ' + T_MUted}>
          Mission docket · {state.mission_stack_count} crises pending
          {activeDisc && <span style={{ color: activeDiscMeta.color }}> — click a mission to target your {activeDiscMeta.label} solution</span>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-w-4xl">
          {state.docket.map((m) => (
            <MissionCard key={m.key} m={m}
              activeDisc={activeDisc} targeted={draft.mission === m.key}
              onClick={() => onMissionClick(m.key)} tipHandlers={tipHandlers} />
          ))}
          {state.docket.length === 0 && (
            <div className={'p-4 text-sm ' + T_MUted}>The docket is clear. Every story has been written.</div>
          )}
        </div>
      </div>

      {/* right rail */}
      <div className="absolute top-12 right-2 z-30 w-72 space-y-2 max-h-[calc(100vh-11rem)] overflow-y-auto pr-0.5">
        <div className={PANEL + ' px-3 py-2 space-y-1'}>
          <TrackBar label="⛏ Xenogeology" color="#e58787" step={you.tracks.military.step} tipHandlers={tipHandlers} />
          <TrackBar label="📜 Xenoanthropology" color="#79c9d6" step={you.tracks.diplomacy.step} tipHandlers={tipHandlers} />
          <TrackBar label="🧬 Exobiology" color="#7fd8a0" step={you.tracks.trade.step} tipHandlers={tipHandlers} />
        </div>
        <Collapsible title="The Council" open={panels.council}
          onToggle={() => setPanels((p) => ({ ...p, council: !p.council }))}>
          {state.players.map((p) => (
            <div key={p.seat}
              className={'rounded border px-2 py-1.5 mb-1.5 text-sm ' +
                (game.current_seat === p.seat && !ended ? 'border-[#e0b45c]/70' : 'border-[#1d2c4c]')}>
              <div className="flex justify-between">
                <span style={{ color: SEAT_COLORS[p.seat] }} className="font-semibold">
                  {p.name}{p.is_you ? ' (you)' : ''}{p.trophy ? ' 🏆' : ''}
                </span>
                <span className="font-mono">{p.credits}c</span>
              </div>
              <div className={'text-[10px] ' + T_MUted}>
                ⛏{p.tracks.military.step} 📜{p.tracks.diplomacy.step} 🧬{p.tracks.trade.step}
                {' · '}solved {p.solves.geo + p.solves.anthro + p.solves.bio}
                {' · '}team {p.roster}/{state.crew_cap}
                {p.discard_top && <> · last: {cards[p.discard_top]?.name}</>}
                {p.conceded ? ' · withdrew' : ''}
                {ended && p.final_score !== null && <> · <b>{p.final_score} VP</b></>}
              </div>
            </div>
          ))}
        </Collapsible>

        <Collapsible title="Researcher market" badge={`${state.market.stack_count} in stock`}
          open={panels.market || picking}
          onToggle={() => setPanels((p) => ({ ...p, market: !p.market }))}>
          <div className="flex flex-wrap gap-1.5">
            {state.market.display.map((key, pos) => {
              const surcharge = state.position_costs[pos] || 0;
              return (
                <div key={key}>
                  <CardChip cardKey={key} cards={cards} small tipHandlers={tipHandlers}
                    selected={draft.picks.includes(key)}
                    disabled={!picking || !myTurn}
                    onClick={() => togglePick(key)} />
                  <div className={'text-[9px] pl-1 ' + T_MUted}>
                    {cards[key].cost_credits}c{surcharge > 0 ? ` + ${surcharge}c position` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </Collapsible>

        <Collapsible title="The story so far" badge={`${state.story.length} resolved`}
          open={panels.story}
          onToggle={() => setPanels((p) => ({ ...p, story: !p.story }))}>
          <ul className="space-y-1.5 text-[11px] max-h-64 overflow-y-auto">
            {[...state.story].reverse().map((s2, i) => {
              const d = DISC_BY_KEY[s2.discipline];
              const solver = state.players.find((p) => p.seat === s2.seat);
              return (
                <li key={i} className="border-l-2 pl-2" style={{ borderColor: d?.color || '#26365a' }}>
                  <b className={T_HEAD}>{s2.title}</b>
                  <span className={T_MUted}> — {d?.icon} {solver?.name || '?'}</span>
                  <div className={'italic ' + T_MUted}>{s2.text}</div>
                </li>
              );
            })}
            {state.story.length === 0 && <li className={T_MUted}>No crises resolved yet.</li>}
          </ul>
        </Collapsible>

        <Collapsible title="Council log" open={panels.log}
          onToggle={() => setPanels((p) => ({ ...p, log: !p.log }))}>
          <ul className={'space-y-0.5 text-[11px] max-h-48 overflow-y-auto ' + T_MUted}>
            {[...state.events].reverse().map((e) => (
              <li key={e.event_id}>{e.message}</li>
            ))}
          </ul>
        </Collapsible>
      </div>

      {/* bottom-left: your team dossier */}
      <div className={'absolute bottom-2 left-2 z-30 p-2.5 space-y-1.5 ' + PANEL}>
        <div className="flex items-center gap-3 text-sm">
          <span className={'font-mono ' + T_GOLD}
            {...tipHandlers(<div><b className={T_HEAD}>Research funding</b><div>Credits pay for hires, equipment charters, and score Wealth (1 VP per 10).</div></div>)}>
            {you.credits}c
          </span>
          <span className={'text-[11px] ' + T_MUted}
            {...tipHandlers(<div><b className={T_HEAD}>Team roster</b><div>Hand + published work, max {state.crew_cap}. Hiring needs open slots.</div></div>)}>
            team {you.roster}/{state.crew_cap}
          </span>
          {state.docket.some((m) => m.your_cultures > 0) && (
            <span className={'text-[11px] ' + T_GOOD}
              {...tipHandlers(<div><b className={T_GOOD}>Matured cultures</b><div>Failed Exobiology trials permanently add +1 on that mission. Active: {state.docket.filter((m) => m.your_cultures > 0).map((m) => `${m.title} +${m.your_cultures}`).join(', ')}.</div></div>)}>
              🧪 cultures active
            </span>
          )}
        </div>
      </div>

      {/* bottom-center: the hand */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-30 max-w-[62vw] flex flex-col items-center">
        <button type="button" onClick={() => setHandOpen((o) => !o)}
          className="px-3 py-0.5 rounded-t border border-[#26365a] bg-[#0a1120]/90 text-[11px] text-[#8593ad] hover:text-[#79c9d6]">
          Research team ({you.hand.length}) {handOpen ? '▾' : '▴'}
        </button>
        {handOpen && (
        <div className="flex gap-1.5 overflow-x-auto pt-3 pb-1 px-2 max-w-full">
          {you.hand.map((key) => (
            <div key={key}
              className="shrink-0 transition-transform hover:-translate-y-1">
              <CardChip cardKey={key} cards={cards} tipHandlers={tipHandlers}
                selected={selectedCard === key}
                committed={draft.commits.includes(key)}
                disabled={!myTurn || ended}
                onCommit={activeDisc === 'anthro' && key !== selectedCard
                  && cards[key].action !== 'reset' && myTurn && !ended
                  ? () => toggleCommit(key) : undefined}
                onClick={() => {
                  if (selectedCard === key) {
                    resetDraft();
                  } else {
                    resetDraft();
                    setSelectedCard(key);
                  }
                }} />
            </div>
          ))}
          {you.hand.length === 0 && (
            <span className={'text-sm px-3 py-2 ' + PANEL}>
              Hand empty. Published: {you.discard.map((k) => cards[k].name).join(', ') || 'nothing'}
            </span>
          )}
        </div>
        )}
      </div>

      {/* bottom-right: action panel */}
      {activeCardDef && (
        <div className={'absolute bottom-2 right-2 z-40 w-96 p-3 text-sm space-y-2 border-[#79c9d6]/50 ' + PANEL}>
          <div className="flex justify-between items-baseline">
            <b className={T_HEAD}>{activeCardDef.name}</b>
            <span className={'text-[11px] ' + T_MUted}>{ACTION_LABELS[activeCardDef.action]}</span>
          </div>
          <p className={'text-[11px] ' + T_MUted}>{activeCardDef.text}</p>

          {activeCardDef.action === 'copy' && (
            <div>
              <div className="mb-1">Peer-review whom?</div>
              <div className="flex gap-1.5 flex-wrap">
                {state.players.filter((p) => !p.is_you).map((p) => {
                  const top = p.discard_top;
                  const blocked = !top || ['reset', 'copy'].includes(cards[top]?.action);
                  return (
                    <button key={p.seat} type="button" disabled={blocked}
                      onClick={() => setDraft(() => ({ ...emptyDraft, copyTarget: p.seat }))}
                      className={BTN + ' text-[11px] ' + (draft.copyTarget === p.seat ? 'ring-1 ring-[#79c9d6]' : '')}>
                      {p.name}: {top ? cards[top]?.name : '(no discard)'}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {activeDisc && (
            <div className="text-[12px] space-y-1">
              <div>
                Proposal strength <b className={T_GOLD}>{solveTotal ?? '—'}</b>
                {targetSolution && (
                  <> vs <b className={solveTotal >= targetSolution.difficulty ? T_GOOD : T_BAD}>
                    {targetSolution.difficulty}</b>
                    {' '}on "{targetMission.title}"
                    <span className={T_MUted}> · pays {targetSolution.credits}c
                      {targetSolution.chaos !== 0 && (targetSolution.chaos > 0
                        ? `, chaos +${targetSolution.chaos}` : `, order ${-targetSolution.chaos}`)}
                    </span>
                  </>
                )}
              </div>
              {activeDisc === 'geo' && (
                <div className="flex items-center gap-2 text-[11px]">
                  Charter equipment:
                  <button type="button" className={BTN + ' px-2 py-0 text-[11px]'}
                    onClick={() => setDraft((dr) => ({ ...dr, charter: Math.max(0, dr.charter - state.geo_credits_per_point) }))}>−</button>
                  <span className="font-mono">{draft.charter}c (+{Math.floor(draft.charter / state.geo_credits_per_point)})</span>
                  <button type="button" className={BTN + ' px-2 py-0 text-[11px]'}
                    onClick={() => setDraft((dr) => ({
                      ...dr,
                      charter: Math.min(you.credits - (you.credits % state.geo_credits_per_point === 0 ? 0 : you.credits % state.geo_credits_per_point), dr.charter + state.geo_credits_per_point),
                    }))}>+</button>
                  <span className={T_MUted}>(spent win or lose)</span>
                </div>
              )}
              {activeDisc === 'anthro' && (
                <div className={'text-[10px] ' + T_MUted}>
                  Consult colleagues with the + button on hand cards (+1 each; they return on your next Regroup).
                  Consulted: {draft.commits.length}.
                </div>
              )}
              {activeDisc === 'bio' && (
                <div className={'text-[10px] ' + T_MUted}>
                  Cultures: +{targetMission?.your_cultures || 0} matured on this crisis.
                  A failed trial is never wasted — it adds +1 here permanently.
                </div>
              )}
            </div>
          )}

          {blockReason && myTurn && (
            <div className={'text-[11px] ' + T_GOLD}>▸ {blockReason}</div>
          )}

          <div className="flex gap-2">
            <button className={BTN_ACCENT} disabled={busy || !confirmReady} onClick={handleConfirm}>
              {busy ? 'Submitting…' : 'Execute'}
            </button>
            <button className={BTN} onClick={resetDraft}>Cancel</button>
          </div>
        </div>
      )}

      {ended && <ResultsOverlay state={state} collapsed={collapsed} />}
    </div>
  );
}

function ResultsOverlay({ state, collapsed }) {
  const winner = state.players.find((p) => p.seat === state.game.winner_seat);
  const ranked = [...state.players]
    .filter((p) => p.final_score !== null)
    .sort((a, b) => b.final_score - a.final_score);
  return (
    <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div className={'max-w-lg w-full p-5 space-y-3 ' + PANEL}>
        <div className={'text-xl font-semibold ' + (collapsed ? T_BAD : T_HEAD)}>
          {collapsed
            ? 'THE ICC HAS COLLAPSED'
            : <>The Council adjourns{winner ? ` — ${winner.name} leads the field` : ''}</>}
        </div>
        {collapsed && (
          <p className={'text-sm ' + T_MUted}>
            Chaos reached its breaking point. Every delegation loses 10 VP —
            the stories you wrote survive; the institution did not.
          </p>
        )}
        {ranked.map((p, i) => (
          <div key={p.seat} className="rounded border border-[#1d2c4c] px-3 py-2">
            <div className="flex justify-between text-sm">
              <b style={{ color: SEAT_COLORS[p.seat] }}>{i + 1}. {p.name}</b>
              <span className={'font-mono ' + T_GOLD}>{p.final_score} VP</span>
            </div>
            {p.score_breakdown && (
              <div className={'text-[11px] ' + T_MUted}>
                {Object.entries(p.score_breakdown)
                  .filter(([, v]) => v !== 0)
                  .map(([k, v]) => `${AFFILIATION_LABELS[k] || k} ${v}`)
                  .join(' · ')}
              </div>
            )}
          </div>
        ))}
        <div className="text-center">
          <Link to="/space" className={BTN_ACCENT + ' inline-block'}>Back to the lobby</Link>
        </div>
      </div>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#03060d] text-[#dbe4f0] flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-3">{children}</div>
    </div>
  );
}

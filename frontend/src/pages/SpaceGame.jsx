import { useMemo, useState, useCallback, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSpaceGame } from '../hooks/useSpaceGame.js';
import { spPlayCard, spHarvest, spResolveBoon, spConcede, spExportGame, spSubmitReport } from '../api/space.js';
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

const AFFILIATION_LABELS_STORY = {
  wealth: 'Foundation', diplomatic_corps: 'Xenoanthropology Circle',
  trade_guild: 'Exobiology Institute', war_college: 'Xenogeology Guild',
  trophy: 'Trophy', collapse: 'ICC Collapse',
};
const AFFILIATION_LABELS_PLAIN = {
  wealth: 'Wealth', diplomatic_corps: 'Anthropology',
  trade_guild: 'Biology', war_college: 'Geology',
  trophy: 'Trophy', collapse: 'Collapse penalty',
};
// Rebound per render via setAffiliationVariant(); default = story names.
let AFFILIATION_LABELS = AFFILIATION_LABELS_STORY;
function setAffiliationVariant(storyMode) {
  AFFILIATION_LABELS = storyMode ? AFFILIATION_LABELS_STORY : AFFILIATION_LABELS_PLAIN;
}
const AFFILIATION_SCORING = {
  wealth: 'Scores once for everyone: 1 VP per 10 credits at game end.',
  diplomatic_corps: 'At game end this card scores VP equal to your Xenoanthropology track.',
  trade_guild: 'At game end this card scores VP equal to your Exobiology track.',
  war_college: 'At game end this card scores VP equal to your Xenogeology track.',
};
const ACTION_LABELS = {
  reset: 'Regroup', survey: 'Geo solution', ethnography: 'Anthro solution',
  biology: 'Plant (grow & harvest)', recruit: 'Hire (2)', recruit_free: 'Hire (1, free position)',
  copy: 'Peer review',
};

const emptyDraft = { mission: null, commits: [], charter: 0, picks: [], copyTarget: null };

/** Compact label for a boon, shown on mission-card fronts and boon chips. */
function boonShort(b) {
  switch (b.type) {
    case 'affinity': return `+${b.power} ${b.keyword}`;
    case 'income': return `+${b.power}c/solve`;
    case 'hire_discount': return 'hires −1c';
    case 'fleet': return 'charter 1c';
    case 'faculty': return 'consult +2';
    case 'purist': return 'purity +3';
    case 'greenhouse': return 'plants +1';
    case 'panspermia': return 'harvest +1';
    case 'severance': return 'fire +4c';
    default: return b.name || '?';
  }
}

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
      {disc && (
        <div style={{ color: disc.color }}>
          {c.action === 'biology'
            ? 'Plants on a project; solves missions when harvested.'
            : `Solves missions the ${disc.label} way.`}
        </div>
      )}
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
      {sol.text && <div className="italic">{sol.text}</div>}
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
      {sol.boon && (
        <div className="border-t border-[#26365a] pt-1">
          <b className={sol.boon.tainted ? T_GOLD : T_MUted}>★ Boon: {sol.boon.name}</b>
          <div className={T_MUted}>{sol.boon.text}</div>
          {sol.boon.tainted && (
            <div className={T_BAD}>Tainted: −5 VP each if the game ends in full chaos.</div>
          )}
        </div>
      )}
      {sol.has_follow && <div className={T_GOLD}>⛓ This choice will have consequences…</div>}
    </div>
  );
}

// ── chaos track ──────────────────────────────────────────────────────────

function ChaosBar({ chaos, mod, storyMode, tipHandlers }) {
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
          <b className={T_HEAD + ' text-[12px]'}>{storyMode ? 'The ICC' : 'Stability'} — chaos {chaos > 0 ? `+${chaos}` : chaos}</b>
          <div>Every solution nudges this shared track toward CHAOS or ORDER.</div>
          <div className={mod !== 0 ? T_GOLD : T_MUted}>
            Current effect: all mission difficulties {mod > 0 ? `+${mod}` : mod < 0 ? mod : '±0'} (1 per 3 chaos).
          </div>
          <div className={T_GOOD}>At −10 (full ORDER) the game ends — highest VP wins clean.</div>
          <div className={T_BAD}>At +10 (full CHAOS) the game ends at once and every player loses 5 VP PER CHAOS BOON claimed (baseline boons are clean).</div>
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
      <div className={'text-[10px] mb-1 ' + T_MUted}>
        {m.culture}
        {(m.keywords || []).map((kw) => (
          <span key={kw} className="ml-1.5 px-1 rounded bg-[#12203a] text-[#8fb2d0]">{kw}</span>
        ))}
      </div>
      {m.problem && <div className="text-[11px] leading-snug mb-2">{m.problem}</div>}
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
              {sol.boon && (
                <span className={'text-[10px] whitespace-nowrap ' + (sol.boon.tainted ? T_GOLD : T_MUted)}>
                  ★ {boonShort(sol.boon)}
                </span>
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
      <div>Gates (red rings): step 5 needs a MAJOR solve, step 9 a CRITICAL solve. Breaking them grants research grants (+10c / +15c) AND raises your team cap (12 at rank 5, 15 at rank 9).</div>
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
  // Harvest mode: a free-standing action — no card is played. Pick a grown
  // field card, then click a docket mission to pair them; execute all pairs.
  const [harvestMode, setHarvestMode] = useState(false);
  const [harvestPairs, setHarvestPairs] = useState([]); // [{field, mission}]
  const [harvestSel, setHarvestSel] = useState(null);   // field index awaiting a mission
  const [firePick, setFirePick] = useState(null);       // card picked in the boon modal
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNotes, setReportNotes] = useState('');
  const [reportRating, setReportRating] = useState(null);
  const [reportDone, setReportDone] = useState(false);

  const tipHandlers = useCallback((node) => ({
    onMouseEnter: (e) => setTip({ x: e.clientX, y: e.clientY, node }),
    onMouseMove: (e) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t)),
    onMouseLeave: () => setTip(null),
  }), []);

  const resetDraft = useCallback(() => {
    setSelectedCard(null);
    setDraft(emptyDraft);
    setActionError(null);
    setHarvestMode(false);
    setHarvestPairs([]);
    setHarvestSel(null);
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
  if (isLoading && !state) return <Shell><p>Loading…</p></Shell>;
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

  const myBoons = you.boons || [];
  const boonCount = (type) => myBoons.filter((b) => b.type === type).length;
  const charterRate = Math.max(1, state.geo_credits_per_point - boonCount('fleet'));

  const statIdx = effectiveAction === 'survey' ? 0 : effectiveAction === 'ethnography' ? 1 : 2;
  const plantStrength = effectiveCard && activeDisc === 'bio'
    ? effectiveCard.stats[2] + 1 + boonCount('greenhouse') : null;
  let solveTotal = null;
  if (effectiveCard && activeDisc && activeDisc !== 'bio') {
    solveTotal = effectiveCard.stats[statIdx];
    if (activeDisc === 'geo') solveTotal += Math.floor(draft.charter / charterRate);
    if (activeDisc === 'anthro') {
      solveTotal += draft.commits.length * (1 + boonCount('faculty'));
      if (boonCount('purist') > 0 && draft.commits.length > 0
          && draft.commits.every((k) => cards[k].action === 'ethnography')) {
        solveTotal += 3;
      }
    }
    for (const b of myBoons) {
      if (b.type === 'affinity' && (targetMission?.keywords || []).includes(b.keyword)) {
        solveTotal += b.power;
      }
    }
  }

  const picking = effectiveAction === 'recruit' || effectiveAction === 'recruit_free';
  const myField = you.field || [];

  // Grown strength of a field entry against a given mission (boons included).
  function fieldStrengthFor(entry, mission) {
    let s = entry.str + boonCount('panspermia');
    for (const b of myBoons) {
      if (b.type === 'affinity' && (mission?.keywords || []).includes(b.keyword)) {
        s += b.power;
      }
    }
    return s;
  }

  function onMissionClick(key) {
    if (harvestMode) {
      const m = state.docket.find((mm) => mm.key === key);
      if (!m?.solutions?.bio) return;
      if (harvestSel === null) {
        // clicking an assigned mission un-assigns it
        setHarvestPairs((ps) => ps.filter((pr) => pr.mission !== key));
        return;
      }
      setHarvestPairs((ps) => [
        ...ps.filter((pr) => pr.field !== harvestSel && pr.mission !== key),
        { field: harvestSel, mission: key },
      ]);
      setHarvestSel(null);
      return;
    }
    if (!activeDisc || activeDisc === 'bio') return;
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
      if (effectiveAction === 'biology') return {};   // plant: no target
      if (effectiveAction === 'recruit' || effectiveAction === 'recruit_free') {
        return { picks: draft.picks.map((key) => ({ card: key })) };
      }
      if (effectiveAction === 'reset') return {};
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

  async function handleHarvest() {
    setBusy(true);
    setActionError(null);
    try {
      await spHarvest(session.player_token, harvestPairs);
      resetDraft();
      await refresh();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    setBusy(true);
    setActionError(null);
    try {
      const res = await spExportGame(session.player_token);
      const blob = new Blob([JSON.stringify(res.export, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `utopian-playthrough-game${res.export?.game?.game_id ?? gameId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitReport() {
    setBusy(true);
    setActionError(null);
    try {
      await spSubmitReport(session.player_token, reportNotes, reportRating);
      setReportDone(true);
      setReportNotes('');
      setReportRating(null);
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
    if (activeDisc === 'bio') return null;   // plant needs no target
    if (activeDisc) {
      if (!draft.mission) return 'Click a mission on the docket to target it.';
      if (!targetSolution) return 'That mission has no solution for this discipline.';
      if (activeDisc === 'geo' && draft.charter > you.credits) return 'Charter exceeds your credits.';
      return null;
    }
    if (picking) {
      if (draft.picks.length === 0) return 'Pick a researcher from the University panel.';
      if (you.roster + draft.picks.length > you.crew_cap) {
        return `Team roster full (${you.crew_cap} max — track ranks 5 and 9 raise it).`;
      }
      const cost = draft.picks.reduce((sum, key) => {
        const pos = state.market.display.indexOf(key);
        return sum + Math.max(0, cards[key].cost_credits
          + (effectiveAction === 'recruit' ? (state.position_costs[pos] || 0) : 0)
          - boonCount('hire_discount'));
      }, 0);
      if (cost > you.credits) return `Not enough credits (${cost}c needed).`;
      return null;
    }
    return null;
  })();
  const confirmReady = activeCardDef && !blockReason;

  const ended = game.status === 'ended';
  const collapsed = game.endgame_trigger === 'chaos_collapse';
  const ordered = game.endgame_trigger === 'order_triumph';
  const storyMode = game.variant === 'story';
  setAffiliationVariant(storyMode);

  return (
    <div className="h-screen overflow-hidden relative text-[#dbe4f0]"
      style={{ background: 'radial-gradient(ellipse at 30% 20%, #0b1226 0%, #070d1c 50%, #03060d 100%)' }}>
      <TooltipLayer tip={tip} />

      {/* top bar */}
      <div className="absolute top-0 inset-x-0 z-40 flex items-center justify-between px-4 py-1.5 bg-[#060b16]/85 backdrop-blur border-b border-[#1d2c4c]">
        <div className="flex items-center gap-4 text-sm">
          <Link to="/space" className={'underline ' + T_MUted}>← Lobby</Link>
          <span className={'font-semibold ' + T_HEAD}>{storyMode ? 'THE ICC' : 'Utopian Space Game'}</span>
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
          <button className={BTN}
            onClick={() => { setReportOpen(true); setReportDone(false); }}>
            📝 Report
          </button>
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
        <ChaosBar chaos={state.chaos} mod={state.chaos_mod} storyMode={storyMode} tipHandlers={tipHandlers} />
      </div>

      {/* THE DOCKET */}
      <div className="absolute top-24 bottom-40 left-2 right-[19rem] z-10 overflow-y-auto pr-1">
        <div className={'text-[11px] mb-1 ' + T_MUted}>
          {storyMode ? <>Mission docket · {state.mission_stack_count} crises pending</>
            : <>Missions · {state.mission_stack_count} remaining in deck</>}
          {harvestMode && (
            <span className={T_GOOD}> — HARVEST: pick a planted card below, then click its mission
              {harvestSel !== null ? ' (choose a mission…)' : ''}</span>
          )}
          {!harvestMode && activeDisc && activeDisc !== 'bio'
            && <span style={{ color: activeDiscMeta.color }}> — click a mission to target your {activeDiscMeta.label} solution</span>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-w-4xl">
          {state.docket.map((m) => (
            <MissionCard key={m.key} m={m}
              activeDisc={harvestMode ? 'bio' : activeDisc}
              targeted={harvestMode
                ? harvestPairs.some((pr) => pr.mission === m.key)
                : draft.mission === m.key}
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
        <Collapsible title={storyMode ? 'The Council' : 'Players'} open={panels.council}
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
                {(p.field || []).length > 0 && (
                  <> · 🌱{(p.field || []).map((fe) => fe.str).join('/')}</>
                )}
                {p.boon_count > 0 && <> · ★{p.boon_count}</>}
                {' · '}team {p.roster}/{p.crew_cap}
                {p.discard_top && <> · last: {cards[p.discard_top]?.name}</>}
                {p.conceded ? ' · withdrew' : ''}
                {ended && p.final_score !== null && <> · <b>{p.final_score} VP</b></>}
              </div>
            </div>
          ))}
        </Collapsible>

        <Collapsible title="The University" badge={`${state.market.stack_count} in stock`}
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

        <Collapsible title={storyMode ? 'The story so far' : 'Resolved missions'} badge={`${state.story.length} resolved`}
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
                  {s2.text && <div className={'italic ' + T_MUted}>{s2.text}</div>}
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

      {/* bottom-center: the hand */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-30 max-w-[62vw] flex flex-col items-center">
        {myBoons.length > 0 && (
          <div className="flex items-center justify-center flex-wrap gap-1.5 mb-1 px-2 py-1 rounded border border-[#4a3b1f] bg-[#130f07]/90">
            <span className={'text-[10px] ' + T_GOLD}
              {...tipHandlers(<div><b className={T_GOLD}>Your boons</b><div>Permanent powers claimed from solved missions. Gold = tainted (−5 VP each if the game ends in full chaos); dimmed = spent one-shots.</div></div>)}>
              ★ Boons
            </span>
            {Object.values(myBoons.reduce((acc, b) => {
              const k = (b.name || b.type) + '|' + (b.keyword || '');
              if (!acc[k]) acc[k] = { ...b, count: 0, spentCount: 0 };
              acc[k].count += 1;
              if (b.spent) acc[k].spentCount += 1;
              return acc;
            }, {})).map((g, i) => (
              <span key={i}
                className={
                  'px-1.5 py-0.5 rounded border text-[10px] whitespace-nowrap ' +
                  (g.spentCount === g.count
                    ? 'border-[#3a3a3a] text-[#6b7487] bg-[#0c1424]/70'
                    : (g.tainted
                      ? 'border-[#e0b45c]/70 text-[#e0b45c] bg-[#1c1608]'
                      : 'border-[#2f4b6e] text-[#8fb2d0] bg-[#0c1424]'))
                }
                {...tipHandlers(
                  <div className="space-y-1">
                    <b className={g.tainted ? T_GOLD : T_HEAD}>★ {g.name}{g.count > 1 ? ` ×${g.count}` : ''}</b>
                    <div className={T_MUted}>{g.text}</div>
                    {g.tainted && <div className={T_BAD}>Tainted: −5 VP each if the game ends in full chaos.</div>}
                    {g.spentCount > 0 && <div className={T_MUted}>{g.spentCount} spent (one-shot already used).</div>}
                  </div>
                )}>
                ★ {boonShort(g)}{g.count > 1 ? ` ×${g.count}` : ''}
              </span>
            ))}
          </div>
        )}
        {myField.length > 0 && (
          <div className="flex items-center gap-1.5 mb-1 px-2 py-1 rounded border border-[#1f4a35] bg-[#07130d]/90">
            <span className={'text-[10px] ' + T_GOOD}
              {...tipHandlers(<div><b className={T_GOOD}>Field projects</b><div>Planted researchers grow +1 at the start of each of your turns. Use HARVEST (a full action, no card) to resolve missions with any number of them at once; used cards go to your discard.</div></div>)}>
              🌱 Field
            </span>
            {myField.map((fe, i) => {
              const assigned = harvestPairs.find((pr) => pr.field === i);
              const assignedTitle = assigned
                ? state.docket.find((m) => m.key === assigned.mission)?.title : null;
              return (
                <button key={i} type="button"
                  onClick={() => {
                    if (!harvestMode) return;
                    if (assigned) {
                      setHarvestPairs((ps) => ps.filter((pr) => pr.field !== i));
                      setHarvestSel(null);
                    } else {
                      setHarvestSel((sel) => (sel === i ? null : i));
                    }
                  }}
                  className={
                    'px-1.5 py-0.5 rounded border text-[10px] transition-colors ' +
                    (assigned ? 'border-[#e0b45c] bg-[#2a2338] ' :
                     harvestSel === i ? 'border-[#7fd8a0] ring-1 ring-[#7fd8a0] bg-[#0d2418] ' :
                     'border-[#2f4b6e] bg-[#0c1424] ') +
                    (harvestMode ? 'cursor-pointer hover:border-[#7fd8a0]' : 'cursor-default')
                  }
                  {...tipHandlers(<CardTooltip cardKey={fe.card} cards={cards} />)}>
                  {cards[fe.card]?.name} <b className={T_GOOD}>{fe.str}</b>
                  {assignedTitle && <span className={T_GOLD}> → {assignedTitle}</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-stretch gap-1">
          <button type="button" onClick={() => setHandOpen((o) => !o)}
            className="px-3 py-0.5 rounded-t border border-[#26365a] bg-[#0a1120]/90 text-[11px] text-[#8593ad] hover:text-[#79c9d6]"
            {...tipHandlers(<div><b className={T_HEAD}>Team roster</b><div>Hand + published work + planted field cards, max {you.crew_cap} (ranks 5 and 9 on any track raise the limit to 12 and 15). Hiring needs open slots.</div></div>)}>
            Team {you.roster}/{you.crew_cap} · hand {you.hand.length} {handOpen ? '▾' : '▴'}
          </button>
          {myField.length > 0 && !ended && (
            <button type="button" disabled={!myTurn}
              onClick={() => {
                if (harvestMode) { resetDraft(); return; }
                resetDraft();
                setHarvestMode(true);
              }}
              className={
                'px-3 py-0.5 rounded-t border text-[11px] font-semibold disabled:opacity-40 ' +
                (harvestMode
                  ? 'border-[#7fd8a0] bg-[#0d2418] text-[#7fd8a0]'
                  : 'border-[#26365a] bg-[#0a1120]/90 text-[#7fd8a0] hover:border-[#7fd8a0]')
              }
              {...tipHandlers(<div><b className={T_GOOD}>Harvest</b><div>A full turn action that plays NO card: assign any number of grown field cards to docket missions and resolve them all at once.</div></div>)}>
              {harvestMode ? '✕ cancel harvest' : '🌾 Harvest'}
            </button>
          )}
          <span className={'px-2 py-0.5 rounded-t border border-[#26365a] bg-[#0a1120]/90 text-[11px] font-mono ' + T_GOLD}
            {...tipHandlers(<div><b className={T_HEAD}>Research funding</b><div>Credits pay for hires and equipment charters, and score Wealth (1 VP per 10).</div></div>)}>
            {you.credits}c
          </span>
        </div>
        {handOpen && (
        <div className="flex gap-1.5 overflow-x-auto pt-3 pb-1 px-2 max-w-full">
          {you.hand.map((key) => (
            <div key={key}
              className="shrink-0 transition-transform hover:-translate-y-1">
              <CardChip cardKey={key} cards={cards} tipHandlers={tipHandlers}
                selected={selectedCard === key}
                committed={draft.commits.includes(key)}
                disabled={!myTurn || ended}
                onCommit={
                  activeDisc === 'anthro' && key !== selectedCard
                    && cards[key].action !== 'reset' && myTurn && !ended
                    ? () => toggleCommit(key)
                  : undefined
                }
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

          {activeDisc === 'bio' && (
            <div className="text-[12px] space-y-1">
              <div>
                Plants at strength <b className={T_GOOD}>{plantStrength}</b>
                <span className={T_MUted}> (Biology {effectiveCard?.stats[2]} + 1
                  {boonCount('greenhouse') > 0 ? ` + ${boonCount('greenhouse')} greenhouse` : ''})</span>
              </div>
              <div className={'text-[10px] ' + T_MUted}>
                Grows +1 at the start of each of your turns. Resolve missions later
                with the 🌾 Harvest action — any number of grown cards at once.
              </div>
            </div>
          )}

          {activeDisc && activeDisc !== 'bio' && (
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
                    {targetSolution.boon && (
                      <div className={'text-[10px] ' + T_GOLD}>
                        ★ Claims boon: {targetSolution.boon.name} — {targetSolution.boon.text}
                      </div>
                    )}
                  </>
                )}
              </div>
              {activeDisc === 'geo' && (
                <div className="flex items-center gap-2 text-[11px]">
                  Charter equipment:
                  <button type="button" className={BTN + ' px-2 py-0 text-[11px]'}
                    onClick={() => setDraft((dr) => ({ ...dr, charter: Math.max(0, dr.charter - charterRate) }))}>−</button>
                  <span className="font-mono">{draft.charter}c (+{Math.floor(draft.charter / charterRate)})</span>
                  <button type="button" className={BTN + ' px-2 py-0 text-[11px]'}
                    onClick={() => setDraft((dr) => ({
                      ...dr,
                      charter: dr.charter + charterRate <= you.credits ? dr.charter + charterRate : dr.charter,
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

      {/* bottom-right: harvest panel */}
      {harvestMode && (
        <div className={'absolute bottom-2 right-2 z-40 w-96 p-3 text-sm space-y-2 border-[#7fd8a0]/60 ' + PANEL}>
          <div className="flex justify-between items-baseline">
            <b className={T_GOOD}>🌾 Harvest</b>
            <span className={'text-[11px] ' + T_MUted}>full action · no card played</span>
          </div>
          {harvestPairs.length === 0 ? (
            <p className={'text-[11px] ' + T_MUted}>
              Click a planted card (bottom), then a docket mission, to pair them.
              Assign as many as you like — they all resolve this turn.
            </p>
          ) : (
            <ul className="text-[11px] space-y-1">
              {harvestPairs.map((pr) => {
                const fe = myField[pr.field];
                const m = state.docket.find((mm) => mm.key === pr.mission);
                if (!fe || !m) return null;
                const s = fieldStrengthFor(fe, m);
                const need = m.solutions.bio.difficulty;
                const ok = s >= need;
                return (
                  <li key={pr.field} className="flex items-center gap-2">
                    <span>{cards[fe.card]?.name} <b className={T_GOOD}>{s}</b></span>
                    <span className={T_MUted}>vs</span>
                    <span className={ok ? T_GOOD : T_BAD}>{need}</span>
                    <span className={'truncate ' + T_MUted}>"{m.title}"</span>
                    <button type="button" className={'ml-auto underline ' + T_MUted}
                      onClick={() => setHarvestPairs((ps) => ps.filter((x) => x.field !== pr.field))}>
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {harvestPairs.some((pr) => {
            const fe = myField[pr.field];
            const m = state.docket.find((mm) => mm.key === pr.mission);
            return fe && m && fieldStrengthFor(fe, m) < m.solutions.bio.difficulty;
          }) && (
            <div className={'text-[11px] ' + T_BAD}>▸ A pairing is not grown enough yet.</div>
          )}
          <div className="flex gap-2">
            <button className={BTN_ACCENT}
              disabled={busy || !myTurn || harvestPairs.length === 0
                || harvestPairs.some((pr) => {
                  const fe = myField[pr.field];
                  const m = state.docket.find((mm) => mm.key === pr.mission);
                  return !fe || !m || fieldStrengthFor(fe, m) < m.solutions.bio.difficulty;
                })}
              onClick={handleHarvest}>
              {busy ? 'Harvesting…' : `Harvest ${harvestPairs.length} project${harvestPairs.length === 1 ? '' : 's'}`}
            </button>
            <button className={BTN} onClick={resetDraft}>Cancel</button>
          </div>
        </div>
      )}

      {/* pending one-shot boon modal */}
      {!ended && (you.pending || []).length > 0 && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#03060d]/80">
          <div className={'w-[34rem] max-w-[92vw] p-4 space-y-3 border-[#e0b45c]/70 ' + PANEL}>
            <div className="flex justify-between items-baseline">
              <b className={T_GOLD}>★ {you.pending[0].name}</b>
              <span className={'text-[11px] ' + T_MUted}>one-shot boon · no turn cost</span>
            </div>
            <p className={'text-[12px] ' + T_MUted}>
              Fire one researcher from your hand or discard — they leave your team
              permanently and refund <b className={T_GOLD}>+{state.fire_refund || 4}c</b>
              {state.chaos_mod > 0 && <span className={T_BAD}> (chaos premium included)</span>}.
              Reset crew can never be fired.
            </p>
            {[['Hand', you.hand], ['Published (discard)', you.discard]].map(([zone, keys]) => (
              <div key={zone}>
                <div className={'text-[10px] mb-1 ' + T_MUted}>{zone}</div>
                <div className="flex flex-wrap gap-1.5">
                  {keys.length === 0 && <span className={'text-[10px] ' + T_MUted}>— empty —</span>}
                  {keys.map((key, i) => (
                    <div key={zone + key + i}>
                      <CardChip cardKey={key} cards={cards} small tipHandlers={tipHandlers}
                        selected={firePick === key}
                        disabled={cards[key].action === 'reset'}
                        onClick={() => setFirePick((fp) => (fp === key ? null : key))} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <button className={BTN_ACCENT} disabled={busy || !firePick}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await spResolveBoon(session.player_token, 0, firePick);
                    setFirePick(null);
                    await refresh();
                  } catch (e) { setActionError(e.message); } finally { setBusy(false); }
                }}>
                {busy ? '…' : `Fire ${firePick ? cards[firePick]?.name : '—'} (+${state.fire_refund || 4}c)`}
              </button>
              <button className={BTN} disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await spResolveBoon(session.player_token, 0, null);
                    setFirePick(null);
                    await refresh();
                  } catch (e) { setActionError(e.message); } finally { setBusy(false); }
                }}>
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {ended && (
        <ResultsOverlay state={state} collapsed={collapsed} ordered={ordered} storyMode={storyMode}
          busy={busy} onExport={handleExport}
          onReport={() => { setReportOpen(true); setReportDone(false); }} />
      )}

      {/* playtest report modal */}
      {reportOpen && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-[#03060d]/85 p-6">
          <div className={'w-[30rem] max-w-[92vw] p-4 space-y-3 border-[#79c9d6]/60 ' + PANEL}>
            <div className="flex justify-between items-baseline">
              <b className={T_HEAD}>📝 Playtest report</b>
              <span className={'text-[11px] ' + T_MUted}>game #{game.game_id} · turn {game.turn_number}</span>
            </div>
            {reportDone ? (
              <>
                <p className={'text-sm ' + T_GOOD}>Report saved — thank you!</p>
                <div className="flex gap-2">
                  <button className={BTN} onClick={() => setReportOpen(false)}>Close</button>
                </div>
              </>
            ) : (
              <>
                <p className={'text-[12px] ' + T_MUted}>
                  What worked, what dragged, what confused you, what broke?
                  A snapshot of the current game state is attached automatically.
                </p>
                <textarea
                  className="w-full h-32 rounded border border-[#2f4b6e] bg-[#060b16] px-2 py-1.5 text-sm text-[#dbe4f0] focus:outline-none focus:border-[#79c9d6]"
                  value={reportNotes}
                  onChange={(e) => setReportNotes(e.target.value)}
                  placeholder="Your notes…" />
                <div className="flex items-center gap-1.5 text-[12px]">
                  <span className={T_MUted}>Fun rating:</span>
                  {[1, 2, 3, 4, 5].map((r) => (
                    <button key={r} type="button"
                      onClick={() => setReportRating((cur) => (cur === r ? null : r))}
                      className={
                        'w-7 h-7 rounded border text-[12px] ' +
                        (reportRating !== null && r <= reportRating
                          ? 'border-[#e0b45c] bg-[#2a2338] text-[#e0b45c]'
                          : 'border-[#2f4b6e] bg-[#0c1424] text-[#8593ad] hover:border-[#e0b45c]')
                      }>
                      ★
                    </button>
                  ))}
                  {reportRating !== null && <span className={T_GOLD}>{reportRating}/5</span>}
                </div>
                <div className="flex gap-2">
                  <button className={BTN_ACCENT} disabled={busy || reportNotes.trim() === ''}
                    onClick={handleSubmitReport}>
                    {busy ? 'Sending…' : 'Submit report'}
                  </button>
                  <button className={BTN} onClick={() => setReportOpen(false)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultsOverlay({ state, collapsed, ordered, storyMode, busy, onExport, onReport }) {
  const winner = state.players.find((p) => p.seat === state.game.winner_seat);
  const ranked = [...state.players]
    .filter((p) => p.final_score !== null)
    .sort((a, b) => b.final_score - a.final_score);
  return (
    <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div className={'max-w-lg w-full p-5 space-y-3 ' + PANEL}>
        <div className={'text-xl font-semibold ' + (collapsed ? T_BAD : ordered ? T_GOOD : T_HEAD)}>
          {collapsed
            ? (storyMode ? 'THE ICC HAS COLLAPSED' : 'FULL CHAOS — GAME OVER')
            : ordered
              ? (storyMode ? 'PERFECT ORDER — THE COUNCIL STANDS ETERNAL' : 'FULL ORDER — GAME OVER')
              : <>{storyMode ? 'The Council adjourns' : 'Game over'}{winner ? ` — ${winner.name} wins` : ''}</>}
        </div>
        {collapsed && (
          <p className={'text-sm ' + T_MUted}>
            {storyMode
              ? 'Chaos reached its breaking point. Every delegation loses 5 VP per CHAOS boon it claimed — the profiteers wear the blame. The stories you wrote survive; the institution did not.'
              : 'Each player loses 5 VP per chaos boon claimed.'}
          </p>
        )}
        {ordered && storyMode && (
          <p className={'text-sm ' + T_MUted}>
            The Council reached perfect stability{winner ? ` — ${winner.name} leads its golden age` : ''}.
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
        <div className="flex justify-center gap-2 flex-wrap">
          <button className={BTN} disabled={busy} onClick={onExport}>
            ⬇ Save playthrough
          </button>
          <button className={BTN} onClick={onReport}>
            📝 Playtest report
          </button>
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

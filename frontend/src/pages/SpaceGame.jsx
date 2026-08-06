import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSpaceGame } from '../hooks/useSpaceGame.js';
import { spPlayCard, spConcede } from '../api/space.js';
import { loadSpSession } from '../api/spSession.js';

/**
 * SpaceGame — the playable board, v3 ("one ship, many occupations").
 *
 * Hand cards are crew occupations; the player pilots one ship whose stats
 * come from installed upgrade modules. Raids build bounty (harder+richer),
 * diplomatic contracts build reputation (easier+poorer), trading is
 * demand-matched with no opposed roll. Server-authoritative throughout.
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
const FACTION_COLORS = {
  O: '#a08468', B: '#5fae5f', C: '#6f96b8', N: '#d8b04c', A: '#a878d8',
};
const RESOURCE_ICONS = { O: '🪨', B: '🌿', C: '⚙️', N: '🍯', A: '🔮' };
const RESOURCE_LETTERS = ['O', 'B', 'C', 'N', 'A'];
const RING_LABELS = ['Home ring (easy)', 'Frontier ring (easy)', 'Verge ring (medium)', 'Core (hard)'];

const AFFILIATION_LABELS = {
  wealth: 'Wealth', diplomatic_corps: 'Diplomatic Corps', alliances: 'Explorers Guild',
  trade_guild: 'Merchant Guild', war_college: 'Pirate Code', engineering: 'Engineering',
};
const AFFILIATION_SCORING = {
  wealth: 'Wealth scores once for everyone: 1 VP per 10 credits of cash + cargo value at game end.',
  diplomatic_corps: 'At game end this card scores VP equal to your Diplomat track position.',
  alliances: 'At game end this card scores VP per region your ship has visited.',
  trade_guild: 'At game end this card scores VP equal to your Merchant track position.',
  war_college: 'At game end this card scores VP equal to your Pirate track position.',
  engineering: 'At game end this card scores 2 VP per ship module you have installed.',
};
const ACTION_LABELS = {
  reset: 'Regroup', move: 'Fly', strike: 'Raid', diplomacy: 'Contract',
  trade: 'Trade', recruit: 'Hire (2)', recruit_free: 'Hire (1, free position)',
  copy: 'Intercept', engineer: 'Install modules',
};
const MODULE_TYPE_LABELS = {
  weapon: 'Weapon', diplomatic: 'Diplomatic module', trade: 'Trade module', system: 'System',
};

const emptyDraft = {
  path: [], planet: null, sell: {}, buy: {}, picks: [],
  upgrades: [], copyTarget: null, commits: [],
};

const MAP_PX = 1500;

// ── helpers ──────────────────────────────────────────────────────────────

function neighborsOf(map, pid) {
  const out = [];
  for (const [, pair] of Object.entries(map.lanes)) {
    if (pair[0] === pid) out.push(pair[1]);
    else if (pair[1] === pid) out.push(pair[0]);
  }
  return out;
}

function connected(map, a, b) {
  const key = a < b ? `${a}~${b}` : `${b}~${a}`;
  return !!map.lanes[key];
}

function autoPayment(cost, cargo) {
  const pay = {};
  const left = { ...cargo };
  for (const c of cost) {
    if (c === '?') continue;
    if (!left[c]) return null;
    left[c] -= 1;
    pay[c] = (pay[c] || 0) + 1;
  }
  const wilds = cost.filter((c) => c === '?').length;
  for (let i = 0; i < wilds; i++) {
    let best = null;
    for (const l of RESOURCE_LETTERS) {
      if ((left[l] || 0) > 0 && (best === null || left[l] > left[best])) best = l;
    }
    if (best === null) return null;
    left[best] -= 1;
    pay[best] = (pay[best] || 0) + 1;
  }
  return pay;
}

function costIcons(cost) {
  if (!cost || cost.length === 0) return 'free';
  return cost.map((c) => (c === '?' ? '❓' : RESOURCE_ICONS[c])).join(' ');
}

// ── tooltips ─────────────────────────────────────────────────────────────

function TooltipLayer({ tip }) {
  if (!tip) return null;
  const pad = 14;
  const style = {
    position: 'fixed', zIndex: 60, pointerEvents: 'none',
    left: Math.min(tip.x + pad, window.innerWidth - 340),
    top: Math.min(tip.y + pad, window.innerHeight - 300),
    maxWidth: 320,
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
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-3">
        <b className={T_HEAD + ' text-[12px]'}>{c.name}</b>
        <span className={T_MUted}>{c.stage ? `Market stage ${['I', 'II', 'III', 'IV', 'V'][c.stage - 1]}` : 'Starting crew'}</span>
      </div>
      <div className={T_MUted}>{ACTION_LABELS[c.action]}</div>
      <div>
        <span className={T_BAD}>Military {c.stats[0]}</span>{' · '}
        <span className={T_GOLD}>Diplomacy {c.stats[1]}</span>{' · '}
        <span className={T_GOOD}>Trade {c.stats[2]}</span>
      </div>
      <div>{c.text}</div>
      {c.steps != null && <div className={T_GOOD}>Flight range: {c.steps} hops.</div>}
      {c.rider_credits > 0 && <div className={T_GOLD}>Pockets {c.rider_credits} bonus credits.</div>}
      {c.kind !== 'starter' && c.cost?.length > 0 && (
        <div>Hiring cost: {costIcons(c.cost)} <span className={T_MUted}>(+ market-position cost)</span></div>
      )}
      <div className="border-t border-[#26365a] pt-1">
        <b className={T_GOLD}>{AFFILIATION_LABELS[c.affiliation]}.</b>{' '}
        {AFFILIATION_SCORING[c.affiliation]}
      </div>
    </div>
  );
}

function PlanetTooltip({ planet, state }) {
  const known = state.you.intel[planet.id];
  const region = planet.system;
  const bounty = state.you.bounty?.[region] || 0;
  const rep = state.you.rep?.[region] || 0;
  const inRegion = state.you.region === region;
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-3">
        <b className={T_HEAD + ' text-[12px]'}>{planet.name}</b>
        <span className={T_MUted}>{state.map.systems[planet.system]?.name}</span>
      </div>
      <div>
        <span style={{ color: FACTION_COLORS[planet.faction] }}>
          {state.faction_names[planet.faction]}
        </span>
        {' — sells '}{RESOURCE_ICONS[planet.faction]} at {state.prices[planet.faction]}c
        {' · wants '}{planet.wants.map((w) => RESOURCE_ICONS[w]).join(' ')}
        {' at +'}{state.sell_markup}c
      </div>
      <div>{RING_LABELS[planet.ring] || `Ring ${planet.ring}`} · production {planet.production}</div>
      <div>
        <span className={T_BAD}>Military: {known ? known.m : '?'}</span>{' · '}
        <span className={T_HEAD}>Political: {known ? known.p : '?'}</span>
        {!known && <span className={T_MUted}> — fly nearby to scout</span>}
      </div>
      {planet.home_seat !== null && planet.home_seat !== undefined && (
        <div style={{ color: SEAT_COLORS[planet.home_seat] }}>
          Home port of {state.players.find((pl) => pl.seat === planet.home_seat)?.name || `seat ${planet.home_seat + 1}`}
        </div>
      )}
      <div className="border-t border-[#26365a] pt-1 space-y-0.5">
        <div className={bounty > 0 ? T_BAD : T_MUted}>
          ⚔ Raid{known ? `: needs ${known.m + bounty}` : ''} — loot {planet.production + bounty} {RESOURCE_ICONS[planet.faction]} + {planet.production + bounty}c
          {bounty > 0 ? ` (your bounty here: ${bounty})` : ''}
        </div>
        <div className={rep > 0 ? T_GOOD : T_MUted}>
          🤝 {state.you.contracted?.includes(planet.id)
            ? 'Crisis already resolved — each planet negotiates only once.'
            : <>Contract{known ? `: needs ${Math.max(1, known.p - rep)}` : ''} — pays {Math.max(planet.production, 3 * planet.production - 2 * rep)}c
              {rep > 0 ? ` (your rep here: ${rep})` : ''}</>}
        </div>
        <div className={T_MUted}>
          💰 Trade: sell its wants, buy up to {planet.production} of its goods.
        </div>
        {!inRegion && <div className={T_GOLD}>Your ship must be in this region to act here.</div>}
      </div>
    </div>
  );
}

function ModuleTooltip({ mod }) {
  return (
    <div className="space-y-1">
      <b className={T_HEAD + ' text-[12px]'}>{mod.name}</b>
      <div className={T_MUted}>{MODULE_TYPE_LABELS[mod.type]}</div>
      <div>{mod.text}</div>
      <div className={T_MUted}>
        Cost {mod.cost}c — installed by playing an Engineer · occupies 1 cargo
        slot · also granted free at even track steps (forfeited if the hold is
        full) · worth 2 VP per Engineer card at game end.
      </div>
    </div>
  );
}

// ── cargo hold ───────────────────────────────────────────────────────────

function CargoHold({ you, resourceNames, tipHandlers }) {
  const slots = [];
  for (let i = 0; i < (you.upgrades || []).length; i++) slots.push({ kind: 'mod' });
  for (const l of RESOURCE_LETTERS) {
    for (let i = 0; i < (you.cargo[l] || 0); i++) slots.push({ kind: 'res', letter: l });
  }
  const used = slots.length;
  while (slots.length < you.cargo_capacity) slots.push({ kind: 'empty' });

  return (
    <div
      {...tipHandlers(
        <div className="space-y-1">
          <b className={T_HEAD + ' text-[12px]'}>Cargo hold — {used}/{you.cargo_capacity} spaces</b>
          {(you.upgrades || []).length > 0 && (
            <div>\ud83d\udd29 Installed modules × {(you.upgrades || []).length} (each occupies a slot)</div>
          )}
          {RESOURCE_LETTERS.filter((l) => you.cargo[l] > 0).map((l) => (
            <div key={l}>{RESOURCE_ICONS[l]} {resourceNames[l]} × {you.cargo[l]}</div>
          ))}
          <div className={T_MUted}>
            A full hold refuses new loot AND new modules — even free track modules
            are forfeited without a slot. Cargo value counts toward Wealth at game
            end. Cargo Pods add +4 spaces (net +3 after their own slot).
          </div>
        </div>
      )}
      className="inline-flex flex-wrap gap-0.5 align-middle rounded border border-[#26365a] bg-[#0d1526]/90 p-1 max-w-[13.5rem]">
      {slots.map((s, i) => (
        <span key={i}
          className={
            'inline-flex items-center justify-center w-6 h-6 rounded-sm text-[13px] ' +
            (s.kind === 'empty' ? 'border border-dashed border-[#26365a] ' :
             s.kind === 'mod' ? 'border border-[#79c9d6]/60 bg-[#12303a]/70 ' :
             'border border-[#3a4f7d] ')
          }
          style={s.kind === 'res' ? { backgroundColor: FACTION_COLORS[s.letter] + '2e' } : undefined}>
          {s.kind === 'res' ? RESOURCE_ICONS[s.letter] : s.kind === 'mod' ? '\ud83d\udd29' : ''}
        </span>
      ))}
    </div>
  );
}

// ── small pieces ─────────────────────────────────────────────────────────

function CardChip({ cardKey, cards, onClick, onCommit, committed, selected, disabled, small, tipHandlers }) {
  const c = cards[cardKey];
  if (!c) return null;
  return (
    <div className={'relative ' + (small ? 'w-36' : 'w-40')}
      {...tipHandlers(<CardTooltip cardKey={cardKey} cards={cards} />)}>
      <button type="button" onClick={onClick} disabled={disabled}
        className={
          'w-full text-left rounded-md border px-2 py-1.5 transition-colors shadow-lg ' +
          (selected ? 'border-[#79c9d6] bg-[#123143] ' :
           committed ? 'border-[#e0b45c] bg-[#2a2338] ' :
           'border-[#2f4b6e] bg-[#0c1424]/95 hover:border-[#8593ad] ') +
          (disabled ? 'opacity-50 cursor-not-allowed ' : '')
        }>
        <div className="flex justify-between items-baseline gap-1">
          <span className="font-semibold text-[11px] leading-tight">{c.name}</span>
          <span className="text-[10px] font-mono whitespace-nowrap">
            <span className={T_BAD}>{c.stats[0]}</span>/
            <span className={T_GOLD}>{c.stats[1]}</span>/
            <span className={T_GOOD}>{c.stats[2]}</span>
          </span>
        </div>
        <div className={'text-[10px] ' + T_MUted}>{ACTION_LABELS[c.action]}</div>
        <div className={'text-[9px] ' + T_HEAD}>{AFFILIATION_LABELS[c.affiliation]}</div>
      </button>
      {onCommit && (
        <button type="button" onClick={onCommit}
          className={
            'absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[10px] leading-none border z-10 ' +
            (committed
              ? 'bg-[#e0b45c] text-[#05070f] border-[#f5d28a]'
              : 'bg-[#122036] text-[#dbe4f0] border-[#2f4b6e] hover:border-[#e0b45c]')
          }
          title={committed ? 'Keep this crew member' : 'Bargain away for +1 political'}>
          {committed ? '\u2713' : '+'}
        </button>
      )}
    </div>
  );
}

function MiniCargo({ cargo }) {
  return (
    <span className="font-mono text-[11px]">
      {RESOURCE_LETTERS.map((l) => (
        (cargo?.[l] || 0) > 0 && (
          <span key={l} className="mr-1.5">{RESOURCE_ICONS[l]}{cargo[l]}</span>
        )
      ))}
    </span>
  );
}

function TrackBar({ label, trackKey, step, tipHandlers }) {
  const cells = [];
  for (let i = 1; i <= 12; i++) {
    const gate = i === 5 || i === 9;
    const reward = i % 2 === 0;
    cells.push(
      <span key={i}
        className={
          'inline-block w-2.5 h-2.5 mr-0.5 rounded-sm ' +
          (i <= step ? 'bg-[#e0b45c] ' : reward ? 'bg-[#223354] ' : 'bg-[#1a2740] ') +
          (gate ? 'ring-1 ring-[#e58787] ' : '')
        } />
    );
  }
  const moduleType = { military: 'weapon', diplomacy: 'diplomatic module', trade: 'trade module' }[trackKey];
  const handlers = tipHandlers ? tipHandlers(
    <div className="space-y-1">
      <b className={T_HEAD + ' text-[12px]'}>{label} track — step {step}/12</b>
      <div>+1 per won {label.toLowerCase()} action.</div>
      <div className={T_GOLD}>Every EVEN step grants a free {moduleType} from the upgrade stack.</div>
      <div>Gates (red rings): step 4→5 needs a medium-ring win; step 8→9 a core-ring win.</div>
      <div className={T_MUted}>Step 12 triggers the endgame. Matching cards score VP × this number.</div>
    </div>
  ) : {};
  return (
    <div className="flex items-center gap-2 text-[11px]" {...handlers}>
      <span className={'w-16 ' + T_MUted}>{label}</span>
      <span>{cells}</span>
      <span className={'font-mono ' + T_MUted}>{step}/12</span>
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

// ── the star map ─────────────────────────────────────────────────────────

function starPoints(n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const x = ((i * 137.508) % 997) * (1000 / 997);
    const y = ((i * 79.138 + 211) % 991) * (1000 / 991);
    const r = 0.4 + ((i * 7) % 10) / 12;
    const o = 0.25 + ((i * 13) % 10) / 18;
    pts.push({ x, y, r, o });
  }
  return pts;
}
const STARS = starPoints(170);

function StarMap({ state, draft, activeAction, mySeat, shipPreviewAt, onPlanetClick, tipHandlers }) {
  const map = state.map;
  const ships = state.board.ships || {};
  const intel = state.you.intel || {};
  const myRegion = state.you.region;

  const shipsAt = {};
  for (const [seatStr, pid] of Object.entries(ships)) {
    const at = Number(seatStr) === mySeat && shipPreviewAt ? shipPreviewAt : pid;
    (shipsAt[at] = shipsAt[at] || []).push(Number(seatStr));
  }

  // Legal next hops while flying.
  const hopTargets = new Set();
  if (activeAction === 'move' && shipPreviewAt) {
    for (const n of neighborsOf(map, shipPreviewAt)) hopTargets.add(n);
  }
  const missionLocal = activeAction === 'strike' || activeAction === 'diplomacy' || activeAction === 'trade';

  return (
    <svg viewBox="0 0 1000 1000" className="w-full h-full select-none block">
      <defs>
        <radialGradient id="spaceBg" cx="50%" cy="50%" r="75%">
          <stop offset="0%" stopColor="#0b1226" />
          <stop offset="55%" stopColor="#070d1c" />
          <stop offset="100%" stopColor="#03060d" />
        </radialGradient>
        <radialGradient id="nebulaA" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5b3f8f" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#5b3f8f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="nebulaB" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1f6a72" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#1f6a72" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="1000" height="1000" fill="url(#spaceBg)" />
      <ellipse cx="310" cy="260" rx="330" ry="220" fill="url(#nebulaA)" />
      <ellipse cx="720" cy="700" rx="360" ry="240" fill="url(#nebulaB)" />
      {STARS.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#cfe2f4" opacity={s.o} />
      ))}

      {Object.entries(map.lanes).map(([key, [a, b]]) => {
        const pa = map.planets[a]; const pb = map.planets[b];
        if (!pa || !pb) return null;
        return (
          <line key={key} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
            stroke="#33507a" strokeWidth={1.6} strokeDasharray="6 5" opacity={0.85} />
        );
      })}

      {Object.values(map.planets).map((p) => {
        const known = intel[p.id];
        const isDraftTarget = draft.planet === p.id;
        const isHopTarget = hopTargets.has(p.id);
        const inMyRegion = p.system === myRegion;
        const dimForMission = missionLocal && !inMyRegion;
        const isHome = p.home_seat !== null && p.home_seat !== undefined;
        const handlers = tipHandlers(<PlanetTooltip planet={p} state={state} />);
        return (
          <g key={p.id} onClick={() => onPlanetClick(p.id)} style={{ cursor: 'pointer' }}
            opacity={dimForMission ? 0.45 : 1}
            onMouseEnter={handlers.onMouseEnter} onMouseMove={handlers.onMouseMove}
            onMouseLeave={handlers.onMouseLeave}>
            {isHome && (
              <circle cx={p.x} cy={p.y} r={24} fill="none"
                stroke={SEAT_COLORS[p.home_seat]} strokeWidth={2} opacity={0.85} />
            )}
            {missionLocal && inMyRegion && (
              <circle cx={p.x} cy={p.y} r={21} fill="none"
                stroke="#79c9d6" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.7} />
            )}
            {isHopTarget && (
              <circle cx={p.x} cy={p.y} r={20} fill="none"
                stroke="#7fd8a0" strokeWidth={2} strokeDasharray="4 3" />
            )}
            <circle cx={p.x} cy={p.y} r={16.5} fill={FACTION_COLORS[p.faction]} opacity={0.25} />
            <circle cx={p.x} cy={p.y} r={13} fill={FACTION_COLORS[p.faction]}
              stroke={isDraftTarget ? '#79c9d6' : '#0a1120'} strokeWidth={isDraftTarget ? 3.5 : 1.5} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={10.5}
              fill="#f0f4fa" fontFamily="monospace" pointerEvents="none">{p.faction}</text>
            <text x={p.x} y={p.y + 30} textAnchor="middle" fontSize={10.5} fill="#9db0cc"
              pointerEvents="none">
              {p.name}
            </text>
            <text x={p.x} y={p.y + 42} textAnchor="middle" fontSize={9} fill="#6c7d9c"
              pointerEvents="none">
              prod {p.production} · wants {p.wants.join('')}
            </text>
            <g pointerEvents="none">
              <circle cx={p.x - 14} cy={p.y - 12} r={8}
                fill={known ? '#301616' : '#101a2e'}
                stroke={known ? '#e58787' : '#33507a'} strokeWidth={1} />
              <text x={p.x - 14} y={p.y - 8.5} textAnchor="middle" fontSize={9.5}
                fill={known ? '#e58787' : '#8593ad'} fontFamily="monospace">
                {known ? known.m : '?'}
              </text>
              <circle cx={p.x + 14} cy={p.y - 12} r={8}
                fill={known ? '#122c33' : '#101a2e'}
                stroke={known ? '#79c9d6' : '#33507a'} strokeWidth={1} />
              <text x={p.x + 14} y={p.y - 8.5} textAnchor="middle" fontSize={9.5}
                fill={known ? '#79c9d6' : '#8593ad'} fontFamily="monospace">
                {known ? known.p : '?'}
              </text>
            </g>
            {/* ships */}
            {(shipsAt[p.id] || []).map((seat, i) => (
              <g key={seat} pointerEvents="none">
                <polygon
                  points={`${p.x - 26 + i * 14},${p.y - 22} ${p.x - 20 + i * 14},${p.y - 15} ${p.x - 26 + i * 14},${p.y - 8} ${p.x - 32 + i * 14},${p.y - 15}`}
                  fill={SEAT_COLORS[seat]} stroke="#03060d" strokeWidth={1.2} />
                {seat === mySeat && (
                  <circle cx={p.x - 26 + i * 14} cy={p.y - 15} r={10} fill="none"
                    stroke="#79c9d6" strokeWidth={1.5} strokeDasharray="3 2" />
                )}
              </g>
            ))}
          </g>
        );
      })}
    </svg>
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
  const [panels, setPanels] = useState({ captains: true, market: false, dock: false, log: false });

  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  const movedRef = useRef(false);
  const centeredRef = useRef(false);

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

  // The Historians app sets :root { zoom: 0.9 }; under zoom, h-screen
  // (100vh) renders ~10% short and leaves a blank strip at the bottom.
  // This page owns its own layout, so opt out of the zoom while mounted.
  useEffect(() => {
    const prev = document.documentElement.style.zoom;
    document.documentElement.style.zoom = '1';
    return () => { document.documentElement.style.zoom = prev; };
  }, []);

  useEffect(() => {
    if (centeredRef.current || !state?.map || !scrollRef.current) return;
    const home = state.map.planets[`H${state.you.seat}a`];
    if (!home) return;
    const el = scrollRef.current;
    const scale = MAP_PX / 1000;
    el.scrollLeft = home.x * scale - el.clientWidth / 2;
    el.scrollTop = home.y * scale - el.clientHeight / 2;
    centeredRef.current = true;
  }, [state]);

  if (!session) {
    return (
      <Shell>
        <p>No session for this game on this device. Open it from the
          {' '}<Link className="underline" to="/space">Space lobby</Link> to adopt it.</p>
      </Shell>
    );
  }
  if (isLoading && !state) return <Shell><p>Contacting the sector…</p></Shell>;
  if (error && !state) return <Shell><p className={T_BAD}>{error}</p></Shell>;
  if (state?.message && !state.map) {
    return (
      <Shell>
        <p>{state.message}</p>
        <Link className={BTN_ACCENT + ' inline-block'} to="/space">Back to the lobby</Link>
      </Shell>
    );
  }
  if (!state || !state.map) {
    return (
      <Shell>
        <p>The game hasn't started yet.
          {' '}<Link className="underline" to="/space">Back to the lobby</Link>.</p>
      </Shell>
    );
  }

  const { game, cards, map } = state;
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

  const shipPreviewAt = effectiveAction === 'move' && draft.path.length > 0
    ? draft.path[draft.path.length - 1] : you.ship_at;
  const moveAllowance = (effectiveCard?.steps || 3) + (you.ship?.speed_bonus || 0);

  // Region math for mission previews.
  const region = you.region;
  const bounty = you.bounty?.[region] || 0;
  const rep = you.rep?.[region] || 0;
  const targetPlanet = draft.planet ? map.planets[draft.planet] : null;
  const targetIntel = draft.planet ? you.intel[draft.planet] : null;
  let missionTotal = null; let missionNeed = null; let missionReward = null;
  if (effectiveCard && targetPlanet) {
    if (effectiveAction === 'strike') {
      missionTotal = (you.ship?.military || 0) + effectiveCard.stats[0];
      missionNeed = targetIntel ? targetIntel.m + bounty : null;
      missionReward = `${targetPlanet.production + bounty} ${RESOURCE_ICONS[targetPlanet.faction]} + ${targetPlanet.production + bounty}c`;
    } else if (effectiveAction === 'diplomacy') {
      missionTotal = (you.ship?.political || 0) + effectiveCard.stats[1] + draft.commits.length;
      missionNeed = targetIntel ? Math.max(1, targetIntel.p - rep) : null;
      missionReward = `${Math.max(targetPlanet.production, 3 * targetPlanet.production - 2 * rep)} credits`;
    }
  }
  const tradeCapacity = effectiveAction === 'trade' && effectiveCard
    ? state.trade_base_cap + effectiveCard.stats[2] + (you.ship?.negotiating || 0) : 0;

  const picking = effectiveAction === 'recruit' || effectiveAction === 'recruit_free';
  const docking = effectiveAction === 'engineer';

  function onPanDown(e) {
    if (e.button !== 0) return;
    movedRef.current = false;
    dragRef.current = {
      x: e.clientX, y: e.clientY,
      sl: scrollRef.current.scrollLeft, st: scrollRef.current.scrollTop,
    };
  }
  function onPanMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x; const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) movedRef.current = true;
    scrollRef.current.scrollLeft = d.sl - dx;
    scrollRef.current.scrollTop = d.st - dy;
  }
  function onPanUp() { dragRef.current = null; }

  function onPlanetClick(pid) {
    if (movedRef.current || !effectiveAction) return;
    if (effectiveAction === 'move') {
      const from = draft.path.length > 0 ? draft.path[draft.path.length - 1] : you.ship_at;
      if (!connected(map, from, pid)) return;
      if (draft.path.length >= moveAllowance) return;
      setDraft((dr) => ({ ...dr, path: [...dr.path, pid] }));
      return;
    }
    setDraft((dr) => {
      if (effectiveAction === 'strike' || effectiveAction === 'diplomacy' || effectiveAction === 'trade') {
        return { ...dr, planet: dr.planet === pid ? null : pid };
      }
      return dr;
    });
  }

  function toggleCommit(key) {
    if (effectiveAction !== 'diplomacy') return;
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

  function toggleModule(key) {
    setDraft((dr) => ({
      ...dr,
      upgrades: dr.upgrades.includes(key)
        ? dr.upgrades.filter((k) => k !== key)
        : [...dr.upgrades, key],
    }));
  }

  function buildParams() {
    const a = activeCardDef.action;
    const inner = () => {
      switch (effectiveAction) {
        case 'move': return { path: draft.path };
        case 'strike': return { planet: draft.planet };
        case 'diplomacy': return { planet: draft.planet, commits: draft.commits };
        case 'trade': return { planet: draft.planet, sell: draft.sell, buy: draft.buy };
        case 'recruit':
        case 'recruit_free': {
          const free = effectiveAction === 'recruit_free';
          const picks = draft.picks.map((key) => {
            const pos = state.market.display.indexOf(key);
            const cost = free ? cards[key].cost
              : [...cards[key].cost, ...(state.position_costs[pos] || [])];
            return { card: key, payment: autoPayment(cost, you.cargo) || {} };
          });
          return { picks };
        }
        case 'engineer': return { upgrades: draft.upgrades };
        case 'reset': return {};
        default: return {};
      }
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
    if (!window.confirm('Withdraw from this game?')) return;
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
    if (activeCardDef.action === 'copy' && draft.copyTarget === null) return 'Choose whose last action to intercept.';
    switch (effectiveAction) {
      case 'move':
        return draft.path.length > 0 ? null : 'Click neighboring planets to plot your flight path.';
      case 'strike':
        return draft.planet ? (map.planets[draft.planet].system === region ? null : 'That planet is outside your region — fly there first.')
          : 'Click a highlighted planet in your region to raid.';
      case 'diplomacy': {
        if (!draft.planet) return 'Click a highlighted planet in your region.';
        if (map.planets[draft.planet].system !== region) return 'That planet is outside your region — fly there first.';
        if (you.contracted?.includes(draft.planet)) return 'Already resolved — each planet negotiates only once.';
        return null;
      }
      case 'trade': {
        if (!draft.planet) return 'Click a highlighted planet in your region to trade with.';
        if (map.planets[draft.planet].system !== region) return 'That planet is outside your region — fly there first.';
        const units = Object.values(draft.sell).reduce((a, b) => a + (b || 0), 0)
          + Object.values(draft.buy).reduce((a, b) => a + (b || 0), 0);
        return units > 0 ? null : 'Set at least one unit to buy or sell.';
      }
      case 'recruit': case 'recruit_free':
        return draft.picks.length > 0 ? null : 'Pick a card from the Crew market panel (top right).';
      case 'engineer':
        return draft.upgrades.length > 0 ? null : 'Pick modules from the Upgrade dock panel (top right).';
      default: return null;
    }
  })();
  const confirmReady = activeCardDef && !blockReason;

  const ended = game.status === 'ended';

  return (
    <div className="h-screen overflow-hidden relative bg-[#03060d] text-[#dbe4f0]">
      <div ref={scrollRef}
        className="absolute inset-0 overflow-auto cursor-grab active:cursor-grabbing"
        onMouseDown={onPanDown} onMouseMove={onPanMove}
        onMouseUp={onPanUp} onMouseLeave={onPanUp}>
        <div style={{ width: MAP_PX, height: MAP_PX }}>
          <StarMap state={state} draft={draft} mySeat={mySeat}
            activeAction={effectiveAction} shipPreviewAt={shipPreviewAt}
            tipHandlers={tipHandlers} onPlanetClick={onPlanetClick} />
        </div>
      </div>

      <TooltipLayer tip={tip} />

      <div className="absolute top-0 inset-x-0 z-40 flex items-center justify-between px-4 py-1.5 bg-[#060b16]/85 backdrop-blur border-b border-[#1d2c4c]">
        <div className="flex items-center gap-4 text-sm">
          <Link to="/space" className={'underline ' + T_MUted}>← Lobby</Link>
          <span className={'font-semibold ' + T_HEAD}>Sector Umbra</span>
          <span className={T_MUted}>game #{game.game_id} · turn {game.turn_number}</span>
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

      <div className="absolute top-12 right-2 z-30 w-72 space-y-2 max-h-[calc(100vh-11rem)] overflow-y-auto pr-0.5">
        <Collapsible title="Captains" open={panels.captains}
          onToggle={() => setPanels((p) => ({ ...p, captains: !p.captains }))}>
          {state.players.map((p) => (
            <div key={p.seat}
              className={'rounded border px-2 py-1.5 mb-1.5 text-sm ' +
                (game.current_seat === p.seat && !ended ? 'border-[#e0b45c]/70' : 'border-[#1d2c4c]')}>
              <div className="flex justify-between">
                <span style={{ color: SEAT_COLORS[p.seat] }} className="font-semibold">
                  {p.name}{p.is_you ? ' (you)' : ''}
                  {p.trophy ? ' 🏆' : ''}
                </span>
                <span className="font-mono">{p.credits}c</span>
              </div>
              <div className={'flex justify-between text-[11px] ' + T_MUted}>
                <MiniCargo cargo={p.cargo} />
                <span>hand {p.hand_count}</span>
              </div>
              <div className={'text-[10px] ' + T_MUted}>
                ⚔{p.ship?.military ?? 0} 🤝{p.ship?.political ?? 0} 💰{p.ship?.negotiating ?? 0}
                {' · '}P{p.tracks.military.step} D{p.tracks.diplomacy.step} M{p.tracks.trade.step}
                {' · '}at {map.planets[p.ship_at]?.name || '?'}
                {p.discard_top && <> · last: {cards[p.discard_top]?.name}</>}
                {p.conceded ? ' · withdrew' : ''}
                {ended && p.final_score !== null && <> · <b>{p.final_score} VP</b></>}
              </div>
            </div>
          ))}
        </Collapsible>

        <Collapsible title="Crew market" badge={`${state.market.stack_count} in stock`}
          open={panels.market || picking}
          onToggle={() => setPanels((p) => ({ ...p, market: !p.market }))}>
          <div className="flex flex-wrap gap-1.5">
            {state.market.display.map((key, pos) => {
              const posCost = state.position_costs[pos] || [];
              return (
                <div key={key}>
                  <CardChip cardKey={key} cards={cards} small tipHandlers={tipHandlers}
                    selected={draft.picks.includes(key)}
                    disabled={!picking || !myTurn}
                    onClick={() => togglePick(key)} />
                  <div className={'text-[9px] pl-1 ' + T_MUted}>
                    {costIcons(cards[key].cost)}
                    {posCost.length > 0 && <> + position {costIcons(posCost)}</>}
                  </div>
                </div>
              );
            })}
          </div>
        </Collapsible>

        <Collapsible title="Upgrade dock" badge={`${state.upgrade_dock.stack_count} in stack`}
          open={panels.dock || docking}
          onToggle={() => setPanels((p) => ({ ...p, dock: !p.dock }))}>
          <div className="space-y-1">
            {state.upgrade_dock.display.map((key) => {
              const mod = state.upgrades_catalog[key];
              const chosen = draft.upgrades.includes(key);
              return (
                <button key={key} type="button"
                  disabled={!docking || !myTurn}
                  onClick={() => toggleModule(key)}
                  {...tipHandlers(<ModuleTooltip mod={mod} />)}
                  className={
                    'w-full text-left rounded border px-2 py-1 text-[11px] ' +
                    (chosen ? 'border-[#79c9d6] bg-[#123143] ' : 'border-[#2f4b6e] bg-[#0c1424] ') +
                    (!docking ? 'opacity-70 ' : '')
                  }>
                  <div className="flex justify-between">
                    <span className="font-semibold">{mod.name}</span>
                    <span className={'font-mono ' + T_GOLD}>{mod.cost}c</span>
                  </div>
                  <span className={T_MUted}>{mod.text}</span>
                </button>
              );
            })}
            {!docking && (
              <div className={'text-[10px] ' + T_MUted}>
                Install by playing an Engineer — or free at even track steps.
              </div>
            )}
          </div>
        </Collapsible>

        <Collapsible title="Sector log" open={panels.log}
          onToggle={() => setPanels((p) => ({ ...p, log: !p.log }))}>
          <ul className={'space-y-0.5 text-[11px] max-h-48 overflow-y-auto ' + T_MUted}>
            {[...state.events].reverse().map((e) => (
              <li key={e.event_id}>{e.message}</li>
            ))}
          </ul>
        </Collapsible>
      </div>

      {/* ── bottom-left: THE SHIP (player board) ── */}
      <div className={'absolute bottom-2 left-2 z-30 p-2.5 space-y-1.5 ' + PANEL}>
        <div className="flex items-center gap-3 text-sm">
          <span className={'font-semibold ' + T_HEAD}
            {...tipHandlers(
              <div className="space-y-1">
                <b className={T_HEAD + ' text-[12px]'}>Your ship</b>
                <div>⚔ Military {you.ship?.military ?? 0} — added to every raid.</div>
                <div>🤝 Political {you.ship?.political ?? 0} — added to every contract.</div>
                <div>💰 Negotiating {you.ship?.negotiating ?? 0} — trade capacity and bonus credits.</div>
                <div className={T_MUted}>Docked at {map.planets[you.ship_at]?.name} — {map.systems[region]?.name}.
                  Local bounty {bounty}, local rep {rep}.</div>
              </div>
            )}>
            ⚔{you.ship?.military ?? 0} 🤝{you.ship?.political ?? 0} 💰{you.ship?.negotiating ?? 0}
          </span>
          <span className={'font-mono ' + T_GOLD}>{you.credits}c</span>
          <CargoHold you={you} resourceNames={state.resource_names} tipHandlers={tipHandlers} />
        </div>
        <div className={'text-[11px] ' + T_MUted}>
          Docked: <b className="text-[#dbe4f0]">{map.planets[you.ship_at]?.name}</b>
          {' '}({map.systems[region]?.name})
          {bounty > 0 && <span className={T_BAD}> · bounty {bounty}</span>}
          {rep > 0 && <span className={T_GOOD}> · rep {rep}</span>}
          {' · '}{you.visited.length} regions charted
        </div>
        {/* Explicit ship stat tally */}
        <ShipStatTally you={you} catalog={state.upgrades_catalog} />
        <div className="border-t border-[#1d2c4c]" />
        <TrackBar label="Pirate" trackKey="military" step={you.tracks.military.step} tipHandlers={tipHandlers} />
        <TrackBar label="Diplomat" trackKey="diplomacy" step={you.tracks.diplomacy.step} tipHandlers={tipHandlers} />
        <TrackBar label="Merchant" trackKey="trade" step={you.tracks.trade.step} tipHandlers={tipHandlers} />
        {(you.upgrades || []).length > 0 && (
          <div className={'text-[11px] max-w-[15rem] ' + T_MUted}>
            {(you.upgrades || []).map((u) => (
              <span key={u} className="mr-2 underline decoration-dotted"
                {...tipHandlers(<ModuleTooltip mod={state.upgrades_catalog[u]} />)}>
                {state.upgrades_catalog[u]?.name || u}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── bottom-center: the crew hand ── */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-30 max-w-[42vw]">
        <div className="flex overflow-x-auto pt-7 pb-1 px-2">
          {you.hand.map((key, i) => (
            <div key={key}
              className={'shrink-0 transition-transform hover:-translate-y-3 hover:z-40 ' + (i > 0 ? '-ml-14' : '')}
              style={{ zIndex: selectedCard === key ? 35 : 30 - (i % 10) }}>
              <CardChip cardKey={key} cards={cards} tipHandlers={tipHandlers}
                selected={selectedCard === key}
                committed={draft.commits.includes(key)}
                disabled={!myTurn || ended}
                onCommit={effectiveAction === 'diplomacy' && key !== selectedCard
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
              Hand empty. Discard: {you.discard.map((k) => cards[k].name).join(', ') || 'empty'}
            </span>
          )}
        </div>
      </div>

      {/* ── bottom-right: action panel ── */}
      {activeCardDef && (
        <div className={'absolute bottom-2 right-2 z-40 w-96 p-3 text-sm space-y-2 border-[#79c9d6]/50 ' + PANEL}>
          <div className="flex justify-between items-baseline">
            <b className={T_HEAD}>{activeCardDef.name}</b>
            <span className={'text-[11px] ' + T_MUted}>{ACTION_LABELS[activeCardDef.action]}</span>
          </div>
          <p className={'text-[11px] ' + T_MUted}>{activeCardDef.text}</p>

          {activeCardDef.action === 'copy' && (
            <div>
              <div className="mb-1">Intercept whom?</div>
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

          {(effectiveAction === 'strike' || effectiveAction === 'diplomacy') && (
            <div className="text-[12px]">
              {effectiveAction === 'strike' ? 'Raid strength ' : 'Diplomatic weight '}
              <b className={T_GOLD}>{missionTotal ?? '—'}</b>
              {targetPlanet && (
                <> vs {missionNeed !== null
                  ? <b className={missionTotal >= missionNeed ? T_GOOD : T_BAD}>{missionNeed}</b>
                  : <b className={T_MUted}>?</b>}
                  {' '}at {targetPlanet.name}
                  {missionReward && <span className={T_MUted}> · reward {missionReward}</span>}
                </>
              )}
              <div className={'text-[10px] ' + T_MUted}>
                {effectiveAction === 'strike'
                  ? `Ship military ${you.ship?.military ?? 0} + crew ${effectiveCard?.stats[0] ?? 0}. Success raises your bounty here (harder, richer).`
                  : `Ship political ${you.ship?.political ?? 0} + crew ${effectiveCard?.stats[1] ?? 0} + ${draft.commits.length} bargained crew (use + on hand cards; they return on your next Regroup). Success raises your rep here (easier, poorer).`}
              </div>
            </div>
          )}

          {effectiveAction === 'move' && (
            <div className={'text-[11px] ' + T_MUted}>
              Path {draft.path.length}/{moveAllowance} hops — click neighboring planets
              from your ship (green rings show legal hops).
              {draft.path.length > 0 && (
                <>
                  {' '}Route: {draft.path.map((pid) => map.planets[pid]?.name).join(' → ')}
                  <button type="button" className={BTN + ' ml-2 text-[10px] py-0.5'}
                    onClick={() => setDraft((dr) => ({ ...dr, path: [] }))}>
                    Undo
                  </button>
                </>
              )}
            </div>
          )}

          {effectiveAction === 'trade' && (
            <TradeControls draft={draft} setDraft={setDraft} you={you}
              prices={state.prices} markup={state.sell_markup}
              capacity={tradeCapacity} planet={targetPlanet} />
          )}

          {docking && (
            <div className={'text-[11px] ' + T_MUted}>
              Select modules to install from the Upgrade dock panel (top right).
              {draft.upgrades.length > 0 && (
                <> Selected: {draft.upgrades.map((k) => state.upgrades_catalog[k]?.name).join(', ')}
                  {' '}({draft.upgrades.reduce((s, k) => s + (state.upgrades_catalog[k]?.cost || 0), 0)}c)</>
              )}
            </div>
          )}

          {blockReason && myTurn && (
            <div className={'text-[11px] ' + T_GOLD}>▸ {blockReason}</div>
          )}

          <div className="flex gap-2">
            <button className={BTN_ACCENT} disabled={busy || !confirmReady} onClick={handleConfirm}>
              {busy ? 'Transmitting…' : 'Execute'}
            </button>
            <button className={BTN} onClick={resetDraft}>Cancel</button>
          </div>
        </div>
      )}

      {ended && <ResultsOverlay state={state} />}
    </div>
  );
}

/** The explicit "+X to everything" readout for the ship board. */
function ShipStatTally({ you, catalog }) {
  const counts = { weapon: 0, diplomatic: 0, trade: 0 };
  for (const key of you.upgrades || []) {
    const t = catalog[key]?.type;
    if (t && counts[t] !== undefined) counts[t] += 1;
  }
  const s = you.ship || {};
  const rows = [
    { icon: '⚔', label: 'Military', value: s.military ?? 0, cls: T_BAD,
      src: counts.weapon ? `${counts.weapon} weapon${counts.weapon > 1 ? 's' : ''}` : 'no weapons yet',
      note: 'added to every raid' },
    { icon: '🤝', label: 'Diplomacy', value: s.political ?? 0, cls: T_HEAD,
      src: counts.diplomatic ? `${counts.diplomatic} module${counts.diplomatic > 1 ? 's' : ''}` : 'no modules yet',
      note: 'added to every contract' },
    { icon: '💰', label: 'Negotiating', value: s.negotiating ?? 0, cls: T_GOOD,
      src: counts.trade ? `${counts.trade} module${counts.trade > 1 ? 's' : ''}` : 'no modules yet',
      note: 'trade capacity + bonus credits' },
    { icon: '📦', label: 'Cargo', value: you.cargo_capacity, cls: T_GOLD, flat: true,
      src: (s.cargo_bonus ?? 0) > 0 ? `base 12 + ${s.cargo_bonus} pods` : 'base 12',
      note: 'hold spaces' },
    { icon: '🚀', label: 'Speed', value: s.speed_bonus ?? 0, cls: T_GOOD,
      src: (s.speed_bonus ?? 0) > 0 ? 'afterburners' : 'no afterburners yet',
      note: 'extra hops per flight' },
  ];
  return (
    <div className="text-[11px] leading-tight">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline gap-1.5">
          <span className={'w-28 whitespace-nowrap ' + r.cls}>
            {r.icon} {r.flat ? '' : '+'}{r.value} {r.label}
          </span>
          <span className={T_MUted}>({r.src} — {r.note})</span>
        </div>
      ))}
    </div>
  );
}

function TradeControls({ draft, setDraft, you, prices, markup, capacity, planet }) {
  function setSide(side, letter, qty) {
    setDraft((dr) => ({ ...dr, [side]: { ...dr[side], [letter]: Math.max(0, qty) } }));
  }
  const units = Object.values(draft.sell).reduce((a, b) => a + (b || 0), 0)
    + Object.values(draft.buy).reduce((a, b) => a + (b || 0), 0);
  return (
    <div className="text-[11px] space-y-1">
      <div className={units > capacity ? T_BAD : T_MUted}>
        Capacity {units}/{capacity} units
        {planet && <> · {planet.name} wants {planet.wants.map((w) => RESOURCE_ICONS[w]).join(' ')} (+{markup}c over list)</>}
      </div>
      <div>
        Sell:
        {RESOURCE_LETTERS.map((l) => {
          const wanted = planet ? planet.wants.includes(l) : false;
          return (
            <span key={l} className={'ml-2 ' + (wanted ? '' : 'opacity-40')}>
              <span>{RESOURCE_ICONS[l]}</span>
              <input type="number" min={0} max={you.cargo[l] || 0}
                disabled={!wanted}
                value={draft.sell[l] || 0}
                onChange={(e) => setSide('sell', l, Number(e.target.value))}
                className="w-10 ml-0.5 bg-[#060b16] border border-[#2f4b6e] rounded px-1 disabled:opacity-50" />
            </span>
          );
        })}
      </div>
      <div>
        Buy {planet ? `${RESOURCE_ICONS[planet.faction]} (max ${planet.production})` : ''}:
        {planet && (
          <input type="number" min={0} max={planet.production}
            value={draft.buy[planet.faction] || 0}
            onChange={(e) => setSide('buy', planet.faction, Number(e.target.value))}
            className="w-10 ml-1 bg-[#060b16] border border-[#2f4b6e] rounded px-1" />
        )}
      </div>
      <div className={T_MUted}>
        List prices {RESOURCE_LETTERS.map((l) => `${RESOURCE_ICONS[l]}${prices[l]}`).join(' ')}.
      </div>
    </div>
  );
}

function ResultsOverlay({ state }) {
  const winner = state.players.find((p) => p.seat === state.game.winner_seat);
  const ranked = [...state.players]
    .filter((p) => p.final_score !== null)
    .sort((a, b) => b.final_score - a.final_score);
  return (
    <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div className={'max-w-lg w-full p-5 space-y-3 ' + PANEL}>
        <div className={'text-xl font-semibold ' + T_HEAD}>
          Journey's end{winner ? ` — ${winner.name} takes the sector` : ''}
        </div>
        {ranked.map((p, i) => (
          <div key={p.seat} className="rounded border border-[#1d2c4c] px-3 py-2">
            <div className="flex justify-between text-sm">
              <b style={{ color: SEAT_COLORS[p.seat] }}>{i + 1}. {p.name}</b>
              <span className={'font-mono ' + T_GOLD}>{p.final_score} VP</span>
            </div>
            {p.score_breakdown && (
              <div className={'text-[11px] ' + T_MUted}>
                {Object.entries(p.score_breakdown)
                  .filter(([, v]) => v > 0)
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

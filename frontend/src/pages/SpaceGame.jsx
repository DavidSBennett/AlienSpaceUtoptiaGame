import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSpaceGame } from '../hooks/useSpaceGame.js';
import { spPlayCard, spConcede } from '../api/space.js';
import { loadSpSession } from '../api/spSession.js';

/**
 * SpaceGame — the playable board for the SPACE GAME prototype.
 *
 * Mission model v2:
 *  - CONQUER: strike card vs planet's military value; commits add the
 *    played card's commit power each. Conquered planets produce 1 good.
 *  - ALLY: diplomacy card vs planet's political value; your drone values
 *    at the planet add. Allied planets produce their full value.
 *  - Drones live ON planets and hop planet-to-planet along lanes.
 *
 * Server-authoritative: this page only BUILDS action params and renders
 * state; every rule lives in backend/sp_engine.php.
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
const DRONE_ICON = '🛰️';
const RESOURCE_LETTERS = ['O', 'B', 'C', 'N', 'A'];
const RING_LABELS = ['Home ring (easy)', 'Frontier ring (easy)', 'Verge ring (medium)', 'Core (hard)'];

const AFFILIATION_LABELS = {
  wealth: 'Wealth', diplomatic_corps: 'Diplomatic Corps', alliances: 'Alliances',
  trade_guild: 'Trade Guild', war_college: 'War College', engineering: 'Engineering',
};
const AFFILIATION_SCORING = {
  wealth: 'Wealth scores once for everyone: 1 VP per 10 credits of cash + cargo value at game end (extra Wealth cards add no more).',
  diplomatic_corps: 'At game end this card scores VP equal to your Diplomacy track position.',
  alliances: 'At game end this card scores VP per star system where you control at least one planet.',
  trade_guild: 'At game end this card scores VP equal to your Trade track position.',
  war_college: 'At game end this card scores VP equal to your Military track position.',
  engineering: 'At game end this card scores 2 VP per ship upgrade you own.',
};
const ACTION_LABELS = {
  reset: 'Reset', move: 'Navigate', strike: 'Conquer', diplomacy: 'Ally',
  trade: 'Trade', produce: 'Produce', deploy: 'Deploy drones',
  recruit: 'Install (2)', recruit_free: 'Install (1, free position)',
  copy: 'Intercept', envoy: 'Envoy',
};

const emptyDraft = {
  steps: [], selectedDrone: null, commits: [],
  planet: null, sell: {}, buy: {}, system: null, mode: 'production',
  deployMode: 'place', placements: [], picks: [],
  buildDrone: false, dronePlanet: null, upgrades: [], copyTarget: null,
};

const MAP_PX = 1500;

// ── geometry helpers ─────────────────────────────────────────────────────

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

/** Apply queued move steps (drone hops) to the board's drones. */
function virtualDrones(board, steps) {
  const drones = board.drones.map((d) => ({ ...d }));
  for (const s of steps) drones[s.drone] = { ...drones[s.drone], at: s.to };
  return drones;
}

function adjacentPlanets(map, drones, seat) {
  const set = new Set();
  for (const d of drones) {
    if (d.seat !== seat) continue;
    set.add(d.at);
    for (const n of neighborsOf(map, d.at)) set.add(n);
  }
  return set;
}

function droneValuesAt(drones, seat, pid) {
  let sum = 0;
  for (const d of drones) {
    if (d.seat === seat && d.at === pid) sum += d.value || 1;
  }
  return sum;
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

// ── tooltip layer ────────────────────────────────────────────────────────

function TooltipLayer({ tip }) {
  if (!tip) return null;
  const pad = 14;
  const style = {
    position: 'fixed', zIndex: 60, pointerEvents: 'none',
    left: Math.min(tip.x + pad, window.innerWidth - 340),
    top: Math.min(tip.y + pad, window.innerHeight - 280),
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
        <span className={T_MUted}>{c.stage ? `Market stage ${['I', 'II', 'III', 'IV', 'V'][c.stage - 1]}` : 'Starting card'}</span>
      </div>
      <div className={T_MUted}>{ACTION_LABELS[c.action]}{c.faction ? ` — ${RESOURCE_ICONS[c.faction]}` : ''}</div>
      <div>
        <span className={T_BAD}>Military {c.stats[0]}</span>{' · '}
        <span className={T_GOLD}>Diplomacy {c.stats[1]}</span>{' · '}
        <span className={T_GOOD}>Trade {c.stats[2]}</span>
      </div>
      <div>{c.text}</div>
      {c.commit_power != null && (
        <div className={T_BAD}>Each committed card adds +{c.commit_power} to this strike.</div>
      )}
      {c.drone_value != null && (
        <div className={T_GOLD}>Launches value-{c.drone_value} drones.</div>
      )}
      {c.step_bonus != null && c.step_bonus > 0 && (
        <div className={T_GOOD}>+{c.step_bonus} extra movement steps.</div>
      )}
      {c.rider_credits > 0 && <div className={T_GOLD}>Grants {c.rider_credits} credits when it leads a successful trade.</div>}
      {c.kind !== 'starter' && c.cost?.length > 0 && (
        <div>Cost: {costIcons(c.cost)} <span className={T_MUted}>(+ its market-position cost)</span></div>
      )}
      <div className="border-t border-[#26365a] pt-1">
        <b className={T_GOLD}>{AFFILIATION_LABELS[c.affiliation]}.</b>{' '}
        {AFFILIATION_SCORING[c.affiliation]}
      </div>
    </div>
  );
}

function PlanetTooltip({ planet, state }) {
  const { board, players } = state;
  const holders = board.control?.[planet.id] || {};
  const known = state.you.intel[planet.id];
  const mySeat = state.you.seat;
  const myDrones = droneValuesAt(board.drones, mySeat, planet.id);
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
        {' — '}{RESOURCE_ICONS[planet.faction]} {state.resource_names[planet.faction]}
        {' '}(sells {state.prices[planet.faction]}c)
      </div>
      <div>{RING_LABELS[planet.ring] || `Ring ${planet.ring}`}</div>
      <div>
        <span className={T_BAD}>Military: {known ? known.m : '?'}</span>{' · '}
        <span className={T_HEAD}>Political: {known ? known.p : '?'}</span>
        {!known && <span className={T_MUted}> — move a drone here or next door to scout</span>}
      </div>
      <div>
        Production: <b className={T_GOOD}>{planet.production}</b> if allied
        {' · '}<b className={T_BAD}>1</b> if conquered
      </div>
      {planet.home_seat !== null && planet.home_seat !== undefined && (
        <div style={{ color: SEAT_COLORS[planet.home_seat] }}>
          Home port of {players.find((p) => p.seat === planet.home_seat)?.name || `seat ${planet.home_seat + 1}`}
        </div>
      )}
      <div>
        Control:{' '}
        {Object.keys(holders).length === 0 ? <span className={T_MUted}>independent</span>
          : Object.entries(holders).map(([s, kind], i, arr) => (
            <span key={s} style={{ color: SEAT_COLORS[Number(s)] }}>
              {players.find((p) => p.seat === Number(s))?.name || `seat ${Number(s) + 1}`}
              {' '}({kind === 'allied' ? 'ally' : 'occupied'}){i < arr.length - 1 ? ', ' : ''}
            </span>
          ))}
      </div>
      {myDrones > 0 && (
        <div className={T_GOLD}>Your drones here add +{myDrones} to diplomacy.</div>
      )}
      <div className={'border-t border-[#26365a] pt-1 ' + T_MUted}>
        ⚔ Conquer: strike card + committed cards vs military · yields 1/production.
        {' '}🤝 Ally: diplomacy card + drone values here vs political · full production.
        Wins advance the matching track{planet.ring >= 2 ? ' and can break tier gates.' : ' (tier 1 only).'}
      </div>
    </div>
  );
}

function UpgradeTooltip({ upgrade }) {
  return (
    <div className="space-y-1">
      <b className={T_HEAD + ' text-[12px]'}>{upgrade.name}</b>
      <div>{upgrade.text}</div>
      <div className={T_MUted}>
        Cost: {upgrade.credits}c{upgrade.resources.length ? ' + ' + upgrade.resources.map((r) => RESOURCE_ICONS[r]).join(' ') : ''}
        {' '}· Bought during a Reset · 2 VP per Engineering card at game end.
      </div>
    </div>
  );
}

// ── cargo hold ───────────────────────────────────────────────────────────

function CargoHold({ you, resourceNames, tipHandlers }) {
  const slots = [];
  for (const l of RESOURCE_LETTERS) {
    for (let i = 0; i < (you.cargo[l] || 0); i++) slots.push({ kind: 'res', letter: l });
  }
  for (let i = 0; i < you.drones_reserve; i++) slots.push({ kind: 'drone' });
  const used = slots.length;
  while (slots.length < you.cargo_capacity) slots.push({ kind: 'empty' });

  return (
    <div
      {...tipHandlers(
        <div className="space-y-1">
          <b className={T_HEAD + ' text-[12px]'}>Cargo hold — {used}/{you.cargo_capacity} spaces</b>
          {RESOURCE_LETTERS.filter((l) => you.cargo[l] > 0).map((l) => (
            <div key={l}>{RESOURCE_ICONS[l]} {resourceNames[l]} × {you.cargo[l]}</div>
          ))}
          <div>{DRONE_ICON} Drones in reserve × {you.drones_reserve} (each occupies a cargo space until launched)</div>
          <div className={T_MUted}>
            A full hold refuses new goods. Cargo value counts toward Wealth at game end.
          </div>
        </div>
      )}
      className="inline-flex flex-wrap gap-0.5 align-middle rounded border border-[#26365a] bg-[#0d1526]/90 p-1 max-w-[13.5rem]">
      {slots.map((s, i) => (
        <span key={i}
          className={
            'inline-flex items-center justify-center w-6 h-6 rounded-sm text-[13px] ' +
            (s.kind === 'empty' ? 'border border-dashed border-[#26365a] ' : 'border border-[#3a4f7d] ')
          }
          style={s.kind === 'res' ? { backgroundColor: FACTION_COLORS[s.letter] + '2e' } : undefined}>
          {s.kind === 'res' ? RESOURCE_ICONS[s.letter] : s.kind === 'drone' ? DRONE_ICON : ''}
        </span>
      ))}
    </div>
  );
}

// ── small display pieces ─────────────────────────────────────────────────

function CardChip({ cardKey, cards, onClick, onCommit, selected, committed, disabled, small, tipHandlers }) {
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
          title={committed ? 'Withdraw from mission' : 'Commit to mission'}>
          {committed ? '✓' : '+'}
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

function TrackBar({ label, step, tipHandlers }) {
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
      <b className={T_HEAD + ' text-[12px]'}>{label} track — step {step}/12</b>
      <div>Every won {label.toLowerCase()} mission advances this +1.</div>
      <div>Gates (red rings): step 4→5 needs a medium-ring win (Verge); step 8→9 a hard-ring win (Core).</div>
      <div className={T_MUted}>Matching cards score VP × this number at game end.</div>
    </div>
  ) : {};
  return (
    <div className="flex items-center gap-2 text-[11px]" {...handlers}>
      <span className={'w-14 ' + T_MUted}>{label}</span>
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

function StarMap({ state, draft, activeAction, mySeat, onPlanetClick, onDroneClick, tipHandlers }) {
  const map = state.map;
  const board = state.board;
  const drones = activeAction === 'move' ? virtualDrones(board, draft.steps) : board.drones;
  const intel = state.you.intel || {};

  const dronesAt = {};
  drones.forEach((d, i) => {
    (dronesAt[d.at] = dronesAt[d.at] || []).push(i);
  });

  // Highlight legal hop targets while a drone is selected.
  const hopTargets = new Set();
  if (activeAction === 'move' && draft.selectedDrone !== null && drones[draft.selectedDrone]) {
    for (const n of neighborsOf(map, drones[draft.selectedDrone].at)) hopTargets.add(n);
  }

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
        const holders = board.control?.[p.id] || {};
        const known = intel[p.id];
        const isDraftTarget = draft.planet === p.id ||
          draft.placements.some((pl) => pl.planet === p.id) || draft.dronePlanet === p.id;
        const isHopTarget = hopTargets.has(p.id);
        const isHome = p.home_seat !== null && p.home_seat !== undefined;
        const handlers = tipHandlers(<PlanetTooltip planet={p} state={state} />);
        return (
          <g key={p.id} onClick={() => onPlanetClick(p.id)} style={{ cursor: 'pointer' }}
            onMouseEnter={handlers.onMouseEnter} onMouseMove={handlers.onMouseMove}
            onMouseLeave={handlers.onMouseLeave}>
            {isHome && (
              <circle cx={p.x} cy={p.y} r={24} fill="none"
                stroke={SEAT_COLORS[p.home_seat]} strokeWidth={2} opacity={0.85} />
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
              yield {p.production}
            </text>
            {/* military / political badges */}
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
            {/* control markers: square = occupied (military), circle = allied */}
            {Object.entries(holders).map(([s, kind], i) => (
              kind === 'allied'
                ? <circle key={s} cx={p.x - 12 + i * 9} cy={p.y + 17} r={3.5}
                    fill={SEAT_COLORS[Number(s)]} stroke="#03060d" strokeWidth={0.7} pointerEvents="none" />
                : <rect key={s} x={p.x - 15 + i * 9} y={p.y + 14} width={7} height={7}
                    fill={SEAT_COLORS[Number(s)]} stroke="#03060d" strokeWidth={0.7} pointerEvents="none" />
            ))}
            {/* drones stacked at the planet, value shown for >1 */}
            {(dronesAt[p.id] || []).map((di, i) => {
              const d = drones[di];
              const dx = p.x - 24 + i * 11;
              return (
                <g key={di} onClick={(e) => { e.stopPropagation(); onDroneClick(di); }}
                  style={{ cursor: 'pointer' }}>
                  <polygon
                    points={`${dx + 4},${p.y - 19} ${dx},${p.y - 9} ${dx + 8},${p.y - 9}`}
                    fill={SEAT_COLORS[d.seat]} stroke="#03060d" strokeWidth={1}
                    opacity={activeAction === 'move' && d.seat === mySeat ? 1 : 0.85} />
                  {(d.value || 1) > 1 && (
                    <text x={dx + 4} y={p.y - 22} textAnchor="middle" fontSize={8.5}
                      fill={SEAT_COLORS[d.seat]} fontFamily="monospace">{d.value}</text>
                  )}
                  {draft.selectedDrone === di && (
                    <circle cx={dx + 4} cy={p.y - 13} r={10} fill="none"
                      stroke="#79c9d6" strokeWidth={1.8} strokeDasharray="3 2" />
                  )}
                </g>
              );
            })}
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
  const [panels, setPanels] = useState({ captains: true, market: false, log: false });

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

  const previewDrones = effectiveAction === 'move'
    ? virtualDrones(state.board, draft.steps) : state.board.drones;

  const myDroneCount = state.board.drones.filter((d) => d.seat === mySeat).length;
  let moveAllowance = myDroneCount + (effectiveCard?.step_bonus || 0);
  if ((you.upgrades || []).includes('nav_thrusters')) moveAllowance += 2;

  // Mission math (advisory mirror of sp_engine):
  //   strike:    M stat + commit_power × commits    vs planet.military
  //   diplomacy: D stat + your drone values there   vs planet.political
  //   trade:     T stat + commits' T stats          vs planet.political
  const missionType = effectiveAction === 'strike' ? 'military'
    : effectiveAction === 'diplomacy' ? 'diplomacy'
    : effectiveAction === 'trade' ? 'trade' : null;
  const commitsAllowed = effectiveAction === 'strike' || effectiveAction === 'trade';
  let missionTotal = 0;
  if (effectiveCard && missionType) {
    if (effectiveAction === 'strike') {
      missionTotal = effectiveCard.stats[0] + (effectiveCard.commit_power || 1) * draft.commits.length;
    } else if (effectiveAction === 'diplomacy') {
      missionTotal = effectiveCard.stats[1] +
        (draft.planet ? droneValuesAt(state.board.drones, mySeat, draft.planet) : 0);
    } else {
      missionTotal = effectiveCard.stats[2] +
        draft.commits.reduce((sum, k) => sum + cards[k].stats[2], 0);
    }
  }
  const missionNeed = draft.planet && you.intel[draft.planet]
    ? (effectiveAction === 'strike' ? you.intel[draft.planet].m : you.intel[draft.planet].p)
    : null;

  const picking = effectiveAction === 'recruit' || effectiveAction === 'recruit_free';

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
  const dragged = () => movedRef.current;

  function onDroneClick(index) {
    if (dragged() || effectiveAction !== 'move') return;
    const d = previewDrones[index];
    if (!d || d.seat !== mySeat) return;
    setDraft((dr) => ({ ...dr, selectedDrone: dr.selectedDrone === index ? null : index }));
  }

  function onPlanetClick(pid) {
    if (dragged() || !effectiveAction) return;
    if (effectiveAction === 'move') {
      // Hop the selected drone one lane per click.
      if (draft.selectedDrone === null) return;
      const d = previewDrones[draft.selectedDrone];
      if (!d || !connected(map, d.at, pid)) return;
      if (draft.steps.length >= moveAllowance) return;
      setDraft((dr) => ({ ...dr, steps: [...dr.steps, { drone: dr.selectedDrone, to: pid }] }));
      return;
    }
    setDraft((dr) => {
      if (effectiveAction === 'strike' || effectiveAction === 'diplomacy' || effectiveAction === 'trade') {
        return { ...dr, planet: dr.planet === pid ? null : pid };
      }
      if (effectiveAction === 'produce') return { ...dr, system: map.planets[pid].system };
      if (effectiveAction === 'deploy') {
        return { ...dr, placements: [...dr.placements, { planet: pid }] };
      }
      if (activeCardDef?.action === 'reset') return { ...dr, dronePlanet: pid };
      return dr;
    });
  }

  function toggleCommit(key) {
    if (!commitsAllowed) return;
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
      switch (effectiveAction) {
        case 'move':
          return { steps: draft.steps };
        case 'strike':
          return { planet: draft.planet, commits: draft.commits };
        case 'diplomacy':
          return { planet: draft.planet };
        case 'trade':
          return { planet: draft.planet, commits: draft.commits, sell: draft.sell, buy: draft.buy };
        case 'produce':
          return draft.mode === 'levy' ? { mode: 'levy' } : { mode: 'production', system: draft.system };
        case 'deploy':
          return draft.deployMode === 'credits'
            ? { mode: 'credits' } : { mode: 'place', placements: draft.placements };
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
        case 'envoy': return {};
        case 'reset':
          return {
            build_drone: draft.buildDrone,
            drone_planet: draft.dronePlanet || undefined,
            upgrades: draft.upgrades,
          };
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
      case 'strike':
        return draft.planet ? null : 'Click any planet to target the assault.';
      case 'diplomacy':
        return draft.planet ? null : 'Click any planet to court them. Your drones there add their values.';
      case 'trade':
        return draft.planet ? null : 'Click a planet adjacent to your drones.';
      case 'produce':
        return draft.mode === 'levy' || draft.system ? null : 'Click any planet to choose its system, or switch to the levy.';
      case 'deploy':
        return draft.deployMode === 'credits' || draft.placements.length > 0
          ? null : 'Click your home planet (or a controlled planet) to place each drone, or switch to credits.';
      case 'recruit': case 'recruit_free':
        return draft.picks.length > 0 ? null : 'Pick a card from the Market panel (top right).';
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
            activeAction={effectiveAction} tipHandlers={tipHandlers}
            onPlanetClick={onPlanetClick} onDroneClick={onDroneClick} />
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
                  {game.boon_seat === p.seat ? ' ✦' : ''}
                  {p.trophy ? ' 🏆' : ''}
                </span>
                <span className="font-mono">{p.credits}c</span>
              </div>
              <div className={'flex justify-between text-[11px] ' + T_MUted}>
                <MiniCargo cargo={p.cargo} />
                <span>hand {p.hand_count}</span>
              </div>
              <div className={'text-[10px] ' + T_MUted}>
                M{p.tracks.military.step} · D{p.tracks.diplomacy.step} · T{p.tracks.trade.step}
                {' · '}{DRONE_ICON}×{p.drones_reserve}
                {p.discard_top && <> · last: {cards[p.discard_top]?.name}</>}
                {p.conceded ? ' · withdrew' : ''}
                {ended && p.final_score !== null && <> · <b>{p.final_score} VP</b></>}
              </div>
            </div>
          ))}
        </Collapsible>

        <Collapsible title="Market" badge={`${state.market.stack_count} in stock`}
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

        <Collapsible title="Sector log" open={panels.log}
          onToggle={() => setPanels((p) => ({ ...p, log: !p.log }))}>
          <ul className={'space-y-0.5 text-[11px] max-h-48 overflow-y-auto ' + T_MUted}>
            {[...state.events].reverse().map((e) => (
              <li key={e.event_id}>{e.message}</li>
            ))}
          </ul>
        </Collapsible>
      </div>

      <div className={'absolute bottom-2 left-2 z-30 p-2.5 space-y-1.5 ' + PANEL}>
        <div className="flex items-center gap-3">
          <span className={'font-mono text-sm ' + T_GOLD}
            {...tipHandlers(<div><b className={T_HEAD}>Credits</b><div>Universal currency: drones, upgrades, market trades. Counts toward Wealth (1 VP per 10, with cargo value).</div></div>)}>
            {you.credits}c
          </span>
          <CargoHold you={you} resourceNames={state.resource_names} tipHandlers={tipHandlers} />
        </div>
        <TrackBar label="Military" step={you.tracks.military.step} tipHandlers={tipHandlers} />
        <TrackBar label="Diplomacy" step={you.tracks.diplomacy.step} tipHandlers={tipHandlers} />
        <TrackBar label="Trade" step={you.tracks.trade.step} tipHandlers={tipHandlers} />
        {(you.upgrades || []).length > 0 && (
          <div className={'text-[11px] ' + T_MUted}>
            {(you.upgrades || []).map((u) => (
              <span key={u} className="mr-2 underline decoration-dotted"
                {...tipHandlers(<UpgradeTooltip upgrade={state.upgrades_catalog[u]} />)}>
                {state.upgrades_catalog[u]?.name || u}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-30 max-w-[46vw]">
        <div className="flex overflow-x-auto pt-7 pb-1 px-2">
          {you.hand.map((key, i) => (
            <div key={key}
              className={'shrink-0 transition-transform hover:-translate-y-3 hover:z-40 ' + (i > 0 ? '-ml-14' : '')}
              style={{ zIndex: selectedCard === key ? 35 : 30 - (i % 10) }}>
              <CardChip cardKey={key} cards={cards} tipHandlers={tipHandlers}
                selected={selectedCard === key}
                committed={draft.commits.includes(key)}
                disabled={!myTurn || ended}
                onCommit={commitsAllowed && key !== selectedCard && myTurn && !ended
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

          {missionType && (
            <div className="text-[12px]">
              {effectiveAction === 'strike' ? 'Assault strength ' :
               effectiveAction === 'diplomacy' ? 'Diplomatic weight ' : 'Trade leverage '}
              <b className={T_GOLD}>{missionTotal}</b>
              {draft.planet && (
                <> vs {missionNeed !== null
                  ? <b className={missionTotal >= missionNeed ? T_GOOD : T_BAD}>{missionNeed}</b>
                  : <b className={T_MUted}>?</b>}
                  {' '}at {map.planets[draft.planet].name}</>
              )}
              {effectiveAction === 'strike' && (
                <div className={'text-[10px] ' + T_MUted}>
                  Each committed card (+ button on hand cards) adds +{effectiveCard?.commit_power || 1}.
                  Committed: {draft.commits.length}. Win = conquer: the planet yields a flat 1 good.
                </div>
              )}
              {effectiveAction === 'diplomacy' && (
                <div className={'text-[10px] ' + T_MUted}>
                  Your drones at the target add their values
                  {draft.planet ? ` (+${droneValuesAt(state.board.drones, mySeat, draft.planet)} here)` : ''}.
                  Win = ally: the planet yields its full production.
                </div>
              )}
            </div>
          )}

          {effectiveAction === 'move' && (
            <div className={'text-[11px] ' + T_MUted}>
              Steps {draft.steps.length}/{moveAllowance} — click one of your drones, then
              click neighboring planets to hop it lane by lane.
              {draft.steps.length > 0 && (
                <button type="button" className={BTN + ' ml-2 text-[10px] py-0.5'}
                  onClick={() => setDraft((dr) => ({ ...dr, steps: [], selectedDrone: null }))}>
                  Undo moves
                </button>
              )}
            </div>
          )}

          {effectiveAction === 'trade' && (
            <TradeControls draft={draft} setDraft={setDraft} you={you} prices={state.prices} />
          )}

          {effectiveAction === 'produce' && (
            <div className="text-[11px] space-y-1">
              <label className="mr-3">
                <input type="radio" checked={draft.mode === 'production'}
                  onChange={() => setDraft((dr) => ({ ...dr, mode: 'production' }))} /> Production
                {draft.system && <> in <b>{map.systems[draft.system]?.name}</b></>}
              </label>
              <label>
                <input type="radio" checked={draft.mode === 'levy'}
                  onChange={() => setDraft((dr) => ({ ...dr, mode: 'levy' }))} /> Collect levy
              </label>
            </div>
          )}

          {effectiveAction === 'deploy' && (
            <div className="text-[11px] space-y-1">
              <label className="mr-3">
                <input type="radio" checked={draft.deployMode === 'place'}
                  onChange={() => setDraft((dr) => ({ ...dr, deployMode: 'place' }))} />
                {' '}Launch value-{effectiveCard?.drone_value || 1} drones
                {' '}({draft.placements.length} queued, 1 {RESOURCE_ICONS.O} + 1 {RESOURCE_ICONS.B} each)
              </label>
              <label>
                <input type="radio" checked={draft.deployMode === 'credits'}
                  onChange={() => setDraft((dr) => ({ ...dr, deployMode: 'credits' }))} />
                {' '}Take credits instead (5 + 1 per drone on the board)
              </label>
              {draft.placements.length > 0 && (
                <button type="button" className={BTN + ' text-[10px] py-0.5'}
                  onClick={() => setDraft((dr) => ({ ...dr, placements: [] }))}>
                  Clear placements
                </button>
              )}
            </div>
          )}

          {activeCardDef.action === 'reset' && (
            <div className="text-[11px] space-y-1">
              <label>
                <input type="checkbox" checked={draft.buildDrone}
                  onChange={(e) => setDraft((dr) => ({ ...dr, buildDrone: e.target.checked }))} />
                {' '}Build a value-1 drone
                {selectedCard === 'maintenance_bay_2' ? ' (free)' : ` (1 ${RESOURCE_ICONS.O} + 1 ${RESOURCE_ICONS.B})`}
                {draft.buildDrone && (
                  <span className={T_MUted}>
                    {' '}at {draft.dronePlanet ? map.planets[draft.dronePlanet]?.name : 'home (or click a controlled planet)'}
                  </span>
                )}
              </label>
              <div>
                Upgrades:
                {Object.entries(state.upgrades_catalog).map(([key, u]) => {
                  const owned = (you.upgrades || []).includes(key);
                  const chosen = draft.upgrades.includes(key);
                  return (
                    <label key={key} className={'block pl-2 ' + (owned ? 'opacity-40' : '')}
                      {...tipHandlers(<UpgradeTooltip upgrade={u} />)}>
                      <input type="checkbox" disabled={owned} checked={chosen}
                        onChange={() => setDraft((dr) => ({
                          ...dr,
                          upgrades: chosen ? dr.upgrades.filter((k) => k !== key) : [...dr.upgrades, key],
                        }))} />
                      {' '}{u.name} — {u.credits}c{u.resources.length ? ' + ' + u.resources.map((r) => RESOURCE_ICONS[r]).join('') : ''}
                    </label>
                  );
                })}
              </div>
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

function TradeControls({ draft, setDraft, you, prices }) {
  function setSide(side, letter, qty) {
    setDraft((dr) => ({ ...dr, [side]: { ...dr[side], [letter]: Math.max(0, qty) } }));
  }
  return (
    <div className="text-[11px] space-y-1">
      <div>
        Sell:
        {RESOURCE_LETTERS.map((l) => (
          <span key={l} className="ml-2">
            <span>{RESOURCE_ICONS[l]}</span>
            <input type="number" min={0} max={you.cargo[l] || 0}
              value={draft.sell[l] || 0}
              onChange={(e) => setSide('sell', l, Number(e.target.value))}
              className="w-10 ml-0.5 bg-[#060b16] border border-[#2f4b6e] rounded px-1" />
          </span>
        ))}
      </div>
      <div>
        Buy:
        {RESOURCE_LETTERS.map((l) => (
          <span key={l} className="ml-2">
            <span>{RESOURCE_ICONS[l]}</span>
            <input type="number" min={0}
              value={draft.buy[l] || 0}
              onChange={(e) => setSide('buy', l, Number(e.target.value))}
              className="w-10 ml-0.5 bg-[#060b16] border border-[#2f4b6e] rounded px-1" />
          </span>
        ))}
      </div>
      <div className={T_MUted}>
        Prices {RESOURCE_LETTERS.map((l) => `${RESOURCE_ICONS[l]}${prices[l]}`).join(' ')}.
        Two resource types max per trade.
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

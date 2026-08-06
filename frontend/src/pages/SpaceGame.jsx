import { useMemo, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSpaceGame } from '../hooks/useSpaceGame.js';
import { spPlayCard, spConcede } from '../api/space.js';
import { loadSpSession } from '../api/spSession.js';

/**
 * SpaceGame — the playable board for the SPACE GAME prototype.
 *
 * Server-authoritative: this page only BUILDS action params and renders
 * state; every rule lives in backend/sp_engine.php. Client-side checks and
 * the cost/scoring figures shown in tooltips are advisory display mirrors,
 * never authority.
 */

const SEAT_COLORS = ['#d4a017', '#4d7c5a', '#a04545', '#6b7bb5', '#8a9a5b'];
const FACTION_COLORS = {
  O: '#8a7060', B: '#4d8a4d', C: '#5b7d99', N: '#c09a3f', A: '#8d5bb0',
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
  alliances: 'At game end this card scores VP per star system where you hold at least one treaty.',
  trade_guild: 'At game end this card scores VP equal to your Trade track position.',
  war_college: 'At game end this card scores VP equal to your Military track position.',
  engineering: 'At game end this card scores 2 VP per ship upgrade you own.',
};
const ACTION_LABELS = {
  reset: 'Reset', move: 'Navigate', strike: 'Strike', trade: 'Trade',
  produce: 'Produce', deploy: 'Deploy drones', recruit: 'Install (2)',
  recruit_free: 'Install (1, free position)', copy: 'Intercept', envoy: 'Envoy',
};
const MISSION_STAT = { move: 1, strike: 0, trade: 2 }; // index into stats [M,D,T]

const emptyDraft = {
  steps: [], selectedDrone: null, treatyPlanet: null, commits: [],
  planet: null, sell: {}, buy: {}, system: null, mode: 'production',
  deployMode: 'place', placements: [], picks: [],
  buildDrone: false, dronePlanet: null, upgrades: [], copyTarget: null,
};

// ── geometry helpers ─────────────────────────────────────────────────────

function laneEnds(map, laneKey) { return map.lanes[laneKey]; }

function lanesOfPlanet(map, pid) {
  const out = {};
  for (const [key, pair] of Object.entries(map.lanes)) {
    if (pair[0] === pid) out[key] = pair[1];
    else if (pair[1] === pid) out[key] = pair[0];
  }
  return out;
}

function virtualDrones(board, steps) {
  const drones = board.drones.map((d) => ({ ...d }));
  for (const s of steps) drones[s.drone] = { ...drones[s.drone], type: 'lane', at: s.to };
  return drones;
}

function adjacentPlanets(map, drones, seat) {
  const set = new Set();
  for (const d of drones) {
    if (d.seat !== seat) continue;
    if (d.type === 'docked') {
      set.add(d.at);
      for (const other of Object.values(lanesOfPlanet(map, d.at))) set.add(other);
    } else {
      const pair = laneEnds(map, d.at);
      if (pair) { set.add(pair[0]); set.add(pair[1]); }
    }
  }
  return set;
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

/** Display mirror of the server's treaty cost (sp_engine.php). */
function treatyCostText(planet, holders, prices) {
  const n = (holders?.length || 0) + 1;
  if (planet.faction === 'O') return `1 ${RESOURCE_ICONS.B} Biomass + ${n} credit${n > 1 ? 's' : ''}`;
  const credits = (prices[planet.faction] - 2) * n;
  return `1 ${RESOURCE_ICONS.O} Ore + 1 ${RESOURCE_ICONS[planet.faction]} + ${credits} credits`;
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
    top: Math.min(tip.y + pad, window.innerHeight - 260),
    maxWidth: 320,
  };
  return (
    <div style={style}
      className="rounded border border-gold-500/60 bg-teal-950/95 shadow-lg px-3 py-2 text-[11px] leading-snug text-cream-100">
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
        <b className="text-gold-300 text-[12px]">{c.name}</b>
        <span className="text-cream-400">{c.stage ? `Market stage ${'I'.repeat(0) + ['I','II','III','IV','V'][c.stage-1]}` : 'Starting card'}</span>
      </div>
      <div className="text-cream-300">{ACTION_LABELS[c.action]}{c.faction ? ` — ${RESOURCE_ICONS[c.faction]}` : ''}</div>
      <table className="w-full">
        <tbody>
          <tr>
            <td className="pr-2 text-oxblood-300">Military {c.stats[0]}</td>
            <td className="pr-2 text-gold-300">Diplomacy {c.stats[1]}</td>
            <td className="text-verdigris-300">Trade {c.stats[2]}</td>
          </tr>
        </tbody>
      </table>
      <div>{c.text}</div>
      {c.rider_credits > 0 && <div className="text-gold-400">Grants {c.rider_credits} credits when it leads a successful trade.</div>}
      {c.kind !== 'starter' && c.cost?.length > 0 && (
        <div>Cost: {costIcons(c.cost)} <span className="text-cream-400">(+ its market-position cost)</span></div>
      )}
      <div className="border-t border-teal-800 pt-1 text-cream-300">
        <b className="text-gold-400">{AFFILIATION_LABELS[c.affiliation]}.</b>{' '}
        {AFFILIATION_SCORING[c.affiliation]}
      </div>
      <div className="text-cream-400">
        Commit it to a mission to add its matching stat (it goes to your discard, recoverable on reset).
      </div>
    </div>
  );
}

function PlanetTooltip({ planet, state }) {
  const { board, players, prices } = state;
  const holders = board.treaties[planet.id] || [];
  const known = state.you.intel[planet.id];
  const yieldN = 2;
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-3">
        <b className="text-gold-300 text-[12px]">{planet.name}</b>
        <span className="text-cream-400">{state.map.systems[planet.system]?.name}</span>
      </div>
      <div>
        <span style={{ color: FACTION_COLORS[planet.faction] }}>
          {state.faction_names[planet.faction]}
        </span>
        {' — '}yields {RESOURCE_ICONS[planet.faction]} {state.resource_names[planet.faction]}
        {' '}(sells for {prices[planet.faction]}c)
      </div>
      <div>{RING_LABELS[planet.ring] || `Ring ${planet.ring}`}</div>
      <div>
        Opposition:{' '}
        {known !== undefined
          ? <b className="text-gold-300">{known}</b>
          : <span className="text-cream-400">unknown — move a drone adjacent to scout it</span>}
      </div>
      {planet.home_seat !== null && planet.home_seat !== undefined && (
        <div style={{ color: SEAT_COLORS[planet.home_seat] }}>
          Home port of {players.find((p) => p.seat === planet.home_seat)?.name || `seat ${planet.home_seat + 1}`}
        </div>
      )}
      <div>
        Treaties:{' '}
        {holders.length === 0 ? <span className="text-cream-400">none yet</span>
          : holders.map((s, i) => (
            <span key={i} style={{ color: SEAT_COLORS[s] }}>
              {players.find((p) => p.seat === s)?.name || `seat ${s + 1}`}{i < holders.length - 1 ? ', ' : ''}
            </span>
          ))}
      </div>
      <div className="border-t border-teal-800 pt-1 text-cream-300 space-y-0.5">
        <div>🤝 Treaty (Diplomacy mission, then pay): {treatyCostText(planet, holders, prices)}</div>
        <div>⚔️ Strike (Military mission): seize {yieldN} {RESOURCE_ICONS[planet.faction]}</div>
        <div>💰 Trade (Trade mission): credits + buy/sell at list prices</div>
        <div className="text-cream-400">All missions need one of your drones adjacent. Winning a mission here advances its track{planet.ring >= 2 ? ' and can break tier gates' : ' (tier 1 only — gates need farther rings)'}.</div>
      </div>
    </div>
  );
}

function UpgradeTooltip({ upgrade }) {
  return (
    <div className="space-y-1">
      <b className="text-gold-300 text-[12px]">{upgrade.name}</b>
      <div>{upgrade.text}</div>
      <div className="text-cream-300">
        Cost: {upgrade.credits}c{upgrade.resources.length ? ' + ' + upgrade.resources.map((r) => RESOURCE_ICONS[r]).join(' ') : ''}
        {' '}· Bought during a Reset · Worth 2 VP per Engineering card at game end.
      </div>
    </div>
  );
}

// ── cargo hold ───────────────────────────────────────────────────────────

function CargoHold({ you, resourceNames, tipHandlers }) {
  const slots = [];
  for (const l of RESOURCE_LETTERS) {
    for (let i = 0; i < (you.cargo[l] || 0); i++) {
      slots.push({ kind: 'res', letter: l });
    }
  }
  for (let i = 0; i < you.drones_reserve; i++) slots.push({ kind: 'drone' });
  const used = slots.length;
  while (slots.length < you.cargo_capacity) slots.push({ kind: 'empty' });

  return (
    <div
      {...tipHandlers(
        <div className="space-y-1">
          <b className="text-gold-300 text-[12px]">Cargo hold — {used}/{you.cargo_capacity} spaces</b>
          {RESOURCE_LETTERS.filter((l) => you.cargo[l] > 0).map((l) => (
            <div key={l}>{RESOURCE_ICONS[l]} {resourceNames[l]} × {you.cargo[l]}</div>
          ))}
          <div>{DRONE_ICON} Drones in reserve × {you.drones_reserve} (each occupies a cargo space until launched)</div>
          <div className="text-cream-400">
            A full hold refuses new goods — production and mission loot are lost
            beyond capacity. Cargo value counts toward Wealth at game end.
          </div>
        </div>
      )}
      className="inline-flex flex-wrap gap-0.5 align-middle rounded border border-teal-700 bg-teal-900/60 p-1"
      data-testid="cargo-hold">
      {slots.map((s, i) => (
        <span key={i}
          className={
            'inline-flex items-center justify-center w-6 h-6 rounded-sm text-[13px] ' +
            (s.kind === 'empty'
              ? 'border border-dashed border-teal-700 '
              : 'border border-teal-600 ')
          }
          style={s.kind === 'res' ? { backgroundColor: FACTION_COLORS[s.letter] + '33' } : undefined}>
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
    <div className={'relative ' + (small ? 'w-36' : 'w-44')}
      {...tipHandlers(<CardTooltip cardKey={cardKey} cards={cards} />)}>
      <button type="button" onClick={onClick} disabled={disabled}
        className={
          'w-full text-left rounded border px-2 py-1 transition-colors ' +
          (selected ? 'border-gold-300 bg-teal-800 ' :
           committed ? 'border-gold-600 bg-teal-800/70 ' :
           'border-teal-700 bg-teal-900/70 hover:border-cream-400 ') +
          (disabled ? 'opacity-50 cursor-not-allowed ' : '')
        }>
        <div className="flex justify-between items-baseline gap-1">
          <span className="font-semibold text-[11px] leading-tight">{c.name}</span>
          <span className="text-[10px] font-mono whitespace-nowrap">
            <span className="text-oxblood-300">{c.stats[0]}</span>/
            <span className="text-gold-300">{c.stats[1]}</span>/
            <span className="text-verdigris-300">{c.stats[2]}</span>
          </span>
        </div>
        <div className="text-[10px] text-cream-400">{ACTION_LABELS[c.action]}</div>
        <div className="text-[9px] text-gold-400">{AFFILIATION_LABELS[c.affiliation]}</div>
      </button>
      {onCommit && (
        <button type="button" onClick={onCommit}
          className={
            'absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[10px] leading-none border ' +
            (committed
              ? 'bg-gold-500 text-teal-950 border-gold-300'
              : 'bg-teal-800 text-cream-200 border-teal-600 hover:border-gold-400')
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
          <span key={l} className="mr-1.5" style={{ color: FACTION_COLORS[l] }}>
            {RESOURCE_ICONS[l]}{cargo[l]}
          </span>
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
          (i <= step ? 'bg-gold-400 ' : 'bg-teal-800 ') +
          (gate ? 'ring-1 ring-oxblood-400 ' : '')
        } />
    );
  }
  const handlers = tipHandlers ? tipHandlers(
    <div className="space-y-1">
      <b className="text-gold-300 text-[12px]">{label} track — step {step}/12</b>
      <div>Every successful {label.toLowerCase()} mission advances this +1.</div>
      <div>Gates (red rings) block advancement: crossing step 4→5 needs a win at a
        medium-ring planet (Verge); step 8→9 needs a hard-ring win (Core).</div>
      <div className="text-cream-400">Matching cards score VP × this number at game end.</div>
    </div>
  ) : {};
  return (
    <div className="flex items-center gap-2 text-[11px]" {...handlers}>
      <span className="w-16 text-cream-300">{label}</span>
      <span>{cells}</span>
      <span className="font-mono text-cream-400">{step}/12</span>
    </div>
  );
}

// ── the star map ─────────────────────────────────────────────────────────

function StarMap({ state, draft, activeAction, onPlanetClick, onLaneClick, onDroneClick, tipHandlers }) {
  const map = state.map;
  const board = state.board;
  const drones = activeAction === 'move' ? virtualDrones(board, draft.steps) : board.drones;
  const intel = state.you.intel || {};

  const dockedAt = {};
  drones.forEach((d, i) => {
    if (d.type === 'docked') (dockedAt[d.at] = dockedAt[d.at] || []).push(i);
  });

  return (
    <svg viewBox="0 0 1000 1000" className="w-full h-full select-none"
      style={{ background: 'radial-gradient(circle at 50% 50%, #10282c 0%, #071417 75%)' }}>
      {Object.entries(map.lanes).map(([key, [a, b]]) => {
        const pa = map.planets[a]; const pb = map.planets[b];
        if (!pa || !pb) return null;
        const occupant = drones.find((d) => d.type === 'lane' && d.at === key);
        const mx = (pa.x + pb.x) / 2; const my = (pa.y + pb.y) / 2;
        return (
          <g key={key} onClick={() => onLaneClick(key)} style={{ cursor: 'pointer' }}>
            <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
              stroke="#2e5a5f" strokeWidth={2} strokeDasharray="6 5" />
            <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="transparent" strokeWidth={16} />
            {occupant && (
              <polygon
                points={`${mx},${my - 9} ${mx - 8},${my + 6} ${mx + 8},${my + 6}`}
                fill={SEAT_COLORS[occupant.seat]} stroke="#0b1c1f" strokeWidth={1.5}
                onClick={(e) => { e.stopPropagation(); onDroneClick(drones.indexOf(occupant)); }}
                style={{ cursor: 'pointer' }} />
            )}
          </g>
        );
      })}

      {Object.values(map.planets).map((p) => {
        const treaties = board.treaties[p.id] || [];
        const known = intel[p.id];
        const isDraftTarget = draft.treatyPlanet === p.id || draft.planet === p.id ||
          draft.placements.some((pl) => pl.planet === p.id) || draft.dronePlanet === p.id;
        const isHome = p.home_seat !== null && p.home_seat !== undefined;
        const handlers = tipHandlers(<PlanetTooltip planet={p} state={state} />);
        return (
          <g key={p.id} onClick={() => onPlanetClick(p.id)} style={{ cursor: 'pointer' }}
            onMouseEnter={handlers.onMouseEnter} onMouseMove={handlers.onMouseMove}
            onMouseLeave={handlers.onMouseLeave}>
            {isHome && (
              <circle cx={p.x} cy={p.y} r={24} fill="none"
                stroke={SEAT_COLORS[p.home_seat]} strokeWidth={2} opacity={0.8} />
            )}
            <circle cx={p.x} cy={p.y} r={15} fill={FACTION_COLORS[p.faction]}
              stroke={isDraftTarget ? '#e8c56a' : '#0b1c1f'} strokeWidth={isDraftTarget ? 3.5 : 1.5} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={11}
              fill="#f4ead6" fontFamily="monospace" pointerEvents="none">{p.faction}</text>
            <text x={p.x} y={p.y + 32} textAnchor="middle" fontSize={11} fill="#c9b892"
              pointerEvents="none">
              {p.name}
            </text>
            <g pointerEvents="none">
              <circle cx={p.x + 15} cy={p.y - 13} r={8}
                fill={known !== undefined ? '#3f2d17' : '#22383b'}
                stroke={known !== undefined ? '#e8c56a' : '#41686d'} strokeWidth={1} />
              <text x={p.x + 15} y={p.y - 9.5} textAnchor="middle" fontSize={9.5}
                fill={known !== undefined ? '#e8c56a' : '#8fb2b5'} fontFamily="monospace">
                {known !== undefined ? known : '?'}
              </text>
            </g>
            {treaties.map((seat, i) => (
              <rect key={i} x={p.x - 15 + i * 7} y={p.y + 15} width={6} height={6}
                fill={SEAT_COLORS[seat]} stroke="#0b1c1f" strokeWidth={0.7}
                pointerEvents="none" />
            ))}
            {(dockedAt[p.id] || []).map((di, i) => {
              const d = drones[di];
              return (
                <polygon key={di}
                  points={`${p.x - 22 + i * 10},${p.y - 18} ${p.x - 26 + i * 10},${p.y - 8} ${p.x - 18 + i * 10},${p.y - 8}`}
                  fill={SEAT_COLORS[d.seat]} stroke="#0b1c1f" strokeWidth={1}
                  onClick={(e) => { e.stopPropagation(); onDroneClick(di); }}
                  style={{ cursor: 'pointer' }} />
              );
            })}
          </g>
        );
      })}

      {draft.selectedDrone !== null && drones[draft.selectedDrone] && (() => {
        const d = drones[draft.selectedDrone];
        let x; let y;
        if (d.type === 'docked') {
          const p = map.planets[d.at]; x = p.x - 22; y = p.y - 13;
        } else {
          const [a, b] = laneEnds(map, d.at);
          x = (map.planets[a].x + map.planets[b].x) / 2;
          y = (map.planets[a].y + map.planets[b].y) / 2;
        }
        return <circle cx={x} cy={y} r={14} fill="none" stroke="#e8c56a" strokeWidth={2} strokeDasharray="4 3" />;
      })()}
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

  // Tooltip plumbing: spread {...tipHandlers(<node/>)} onto any element.
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

  if (!session) {
    return (
      <Shell>
        <p>No session for this game on this device. Open it from the
          {' '}<Link className="underline" to="/space">Space lobby</Link> to adopt it.</p>
      </Shell>
    );
  }
  if (isLoading && !state) return <Shell><p>Contacting the sector…</p></Shell>;
  if (error && !state) return <Shell><p className="text-oxblood-300">{error}</p></Shell>;
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

  const previewDrones = effectiveAction === 'move'
    ? virtualDrones(state.board, draft.steps) : state.board.drones;

  const myDroneCount = state.board.drones.filter((d) => d.seat === mySeat).length;
  let moveAllowance = myDroneCount;
  if ((you.upgrades || []).includes('nav_thrusters')) moveAllowance += 2;

  const missionStatIdx = MISSION_STAT[effectiveAction];
  const missionType = effectiveAction === 'move' ? 'diplomacy'
    : effectiveAction === 'strike' ? 'military'
    : effectiveAction === 'trade' ? 'trade' : null;
  const missionTotal = missionType && effectiveCardKey
    ? cards[effectiveCardKey].stats[missionStatIdx] +
      draft.commits.reduce((sum, k) => sum + cards[k].stats[missionStatIdx], 0)
    : 0;

  function onDroneClick(index) {
    if (effectiveAction !== 'move') return;
    const d = previewDrones[index];
    if (!d || d.seat !== mySeat) return;
    setDraft((dr) => ({ ...dr, selectedDrone: index }));
  }

  function onLaneClick(laneKey) {
    if (effectiveAction !== 'move' || draft.selectedDrone === null) return;
    if (draft.steps.length >= moveAllowance) return;
    setDraft((dr) => ({ ...dr, steps: [...dr.steps, { drone: dr.selectedDrone, to: laneKey }] }));
  }

  function onPlanetClick(pid) {
    if (!effectiveAction) return;
    setDraft((dr) => {
      if (effectiveAction === 'move') return { ...dr, treatyPlanet: dr.treatyPlanet === pid ? null : pid };
      if (effectiveAction === 'strike' || effectiveAction === 'trade') return { ...dr, planet: pid };
      if (effectiveAction === 'produce') return { ...dr, system: map.planets[pid].system };
      if (effectiveAction === 'deploy') {
        return { ...dr, placements: [...dr.placements, { planet: pid }] };
      }
      if (activeCardDef?.action === 'reset') return { ...dr, dronePlanet: pid };
      return dr;
    });
  }

  function toggleCommit(key) {
    if (!missionType) return;
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
        case 'move': {
          const p = { steps: draft.steps };
          if (draft.treatyPlanet) p.treaty = { planet: draft.treatyPlanet, commits: draft.commits };
          return p;
        }
        case 'strike':
          return { planet: draft.planet, commits: draft.commits };
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

  // Why can't I press Execute yet? Surface the reason instead of a mute
  // disabled button — "nothing happened" is the enemy.
  const blockReason = (() => {
    if (!activeCardDef) return null;
    if (!myTurn) return game.status === 'ended' ? 'The game has ended.' : 'Not your turn yet.';
    if (activeCardDef.action === 'copy' && draft.copyTarget === null) return 'Choose whose last action to intercept.';
    switch (effectiveAction) {
      case 'strike': case 'trade':
        return draft.planet ? null : 'Click a target planet on the map (must be adjacent to one of your drones).';
      case 'produce':
        return draft.mode === 'levy' || draft.system ? null : 'Click any planet to choose its system, or switch to the levy.';
      case 'deploy':
        return draft.deployMode === 'credits' || draft.placements.length > 0
          ? null : 'Click your home planet (or a treaty planet) to place each drone, or switch to credits.';
      case 'recruit': case 'recruit_free':
        return draft.picks.length > 0 ? null : 'Pick a card from the market display (right panel).';
      default: return null;
    }
  })();
  const confirmReady = activeCardDef && !blockReason;

  const ended = game.status === 'ended';

  return (
    <div className="min-h-screen bg-teal-950 text-cream-100 flex flex-col">
      <TooltipLayer tip={tip} />

      {/* header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-teal-800">
        <div className="flex items-center gap-4">
          <Link to="/space" className="text-sm underline text-cream-300">← Lobby</Link>
          <span className="font-display text-gold-300">Sector Umbra — game #{game.game_id}</span>
          <span className="text-sm text-cream-300">Turn {game.turn_number}</span>
          {game.endgame_trigger && !ended && (
            <span className="text-sm text-oxblood-300">
              Final turns! ({game.final_turns_remaining} remaining)
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          {!ended && (
            <span className={myTurn ? 'text-gold-300 font-semibold' : 'text-cream-400'}>
              {myTurn ? 'YOUR TURN' : `Waiting on ${state.players.find((p) => p.seat === game.current_seat)?.name || '…'}`}
            </span>
          )}
          {!ended && <button className="btn-ghost" onClick={handleConcede}>Concede</button>}
        </div>
      </div>

      {actionError && (
        <div className="px-4 py-2 bg-oxblood-900/60 border-b border-oxblood-400 text-sm">
          ⚠ {actionError}
          <button className="ml-3 underline text-cream-300" onClick={() => setActionError(null)}>dismiss</button>
        </div>
      )}

      {ended && <ResultsBanner state={state} />}

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0">
          <StarMap state={state} draft={draft}
            activeAction={effectiveAction} tipHandlers={tipHandlers}
            onPlanetClick={onPlanetClick} onLaneClick={onLaneClick} onDroneClick={onDroneClick} />
        </div>

        {/* right rail */}
        <div className="w-80 shrink-0 border-l border-teal-800 overflow-y-auto p-3 space-y-4 text-sm">
          <div>
            <h3 className="font-display text-gold-300 mb-1">Captains</h3>
            {state.players.map((p) => (
              <div key={p.seat}
                className={'rounded border px-2 py-1.5 mb-1.5 ' +
                  (game.current_seat === p.seat && !ended ? 'border-gold-500' : 'border-teal-800')}>
                <div className="flex justify-between">
                  <span style={{ color: SEAT_COLORS[p.seat] }} className="font-semibold">
                    {p.name}{p.is_you ? ' (you)' : ''}
                    {game.boon_seat === p.seat ? ' ✦' : ''}
                    {p.trophy ? ' 🏆' : ''}
                  </span>
                  <span className="font-mono">{p.credits}c</span>
                </div>
                <div className="flex justify-between text-[11px] text-cream-300">
                  <MiniCargo cargo={p.cargo} />
                  <span>hand {p.hand_count}</span>
                </div>
                <div className="text-[10px] text-cream-400">
                  M{p.tracks.military.step} · D{p.tracks.diplomacy.step} · T{p.tracks.trade.step}
                  {' · '}{DRONE_ICON}×{p.drones_reserve} held
                  {p.discard_top && <> · last: {cards[p.discard_top]?.name}</>}
                  {p.conceded ? ' · withdrew' : ''}
                  {ended && p.final_score !== null && <> · <b>{p.final_score} VP</b></>}
                </div>
              </div>
            ))}
          </div>

          <div>
            <h3 className="font-display text-gold-300 mb-1">
              Component market <span className="text-cream-400 text-[11px]">({state.market.stack_count} in stock)</span>
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {state.market.display.map((key, pos) => {
                const posCost = state.position_costs[pos] || [];
                const picking = effectiveAction === 'recruit' || effectiveAction === 'recruit_free';
                return (
                  <div key={key}>
                    <CardChip cardKey={key} cards={cards} small tipHandlers={tipHandlers}
                      selected={draft.picks.includes(key)}
                      disabled={!picking || !myTurn}
                      onClick={() => togglePick(key)} />
                    <div className="text-[9px] text-cream-400 pl-1">
                      {costIcons(cards[key].cost)}
                      {posCost.length > 0 && <> + position {costIcons(posCost)}</>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="font-display text-gold-300 mb-1">Sector log</h3>
            <ul className="space-y-0.5 text-[11px] text-cream-300 max-h-56 overflow-y-auto">
              {[...state.events].reverse().map((e) => (
                <li key={e.event_id}>{e.message}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* bottom: you + hand + action panel */}
      <div className="border-t border-teal-800 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="font-mono text-gold-300"
            {...tipHandlers(<div><b className="text-gold-300">Credits</b><div>Universal currency: treaties, drones, upgrades, market trades. Counts toward Wealth (1 VP per 10, with cargo value).</div></div>)}>
            {you.credits} credits
          </span>
          <CargoHold you={you} resourceNames={state.resource_names} tipHandlers={tipHandlers} />
          <TrackBar label="Military" step={you.tracks.military.step} tipHandlers={tipHandlers} />
          <TrackBar label="Diplomacy" step={you.tracks.diplomacy.step} tipHandlers={tipHandlers} />
          <TrackBar label="Trade" step={you.tracks.trade.step} tipHandlers={tipHandlers} />
          {(you.upgrades || []).length > 0 && (
            <span className="text-[11px] text-cream-300">
              Upgrades:{' '}
              {(you.upgrades || []).map((u) => (
                <span key={u} className="mr-1 underline decoration-dotted"
                  {...tipHandlers(<UpgradeTooltip upgrade={state.upgrades_catalog[u]} />)}>
                  {state.upgrades_catalog[u]?.name || u}
                </span>
              ))}
            </span>
          )}
        </div>

        <div className="flex gap-3">
          <div className="flex flex-wrap gap-1.5 flex-1 content-start">
            {you.hand.map((key) => (
              <CardChip key={key} cardKey={key} cards={cards} tipHandlers={tipHandlers}
                selected={selectedCard === key}
                committed={draft.commits.includes(key)}
                disabled={!myTurn || ended}
                onCommit={missionType && key !== selectedCard && myTurn && !ended
                  ? () => toggleCommit(key) : undefined}
                onClick={() => {
                  if (selectedCard === key) {
                    resetDraft();
                  } else {
                    resetDraft();
                    setSelectedCard(key);
                  }
                }} />
            ))}
            {you.hand.length === 0 && (
              <span className="text-cream-400 text-sm self-center">
                Hand empty. Discard: {you.discard.map((k) => cards[k].name).join(', ') || 'empty'}
              </span>
            )}
          </div>

          {activeCardDef && (
            <div className="w-96 shrink-0 rounded border border-gold-600/50 bg-teal-900/70 p-3 text-sm space-y-2">
              <div className="flex justify-between items-baseline">
                <b className="text-gold-300">{activeCardDef.name}</b>
                <span className="text-[11px] text-cream-400">{ACTION_LABELS[activeCardDef.action]}</span>
              </div>
              <p className="text-[11px] text-cream-300">{activeCardDef.text}</p>

              {activeCardDef.action === 'copy' && (
                <div>
                  <div className="mb-1">Intercept whom?</div>
                  <div className="flex gap-1.5 flex-wrap">
                    {state.players.filter((p) => !p.is_you).map((p) => {
                      const top = p.discard_top;
                      const blocked = !top || ['reset', 'copy'].includes(cards[top]?.action);
                      return (
                        <button key={p.seat} type="button" disabled={blocked}
                          onClick={() => setDraft((dr) => ({ ...emptyDraft, copyTarget: p.seat }))}
                          className={'btn-ghost text-[11px] ' + (draft.copyTarget === p.seat ? 'ring-1 ring-gold-400' : '')}>
                          {p.name}: {top ? cards[top]?.name : '(no discard)'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {missionType && (
                <div className="text-[12px]">
                  Mission strength <b className="text-gold-300">{missionTotal}</b>
                  {(draft.treatyPlanet || draft.planet) && (() => {
                    const pid = draft.treatyPlanet || draft.planet;
                    const known = you.intel[pid];
                    return (
                      <> vs {known !== undefined
                        ? <b className={missionTotal >= known ? 'text-verdigris-300' : 'text-oxblood-300'}>{known}</b>
                        : <b className="text-cream-400">?</b>}
                        {' '}at {map.planets[pid].name}</>
                    );
                  })()}
                  <div className="text-[10px] text-cream-400">
                    Use the + button on other hand cards to commit them
                    (their matching stat adds; they discard win or lose).
                  </div>
                </div>
              )}

              {effectiveAction === 'move' && (
                <div className="text-[11px] text-cream-300">
                  Steps {draft.steps.length}/{moveAllowance} — click one of your drones, then lanes.
                  Click a planet to target a treaty; click again to clear.
                  {draft.steps.length > 0 && (
                    <button type="button" className="btn-ghost ml-2 text-[10px]"
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
                    {' '}Launch drones ({draft.placements.length} queued, 1 {RESOURCE_ICONS.O} + 1 {RESOURCE_ICONS.B} each)
                  </label>
                  <label>
                    <input type="radio" checked={draft.deployMode === 'credits'}
                      onChange={() => setDraft((dr) => ({ ...dr, deployMode: 'credits' }))} />
                    {' '}Take credits instead (5 + 1 per drone on the board)
                  </label>
                  {draft.placements.length > 0 && (
                    <button type="button" className="btn-ghost text-[10px]"
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
                    {' '}Build a drone
                    {selectedCard === 'maintenance_bay_2' ? ' (free)' : ` (1 ${RESOURCE_ICONS.O} + 1 ${RESOURCE_ICONS.B})`}
                    {draft.buildDrone && (
                      <span className="text-cream-400">
                        {' '}at {draft.dronePlanet ? map.planets[draft.dronePlanet]?.name : 'home (or click a treaty planet)'}
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
                <div className="text-[11px] text-gold-400">▸ {blockReason}</div>
              )}
              {actionError && <div className="text-oxblood-300 text-[11px]">{actionError}</div>}

              <div className="flex gap-2">
                <button className="btn-primary" disabled={busy || !confirmReady}
                  onClick={handleConfirm}>
                  {busy ? 'Transmitting…' : 'Execute'}
                </button>
                <button className="btn-ghost" onClick={resetDraft}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
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
              className="w-10 ml-0.5 bg-teal-950 border border-teal-700 rounded px-1" />
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
              className="w-10 ml-0.5 bg-teal-950 border border-teal-700 rounded px-1" />
          </span>
        ))}
      </div>
      <div className="text-cream-400">
        Prices {RESOURCE_LETTERS.map((l) => `${RESOURCE_ICONS[l]}${prices[l]}`).join(' ')}.
        Two resource types max per trade.
      </div>
    </div>
  );
}

function ResultsBanner({ state }) {
  const winner = state.players.find((p) => p.seat === state.game.winner_seat);
  const ranked = [...state.players]
    .filter((p) => p.final_score !== null)
    .sort((a, b) => b.final_score - a.final_score);
  const AFF = AFFILIATION_LABELS;
  return (
    <div className="border-b border-gold-600/50 bg-teal-900/80 px-4 py-3">
      <div className="font-display text-gold-300 text-lg mb-1">
        Journey's end{winner ? ` — ${winner.name} takes the sector` : ''}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        {ranked.map((p) => (
          <div key={p.seat} className="rounded border border-teal-700 px-3 py-1.5">
            <b style={{ color: SEAT_COLORS[p.seat] }}>{p.name}</b>: {p.final_score} VP
            {p.score_breakdown && (
              <span className="text-[10px] text-cream-400 block">
                {Object.entries(p.score_breakdown)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => `${AFF[k] || k} ${v}`)
                  .join(' · ')}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-teal-950 text-cream-100 flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-3">{children}</div>
    </div>
  );
}

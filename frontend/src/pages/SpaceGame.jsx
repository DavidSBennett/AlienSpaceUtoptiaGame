import { useMemo, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSpaceGame } from '../hooks/useSpaceGame.js';
import { spPlayCard, spConcede } from '../api/space.js';
import { loadSpSession } from '../api/spSession.js';

/**
 * SpaceGame — the playable board for the SPACE GAME prototype.
 *
 * Server-authoritative: this page only BUILDS action params and renders
 * state; every rule lives in backend/sp_engine.php. Client-side checks here
 * are advisory conveniences (disabled buttons), never authority.
 */

const SEAT_COLORS = ['#d4a017', '#4d7c5a', '#a04545', '#6b7bb5', '#8a9a5b'];
const FACTION_COLORS = {
  O: '#8a7060', B: '#4d8a4d', C: '#5b7d99', N: '#c09a3f', A: '#8d5bb0',
};
const AFFILIATION_LABELS = {
  wealth: 'Wealth', diplomatic_corps: 'Diplomatic Corps', alliances: 'Alliances',
  trade_guild: 'Trade Guild', war_college: 'War College', engineering: 'Engineering',
};
const ACTION_LABELS = {
  reset: 'Reset', move: 'Navigate', strike: 'Strike', trade: 'Trade',
  produce: 'Produce', deploy: 'Deploy drones', recruit: 'Install (2)',
  recruit_free: 'Install (1, free position)', copy: 'Intercept', envoy: 'Envoy',
};
const MISSION_STAT = { move: 1, strike: 0, trade: 2 }; // index into stats [M,D,T]
const RESOURCE_LETTERS = ['O', 'B', 'C', 'N', 'A'];

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

/** Apply queued move steps to the server board's drones (client preview). */
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

/** Auto-build a payment {letter:n} for a cost list; null if unaffordable. */
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
    // Spend the most abundant remaining resource.
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

// ── small display pieces ─────────────────────────────────────────────────

function CardChip({ card, cards, onClick, selected, committed, disabled, small }) {
  const c = cards[card];
  if (!c) return null;
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={
        'text-left rounded border px-2 py-1 transition-colors ' +
        (selected ? 'border-gold-300 bg-teal-800 ' :
         committed ? 'border-gold-600 bg-teal-800/70 ' :
         'border-teal-700 bg-teal-900/70 hover:border-cream-400 ') +
        (disabled ? 'opacity-50 cursor-not-allowed ' : '') +
        (small ? 'w-36' : 'w-44')
      }>
      <div className="flex justify-between items-baseline gap-1">
        <span className="font-semibold text-[11px] leading-tight">{c.name}</span>
        <span className="text-[10px] font-mono whitespace-nowrap text-cream-300">
          {c.stats[0]}/{c.stats[1]}/{c.stats[2]}
        </span>
      </div>
      <div className="text-[10px] text-cream-400">{ACTION_LABELS[c.action]}</div>
      <div className="text-[9px] text-gold-400">{AFFILIATION_LABELS[c.affiliation]}</div>
      {committed && <div className="text-[9px] text-gold-300">committed</div>}
    </button>
  );
}

function ResourceRow({ cargo, prices }) {
  return (
    <span className="font-mono text-[11px]">
      {RESOURCE_LETTERS.map((l) => (
        <span key={l} className="mr-2" style={{ color: FACTION_COLORS[l] }}>
          {l}:{cargo?.[l] ?? 0}{prices ? '' : ''}
        </span>
      ))}
    </span>
  );
}

function TrackBar({ label, step }) {
  const cells = [];
  for (let i = 1; i <= 12; i++) {
    const gate = i === 5 || i === 9;
    cells.push(
      <span key={i}
        className={
          'inline-block w-2.5 h-2.5 mr-0.5 rounded-sm ' +
          (i <= step ? 'bg-gold-400 ' : 'bg-teal-800 ') +
          (gate ? 'ring-1 ring-oxblood-400 ' : '')
        }
        title={gate ? (i === 5 ? 'Gate: needs a mid-ring win' : 'Gate: needs a core-ring win') : undefined}
      />
    );
  }
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-16 text-cream-300">{label}</span>
      <span>{cells}</span>
      <span className="font-mono text-cream-400">{step}/12</span>
    </div>
  );
}

// ── the star map ─────────────────────────────────────────────────────────

function StarMap({ state, draft, mySeat, onPlanetClick, onLaneClick, onDroneClick, activeAction }) {
  const map = state.map;
  const board = state.board;
  const drones = activeAction === 'move' ? virtualDrones(board, draft.steps) : board.drones;
  const intel = state.you.intel || {};

  // Group docked drones per planet for offsetting.
  const dockedAt = {};
  drones.forEach((d, i) => {
    if (d.type === 'docked') (dockedAt[d.at] = dockedAt[d.at] || []).push(i);
  });

  return (
    <svg viewBox="0 0 1000 1000" className="w-full h-full select-none"
      style={{ background: 'radial-gradient(circle at 50% 50%, #10282c 0%, #071417 75%)' }}>
      {/* lanes */}
      {Object.entries(map.lanes).map(([key, [a, b]]) => {
        const pa = map.planets[a]; const pb = map.planets[b];
        if (!pa || !pb) return null;
        const occupied = drones.find((d) => d.type === 'lane' && d.at === key);
        return (
          <g key={key} onClick={() => onLaneClick(key)} style={{ cursor: 'pointer' }}>
            <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
              stroke="#2e5a5f" strokeWidth={2} strokeDasharray="6 5" />
            {/* fat invisible hit area */}
            <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="transparent" strokeWidth={16} />
            {occupied && (
              <polygon
                points={`${(pa.x + pb.x) / 2},${(pa.y + pb.y) / 2 - 9} ${(pa.x + pb.x) / 2 - 8},${(pa.y + pb.y) / 2 + 6} ${(pa.x + pb.x) / 2 + 8},${(pa.y + pb.y) / 2 + 6}`}
                fill={SEAT_COLORS[occupied.seat]} stroke="#0b1c1f" strokeWidth={1.5}
                onClick={(e) => { e.stopPropagation(); onDroneClick(drones.indexOf(occupied)); }}
                style={{ cursor: 'pointer' }} />
            )}
          </g>
        );
      })}

      {/* planets */}
      {Object.values(map.planets).map((p) => {
        const treaties = board.treaties[p.id] || [];
        const known = intel[p.id];
        const isDraftTarget = draft.treatyPlanet === p.id || draft.planet === p.id ||
          draft.placements.some((pl) => pl.planet === p.id) || draft.dronePlanet === p.id;
        const isHome = p.home_seat !== null && p.home_seat !== undefined;
        return (
          <g key={p.id} onClick={() => onPlanetClick(p.id)} style={{ cursor: 'pointer' }}>
            {isHome && (
              <circle cx={p.x} cy={p.y} r={24} fill="none"
                stroke={SEAT_COLORS[p.home_seat]} strokeWidth={2} opacity={0.8} />
            )}
            <circle cx={p.x} cy={p.y} r={15} fill={FACTION_COLORS[p.faction]}
              stroke={isDraftTarget ? '#e8c56a' : '#0b1c1f'} strokeWidth={isDraftTarget ? 3.5 : 1.5} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={11}
              fill="#f4ead6" fontFamily="monospace">{p.faction}</text>
            <text x={p.x} y={p.y + 32} textAnchor="middle" fontSize={11} fill="#c9b892">
              {p.name}
            </text>
            {/* opposition badge: known value or ? */}
            <g>
              <circle cx={p.x + 15} cy={p.y - 13} r={8}
                fill={known !== undefined ? '#3f2d17' : '#22383b'}
                stroke={known !== undefined ? '#e8c56a' : '#41686d'} strokeWidth={1} />
              <text x={p.x + 15} y={p.y - 9.5} textAnchor="middle" fontSize={9.5}
                fill={known !== undefined ? '#e8c56a' : '#8fb2b5'} fontFamily="monospace">
                {known !== undefined ? known : '?'}
              </text>
            </g>
            {/* treaty pips */}
            {treaties.map((seat, i) => (
              <rect key={i} x={p.x - 15 + i * 7} y={p.y + 15} width={6} height={6}
                fill={SEAT_COLORS[seat]} stroke="#0b1c1f" strokeWidth={0.7} />
            ))}
            {/* docked drones */}
            {(dockedAt[p.id] || []).map((di, i) => {
              const d = drones[di];
              return (
                <polygon key={di}
                  points={`${p.x - 22 + i * 10},${p.y - 18} ${p.x - 26 + i * 10},${p.y - 8} ${p.x - 18 + i * 10},${p.y - 8}`}
                  fill={SEAT_COLORS[d.seat]} stroke="#0b1c1f" strokeWidth={1}
                  opacity={draft.selectedDrone === di ? 1 : 0.9}
                  onClick={(e) => { e.stopPropagation(); onDroneClick(di); }}
                  style={{ cursor: 'pointer' }}>
                  {draft.selectedDrone === di}
                </polygon>
              );
            })}
          </g>
        );
      })}

      {/* selected drone highlight */}
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

  // For copy: the card actually being executed (the target's discard top).
  const copyTargetPlayer = draft.copyTarget !== null
    ? state.players.find((p) => p.seat === draft.copyTarget) : null;
  const copiedKey = copyTargetPlayer?.discard_top || null;
  const effectiveAction = activeCardDef?.action === 'copy'
    ? (copiedKey ? cards[copiedKey].action : null)
    : activeCardDef?.action;
  const effectiveCardKey = activeCardDef?.action === 'copy' ? copiedKey : selectedCard;

  const previewDrones = effectiveAction === 'move'
    ? virtualDrones(state.board, draft.steps) : state.board.drones;
  const adjacency = adjacentPlanets(map, previewDrones, mySeat);

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

  // ── click handlers feeding the draft ──
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

  // ── build the params object for the server ──
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

  const confirmReady = (() => {
    if (!activeCardDef) return false;
    switch (effectiveAction) {
      case 'move': return true; // moving 0 steps and skipping treaty is legal
      case 'strike': return !!draft.planet;
      case 'trade': return !!draft.planet;
      case 'produce': return draft.mode === 'levy' || !!draft.system;
      case 'deploy': return draft.deployMode === 'credits' || draft.placements.length > 0;
      case 'recruit': case 'recruit_free': return draft.picks.length > 0;
      case 'envoy': return true;
      case 'reset': return true;
      case null: return false;
      default: return activeCardDef.action !== 'copy' || false;
    }
  })();

  const ended = game.status === 'ended';

  return (
    <div className="min-h-screen bg-teal-950 text-cream-100 flex flex-col">
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

      {ended && <ResultsBanner state={state} />}

      <div className="flex flex-1 min-h-0">
        {/* map */}
        <div className="flex-1 min-w-0">
          <StarMap state={state} draft={draft} mySeat={mySeat}
            activeAction={effectiveAction}
            onPlanetClick={onPlanetClick} onLaneClick={onLaneClick} onDroneClick={onDroneClick} />
        </div>

        {/* right rail */}
        <div className="w-80 shrink-0 border-l border-teal-800 overflow-y-auto p-3 space-y-4 text-sm">
          {/* players */}
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
                  <ResourceRow cargo={p.cargo} />
                  <span>hand {p.hand_count}</span>
                </div>
                <div className="text-[10px] text-cream-400">
                  M{p.tracks.military.step} · D{p.tracks.diplomacy.step} · T{p.tracks.trade.step}
                  {' · '}drones held {p.drones_reserve}
                  {p.discard_top && <> · last: {cards[p.discard_top]?.name}</>}
                  {p.conceded ? ' · withdrew' : ''}
                  {ended && p.final_score !== null && <> · <b>{p.final_score} VP</b></>}
                </div>
              </div>
            ))}
          </div>

          {/* market */}
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
                    <CardChip card={key} cards={cards} small
                      selected={draft.picks.includes(key)}
                      disabled={!picking || !myTurn}
                      onClick={() => togglePick(key)} />
                    <div className="text-[9px] text-cream-400 pl-1">
                      cost {cards[key].cost.join('') || '—'}
                      {posCost.length > 0 && ` +${posCost.join('')}`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* events */}
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
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="font-mono text-gold-300">{you.credits} credits</span>
          <span>
            Cargo <ResourceRow cargo={you.cargo} />
            <span className="text-cream-400 text-[11px]">
              {' '}({Object.values(you.cargo).reduce((a, b) => a + b, 0) + you.drones_reserve}/{you.cargo_capacity}
              {' '}incl. {you.drones_reserve} drones)
            </span>
          </span>
          <TrackBar label="Military" step={you.tracks.military.step} />
          <TrackBar label="Diplomacy" step={you.tracks.diplomacy.step} />
          <TrackBar label="Trade" step={you.tracks.trade.step} />
          {(you.upgrades || []).length > 0 && (
            <span className="text-[11px] text-cream-300">
              Upgrades: {(you.upgrades || []).map((u) => state.upgrades_catalog[u]?.name || u).join(', ')}
            </span>
          )}
        </div>

        <div className="flex gap-3">
          {/* hand */}
          <div className="flex flex-wrap gap-1.5 flex-1">
            {you.hand.map((key) => (
              <CardChip key={key} card={key} cards={cards}
                selected={selectedCard === key}
                committed={draft.commits.includes(key)}
                disabled={!myTurn || ended}
                onClick={() => {
                  if (selectedCard && key !== selectedCard && missionType) {
                    toggleCommit(key);
                  } else if (selectedCard === key) {
                    resetDraft();
                  } else {
                    resetDraft();
                    setSelectedCard(key);
                  }
                }} />
            ))}
            {you.hand.length === 0 && (
              <span className="text-cream-400 text-sm self-center">
                Hand empty — you'll need a reset card back… which is also in the discard.
                (Discard: {you.discard.map((k) => cards[k].name).join(', ') || 'empty'})
              </span>
            )}
          </div>

          {/* action panel */}
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
                    Click other hand cards to commit them (their matching stat adds; they discard win or lose).
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
                  {draft.mode === 'production' && !draft.system && (
                    <div className="text-cream-400">Click any planet to choose its system.</div>
                  )}
                </div>
              )}

              {effectiveAction === 'deploy' && (
                <div className="text-[11px] space-y-1">
                  <label className="mr-3">
                    <input type="radio" checked={draft.deployMode === 'place'}
                      onChange={() => setDraft((dr) => ({ ...dr, deployMode: 'place' }))} />
                    {' '}Launch drones ({draft.placements.length} queued — click home/treaty planets)
                  </label>
                  <label>
                    <input type="radio" checked={draft.deployMode === 'credits'}
                      onChange={() => setDraft((dr) => ({ ...dr, deployMode: 'credits' }))} />
                    {' '}Take credits instead
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
                    {selectedCard === 'maintenance_bay_2' ? ' (free)' : ' (1 Ore + 1 Biomass)'}
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
                        <label key={key} className={'block pl-2 ' + (owned ? 'opacity-40' : '')}>
                          <input type="checkbox" disabled={owned} checked={chosen}
                            onChange={() => setDraft((dr) => ({
                              ...dr,
                              upgrades: chosen ? dr.upgrades.filter((k) => k !== key) : [...dr.upgrades, key],
                            }))} />
                          {' '}{u.name} — {u.credits}c{u.resources.length ? ' + ' + u.resources.join('') : ''}
                          {' '}<span className="text-cream-400">{u.text}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {actionError && <div className="text-oxblood-300 text-[11px]">{actionError}</div>}

              <div className="flex gap-2">
                <button className="btn-primary" disabled={!myTurn || busy || !confirmReady || (activeCardDef.action === 'copy' && draft.copyTarget === null)}
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
            <span style={{ color: FACTION_COLORS[l] }}>{l}</span>
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
            <span style={{ color: FACTION_COLORS[l] }}>{l}</span>
            <input type="number" min={0}
              value={draft.buy[l] || 0}
              onChange={(e) => setSide('buy', l, Number(e.target.value))}
              className="w-10 ml-0.5 bg-teal-950 border border-teal-700 rounded px-1" />
          </span>
        ))}
      </div>
      <div className="text-cream-400">
        Prices O:{prices.O} B:{prices.B} C:{prices.C} N:{prices.N} A:{prices.A}.
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
                  .map(([k, v]) => `${AFFILIATION_LABELS[k] || k} ${v}`)
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

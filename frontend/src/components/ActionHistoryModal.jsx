/**
 * ActionHistoryModal — a slide-out drawer from the left edge showing the
 * full event log of the game, grouped by year. Players can review every
 * action taken across the entire game.
 *
 * Events are fetched fresh each time the drawer opens. Within each year,
 * events appear in chronological order (oldest first). Year groupings
 * appear in reverse (current year on top).
 *
 * Props:
 *   open          — whether the drawer is showing
 *   onClose       — close handler
 *   playerToken   — for the API call
 *   opponents     — used to look up player colors
 *   you           — used to label "you" in the history
 */
import { useEffect, useState } from 'react';
import { mpGetEvents } from '../api/multiplayer.js';
import { colorForSeat } from '../lib/playerColors.js';

export default function ActionHistoryModal({ open, onClose, playerToken, opponents, you }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Player ID → seat index lookup for color coding.
  const seatByPid = new Map();
  seatByPid.set(you.player_id, you.seat_index);
  opponents.forEach((o) => seatByPid.set(o.player_id, o.seat_index));

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    mpGetEvents(playerToken, 500)
      .then((res) => {
        if (cancelled) return;
        setEvents(res.events || []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, playerToken]);

  if (!open) return null;

  // Group events by year. Events have a 'year' in event_data for action-
  // related events, and 'new_year' for year_advanced. Other event types
  // don't have a year — we bucket them under the year_advanced events
  // that bracket them. Simpler approach: just compute year from the most
  // recent year_advanced that PRECEDED each event (events come reverse-
  // chrono so we walk forward in time to figure out which year was current).
  const yearGroups = groupByYear(events);

  return (
    <>
      {/* Backdrop to dismiss */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40"
        aria-hidden="true"
      />
      {/* Drawer */}
      <aside
        className="
          fixed left-0 top-0 bottom-0 z-50 w-96 max-w-[90vw]
          surface-binding border-r-2 border-gold-500/40
          flex flex-col
        "
        role="dialog"
        aria-label="Game action history"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gold-500/30">
          <h2 className="font-display text-lg text-gold-400">Action History</h2>
          <button
            onClick={onClose}
            aria-label="Close history"
            className="font-mono text-xl text-cream-200 hover:text-cream-50 px-2"
          >×</button>
        </div>

        {/* Scrolling body */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {loading && (
            <p className="font-serif italic text-cream-200/70 text-sm">Loading…</p>
          )}
          {error && (
            <p className="font-serif italic text-oxblood-300 text-sm">Error: {error}</p>
          )}
          {!loading && !error && yearGroups.length === 0 && (
            <p className="font-serif italic text-cream-200/60 text-sm">
              No events yet.
            </p>
          )}
          {yearGroups.map((group) => (
            <section key={group.year}>
              <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400 mb-1.5 px-1 sticky top-0 bg-teal-900 py-1">
                Year {group.year}
              </h3>
              <ul className="space-y-1">
                {group.events.map((ev) => (
                  <EventRow
                    key={ev.event_id}
                    event={ev}
                    you={you}
                    seatByPid={seatByPid}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </aside>
    </>
  );
}


/**
 * Walk the reverse-chrono events list, figure out which year each was in,
 * and bucket. Returns array of { year, events } in descending year order.
 *
 * Strategy: events arrive newest-first. We track a "current year" cursor
 * that starts at the most recent year_advanced event's new_year (+1 since
 * advances happen at end-of-year). When we hit a year_advanced event going
 * back in time, we step the cursor down. Events before any year_advanced
 * are tagged as year 1 (the start of the game).
 */
function groupByYear(events) {
  if (events.length === 0) return [];
  // First pass: identify the year of each event by walking from oldest
  // to newest, since year_advanced events bump the year forward.
  const chronological = [...events].reverse();
  let currentYear = 1;
  const tagged = chronological.map((ev) => {
    // Some events carry their own year explicitly.
    const explicit = ev.event_data?.year ?? ev.event_data?.new_year;
    const yearOfEvent = explicit ?? currentYear;
    const tag = { ...ev, _year: yearOfEvent };
    if (ev.event_type === 'year_advanced' && ev.event_data?.new_year) {
      currentYear = ev.event_data.new_year;
    }
    return tag;
  });
  // Now bucket by year, preserving chronological order within each.
  const buckets = new Map();
  for (const ev of tagged) {
    const y = ev._year;
    if (!buckets.has(y)) buckets.set(y, []);
    buckets.get(y).push(ev);
  }
  // Return in descending year order (current year on top).
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, evs]) => ({ year, events: evs }));
}


/**
 * Render a single event as a one-line entry. Player name color-coded by
 * seat. Description is hand-formatted per event type.
 */
function EventRow({ event, you, seatByPid }) {
  const seat = event.player_id ? seatByPid.get(event.player_id) : null;
  const col = seat != null ? colorForSeat(seat) : null;
  const who = event.player_id
    ? (event.player_id === you.player_id ? 'You' : event.player_name)
    : 'Game';
  const desc = describeEvent(event);
  if (!desc) return null;  // skip noisy events
  return (
    <li className="font-serif text-xs text-cream-200/90 leading-snug px-1 py-0.5">
      <span className={`font-mono uppercase tracking-wider text-[10px] ${col?.accent ?? 'text-cream-200/60'} mr-1.5`}>
        {who}
      </span>
      {desc}
    </li>
  );
}


/**
 * Turn an event row into human-readable text. Returns null for events
 * that shouldn't appear in the user-facing history (internal/debug only).
 */
function describeEvent(ev) {
  const d = ev.event_data || {};
  switch (ev.event_type) {
    case 'year_advanced':
      return `Year ${d.new_year ?? '?'} begins.`;
    case 'action_dispatched': {
      // Catch-all log entry for every player's committed action this year.
      // If a more specific 'action_resolved_*' event followed, this one is
      // a duplicate; if not, this is the only trace. Render either way —
      // duplicates are mildly noisy but completeness is worth more.
      switch (d.action) {
        case 'draw':    return 'chose to draw cards.';
        case 'publish': return `chose to publish from project ${(d.data?.projectId ?? 0) + 1}.`;
        case 'review':  return `chose to review submission #${d.data?.submissionId ?? '?'}.`;
        case 'pass':    return 'passed this year.';
        case null:
        case undefined: return 'took no action.';
        default:        return `chose action: ${d.action}.`;
      }
    }
    case 'action_resolved_draw':
      if (d.reason === 'hand_full') return `tried to draw, but the notebook was full.`;
      return `drew ${d.drawn ?? '?'} card${d.drawn === 1 ? '' : 's'}.`;
    case 'action_resolved_publish_skipped':
      return `tried to publish, but ${formatPublishSkipReason(d.reason)}.`;
    case 'action_committed': {
      // Logged at the moment the player clicks End Year. Critical for
      // diagnosing "I committed publish but nothing happened" bugs —
      // shows definitively what the server received vs. what the player
      // thinks they sent. Shown in addition to the later
      // 'action_dispatched' which fires when resolve runs.
      switch (d.action) {
        case 'draw':    return 'committed Draw for the year.';
        case 'publish': return 'committed Publish for the year.';
        case 'review':  return 'committed Review for the year.';
        case 'pass':    return 'committed Pass for the year.';
        default:        return `committed action: ${d.action ?? '(none)'}.`;
      }
    }
    case 'action_selected':
      return null; // tentative selection, not yet committed — too noisy
    case 'submission_created': {
      const conc = d.conclusion_title ? `on "${d.conclusion_title}"` : 'a manuscript';
      return `submitted ${conc} for peer review (${d.kind ?? '?'}, ${d.evidence_count ?? '?'} evidence).`;
    }
    case 'review_recorded':
      return `reviewed a manuscript: ${d.verdict ?? '?'}.`;
    case 'publication_approved': {
      const total = d.prestige_total != null ? ` → ${d.prestige_total} total` : '';
      return `had "${d.title ?? 'a manuscript'}" approved (+${d.prestige ?? '?'} prestige${total}).`;
    }
    case 'publication_rejected':
      return `had a manuscript rejected.`;
    case 'citation_added':
      return `added a citation.`;
    case 'citation_removed':
      return `removed a citation.`;

    // ── Objection token mechanics ──────────────────────────────────
    // The writer spent an objection token to contest a peer rejection.
    // On success, the rejection is overturned, the rejecting reviewer(s)
    // each lose 5 prestige, and the token is refunded. On failure, the
    // rejection stands and the token is spent.
    case 'objection_won': {
      const n = d.penalized_count ?? 0;
      const names = Array.isArray(d.penalized_names) && d.penalized_names.length > 0
        ? ` (${d.penalized_names.join(', ')})`
        : '';
      const penalty = n > 0
        ? `${n} reviewer${n === 1 ? '' : 's'}${names} lost 5 prestige`
        : 'no reviewers penalized';
      const refund = d.token_refunded ? '; objection token refunded' : '';
      return `objected successfully — rejection overturned, ${penalty}${refund}.`;
    }
    case 'objection_lost':
      return `objected unsuccessfully — rejection stands, objection token spent.`;
    case 'objection_penalty': {
      const total = d.prestige_total != null ? ` → ${d.prestige_total} total` : '';
      return `lost ${d.prestige_lost ?? 5} prestige for rejecting a sound argument${total}.`;
    }
    case 'publication_auto_rejected':
      return `had a manuscript auto-rejected by validation (${d.reason ?? 'invalid'}).`;
    case 'player_joined':
      return `joined the game.`;
    case 'game_started':
      return `the game begins.`;
    case 'renown_bonus_awarded':
      return `earned a renown bonus of +${d.bonus ?? 0} prestige (${d.citations_received ?? 0} citations received × renown L${d.renown_level ?? 1}). Total: ${d.prestige_total ?? '?'}.`;
    case 'game_ended':
      return `the game has ended${d.reason ? ` (${d.reason})` : ''}.`;
    case 'archive_reshuffled':
      return `the archive was reshuffled (${d.cards_returned ?? '?'} cards returned).`;
    case 'consolation_drawn':
      return `drew a consolation card.`;
    case 'reclaim_manuscript':
      return `reclaimed evidence from a rejected manuscript.`;
    case 'stage_gate_failed':
      return `failed a stage gate: ${d.reason ?? '?'}.`;
    case 'resolve_year_failed':
      return `(server error during year resolution: ${d.error ?? '?'})`;
    default:
      // Hide unknown events from the user
      return null;
  }
}

function formatPublishSkipReason(reason) {
  switch (reason) {
    case 'no_data': return 'the publish data was missing';
    case 'invalid_projectId': return 'the project ID was invalid';
    case 'no_conclusion': return 'the project had no conclusion';
    case 'no_evidence': return 'the project had no evidence';
    default: return reason || 'unknown reason';
  }
}

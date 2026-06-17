/**
 * MultiplayerBookshelf — the bottom shelf for multiplayer games.
 *
 * Each player gets their own section: you on the left, then each opponent
 * in seat order. Within a section, spines stack horizontally as in the
 * single-player bookshelf, color-coded by author (so all your spines are
 * gold, P2's are verdigris, etc.).
 *
 * Collapsible (same chevron pattern as single-player Bookshelf).
 *
 * Spines look like the single-player bookshelf spines but tinted by player
 * color: articles use the player's accent (lighter), books use the spine
 * color (saturated). Click a spine → opens a publication modal.
 *
 * Props:
 *   you             — state.you
 *   opponents       — state.opponents
 *   publishedWorks  — state.published_works (everyone's combined)
 *   onSpineClick    — (work) => void; opens the publication modal.
 *                     Spines are also draggable as citation sources.
 */
import { useState } from 'react';
import { colorForSeat } from '../lib/playerColors.js';
import DraggableCard from './DraggableCard.jsx';
import Tooltip from './Tooltip.jsx';

export default function MultiplayerBookshelf({ you, opponents, publishedWorks, onSpineClick }) {
  const [collapsed, setCollapsed] = useState(false);

  // Group works by author. Ordered: you first, then opponents by seat.
  const yourWorks = publishedWorks.filter((w) => w.writer_player_id === you.player_id);
  const oppList = [...opponents].sort((a, b) => a.seat_index - b.seat_index);
  const oppWorks = oppList.map((op) => ({
    player: op,
    works: publishedWorks.filter((w) => w.writer_player_id === op.player_id),
  }));

  const totalCount = publishedWorks.length;

  return (
    <section className="surface-binding border-t border-edge-on-dark">
      {/* Header bar */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full px-6 py-2 flex items-center justify-between gap-3 hover:bg-teal-800/40 transition-colors"
        aria-expanded={!collapsed}
      >
        <span className="flex items-center gap-2">
          <span
            className="font-mono text-xs text-gold-400 transition-transform inline-block"
            style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)' }}
          >▾</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream-100/80">
            Library of Publications
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-cream-200">
            · {totalCount} published
          </span>
        </span>
      </button>

      {!collapsed && (
        <div className="px-6 py-3 border-t border-gold-500/20 overflow-x-auto">
          <div className="flex items-end gap-4 min-w-max">
            <PlayerSection
              label={`${you.player_name} (you)`}
              seat={you.seat_index}
              works={yourWorks}
              onSpineClick={onSpineClick}
            />
            {oppWorks.map(({ player, works }) => (
              <PlayerSection
                key={player.player_id}
                label={player.player_name}
                seat={player.seat_index}
                works={works}
                onSpineClick={onSpineClick}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}


function PlayerSection({ label, seat, works, onSpineClick }) {
  const col = colorForSeat(seat);
  return (
    <div className="flex-shrink-0">
      <div className={`font-mono text-[10px] uppercase tracking-[0.15em] mb-1 ${col.accent}`}>
        {label}
        {works.length > 0 && <span className="text-cream-200/60"> · {works.length}</span>}
      </div>
      <div className={`flex items-end gap-0.5 min-h-[150px] p-1 border-b-2 ${col.spineEdge}`}>
        {works.length === 0 ? (
          <p className="font-serif italic text-cream-200/50 text-xs self-center px-2">
            no publications
          </p>
        ) : (
          works.map((w) => (
            <PublicationSpine
              key={w.work_id}
              work={w}
              color={col}
              onClick={() => onSpineClick(w)}
            />
          ))
        )}
      </div>
    </div>
  );
}


function PublicationSpine({ work, color, onClick }) {
  const isBook = work.kind === 'book';
  const widthClass = isBook ? 'w-11' : 'w-[22px]';
  const bgClass = isBook ? color.spineBg : color.accentBg;
  const evidenceCount = work.evidence_count ?? 0;
  // Citation evidence contribution: floor(N/2). If you drag this onto
  // a project as a citation, this is how many effective evidence cards
  // it counts as toward base prestige and article/book classification.
  // Doubling check ignores citations, and citations don't bring bonus_sum.
  const effectiveEvidence = Math.floor(evidenceCount / 2);
  const tooltip = (
    <>
      <strong className="block font-display text-sm text-gold-300 mb-1">
        {work.publication_title}
      </strong>
      <span className="font-mono text-[10px] text-cream-200/70 block">
        {isBook ? 'Book' : 'Article'} · Year {work.year_published} · {evidenceCount} evidence card{evidenceCount === 1 ? '' : 's'}
      </span>
      <span className="block mt-2">
        <strong className="text-verdigris-400">If you cite this:</strong>{' '}
        contributes <strong>+{effectiveEvidence}</strong> effective evidence
        {effectiveEvidence === 0 && ' (too small to score from)'}.
      </span>
      <span className="block mt-1 text-cream-200/60 text-[11px]">
        Drag onto a project to cite. Tags must match your conclusion.
      </span>
    </>
  );

  return (
    <DraggableCard
      id={`library-${work.work_id}`}
      data={{
        cardId: work.work_id,
        from: { kind: 'library', workId: work.work_id, writerPlayerId: work.writer_player_id },
        // Citation payload — distinguishes from a regular evidence card move
        isCitation: true,
        citedWorkId: work.work_id,
        conclusionTag: work.conclusion_tag,
      }}
    >
      {({ dragHandleProps, isDragging }) => (
        <Tooltip content={tooltip} side="top" width="w-72">
          <button
            type="button"
            onClick={onClick}
            {...dragHandleProps}
            className={`
              relative ${widthClass} h-36 border-2 ${color.spineEdge} ${bgClass}
              transition-all duration-200 ease-desk hover:-translate-y-1 hover:shadow-card-hover
              flex items-center justify-center flex-shrink-0
              cursor-grab active:cursor-grabbing
              ${isDragging ? 'opacity-50' : ''}
            `}
          >
            <span className="absolute inset-1 border border-gold-500/30 pointer-events-none" />
            <span
              className={`font-display font-bold text-[10px] uppercase tracking-wider whitespace-nowrap overflow-hidden ${color.spineText}`}
              style={{
                writingMode: 'vertical-rl',
                transform: 'rotate(180deg)',
                textOverflow: 'ellipsis',
                maxHeight: '130px',
              }}
            >
              {work.publication_title}
            </span>
          </button>
        </Tooltip>
      )}
    </DraggableCard>
  );
}

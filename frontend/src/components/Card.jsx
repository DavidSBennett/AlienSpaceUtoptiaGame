import { useEffect } from 'react';
import CornerOrnament from './CornerOrnament.jsx';
import FleuronDivider from './FleuronDivider.jsx';
import Tooltip from './Tooltip.jsx';
import { formatBonus } from '../lib/cardBonus.js';
import { getCardTagsByField } from '../lib/tags.js';

/** Context tags are pipe-separated (unlike argument tags, which use commas). */
export function getContextTags(card) {
  return String(card?.context_tags ?? '')
    .split('|')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * The card's FACE, as tooltip content — what's printed on the card itself:
 * title, provenance, the source passage, and its significance. Argument tags
 * are deliberately excluded; they're hidden scaffolding, and the face doesn't
 * show them either. Context tags are fine (they're printed on the front).
 */
export function cardFaceTooltip(card) {
  if (!card) return null;
  const provenance = [card.author, card.date, card.location, card.source_type]
    .filter(Boolean)
    .join(' · ');
  const context = getContextTags(card);
  return (
    <span className="block text-left">
      <strong className="block font-display text-sm text-gold-300 leading-tight">
        {card.title || 'Untitled'}
      </strong>
      {provenance && (
        <span className="block font-mono text-[9px] uppercase tracking-wider text-cream-200/70 mt-1">
          {provenance}
        </span>
      )}
      {card.content && (
        <span className="block font-serif text-xs leading-snug mt-2">{card.content}</span>
      )}
      {card.significance && (
        <span className="block font-serif italic text-xs leading-snug mt-2 text-cream-200/85">
          {card.significance}
        </span>
      )}
      {context.length > 0 && (
        <span className="block font-mono text-[9px] uppercase tracking-wider text-verdigris-300 mt-2">
          {context.join(' · ')}
        </span>
      )}
    </span>
  );
}

/**
 * TagChips — renders a card's argument and sub_argument tags as small chips.
 *
 * Used on both thumbnails and modals. The two field types are rendered with
 * subtly different treatments so a power-user can see at a glance which
 * came from which field, even though both count equally for matching.
 *
 * Visual rule:
 *   - argument tags     = filled gold chips (the "primary thesis" tag)
 *   - sub_argument tags = outlined gold chips (the "secondary" tags)
 *
 * @param {Object} props
 * @param {Object} props.card             card object
 * @param {'paper'|'dark'} props.surface  background surface — affects contrast
 * @param {'sm'|'md'} props.size          chip size variant
 */
function TagChips({ card, surface = 'paper', size = 'sm' }) {
  const { argument, subArgument } = getCardTagsByField(card);

  if (argument.length === 0 && subArgument.length === 0) {
    return null;
  }

  const sizeClass = size === 'sm' ? 'text-[9px] px-1.5 py-px' : 'text-[10px] px-2 py-0.5';

  const filledClass =
    surface === 'paper'
      ? 'bg-gold-500 text-cream-50 border-gold-600'
      : 'bg-gold-500 text-teal-950 border-gold-400';

  const outlinedClass =
    surface === 'paper'
      ? 'bg-cream-50 text-gold-700 border-gold-700'
      : 'bg-teal-900 text-gold-300 border-gold-500';

  return (
    <div className="flex flex-wrap items-center gap-1">
      {argument.map((tag) => (
        <span
          key={`a-${tag}`}
          className={`font-mono uppercase tracking-wider border ${sizeClass} ${filledClass}`}
        >
          {tag}
        </span>
      ))}
      {subArgument.map((tag) => (
        <span
          key={`s-${tag}`}
          className={`font-mono uppercase tracking-wider border ${sizeClass} ${outlinedClass}`}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}


/**
 * CardThumbnail — the small card as it appears in the Research Notebook
 * or in a project space.
 *
 * Per design doc, this view shows: Title, Date, Image.
 * When showTags is true, ALSO shows argument + sub_argument as a footer band.
 *
 * @param {'sm'|'md'} size  'sm' = notebook hand size (w-32, current default)
 *                          'md' = project-placed size (w-40, larger for emphasis)
 */
export function CardThumbnail({ card, onClick, isDragging = false, showTags = false, showSignificance = false, size = 'sm' }) {
  // Size variants — each defines width, image-area height, base content height,
  // and font sizes to keep proportions readable.
  const v = size === 'md'
    ? {
        widthClass: 'w-40',
        imgHeight: 'h-24',
        baseHeight: '15rem',
        tagsHeight: '16rem',
        sigHeight: '19rem',
        bothHeight: '20rem',
        titleClass: 'font-display text-base leading-tight font-bold text-ink-900 line-clamp-3',
        datePadX: 'px-3',
        datePadY: 'py-2',
        dateClass: 'font-mono text-[10px] text-ink-700 mt-1 truncate',
      }
    : {
        widthClass: 'w-32',
        imgHeight: 'h-20',
        baseHeight: '12.5rem',
        tagsHeight: '13.5rem',
        sigHeight: '16.5rem',
        bothHeight: '17.5rem',
        titleClass: 'font-display text-sm leading-tight font-bold text-ink-900 line-clamp-3',
        datePadX: 'px-2',
        datePadY: 'py-1.5',
        dateClass: 'font-mono text-[9px] text-ink-700 mt-1 truncate',
      };

  // Significance is intentionally NOT shown on the card face / hand — only in
  // the card modal when unlocked. The thumbnail height depends only on tags.

  const contextTags = getContextTags(card);

  // Hovering ANY card — hand, project slot, archive market, conference draft —
  // shows its face. Tooltip portals to <body> and clamps to the viewport, so it
  // never gets clipped by a scrolling container or run off a screen edge.
  return (
    <Tooltip content={cardFaceTooltip(card)} side="right" width="w-72" delay={250}>
    <button
      type="button"
      onClick={onClick}
      className={`
        group relative
        ${v.widthClass} flex flex-col
        surface-paper
        border border-gold-700
        shadow-card hover:shadow-card-hover
        transition-all duration-200 ease-desk
        text-left overflow-hidden
        ${isDragging ? 'opacity-50' : 'hover:-translate-y-1'}
      `}
      style={{ height: showTags ? v.tagsHeight : v.baseHeight }}
    >
      <div className="absolute inset-1 border border-gold-500/20 pointer-events-none" />

      {/* Image area — top */}
      <div className={`relative ${v.imgHeight} bg-cream-200 overflow-hidden border-b border-gold-500/30`}>
        {card.image_url ? (
          <img
            src={card.image_url}
            alt={card.description || card.title || ''}
            className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink-700 font-display italic text-xs">
            no image
          </div>
        )}
      </div>

      {/* Title + context tags + date. Context tags are printed on the front of
          the card (unlike argument tags, which stay hidden behind the toggle). */}
      <div className={`flex-1 ${v.datePadX} ${v.datePadY} flex flex-col justify-between min-h-0`}>
        <h3 className={v.titleClass}>
          {card.title}
        </h3>
        <div className="mt-1">
          {contextTags.length > 0 && (
            <div className="flex flex-wrap gap-0.5 mb-1">
              {contextTags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="font-mono text-[7px] uppercase tracking-wider px-1 py-px
                             border border-verdigris-500/60 text-verdigris-600 bg-cream-50/60"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          <p className={v.dateClass}>
            {card.date || '—'}
          </p>
        </div>
      </div>

      {/* Tag footer band — only when tags toggled on */}
      {showTags && (
        <div className="px-2 py-1 bg-cream-200 border-t border-gold-500/30">
          <TagChips card={card} surface="paper" size="sm" />
        </div>
      )}

      {/* Sequence number — top-left corner */}
      <span
        className="absolute top-1.5 left-2 font-mono text-[9px] text-ink-700"
        aria-hidden="true"
      >
        № {card.sequence_number ?? '—'}
      </span>
    </button>
    </Tooltip>
  );
}


/**
 * ConclusionSpine — wide horizontal variant of ConclusionTile.
 *
 * Used in the top conclusion rail (Phase 10 layout change). Where
 * ConclusionTile is upright (~128×112), ConclusionSpine is wide and short
 * (~256×80), evoking book spines on a shelf with the title running
 * horizontally across the full width of the tile.
 *
 * Same visual family as ConclusionTile (verdigris border + tint) so the
 * connection between the two reads at a glance.
 */
export function ConclusionSpine({
  card,
  onClick,
  showTags = false,
  showSignificance = false,
  thin = false,
  widthClass = 'w-64',
  hidePrestige = false,
  // Fill the height the parent gives it instead of a fixed h-14. The
  // conclusion shelf divides its column between its slots so the rail ends
  // level with the archive beside it, which means the tiles can't be a fixed
  // size — they take whatever share they're handed.
  fill = false,
}) {
  // A conclusion may carry a citation ladder rather than a single number, so
  // the spine prints the whole ladder ("3 · 6 · 10 · 15"). The player needs to
  // see what citing buys BEFORE committing cards to the project.
  const prestigeLabel = formatBonus(card?.bonus);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        group relative
        ${widthClass} ${thin ? 'h-9 py-0.5' : (fill ? 'h-full py-1' : 'h-14 py-1')} flex flex-col justify-center
        surface-paper
        border border-verdigris-500
        shadow-card hover:shadow-card-hover
        transition-all duration-200 ease-desk
        text-left overflow-hidden flex-shrink-0
        hover:-translate-y-1
        px-3
      `}
      style={{
        backgroundImage:
          'linear-gradient(rgba(82, 117, 94, 0.08), rgba(82, 117, 94, 0.08))',
      }}
    >
      <div className="absolute inset-1 border border-verdigris-500/30 pointer-events-none" />

      {thin ? (
        // Thin sidebar tile: title on the left, then (when tags are visible)
        // the tag chips, then the prestige value on the right — all on the
        // tile itself. (Prestige omitted when hidePrestige — caller renders it.)
        <div className="flex items-center gap-2 w-full">
          <h3 className="flex-1 min-w-0 font-display text-xs leading-tight font-bold text-ink-900 line-clamp-1">
            {card.title}
          </h3>
          {showTags && (
            <div className="shrink-0">
              <TagChips card={card} surface="paper" size="sm" />
            </div>
          )}
          {!hidePrestige && (
            <span
              className="shrink-0 font-mono text-[11px] font-bold text-verdigris-700 tabular-nums"
              title="Conclusion prestige value — a ladder shows what it pays at 0 / 1 / 2 / 3+ citations"
            >
              {prestigeLabel}
            </span>
          )}
        </div>
      ) : (
        // Full-height tile: label + title on the left, prestige pinned right.
        // (The prestige used to be missing from this branch entirely.)
        <div className="flex items-start gap-2 w-full">
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-verdigris-600 leading-none">
              Conclusion
            </p>
            <h3 className="font-display text-sm leading-tight font-bold text-ink-900 line-clamp-2 mt-0.5">
              {card.title}
            </h3>
            {showTags && (
              <div className="mt-1">
                <TagChips card={card} surface="paper" size="sm" />
              </div>
            )}
          </div>
          {!hidePrestige && (
            <span
              className="shrink-0 font-mono text-xs font-bold text-verdigris-700 tabular-nums"
              title="Conclusion prestige value — a ladder shows what it pays at 0 / 1 / 2 / 3+ citations"
            >
              {prestigeLabel}
            </span>
          )}
        </div>
      )}
    </button>
  );
}


/**
 * ConclusionTile — same family as CardThumbnail but for conclusion cards.
 *
 * Visually distinct (verdigris border + tint) so players can tell
 * conclusions apart from evidence at a glance.
 */
export function ConclusionTile({ card, onClick, showTags = false, showSignificance = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        group relative
        w-32 h-28 flex flex-col justify-center
        surface-paper
        border border-verdigris-500
        shadow-card hover:shadow-card-hover
        transition-all duration-200 ease-desk
        text-left overflow-hidden
        hover:-translate-y-1
        px-3 py-2
      "
      style={{
        backgroundImage:
          'linear-gradient(rgba(82, 117, 94, 0.08), rgba(82, 117, 94, 0.08))',
      }}
    >
      <div className="absolute inset-1 border border-verdigris-500/30 pointer-events-none" />

      <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-verdigris-600 mb-1">
        Conclusion
      </p>

      <h3 className="font-display text-sm leading-tight font-bold text-ink-900 line-clamp-4">
        {card.title}
      </h3>

      {showTags && (
        <div className="mt-2">
          <TagChips card={card} surface="paper" size="sm" />
        </div>
      )}
    </button>
  );
}


/**
 * CardModal — the full open document view.
 *
 * Per design doc:
 *   Title, Source type, Image, Date, Author, Location, Content,
 *   Significance, Citation
 *   Lower right: bonus  ·  Lower center: contributor  ·  Lower left: sequence
 *
 * When showTags is true, displays argument + sub_argument as chips near the
 * top alongside the source-type tag.
 *
 * Optional `actions` prop renders above the metadata footer — used for
 * the in-modal "Place in Project N" buttons.
 *
 * Optional `onPrev`/`onNext` enable photo-gallery-style navigation through
 * a sequence (e.g. hand cards, conclusion shelf). Each handler is called
 * with no arguments and is expected to update the parent's state to show
 * a different card. When a handler is null/undefined, that side's nav
 * zone is hidden (used for the leftmost/rightmost card).
 *
 * Optional `position` (shape: { current, total }) renders an "X of Y"
 * indicator next to the close button so the player can see where they are
 * in the sequence.
 *
 * Keyboard: when nav handlers are present, ← and → arrow keys cycle.
 */
export function CardModal({
  card,
  onClose,
  showTags = false,
  showSignificance = false,
  actions = null,
  onPrev = null,
  onNext = null,
  position = null,
  // Card Library viewer only (not used in-game): the whole-card images, shown
  // as hover-to-flip cards in a column beside the document.
  //   faces — [{ label, front, back }]
  faces = null,
}) {
  // Keyboard navigation — wire up arrow keys when either handler is present.
  // We listen at the window level so the keys work anywhere on the page
  // while the modal is open. Removing the listener on unmount and on
  // handler change keeps things tidy.
  useEffect(() => {
    if (!onPrev && !onNext) return;

    function handleKey(e) {
      // Don't hijack arrow keys if the user is typing in a form field
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowLeft' && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowRight' && onNext) {
        e.preventDefault();
        onNext();
      } else if (e.key === 'Escape' && onClose) {
        e.preventDefault();
        onClose();
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onPrev, onNext, onClose]);

  if (!card) return null;

  // Library viewer: whole-card images to show as flip-cards beside the document.
  const faceList = Array.isArray(faces) ? faces.filter((f) => f.front || f.back) : [];
  const hasFaces = faceList.length > 0;

  return (
    <div
      className="fixed inset-0 z-[70] bg-teal-950/80 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in"
      onClick={onClose}
    >
      {/* Wrapper holds the modal AND its flanking chevrons. The chevrons
          use `left-full` / `right-full` to sit just outside the modal's
          edges, so they track the modal's position as the viewport
          resizes rather than hugging the screen edges. */}
      <div className={hasFaces ? 'relative flex items-stretch gap-4' : 'relative'} onClick={(e) => e.stopPropagation()}>

        {/* Left chevron — anchored to the modal's left edge, sized ~3x
            the previous text-5xl. Hidden when there's no previous card. */}
        {onPrev && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
            className="absolute right-full top-1/2 -translate-y-1/2 mr-2 sm:mr-4 z-10 flex items-center justify-center group focus:outline-none px-2"
            aria-label="Previous card"
          >
            <span
              className="font-display text-cream-200 group-hover:text-gold-400 transition-colors select-none leading-none"
              style={{
                fontSize: '9rem',
                textShadow: '0 2px 12px rgba(0,0,0,0.6)',
              }}
            >
              ‹
            </span>
          </button>
        )}

        {/* Right chevron — anchored to the modal's right edge. */}
        {onNext && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onNext(); }}
            className="absolute left-full top-1/2 -translate-y-1/2 ml-2 sm:ml-4 z-10 flex items-center justify-center group focus:outline-none px-2"
            aria-label="Next card"
          >
            <span
              className="font-display text-cream-200 group-hover:text-gold-400 transition-colors select-none leading-none"
              style={{
                fontSize: '9rem',
                textShadow: '0 2px 12px rgba(0,0,0,0.6)',
              }}
            >
              ›
            </span>
          </button>
        )}

        {/* Close button — sibling of the scrollable article so it stays
            visible at the modal's top-right corner regardless of where
            the user has scrolled inside the article. Prominent styling
            since with a near-full-viewport modal, clicking the backdrop
            isn't a reliable way to dismiss. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="absolute top-4 right-4 z-30 px-4 py-2 bg-cream-50 border border-gold-500 text-ink-900 hover:bg-oxblood-500 hover:text-cream-50 hover:border-oxblood-500 transition-colors font-mono text-sm uppercase tracking-wider shadow-md"
          aria-label="Close"
        >
          ✕ Close
        </button>

        {/* Card image(s) — adjacent to the document; hover to flip to the back.
            Library viewer only. */}
        {hasFaces && (
          <div className="hidden md:flex flex-col gap-3 shrink-0 w-56 max-h-[95vh] overflow-y-auto py-1 pr-0.5">
            {faceList.map((f, i) => <FlipCard key={f.label || i} face={f} />)}
          </div>
        )}

        <article
          className="relative surface-paper max-w-5xl w-full max-h-[95vh] overflow-y-auto animate-fade-up"
          style={{
            boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(184, 146, 58, 0.5)',
          }}
        >
        <div className="absolute inset-2 border border-gold-500/30 pointer-events-none" />

        <div className="absolute top-3 left-3 text-gold-500 pointer-events-none">
          <CornerOrnament corner="tl" size={24} />
        </div>
        <div className="absolute top-3 right-3 text-gold-500 pointer-events-none">
          <CornerOrnament corner="tr" size={24} />
        </div>
        <div className="absolute bottom-3 left-3 text-gold-500 pointer-events-none">
          <CornerOrnament corner="bl" size={24} />
        </div>
        <div className="absolute bottom-3 right-3 text-gold-500 pointer-events-none">
          <CornerOrnament corner="br" size={24} />
        </div>

        {/* Position indicator — "3 of 8" style, sits next to the close button
            in the top-right area. Only shown when we have a position. */}
        {position && position.total > 1 && (
          <p
            className="absolute top-4 left-4 z-10 font-mono text-[10px] uppercase tracking-widest text-ink-900"
            title="Position in current sequence"
          >
            {position.current} of {position.total}
          </p>
        )}

        <div className="px-12 py-10">

          {/* Top metadata: just the source_type tag now. Tag chips moved
              below the title/author line so they don't collide with the
              Close button in the modal's top-right corner. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {card.source_type && (
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 border border-cream-300 text-ink-900 bg-cream-50">
                {card.source_type}
              </span>
            )}
          </div>

          <h2 className="font-display text-3xl font-bold text-ink-900 leading-tight">
            {card.title}
          </h2>

          <div className="mt-3 mb-1 flex items-start justify-between gap-3">
            <div className="font-serif italic text-ink-900 text-base min-w-0">
              {card.author && <span>{card.author}</span>}
              {card.author && card.date && <span className="mx-2 text-gold-700">·</span>}
              {card.date && <span>{card.date}</span>}
              {card.location && (
                <>
                  <span className="mx-2 text-gold-700">·</span>
                  <span>{card.location}</span>
                </>
              )}
            </div>

            {/* Context tags — right-aligned across from the author. These feed
                the prestige "doubling" check (evidence sharing a common tag). */}
            {(() => {
              const contextTags = String(card.context_tags ?? '')
                .split('|').map((t) => t.trim()).filter(Boolean);
              if (contextTags.length === 0) return null;
              return (
                <div
                  className="flex flex-wrap justify-end gap-1 shrink-0 max-w-[50%]"
                  title="Context tags — evidence sharing a tag doubles a publication's prestige"
                >
                  {contextTags.map((t) => (
                    <span
                      key={t}
                      className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-verdigris-500/60 text-verdigris-700 bg-verdigris-500/5"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Tag chips (only when Show Tags is unlocked). Sits in its own
              row below the title/author so it doesn't compete with the
              Close button for space in the top-right. */}
          {showTags && (
            <div className="mt-3">
              <TagChips card={card} surface="paper" size="md" />
            </div>
          )}

          <FleuronDivider className="my-5" />

          {card.image_url && (
            <div className="my-4 flex justify-center">
              <img
                src={card.image_url}
                alt={card.description || card.title}
                className="max-w-full max-h-[14rem] border border-gold-500/40"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            </div>
          )}

          {card.content && (
            <div className="my-6">
              <p className="font-serif text-base leading-relaxed text-ink-900 whitespace-pre-wrap">
                {card.content}
              </p>
            </div>
          )}

          {showSignificance && card.significance && (
            <>
              <FleuronDivider className="my-5" />
              <div>
                <h3 className="font-display text-base font-bold uppercase tracking-widest text-ink-900 mb-2">
                  Significance
                </h3>
                <p className="font-serif text-base leading-relaxed text-ink-900 italic">
                  {card.significance}
                </p>
              </div>
            </>
          )}

          {card.citation && (
            <div className="mt-6 pt-4 border-t border-gold-500/30">
              <p className="font-serif text-xs leading-relaxed text-ink-900 italic">
                {card.citation}
              </p>
            </div>
          )}

          {/* Optional actions block — renders the in-modal place buttons.
              When actions are present, that block also shows the card's
              sequence # and bonus inline alongside the buttons, so we
              suppress the standalone footer below to avoid duplication. */}
          {actions && (
            <div className="mt-6 pt-4 border-t border-gold-500/30">
              {actions}
              {card.contributor && (
                <p className="text-center italic font-serif text-xs text-ink-900 mt-3">
                  Contributed by {card.contributor}
                </p>
              )}
            </div>
          )}

          {/* Standalone footer — only used when there are no actions
              (e.g. inspecting a card already placed in a project). */}
          {!actions && (
            <div className="mt-8 pt-4 border-t border-gold-500/30 flex items-end justify-between gap-4 text-xs font-mono text-ink-900">
              <span title="Sequence number">№ {card.sequence_number ?? '—'}</span>
              <span className="text-center italic font-serif">
                {card.contributor ? `Contributed by ${card.contributor}` : ''}
              </span>
              <span className="text-right" title="Bonus points">
                {formatBonus(card?.bonus)}
              </span>
            </div>
          )}
        </div>
      </article>
      </div>
    </div>
  );
}

/**
 * FlipCard — a whole-card image beside the CardModal document. Shows the front;
 * hovering reveals the back. A small badge marks the Article/Book face for
 * conclusions.
 */
function FlipCard({ face }) {
  const { front, back, label } = face;
  return (
    <div
      className="group relative aspect-[5/7] w-full border border-gold-500/40 overflow-hidden bg-cream-100 shadow-card"
      title={back ? 'Hover to see the back' : undefined}
    >
      {label && (
        <span className="absolute top-1 left-1 z-10 font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 bg-teal-950/85 text-gold-300 border border-gold-500/40">
          {label}
        </span>
      )}
      {front ? (
        <img src={front} alt={label ? `${label} front` : 'Card front'} className="absolute inset-0 w-full h-full object-contain" loading="lazy" />
      ) : (
        <FaceMissing text="no front" />
      )}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        {back ? (
          <img src={back} alt={label ? `${label} back` : 'Card back'} className="w-full h-full object-contain bg-cream-100" loading="lazy" />
        ) : (
          <FaceMissing text="no back" />
        )}
      </div>
    </div>
  );
}

function FaceMissing({ text }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center font-mono text-[9px] uppercase tracking-wider text-ink-500 bg-cream-100">
      {text}
    </div>
  );
}

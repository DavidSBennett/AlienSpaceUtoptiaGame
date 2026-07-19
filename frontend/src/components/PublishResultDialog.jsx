import CornerOrnament from './CornerOrnament.jsx';
import FleuronDivider from './FleuronDivider.jsx';
import EvidenceFan from './EvidenceFan.jsx';
import { tagAsConclusionLabel } from '../lib/tags.js';

/**
 * PublishResultDialog — shown after the player submits an argument for review.
 *
 * Pedagogy: the dialog is voiced as a peer reviewer's response, written
 * supportively. On success we celebrate; on failure we explain *what*
 * went structurally wrong without scolding.
 *
 * IMPORTANT — the dialog NEVER shows raw tag letters to players. Tags
 * are scaffolding; the canonical vocabulary is the conclusion titles in
 * the deck. The dialog accepts a `tagToConclusion` Map and uses it to
 * resolve any tag reference to the conclusion that "owns" it. Tags that
 * have no owning conclusion fall back to a generic phrase rather than
 * leaking the underlying letter.
 *
 * @param {Object}  props.result            from state.lastPublishResult
 * @param {Map}     props.tagToConclusion   from buildTagToConclusionMap()
 * @param {Function} props.onClose
 */
export default function PublishResultDialog({ result, tagToConclusion, onClose }) {
  if (!result) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-teal-950/80 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in"
      onClick={onClose}
    >
      <article
        className="relative surface-paper max-w-3xl w-full max-h-[90vh] overflow-y-auto animate-fade-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(184, 146, 58, 0.5)',
        }}
      >
        {/* Inner gilt frame and corner ornaments — same visual language as CardModal */}
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

        <div className="px-10 py-6">

          {/* Headline row — decision + the submitted work's title, on one line
              where there's room. Keeps the top compact. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2
              className={`font-display text-2xl font-bold leading-tight ${
                result.ok ? 'text-verdigris-600' : 'text-oxblood-500'
              }`}
            >
              {result.ok
                ? (result.kind === 'book' ? 'Book Accepted' : 'Article Accepted')
                : 'Revisions Required'}
            </h2>
            <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-gold-700">
              Peer Review · Editor's Decision
            </p>
          </div>
          {result.conclusion?.title && (
            <p className="font-serif italic text-ink-700 text-sm mt-0.5">
              re:&nbsp;<span className="not-italic font-semibold">{result.conclusion.title}</span>
            </p>
          )}

          {/* Fanned-card visualization — shows which evidence supported the
              conclusion (shares its theme) and which fell off-topic. */}
          {result.conclusionCard && (
            <div className="mt-3">
              <EvidenceFan
                evidence={result.evidenceCards || []}
                conclusion={result.conclusionCard}
              />
            </div>
          )}

          <FleuronDivider className="my-3" />

          {/* The body of the review — different content for accept vs revise */}
          {result.ok ? (
            <SuccessBody result={result} tagToConclusion={tagToConclusion} />
          ) : (
            <FailureBody result={result} tagToConclusion={tagToConclusion} />
          )}

          {/* Sign-off + dismiss on one line to save vertical space */}
          <div className="mt-4 pt-3 border-t border-gold-500/30 flex items-center justify-between gap-3">
            <p className="font-serif italic text-ink-700 text-sm">
              — The Editorial Board
            </p>
            <button
              type="button"
              onClick={onClose}
              className="font-display font-bold uppercase tracking-[0.15em] text-sm
                         px-6 py-2 border-2 border-ink-900 text-ink-900
                         hover:bg-ink-900 hover:text-cream-50
                         transition-colors duration-200 flex-shrink-0"
            >
              Continue Career
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}


/**
 * SuccessBody — the peer-reviewer's encouraging response on a successful publication.
 *
 * Names the through-line by referring to the conclusion that "owns" the
 * unifying tag(s), not the tag letters themselves. Players see scholarly
 * vocabulary, not letter codes.
 */
function SuccessBody({ result, tagToConclusion }) {
  const { commonTags } = result.validation;
  const { prestige } = result;
  const evidenceCount = result.evidence.length;
  const submittedTitle = result.conclusion?.title;

  // Resolve common tags to conclusion titles. Filter out any that map to
  // the SAME conclusion the player submitted (because saying "your argument
  // is unified by [the same conclusion you submitted]" is redundant) — those
  // happen because the conclusion's own tag is naturally in the intersection.
  const throughLines = commonTags
    .map((tag) => tagAsConclusionLabel(tag, tagToConclusion))
    .filter((label) => label !== submittedTitle);

  return (
    <div className="space-y-3 font-serif text-ink-900 leading-snug text-sm">
      {throughLines.length > 0 ? (
        <p>
          Your argument is well-supported. The {evidenceCount} pieces of evidence you marshal
          cohere around the framework of <ThemeList themes={throughLines} />,
          providing a clear through-line that the editorial board found persuasive.
        </p>
      ) : (
        // The only common tag was the conclusion's own — meaning evidence
        // all carries the conclusion's tag and nothing else of note shared.
        // Still a valid argument, just no secondary theme to call out.
        <p>
          Your argument is well-supported. The {evidenceCount} pieces of evidence
          consistently speak to the question raised by{' '}
          <span className="font-semibold">{submittedTitle}</span>, providing a clear
          through-line that the editorial board found persuasive.
        </p>
      )}

      {prestige?.doubled && prestige.contextField && (
        <p>
          We were further impressed by the evidentiary discipline of your selection — every
          source shares a common <span className="italic">{readableContextField(prestige.contextField)}</span>,
          which strengthens the credibility of the argument considerably.
        </p>
      )}

      {/* Prestige scoring line — compact, on one row */}
      {prestige && (
        <div className="my-2 border-t border-b border-gold-500/30 py-2 flex items-baseline justify-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold-700">
            Prestige Awarded
          </span>
          <span className="font-display text-3xl font-bold text-ink-900 leading-none">
            +{prestige.total}
          </span>
          {prestige.doubled && (
            <span className="font-serif italic text-verdigris-600 text-xs">
              ({prestige.base} base × 2 coherence)
            </span>
          )}
        </div>
      )}
    </div>
  );
}


/**
 * ThemeList — render a list of conclusion titles in scholarly italics,
 * joined naturally:
 *   1 theme  → "<title>"
 *   2 themes → "<title> and <title>"
 *   3+       → "<title>, <title>, and <title>"
 */
function ThemeList({ themes }) {
  if (themes.length === 0) return null;
  if (themes.length === 1) {
    return <span className="italic font-semibold">{themes[0]}</span>;
  }
  if (themes.length === 2) {
    return (
      <>
        <span className="italic font-semibold">{themes[0]}</span>
        {' and '}
        <span className="italic font-semibold">{themes[1]}</span>
      </>
    );
  }
  return (
    <>
      {themes.slice(0, -1).map((t, i) => (
        <span key={t}>
          <span className="italic font-semibold">{t}</span>
          {i < themes.length - 2 ? ', ' : ', and '}
        </span>
      ))}
      <span className="italic font-semibold">{themes[themes.length - 1]}</span>
    </>
  );
}


/**
 * FailureBody — the peer-reviewer's gentle critique on rejection.
 *
 * The exact wording adapts to which `critique.kind` the validator returned.
 * All copy is templated — card titles come from result payload, never
 * hardcoded for any specific deck.
 */
function FailureBody({ result, tagToConclusion }) {
  const { critique } = result;

  // Defensive — should always be present on failure but check anyway
  if (!critique) {
    return (
      <p className="font-serif text-ink-900 leading-relaxed text-base">
        The board has asked for revisions. Consider reviewing your evidence and conclusion
        for stronger thematic alignment.
      </p>
    );
  }

  return (
    <div className="space-y-2 font-serif text-ink-900 leading-snug text-sm">
      <CritiqueText critique={critique} result={result} tagToConclusion={tagToConclusion} />
      <p className="italic text-ink-700">
        Take heart — even seasoned scholars revise many times. Your evidence stays assembled
        in the project; consider a different conclusion for what you've gathered, or which
        sources to exchange to better support your thesis.
      </p>
    </div>
  );
}


/**
 * CritiqueText — chooses the right templated paragraph based on the critique kind.
 *
 * Each branch generates fresh copy from the card titles in the result, so
 * decks about the Civil Rights Movement, the Spanish-American War, or any
 * other topic produce equally specific reviews.
 *
 * For the evidence-conclusion-mismatch case, we resolve the consensus tag
 * to its owning conclusion title so the reviewer can name what the evidence
 * actually IS about, not just what it isn't.
 */
function CritiqueText({ critique, result, tagToConclusion }) {
  const conclusionTitle = result.conclusion?.title;

  switch (critique.kind) {
    case 'no-conclusion-support':
      return (
        <p>
          The evidence you've assembled, while compelling individually, does not directly
          speak to the question posed by <span className="font-semibold">{conclusionTitle}</span>.
          The board could not find a thread connecting your sources to the conclusion you wish to draw.
        </p>
      );

    case 'evidence-conclusion-mismatch': {
      // Resolve the consensus tag to its owning conclusion title.
      // If the deck has a conclusion that "owns" this tag, name it so the
      // reviewer can show the player what their evidence is actually about.
      const evidenceTheme = critique.evidenceTheme;
      const themeConclusion = evidenceTheme
        ? tagToConclusion?.get(evidenceTheme)
        : null;

      if (themeConclusion?.title) {
        return (
          <p>
            The evidence you've gathered tells a coherent story — but one whose natural
            home is <span className="italic font-semibold">{themeConclusion.title}</span>,
            not the question your conclusion{' '}
            <span className="font-semibold">{conclusionTitle}</span> raises. You may have
            assembled the makings of a different argument than the one you set out to write.
          </p>
        );
      }

      // Fallback when no conclusion claims the tag — keep it generic
      // rather than exposing the raw letter
      return (
        <p>
          The evidence you've gathered is internally coherent — these sources do speak
          to a shared theme. However, that shared theme is not the question your
          conclusion <span className="font-semibold">{conclusionTitle}</span> raises.
          You may have assembled the makings of a different argument than the one you
          set out to write.
        </p>
      );
    }

    case 'single-outlier': {
      const card = critique.problemCards[0];
      return (
        <p>
          Most of your evidence aligns clearly with <span className="font-semibold">{conclusionTitle}</span>,
          and we appreciate the focus. However, the inclusion of{' '}
          <span className="italic font-semibold">{card?.title}</span> falls outside the
          through-line of your argument; this source seems to belong to a different conversation.
        </p>
      );
    }

    case 'few-outliers': {
      const titles = critique.problemCards
        .map((c) => c?.title)
        .filter(Boolean);
      const titleList = formatTitleList(titles);
      return (
        <p>
          Several of your sources support <span className="font-semibold">{conclusionTitle}</span> well.
          However, {titleList} {titles.length === 1 ? 'falls' : 'fall'} outside the central thread
          of your argument. Consider whether {titles.length === 1 ? 'this source' : 'these sources'} might
          better support a different conclusion, or whether stronger evidence is needed elsewhere.
        </p>
      );
    }

    case 'no-coherence':
      return (
        <p>
          The board could not identify a unifying through-line in your evidence. While each
          source has merit, taken together they do not form a coherent argument for{' '}
          <span className="font-semibold">{conclusionTitle}</span>. We encourage you to
          consider what theme might tie these sources together — or to select evidence
          more closely aligned with your stated conclusion.
        </p>
      );

    case 'too-few-evidence':
      return (
        <p>
          A scholarly argument requires more than a single source. Please return with
          additional evidence to support <span className="font-semibold">{conclusionTitle}</span>.
        </p>
      );

    default:
      return (
        <p>
          The board has asked for revisions. Consider reviewing your evidence and conclusion
          for stronger thematic alignment.
        </p>
      );
  }
}


// ===== Formatting helpers =====

/**
 * Format an array of card titles as a natural-language list with italicization
 * left to the caller. Returns a JSX-safe array intermixed with text.
 *   ['Card A']               → "Card A"
 *   ['Card A', 'Card B']     → "Card A and Card B"
 *   ['A', 'B', 'C']          → "A, B, and C"
 *
 * Returns a single ReactNode (a span) with italicized titles.
 */
function formatTitleList(titles) {
  if (titles.length === 0) return null;
  if (titles.length === 1) {
    return <span className="italic font-semibold">{titles[0]}</span>;
  }
  if (titles.length === 2) {
    return (
      <>
        <span className="italic font-semibold">{titles[0]}</span>
        {' and '}
        <span className="italic font-semibold">{titles[1]}</span>
      </>
    );
  }
  // 3+
  return (
    <>
      {titles.slice(0, -1).map((t, i) => (
        <span key={t}>
          <span className="italic font-semibold">{t}</span>
          {i < titles.length - 2 ? ', ' : ', and '}
        </span>
      ))}
      <span className="italic font-semibold">{titles[titles.length - 1]}</span>
    </>
  );
}

/**
 * Translate a context field name into a human-readable phrase.
 */
function readableContextField(field) {
  const labels = {
    location: 'geographic setting',
    author: 'authorial voice',
    date: 'historical moment',
    source_type: 'kind of source',
    citation: 'archival origin',
  };
  return labels[field] || field;
}

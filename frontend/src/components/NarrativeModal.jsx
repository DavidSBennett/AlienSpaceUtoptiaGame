/**
 * NarrativeModal — a story beat shown when the player reaches a new career
 * rank (hired, tenure, a promotion). Pure narrative; dismiss to continue.
 * Rendered only when the player has narrative prompts enabled.
 *
 * Props:
 *   stage   — the rank just reached (key into STAGE_NARRATIVE)
 *   year    — current game year (optional, shown in the eyebrow)
 *   onClose — () => void
 */
import { STAGE_NARRATIVE } from '../lib/career.js';
import CornerOrnament from './CornerOrnament.jsx';
import FleuronDivider from './FleuronDivider.jsx';

export default function NarrativeModal({ stage, year, onClose }) {
  const copy = STAGE_NARRATIVE[stage];
  if (!copy) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-teal-950/85 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onClose}
    >
      <article
        className="relative max-w-md w-full surface-paper px-10 py-9 text-center animate-fade-up"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(184, 146, 58, 0.5)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-2 border border-gold-500/30 pointer-events-none" />
        <div className="absolute top-3 left-3 text-gold-500 pointer-events-none">
          <CornerOrnament corner="tl" size={22} />
        </div>
        <div className="absolute top-3 right-3 text-gold-500 pointer-events-none">
          <CornerOrnament corner="tr" size={22} />
        </div>
        <div className="absolute bottom-3 left-3 text-gold-500 pointer-events-none">
          <CornerOrnament corner="bl" size={22} />
        </div>
        <div className="absolute bottom-3 right-3 text-gold-500 pointer-events-none">
          <CornerOrnament corner="br" size={22} />
        </div>

        <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-700 mb-2">
          {copy.eyebrow}{year ? ` · Year ${year}` : ''}
        </p>
        <h2 className="font-display text-3xl font-bold text-ink-900 leading-tight">
          {copy.title}
        </h2>

        <FleuronDivider className="my-4" />

        <p className="font-serif text-ink-800 text-base leading-relaxed">
          {copy.body}
        </p>

        <button type="button" onClick={onClose} className="btn-primary inline-block mt-6">
          Continue
        </button>
      </article>
    </div>
  );
}

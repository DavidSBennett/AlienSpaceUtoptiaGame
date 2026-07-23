/**
 * src/auth/AuthFrame.jsx
 *
 * Shared visual chrome for every auth page (login, register, forgot,
 * reset, verify, account). Reproduces the gilt-bordered surface-binding
 * pattern used by MultiplayerLobby so the auth flow feels native to
 * the app's chrome rather than a stock form.
 *
 * Props:
 *   title    — main display heading (e.g. "Sign In", "Create Account")
 *   subtitle — small italic line below the heading (optional)
 *   eyebrow  — tiny uppercase mono line above the heading (optional;
 *              defaults to "The Historians")
 *   children — the form / body content
 *   footer   — bottom-of-card nav block (e.g. "Already have an account?
 *              Sign in." — optional)
 *   wide     — roomier frame for the data-heavy admin pages (deck manager,
 *              invite codes). A login form wants a narrow column; a table of
 *              decks or invite codes crammed into that same column has its
 *              rows fighting the frame. This widens the card AND opens up the
 *              interior margins, and the gilt pinstripe and corner ornaments
 *              step outward with it so the chrome stays in proportion rather
 *              than hugging the text.
 */
import SkipLink from '../components/SkipLink.jsx';
import CornerOrnament from '../components/CornerOrnament.jsx';
import FleuronDivider from '../components/FleuronDivider.jsx';

export default function AuthFrame({ title, subtitle, eyebrow = 'The Historians', children, footer, wide = false }) {
  // Chrome insets scale with the frame: the pinstripe sits just inside the
  // outer rule, and the ornaments just inside the pinstripe. Keeping that
  // relationship is what stops the wide variant looking like the narrow one
  // stretched.
  //
  // Written as whole literal class strings, never interpolated fragments:
  // Tailwind scans source text for complete class names, so a `top-${n}` would
  // compile to nothing and the ornaments would silently collapse to the corner.
  const maxW   = wide ? 'max-w-4xl' : 'max-w-lg';
  const pad    = wide ? 'px-14 py-12' : 'px-8 py-10';
  const stripe = wide ? 'inset-3' : 'inset-2';
  const orn = wide
    ? { tl: 'top-4 left-4', tr: 'top-4 right-4', bl: 'bottom-4 left-4', br: 'bottom-4 right-4' }
    : { tl: 'top-3 left-3', tr: 'top-3 right-3', bl: 'bottom-3 left-3', br: 'bottom-3 right-3' };

  return (
    <>
      <SkipLink />
      <main
        id="main-content"
        tabIndex={-1}
        className={`min-h-screen flex items-center justify-center py-12 ${wide ? 'px-10' : 'px-6'}`}
      >
        <div className={`relative ${maxW} w-full`}>
          <div className={`relative border border-gold-500/40 ${pad} surface-binding`}>
            {/* Inner gilt border — the pinstripe */}
            <div className={`absolute ${stripe} border border-gold-500/20 pointer-events-none`} />

            {/* Corner ornaments */}
            <div className={`absolute ${orn.tl} text-gold-400 pointer-events-none`}>
              <CornerOrnament corner="tl" size={28} />
            </div>
            <div className={`absolute ${orn.tr} text-gold-400 pointer-events-none`}>
              <CornerOrnament corner="tr" size={28} />
            </div>
            <div className={`absolute ${orn.bl} text-gold-400 pointer-events-none`}>
              <CornerOrnament corner="bl" size={28} />
            </div>
            <div className={`absolute ${orn.br} text-gold-400 pointer-events-none`}>
              <CornerOrnament corner="br" size={28} />
            </div>

            {/* Title block */}
            <div className="text-center relative z-10 mb-6">
              {eyebrow && (
                <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-gold-400 mb-3">
                  {eyebrow}
                </p>
              )}
              <h1 className="font-display text-4xl font-medium text-cream-50 leading-none tracking-tight">
                {title}
              </h1>
              {subtitle && (
                <p className="font-display italic text-base text-cream-200 mt-2">
                  {subtitle}
                </p>
              )}
            </div>

            <FleuronDivider className="my-6" />

            {/* Body */}
            <div className="relative z-10">
              {children}
            </div>

            {footer && (
              <>
                <FleuronDivider className="my-6" />
                <div className="relative z-10 text-center">
                  {footer}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

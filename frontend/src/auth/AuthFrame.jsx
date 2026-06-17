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
 */
import SkipLink from '../components/SkipLink.jsx';
import CornerOrnament from '../components/CornerOrnament.jsx';
import FleuronDivider from '../components/FleuronDivider.jsx';

export default function AuthFrame({ title, subtitle, eyebrow = 'The Historians', children, footer }) {
  return (
    <>
      <SkipLink />
      <main
        id="main-content"
        tabIndex={-1}
        className="min-h-screen flex items-center justify-center px-6 py-12"
      >
        <div className="relative max-w-lg w-full">
          <div className="relative border border-gold-500/40 px-8 py-10 surface-binding">
            {/* Inner gilt border */}
            <div className="absolute inset-2 border border-gold-500/20 pointer-events-none" />

            {/* Corner ornaments */}
            <div className="absolute top-3 left-3 text-gold-400 pointer-events-none">
              <CornerOrnament corner="tl" size={28} />
            </div>
            <div className="absolute top-3 right-3 text-gold-400 pointer-events-none">
              <CornerOrnament corner="tr" size={28} />
            </div>
            <div className="absolute bottom-3 left-3 text-gold-400 pointer-events-none">
              <CornerOrnament corner="bl" size={28} />
            </div>
            <div className="absolute bottom-3 right-3 text-gold-400 pointer-events-none">
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

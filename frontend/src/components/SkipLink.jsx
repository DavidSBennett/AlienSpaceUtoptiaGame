/**
 * SkipLink — the "skip to main content" link required by WCAG 2.4.1
 * (Bypass Blocks). It is the first focusable element on the page; it is
 * visually hidden until it receives keyboard focus, at which point it
 * appears in the top-left corner. Activating it moves focus to the
 * page's <main id="main-content"> landmark.
 *
 * Usage: render <SkipLink /> as the very first child of a page, and make
 * sure that page's <main> element has id="main-content" and tabIndex={-1}
 * (so it can receive programmatic focus).
 *
 * The styling lives in styles/index.css under `.skip-link`.
 */
export default function SkipLink() {
  return (
    <a href="#main-content" className="skip-link">
      Skip to main content
    </a>
  );
}

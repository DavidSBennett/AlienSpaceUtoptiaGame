import { Component } from 'react';

/**
 * ErrorBoundary — catches any uncaught render error in its children
 * and shows a graceful fallback UI instead of blanking the screen.
 *
 * Must be a class component because React's error-boundary lifecycle
 * methods (componentDidCatch, getDerivedStateFromError) aren't
 * available on function components. Everything else in this app is
 * functional; this one file is the exception.
 *
 * Wrapped at the root of the tree in main.jsx so it catches errors
 * from any page. Has a built-in "reload" button — for a single-page
 * app, full reload is usually the only safe recovery (the React tree
 * might be in an inconsistent state after a render throw).
 *
 * In dev, the underlying error is dumped to the console; in prod
 * builds, we still log it but the UI doesn't expose the stack to the
 * end user.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error) {
    // This runs during the render phase, before commit. It must be
    // pure: only return state. Side effects (logging) go in
    // componentDidCatch.
    return { hasError: true, errorMessage: error?.message || 'Unknown error' };
  }

  componentDidCatch(error, info) {
    // Side-effect phase. Log the error somewhere developer-visible.
    // In a future iteration we could ship these to a server endpoint
    // for telemetry; for now console is enough.
    // eslint-disable-next-line no-console
    console.error('Unhandled render error:', error, info?.componentStack);
  }

  handleReload = () => {
    // Full page reload — the React tree is potentially corrupt after
    // a render throw, so we can't safely just clear the error and try
    // again. A reload re-mounts everything from scratch.
    window.location.reload();
  };

  handleHome = () => {
    // Soft recovery — navigate to landing. Some errors are caused by
    // a specific page's state (e.g., bad nav state) and bouncing home
    // resolves them without a full reload.
    window.location.assign('/');
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="min-h-screen flex items-center justify-center px-6 py-12 surface-binding">
        <div className="relative max-w-lg w-full">
          <div className="relative border border-oxblood-500/40 px-8 py-10 surface-binding">
            <div className="absolute inset-2 border border-oxblood-500/20 pointer-events-none" />

            <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-oxblood-300 mb-3 text-center">
              Something went wrong
            </p>
            <h1 className="font-display text-3xl font-medium text-cream-50 leading-tight tracking-tight text-center mb-4">
              The archive misfiled itself.
            </h1>
            <p className="font-serif italic text-cream-200/80 text-center text-sm mb-6">
              An unexpected error interrupted the page. Reloading usually fixes it.
              If it keeps happening, head back to the landing and try again.
            </p>

            {this.state.errorMessage && (
              <pre className="font-mono text-[10px] text-cream-200/40 bg-ink-900/40 p-3 mb-6 overflow-x-auto whitespace-pre-wrap break-words">
                {this.state.errorMessage}
              </pre>
            )}

            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <button onClick={this.handleReload} className="btn-primary">
                Reload page
              </button>
              <button onClick={this.handleHome} className="btn-ghost">
                Return home
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }
}

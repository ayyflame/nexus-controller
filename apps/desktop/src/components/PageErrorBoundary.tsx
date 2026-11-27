import { Component, type ReactNode } from "react";
import { Icon } from "./Icons";

/**
 * Keeps one page's failure inside that page: the sidebar, top bar and the
 * other pages keep working, and the error is shown instead of a blank window.
 * Navigating to any page (or Try again) renders the page afresh.
 */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) }; }
  componentDidCatch(e: unknown) { console.error("Page failed to render.", e); }
  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="page">
        <section className="card" role="alert">
          <div className="empty-state">
            <Icon name="alert" size={22} />
            <strong>This page ran into a problem</strong>
            <span>{this.state.error}</span>
            <span>Your settings are unchanged. Other pages still work.</span>
            <button type="button" className="btn-secondary small" onClick={() => this.setState({ error: null })}>Try again</button>
          </div>
        </section>
      </div>
    );
  }
}

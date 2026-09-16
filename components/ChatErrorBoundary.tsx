"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ChatErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[chat-ui] render failed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="messages">
          <section className="chat-error-card" role="alert">
            <strong>The chat view could not render this response.</strong>
            <p>Refresh the page to reconnect to the saved conversation.</p>
            <button type="button" onClick={() => window.location.reload()}>
              Refresh chat
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

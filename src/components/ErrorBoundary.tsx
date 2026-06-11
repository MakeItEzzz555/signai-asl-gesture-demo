import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Unhandled UI error:', error, info);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-xl border border-destructive/20 bg-card p-6 space-y-4">
          <h1 className="text-xl font-bold text-destructive" style={{ fontFamily: 'Space Grotesk' }}>
            Something went wrong
          </h1>
          <p className="text-sm text-muted-foreground">
            The app hit an unexpected error. Reload the page to recover.
          </p>
          {this.state.error?.message && (
            <pre className="text-xs rounded-md bg-muted p-3 overflow-auto text-muted-foreground">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.handleReload}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold hover:opacity-90"
          >
            Reload App
          </button>
        </div>
      </div>
    );
  }
}

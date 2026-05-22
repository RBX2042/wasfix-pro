"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

type Props = { children: React.ReactNode; fallback?: React.ReactNode; onReset?: () => void };
type State = { hasError: boolean; error?: Error };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (typeof window !== "undefined") {
      // Forward to client logger if you ship one (Sentry, PostHog, etc).
       
      console.error("[WasFix] Component error", error, info.componentStack);
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: undefined });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center my-4">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive mb-3" />
          <h2 className="font-heading text-lg font-semibold">Er ging iets mis</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Probeer de pagina te vernieuwen of probeer het opnieuw.
          </p>
          <Button onClick={this.reset} variant="outline" size="sm">
            Opnieuw proberen
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

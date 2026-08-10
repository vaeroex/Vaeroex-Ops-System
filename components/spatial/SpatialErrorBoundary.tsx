"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type SpatialErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  onError?: () => void;
};

type SpatialErrorBoundaryState = { failed: boolean };

export class SpatialErrorBoundary extends Component<SpatialErrorBoundaryProps, SpatialErrorBoundaryState> {
  state: SpatialErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): SpatialErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.();
    console.error("Spatial presentation failed safely.", { name: error.name, componentStack: info.componentStack });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

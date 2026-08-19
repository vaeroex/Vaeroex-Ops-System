"use client";

import { useThree } from "@react-three/fiber";
import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";

type PublicSpatialErrorBoundaryProps = Readonly<{
  children: ReactNode;
  fallback: ReactNode;
  onFailure?: () => void;
}>;

type PublicSpatialErrorBoundaryState = Readonly<{ failed: boolean }>;

export class PublicSpatialErrorBoundary extends Component<
  PublicSpatialErrorBoundaryProps,
  PublicSpatialErrorBoundaryState
> {
  state: PublicSpatialErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): PublicSpatialErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onFailure?.();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function PublicSpatialContextGuard({ onFailure }: { onFailure: () => void }) {
  const { gl } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      onFailure();
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    return () => canvas.removeEventListener("webglcontextlost", handleContextLost);
  }, [gl, onFailure]);

  return null;
}

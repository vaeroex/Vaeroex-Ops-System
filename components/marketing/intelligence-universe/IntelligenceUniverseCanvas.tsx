"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  MathUtils,
  PerspectiveCamera,
  SRGBColorSpace,
  Vector3
} from "three";
import { IntelligenceUniverseWorld } from "@/components/marketing/intelligence-universe/IntelligenceUniverseWorld";
import { probeRenderedCanvas, type CanvasPixelProbeResult } from "@/components/spatial/CanvasPixelProbe";
import { SpatialResizeObserver } from "@/components/spatial/SpatialResizeObserver";
import type { SpatialQualityTier } from "@/components/spatial/useSpatialCapability";
import {
  isUniverseSystemDestination,
  type IntelligenceUniverseState,
  type IntelligenceUniverseSystemDestination
} from "@/lib/marketing/intelligence-universe";

type IntelligenceUniverseCanvasProps = Readonly<{
  active: boolean;
  state: IntelligenceUniverseState;
  quality: SpatialQualityTier;
}>;

type CameraAnchor = Readonly<{
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fov: number;
}>;

const SYSTEM_X: Readonly<Record<IntelligenceUniverseSystemDestination, number>> = {
  "executive-intelligence": -9.5,
  "drug-discovery-intelligence": 0,
  "biological-intelligence": 9.5
};

const MASTER_ANCHOR: CameraAnchor = {
  position: [0, 5.4, 33],
  target: [0, 0, -9],
  fov: 47
};

function resolveCameraAnchor(state: IntelligenceUniverseState): CameraAnchor {
  const destination = state.phase === "transitioning" || state.phase === "arriving"
    ? state.target
    : state.current;

  if (destination === "vaeroex") return MASTER_ANCHOR;

  if (destination === "intelligence-systems") {
    const selectedX = SYSTEM_X[state.selectedSystem];
    return {
      position: [selectedX * 0.16, 3.1, 20.5],
      target: [selectedX * 0.28, 0, -9],
      fov: 46
    };
  }

  const system = isUniverseSystemDestination(destination) ? destination : state.selectedSystem;
  const systemX = SYSTEM_X[system];
  return {
    position: [systemX, 2.1, state.phase === "transitioning" ? 9.5 : 7.2],
    target: [systemX, 0, -9.4],
    fov: state.phase === "transitioning" ? 49 : 41
  };
}

function UniverseCamera({ active, state }: Pick<IntelligenceUniverseCanvasProps, "active" | "state">) {
  const camera = useThree((root) => root.camera) as PerspectiveCamera;
  const invalidate = useThree((root) => root.invalidate);
  const anchor = useMemo(() => resolveCameraAnchor(state), [state]);
  const lookAt = useRef(new Vector3(...anchor.target));

  useEffect(() => {
    if (!active) return;
    invalidate();
  }, [active, anchor, invalidate]);

  useFrame((_, delta) => {
    if (!active) return;
    const reducedMotion = state.reducedMotion || state.quality === "reduced_motion";
    const position = anchor.position;
    const target = anchor.target;

    if (reducedMotion) {
      camera.position.set(...position);
      lookAt.current.set(...target);
      camera.fov = anchor.fov;
    } else {
      camera.position.x = MathUtils.damp(camera.position.x, position[0], 4.6, delta);
      camera.position.y = MathUtils.damp(camera.position.y, position[1], 4.6, delta);
      camera.position.z = MathUtils.damp(camera.position.z, position[2], 4.6, delta);
      lookAt.current.x = MathUtils.damp(lookAt.current.x, target[0], 5.1, delta);
      lookAt.current.y = MathUtils.damp(lookAt.current.y, target[1], 5.1, delta);
      lookAt.current.z = MathUtils.damp(lookAt.current.z, target[2], 5.1, delta);
      camera.fov = MathUtils.damp(camera.fov, anchor.fov, 4.2, delta);
    }

    camera.lookAt(lookAt.current);
    camera.updateProjectionMatrix();
  });

  return null;
}

function UniverseFrameScheduler({ active, quality }: Pick<IntelligenceUniverseCanvasProps, "active" | "quality">) {
  const invalidate = useThree((root) => root.invalidate);

  useEffect(() => {
    if (!active) return;
    const intervalMs = quality === "full" ? 34 : quality === "constrained" ? 62 : 160;
    const renderIfVisible = () => {
      if (document.visibilityState === "visible") invalidate();
    };
    renderIfVisible();
    const interval = window.setInterval(renderIfVisible, intervalMs);
    document.addEventListener("visibilitychange", renderIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", renderIfVisible);
    };
  }, [active, invalidate, quality]);

  return null;
}

export default function IntelligenceUniverseCanvas({ active, state, quality }: IntelligenceUniverseCanvasProps) {
  const [pixelProbe, setPixelProbe] = useState<CanvasPixelProbeResult>("pending");
  const dpr: [number, number] = quality === "full"
    ? [1, 1.35]
    : quality === "constrained"
      ? [0.75, 1]
      : [0.7, 0.9];

  return (
    <div
      data-spatial-webgl
      data-intelligence-universe-canvas
      data-active={active}
      data-quality={quality}
      data-canvas-pixels={pixelProbe}
      style={{ width: "100%", height: "100%" }}
    >
      <Canvas
        camera={{ position: MASTER_ANCHOR.position, fov: MASTER_ANCHOR.fov, near: 0.1, far: 180 }}
        dpr={dpr}
        frameloop={active ? "demand" : "never"}
        gl={{ antialias: quality === "full", alpha: false, powerPreference: "high-performance" }}
        resize={{ polyfill: SpatialResizeObserver }}
        onCreated={(root) => {
          root.gl.outputColorSpace = SRGBColorSpace;
          root.gl.toneMapping = ACESFilmicToneMapping;
          root.gl.toneMappingExposure = 1.02;
          if (active) probeRenderedCanvas(root, setPixelProbe);
        }}
      >
        <IntelligenceUniverseWorld active={active} quality={quality} state={state} />
        <UniverseCamera active={active} state={state} />
        <UniverseFrameScheduler active={active} quality={quality} />
      </Canvas>
    </div>
  );
}

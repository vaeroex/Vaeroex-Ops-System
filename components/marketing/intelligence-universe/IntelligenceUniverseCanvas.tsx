"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
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
  INTELLIGENCE_UNIVERSE_DESTINATION_POSITIONS,
  INTELLIGENCE_UNIVERSE_ENTRY_POSITIONS,
  INTELLIGENCE_UNIVERSE_START_POSITION,
  isUniverseSystemDestination,
  type IntelligenceUniverseMotion,
  type IntelligenceUniverseState
} from "@/lib/marketing/intelligence-universe";

type IntelligenceUniverseCanvasProps = Readonly<{
  active: boolean;
  state: IntelligenceUniverseState;
  motion: MutableRefObject<IntelligenceUniverseMotion>;
  quality: SpatialQualityTier;
}>;

const MASTER_CAMERA_POSITION = [
  INTELLIGENCE_UNIVERSE_START_POSITION.x,
  INTELLIGENCE_UNIVERSE_START_POSITION.y,
  INTELLIGENCE_UNIVERSE_START_POSITION.z
] as const;

function UniverseCamera({ active, state, motion }: Pick<IntelligenceUniverseCanvasProps, "active" | "state" | "motion">) {
  const camera = useThree((root) => root.camera) as PerspectiveCamera;
  const invalidate = useThree((root) => root.invalidate);
  const lookAt = useRef(new Vector3(0, 0, -18));
  const desiredPosition = useRef(new Vector3(...MASTER_CAMERA_POSITION));
  const desiredTarget = useRef(new Vector3(0, 0, -18));
  const guidedTarget = useRef(new Vector3(0, 0, -18));
  const destinationTarget = useRef(new Vector3());

  useEffect(() => {
    if (active) invalidate();
  }, [active, invalidate, state.current, state.phase, state.selectedDestination]);

  useFrame((_, delta) => {
    if (!active) return;
    const currentMotion = motion.current;
    const selectedDestination = state.selectedDestination;
    const entry = INTELLIGENCE_UNIVERSE_ENTRY_POSITIONS[selectedDestination];
    const destination = INTELLIGENCE_UNIVERSE_DESTINATION_POSITIONS[selectedDestination];
    const approach = currentMotion.approachProgress;
    const position = desiredPosition.current.set(
      MathUtils.lerp(currentMotion.position.x, entry.x, approach),
      MathUtils.lerp(currentMotion.position.y, entry.y, approach),
      MathUtils.lerp(currentMotion.position.z, entry.z, approach)
    );

    guidedTarget.current.set(
      currentMotion.position.x * 0.08,
      currentMotion.position.y * 0.08,
      currentMotion.position.z - 34
    );
    destinationTarget.current.set(destination.x, destination.y, destination.z);
    const proximityFocus = state.proximity === "near"
      ? 0.56
      : 0.18;
    const focus = Math.max(approach, proximityFocus);
    const target = desiredTarget.current.copy(guidedTarget.current).lerp(destinationTarget.current, focus);
    const destinationFov = isUniverseSystemDestination(selectedDestination) ? 40.5 : 44;
    const fov = MathUtils.lerp(state.current === "vaeroex" ? 51 : 49, destinationFov, approach);
    const reducedMotion = state.reducedMotion || state.quality === "reduced_motion";

    if (reducedMotion) {
      camera.position.copy(position);
      lookAt.current.copy(target);
      camera.fov = fov;
    } else {
      const positionDamping = currentMotion.mode === "fast_travel"
        ? 10.5
        : currentMotion.mode === "scrolling" ? 6.8 : 7.6;
      camera.position.x = MathUtils.damp(camera.position.x, position.x, positionDamping, delta);
      camera.position.y = MathUtils.damp(camera.position.y, position.y, positionDamping * 0.9, delta);
      camera.position.z = MathUtils.damp(camera.position.z, position.z, positionDamping * 0.86, delta);
      lookAt.current.x = MathUtils.damp(lookAt.current.x, target.x, 7.8, delta);
      lookAt.current.y = MathUtils.damp(lookAt.current.y, target.y, 7.2, delta);
      lookAt.current.z = MathUtils.damp(lookAt.current.z, target.z, 7.4, delta);
      camera.fov = MathUtils.damp(camera.fov, fov, 6.2, delta);
    }

    camera.lookAt(lookAt.current);
    camera.updateProjectionMatrix();
  });

  return null;
}

function UniverseFrameScheduler({
  active,
  motion,
  quality
}: Pick<IntelligenceUniverseCanvasProps, "active" | "motion" | "quality">) {
  const invalidate = useThree((root) => root.invalidate);

  useEffect(() => {
    if (!active) return;
    const intervalMs = quality === "full" ? 42 : quality === "constrained" ? 72 : 180;
    let frame = 0;
    const renderMotion = () => {
      const currentMotion = motion.current;
      const isMoving = currentMotion.mode !== "idle"
        || Math.abs(currentMotion.approachTarget - currentMotion.approachProgress) > 0.0015
        || Math.abs(currentMotion.scrollTarget - currentMotion.scrollProgress) > 0.0015;
      if (isMoving && document.visibilityState === "visible") invalidate();
      frame = window.requestAnimationFrame(renderMotion);
    };
    const renderAmbient = () => {
      if (document.visibilityState === "visible") invalidate();
    };
    renderAmbient();
    frame = window.requestAnimationFrame(renderMotion);
    const interval = window.setInterval(renderAmbient, intervalMs);
    document.addEventListener("visibilitychange", renderAmbient);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", renderAmbient);
    };
  }, [active, invalidate, motion, quality]);

  return null;
}

export default function IntelligenceUniverseCanvas({
  active,
  state,
  motion,
  quality
}: IntelligenceUniverseCanvasProps) {
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
        camera={{ position: MASTER_CAMERA_POSITION, fov: 51, near: 0.1, far: 280 }}
        dpr={dpr}
        frameloop={active ? "demand" : "never"}
        gl={{ antialias: quality === "full", alpha: false, powerPreference: "high-performance" }}
        resize={{ polyfill: SpatialResizeObserver }}
        onCreated={(root) => {
          root.gl.outputColorSpace = SRGBColorSpace;
          root.gl.toneMapping = ACESFilmicToneMapping;
          root.gl.toneMappingExposure = 1.08;
          if (active) probeRenderedCanvas(root, setPixelProbe);
        }}
      >
        <IntelligenceUniverseWorld
          active={active}
          quality={quality}
          state={state}
          motion={motion}
        />
        <UniverseCamera active={active} state={state} motion={motion} />
        <UniverseFrameScheduler active={active} quality={quality} motion={motion} />
      </Canvas>
    </div>
  );
}

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
  INTELLIGENCE_UNIVERSE_ENTRY_POSITIONS,
  INTELLIGENCE_UNIVERSE_START_POSITION,
  INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS,
  type IntelligenceUniverseMotion,
  type IntelligenceUniverseState,
  type IntelligenceUniverseSystemDestination
} from "@/lib/marketing/intelligence-universe";

type IntelligenceUniverseCanvasProps = Readonly<{
  active: boolean;
  state: IntelligenceUniverseState;
  motion: MutableRefObject<IntelligenceUniverseMotion>;
  quality: SpatialQualityTier;
  onEnterSystem: (destination: IntelligenceUniverseSystemDestination) => void;
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
  const freeTarget = useRef(new Vector3(0, 0, -18));
  const systemTarget = useRef(new Vector3());

  useEffect(() => {
    if (active) invalidate();
  }, [active, invalidate, state.current, state.phase, state.selectedSystem]);

  useFrame((_, delta) => {
    if (!active) return;
    const currentMotion = motion.current;
    const selectedSystem = state.selectedSystem;
    const entry = INTELLIGENCE_UNIVERSE_ENTRY_POSITIONS[selectedSystem];
    const system = INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS[selectedSystem];
    const approach = currentMotion.approachProgress;
    const velocityMagnitude = Math.hypot(
      currentMotion.velocity.x,
      currentMotion.velocity.y,
      currentMotion.velocity.z
    );
    const lookAheadScale = MathUtils.clamp(velocityMagnitude / 16, 0, 1);
    const position = desiredPosition.current.set(
      MathUtils.lerp(currentMotion.position.x, entry.x, approach),
      MathUtils.lerp(currentMotion.position.y, entry.y, approach),
      MathUtils.lerp(currentMotion.position.z, entry.z, approach)
    );

    freeTarget.current.set(
      currentMotion.position.x + MathUtils.clamp(currentMotion.velocity.x * 0.2, -4.5, 4.5),
      currentMotion.position.y + MathUtils.clamp(currentMotion.velocity.y * 0.16, -3, 3),
      currentMotion.position.z - 36 - Math.max(0, -currentMotion.velocity.z) * 0.08
    );
    systemTarget.current.set(system.x, system.y, system.z);
    const systemDistance = Math.max(0.001, Math.hypot(
      system.x - currentMotion.position.x,
      system.y - currentMotion.position.y,
      system.z - currentMotion.position.z
    ));
    const headingTowardSystem = (
      currentMotion.velocity.x * (system.x - currentMotion.position.x)
      + currentMotion.velocity.y * (system.y - currentMotion.position.y)
      + currentMotion.velocity.z * (system.z - currentMotion.position.z)
    ) / systemDistance;
    const proximityFocus = state.proximity === "near"
      ? (headingTowardSystem < -0.08 ? 0.1 : 0.52 + lookAheadScale * 0.08)
      : state.proximity === "signal" ? (headingTowardSystem < -0.08 ? 0.025 : 0.12) : 0;
    const focus = Math.max(approach, proximityFocus);
    const target = desiredTarget.current.copy(freeTarget.current).lerp(systemTarget.current, focus);
    const fov = MathUtils.lerp(state.current === "vaeroex" ? 51 : 49, 40.5, approach);
    const reducedMotion = state.reducedMotion || state.quality === "reduced_motion";

    if (reducedMotion) {
      camera.position.copy(position);
      lookAt.current.copy(target);
      camera.fov = fov;
    } else {
      const positionDamping = currentMotion.dragging ? 19 : currentMotion.mode === "fast_travel" ? 10.5 : 7.6;
      camera.position.x = MathUtils.damp(camera.position.x, position.x, positionDamping, delta);
      camera.position.y = MathUtils.damp(camera.position.y, position.y, positionDamping * 0.9, delta);
      camera.position.z = MathUtils.damp(camera.position.z, position.z, positionDamping * 0.86, delta);
      lookAt.current.x = MathUtils.damp(lookAt.current.x, target.x, currentMotion.dragging ? 15 : 7.8, delta);
      lookAt.current.y = MathUtils.damp(lookAt.current.y, target.y, currentMotion.dragging ? 15 : 7.2, delta);
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
      const speed = Math.hypot(
        currentMotion.velocity.x,
        currentMotion.velocity.y,
        currentMotion.velocity.z
      );
      const isMoving = currentMotion.dragging || currentMotion.mode !== "idle" || speed > 0.012;
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
  quality,
  onEnterSystem
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
          root.gl.toneMappingExposure = 1.02;
          if (active) probeRenderedCanvas(root, setPixelProbe);
        }}
      >
        <IntelligenceUniverseWorld
          active={active}
          quality={quality}
          state={state}
          motion={motion}
          onEnterSystem={onEnterSystem}
        />
        <UniverseCamera active={active} state={state} motion={motion} />
        <UniverseFrameScheduler active={active} quality={quality} motion={motion} />
      </Canvas>
    </div>
  );
}

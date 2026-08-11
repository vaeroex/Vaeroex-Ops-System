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
  INTELLIGENCE_UNIVERSE_RAIL_ANCHORS,
  nearestUniverseSystem,
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

const SYSTEM_DEPTH: Readonly<Record<IntelligenceUniverseSystemDestination, number>> = {
  "executive-intelligence": -14,
  "drug-discovery-intelligence": -18,
  "biological-intelligence": -13.5
};

const MASTER_CAMERA_POSITION = [0, 4.9, 28] as const;

function UniverseCamera({ active, state, motion }: Pick<IntelligenceUniverseCanvasProps, "active" | "state" | "motion">) {
  const camera = useThree((root) => root.camera) as PerspectiveCamera;
  const invalidate = useThree((root) => root.invalidate);
  const lookAt = useRef(new Vector3(0, 0, -14));
  const desiredPosition = useRef(new Vector3(...MASTER_CAMERA_POSITION));
  const desiredTarget = useRef(new Vector3(0, 0, -14));

  useEffect(() => {
    if (active) invalidate();
  }, [active, invalidate, state.current, state.phase, state.selectedSystem]);

  useFrame((_, delta) => {
    if (!active) return;
    const currentMotion = motion.current;
    const selectedSystem = nearestUniverseSystem(currentMotion.railProgress);
    const selectedAnchor = INTELLIGENCE_UNIVERSE_RAIL_ANCHORS[selectedSystem];
    const selectedX = selectedAnchor * 12;
    const railX = currentMotion.railProgress * 12;
    const approach = currentMotion.approachProgress;
    const selectedDepth = SYSTEM_DEPTH[selectedSystem];
    const isMaster = state.current === "vaeroex" && state.phase === "idle";
    const overviewY = isMaster ? 4.9 : 3.8;
    const overviewZ = isMaster ? 28 : 25;
    const lookAhead = MathUtils.clamp(currentMotion.velocity, -1.25, 1.25) * 2.2;
    const position = desiredPosition.current.set(
      MathUtils.lerp(railX, selectedX, approach),
      MathUtils.lerp(overviewY, 2.05, approach),
      MathUtils.lerp(overviewZ, selectedDepth + 13.2, approach)
    );
    const target = desiredTarget.current.set(
      MathUtils.lerp(railX + lookAhead, selectedX, approach),
      MathUtils.lerp(0.15, 0, approach),
      MathUtils.lerp(-14.5, selectedDepth, approach)
    );
    const fov = MathUtils.lerp(isMaster ? 50 : 48, 40.5, approach);
    const reducedMotion = state.reducedMotion || state.quality === "reduced_motion";

    if (reducedMotion) {
      camera.position.copy(position);
      lookAt.current.copy(target);
      camera.fov = fov;
    } else {
      const positionDamping = currentMotion.dragging ? 18 : 7.4;
      camera.position.x = MathUtils.damp(camera.position.x, position.x, positionDamping, delta);
      camera.position.y = MathUtils.damp(camera.position.y, position.y, 6.8, delta);
      camera.position.z = MathUtils.damp(camera.position.z, position.z, 6.8, delta);
      lookAt.current.x = MathUtils.damp(lookAt.current.x, target.x, currentMotion.dragging ? 16 : 8.2, delta);
      lookAt.current.y = MathUtils.damp(lookAt.current.y, target.y, 7.2, delta);
      lookAt.current.z = MathUtils.damp(lookAt.current.z, target.z, 7.2, delta);
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
      const isMoving = currentMotion.dragging
        || currentMotion.mode !== "idle"
        || Math.abs(currentMotion.velocity) > 0.006;
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
        camera={{ position: MASTER_CAMERA_POSITION, fov: 50, near: 0.1, far: 190 }}
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

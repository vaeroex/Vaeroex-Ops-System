"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { ACESFilmicToneMapping, MathUtils, SRGBColorSpace, Vector3 } from "three";
import styles from "@/app/executive-intelligence/executive-intelligence.module.css";
import { ExecutiveIntelligenceWorld } from "@/components/marketing/executive-intelligence/ExecutiveIntelligenceWorld";
import { probeRenderedCanvas, type CanvasPixelProbeResult } from "@/components/spatial/CanvasPixelProbe";
import { SpatialResizeObserver } from "@/components/spatial/SpatialResizeObserver";
import { useSpatialCapability, type SpatialQualityTier } from "@/components/spatial/useSpatialCapability";

type JourneyPoint = Readonly<{
  progress: number;
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fov: number;
}>;

const JOURNEY: readonly JourneyPoint[] = [
  { progress: 0, position: [5.8, 3.1, 15], target: [0, 0.4, -8], fov: 44 },
  { progress: 0.135, position: [-4.8, 1.3, -15], target: [0, 0, -31], fov: 39 },
  { progress: 0.275, position: [5.7, 2.5, -46], target: [0, -0.4, -61], fov: 46 },
  { progress: 0.415, position: [-2.8, 2.8, -76], target: [0, 0, -92], fov: 37 },
  { progress: 0.555, position: [3.8, -1.4, -107], target: [0, -2.2, -123], fov: 43 },
  { progress: 0.695, position: [-5.2, 2.1, -138], target: [0, 0, -154], fov: 41 },
  { progress: 0.835, position: [4.8, 3.4, -169], target: [0, 0.5, -185], fov: 45 },
  { progress: 1, position: [0, 3.6, -201], target: [0, 0, -218], fov: 40 }
] as const;

function smoothStep(value: number) {
  return value * value * (3 - 2 * value);
}

function sampleJourney(progress: number, key: "position" | "target", target: Vector3) {
  let index = 0;
  while (index < JOURNEY.length - 2 && progress > JOURNEY[index + 1].progress) index += 1;
  const from = JOURNEY[index];
  const to = JOURNEY[index + 1];
  const range = Math.max(0.001, to.progress - from.progress);
  const local = smoothStep(MathUtils.clamp((progress - from.progress) / range, 0, 1));
  target.set(
    MathUtils.lerp(from[key][0], to[key][0], local),
    MathUtils.lerp(from[key][1], to[key][1], local),
    MathUtils.lerp(from[key][2], to[key][2], local)
  );
  return MathUtils.lerp(from.fov, to.fov, local);
}

function FrameScheduler({ quality }: { quality: SpatialQualityTier }) {
  const { invalidate } = useThree();

  useEffect(() => {
    const delay = quality === "full" ? 34 : quality === "constrained" ? 62 : 150;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "hidden") invalidate();
    }, delay);
    return () => window.clearInterval(interval);
  }, [invalidate, quality]);

  return null;
}

function DirectedJourney({ quality }: { quality: SpatialQualityTier }) {
  const { camera, pointer } = useThree();
  const targetProgress = useRef(0);
  const currentProgress = useRef(0);
  const nextPosition = useRef(new Vector3());
  const nextTarget = useRef(new Vector3());
  const reducedMotion = quality === "reduced_motion";

  useEffect(() => {
    const update = () => {
      const journey = document.querySelector<HTMLElement>("[data-executive-intelligence-journey]");
      if (!journey) return;
      const bounds = journey.getBoundingClientRect();
      const travel = Math.max(1, journey.offsetHeight - window.innerHeight);
      targetProgress.current = MathUtils.clamp(-bounds.top / travel, 0, 1);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useFrame((_, delta) => {
    currentProgress.current = reducedMotion
      ? targetProgress.current
      : MathUtils.damp(currentProgress.current, targetProgress.current, 4.4, delta);

    const fov = sampleJourney(currentProgress.current, "position", nextPosition.current);
    sampleJourney(currentProgress.current, "target", nextTarget.current);
    if (quality === "full" && !reducedMotion) {
      nextPosition.current.x += pointer.x * 0.2;
      nextPosition.current.y += pointer.y * 0.11;
    }
    camera.position.copy(nextPosition.current);
    camera.lookAt(nextTarget.current);
    if ("fov" in camera) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });

  return <ExecutiveIntelligenceWorld quality={quality} progress={currentProgress} />;
}

function ExecutiveFallback({ reason }: { reason: string }) {
  return (
    <div className={styles.spatialFallback} data-executive-intelligence-fallback={reason} aria-hidden="true">
      <div className={styles.fallbackCommand}>
        {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
      </div>
      <div className={styles.fallbackInstrument}>
        {Array.from({ length: 4 }, (_, index) => <i key={index} />)}
      </div>
    </div>
  );
}

export default function ExecutiveIntelligenceSpatialCanvas() {
  const capability = useSpatialCapability();
  const [pixelProbe, setPixelProbe] = useState<CanvasPixelProbeResult>("pending");

  if (!capability.ready) return null;
  if (!capability.available || !capability.quality) {
    return <ExecutiveFallback reason={capability.reason || "unavailable"} />;
  }

  const quality = capability.quality;
  const dpr: [number, number] = quality === "full" ? [1, 1.4] : quality === "constrained" ? [0.88, 1.1] : [0.8, 1];

  return (
    <div
      className={styles.spatialCanvas}
      data-executive-intelligence-canvas
      data-spatial-webgl
      data-canvas-pixels={pixelProbe}
      aria-hidden="true"
    >
      <Canvas
        camera={{ position: [5.8, 3.1, 15], fov: 44, near: 0.1, far: 310 }}
        dpr={dpr}
        frameloop="demand"
        gl={{ antialias: quality === "full", alpha: false, powerPreference: "high-performance" }}
        resize={{ polyfill: SpatialResizeObserver }}
        onCreated={(state) => {
          state.gl.toneMapping = ACESFilmicToneMapping;
          state.gl.toneMappingExposure = 1.02;
          state.gl.outputColorSpace = SRGBColorSpace;
          probeRenderedCanvas(state, setPixelProbe);
        }}
      >
        <DirectedJourney quality={quality} />
        <FrameScheduler quality={quality} />
      </Canvas>
    </div>
  );
}

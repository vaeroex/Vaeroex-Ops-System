"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  MathUtils,
  SRGBColorSpace,
  Vector3
} from "three";
import styles from "@/app/intelligence-systems/intelligence-systems.module.css";
import { IntelligenceSystemsWorld } from "@/components/marketing/intelligence-systems/IntelligenceSystemsWorld";
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
  { progress: 0, position: [4.5, 3, 14], target: [0, 0, -8], fov: 45 },
  { progress: 0.095, position: [-5.2, 1.2, -17], target: [0, 0, -33], fov: 43 },
  { progress: 0.19, position: [5.6, 2.7, -41], target: [0, 0, -57], fov: 46 },
  { progress: 0.285, position: [-5.4, 3.8, -65], target: [0, -0.4, -81], fov: 48 },
  { progress: 0.38, position: [1.5, -1.2, -89], target: [0, 0, -105], fov: 41 },
  { progress: 0.48, position: [0, 5, -110], target: [0, 0, -130], fov: 53 },
  { progress: 0.58, position: [-7, 2.5, -139], target: [0, 0, -154], fov: 47 },
  { progress: 0.68, position: [6, 2, -164], target: [0, 0, -179], fov: 43 },
  { progress: 0.78, position: [-6, 1.8, -189], target: [0, 0, -204], fov: 46 },
  { progress: 0.88, position: [6, 2, -215], target: [0, 0, -230], fov: 45 },
  { progress: 1, position: [0, 4, -241], target: [0, 0, -257], fov: 44 }
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
      const journey = document.querySelector<HTMLElement>("[data-intelligence-systems-journey]");
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
      : MathUtils.damp(currentProgress.current, targetProgress.current, 4.2, delta);

    const fov = sampleJourney(currentProgress.current, "position", nextPosition.current);
    sampleJourney(currentProgress.current, "target", nextTarget.current);
    if (quality === "full" && !reducedMotion) {
      nextPosition.current.x += pointer.x * 0.22;
      nextPosition.current.y += pointer.y * 0.12;
    }
    camera.position.copy(nextPosition.current);
    camera.lookAt(nextTarget.current);
    if ("fov" in camera) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });

  return <IntelligenceSystemsWorld quality={quality} progress={currentProgress} />;
}

function IntelligenceSystemsFallback({ reason }: { reason: string }) {
  return (
    <div className={styles.spatialFallback} data-intelligence-systems-fallback={reason} aria-hidden="true">
      <div className={styles.fallbackArchitecture}>
        {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
      </div>
      <div className={styles.fallbackSignals}>
        {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
      </div>
    </div>
  );
}

export default function IntelligenceSystemsSpatialCanvas() {
  const capability = useSpatialCapability();
  const [pixelProbe, setPixelProbe] = useState<CanvasPixelProbeResult>("pending");

  if (!capability.ready) return null;
  if (!capability.available || !capability.quality) {
    return <IntelligenceSystemsFallback reason={capability.reason || "unavailable"} />;
  }

  const quality = capability.quality;
  const dpr: [number, number] = quality === "full" ? [1, 1.4] : quality === "constrained" ? [0.9, 1.1] : [0.8, 1];

  return (
    <div
      className={styles.spatialCanvas}
      data-intelligence-systems-canvas
      data-spatial-webgl
      data-canvas-pixels={pixelProbe}
      aria-hidden="true"
    >
      <Canvas
        camera={{ position: [4.5, 3, 14], fov: 45, near: 0.1, far: 380 }}
        dpr={dpr}
        frameloop="demand"
        gl={{ antialias: quality === "full", alpha: false, powerPreference: "high-performance" }}
        resize={{ polyfill: SpatialResizeObserver }}
        onCreated={(state) => {
          state.gl.toneMapping = ACESFilmicToneMapping;
          state.gl.toneMappingExposure = 1.06;
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

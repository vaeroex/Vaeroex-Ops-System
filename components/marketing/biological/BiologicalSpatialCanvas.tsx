"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode
} from "react";
import { ACESFilmicToneMapping, Color, Group, MathUtils, SRGBColorSpace, Vector3 } from "three";
import styles from "@/app/biological-intelligence/biological-intelligence.module.css";
import {
  BiologicalScaleContinuity,
  CellularEnvironment,
  DnaDoubleHelix,
  IntelligenceConvergence,
  PathwaySystem,
  RegulatoryLandscape,
  SequenceToProteinBridge,
  SelectedVariant
} from "@/components/marketing/biological/BiologicalStructures";
import { ProteinTarget } from "@/components/marketing/drug-discovery/ProteinVisualization";
import { probeRenderedCanvas, type CanvasPixelProbeResult } from "@/components/spatial/CanvasPixelProbe";
import { PublicSpatialContextGuard, PublicSpatialErrorBoundary } from "@/components/spatial/PublicSpatialCanvasGuard";
import { SpatialResizeObserver } from "@/components/spatial/SpatialResizeObserver";
import { applySpatialCameraFraming } from "@/components/spatial/spatialCameraFraming";
import {
  useSpatialCapability,
  type SpatialQualityTier,
  type SpatialViewportProfile
} from "@/components/spatial/useSpatialCapability";

type JourneyPoint = Readonly<{
  progress: number;
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fov: number;
}>;

const JOURNEY: readonly JourneyPoint[] = [
  { progress: 0, position: [3.8, 1.8, 14], target: [0, 0, -7], fov: 40 },
  { progress: 0.11, position: [1.6, 0.7, 2.5], target: [0, 0, -14], fov: 35 },
  { progress: 0.21, position: [-1.5, 0.4, -8.5], target: [0, 0, -16], fov: 31 },
  { progress: 0.31, position: [-4.3, 1.2, -18], target: [0, 0, -26], fov: 44 },
  { progress: 0.43, position: [3.5, 0.9, -32], target: [0, 0, -41], fov: 38 },
  { progress: 0.56, position: [-1.7, 0.1, -46], target: [0, 0, -57], fov: 52 },
  { progress: 0.7, position: [4, 1.3, -64], target: [0, 0, -75], fov: 45 },
  { progress: 0.84, position: [-3, 1.2, -83], target: [0, 0, -94], fov: 43 },
  { progress: 1, position: [0.2, 2, -98], target: [0, 0, -108], fov: 40 }
] as const;

type JourneyState = Readonly<{ progress: MutableRefObject<number> }>;

const JourneyContext = createContext<JourneyState | null>(null);

function useJourneyState() {
  const value = useContext(JourneyContext);
  if (!value) throw new Error("Biological Intelligence journey context is unavailable");
  return value;
}

function smoothRange(value: number, from: number, to: number) {
  const normalized = MathUtils.clamp((value - from) / Math.max(0.001, to - from), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function sampleJourney(progress: number, key: "position" | "target", target: Vector3) {
  let index = 0;
  while (index < JOURNEY.length - 2 && progress > JOURNEY[index + 1].progress) index += 1;
  const from = JOURNEY[index];
  const to = JOURNEY[index + 1];
  const local = smoothRange(progress, from.progress, to.progress);
  target.set(
    MathUtils.lerp(from[key][0], to[key][0], local),
    MathUtils.lerp(from[key][1], to[key][1], local),
    MathUtils.lerp(from[key][2], to[key][2], local)
  );
  return MathUtils.lerp(from.fov, to.fov, local);
}

function JourneyDirector({ profile, quality, children }: { profile: SpatialViewportProfile; quality: SpatialQualityTier; children: ReactNode }) {
  const { camera, pointer } = useThree();
  const targetProgress = useRef(0);
  const currentProgress = useRef(0);
  const nextPosition = useRef(new Vector3());
  const nextTarget = useRef(new Vector3());
  const reducedMotion = quality === "reduced_motion";

  useEffect(() => {
    const update = () => {
      const journey = document.querySelector<HTMLElement>("[data-biological-journey]");
      if (!journey) return;
      const bounds = journey.getBoundingClientRect();
      const intelligenceStage = journey.querySelector<HTMLElement>('[data-bi-stage="intelligence-layer"]');
      const intelligenceBounds = intelligenceStage?.getBoundingClientRect();
      const travel = Math.max(
        1,
        intelligenceBounds ? intelligenceBounds.bottom - bounds.top : journey.offsetHeight - window.innerHeight
      );
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

    if (reducedMotion) {
      nextPosition.current.set(3.8, 1.8, 14);
      nextTarget.current.set(0, 0, -7);
      const fov = applySpatialCameraFraming(nextPosition.current, nextTarget.current, 40, profile);
      camera.position.copy(nextPosition.current);
      camera.lookAt(nextTarget.current);
      if ("fov" in camera) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      return;
    }

    const sampledFov = sampleJourney(currentProgress.current, "position", nextPosition.current);
    sampleJourney(currentProgress.current, "target", nextTarget.current);
    if (quality === "full") {
      nextPosition.current.x += pointer.x * 0.24;
      nextPosition.current.y += pointer.y * 0.14;
    }
    const fov = applySpatialCameraFraming(nextPosition.current, nextTarget.current, sampledFov, profile);
    camera.position.copy(nextPosition.current);
    camera.lookAt(nextTarget.current);
    if ("fov" in camera) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });

  return <JourneyContext.Provider value={{ progress: currentProgress }}>{children}</JourneyContext.Provider>;
}

function FrameScheduler({ quality }: { quality: SpatialQualityTier }) {
  const { invalidate } = useThree();

  useEffect(() => {
    const delay = quality === "full" ? 34 : quality === "balanced" ? 60 : quality === "light" ? 92 : 180;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "hidden") invalidate();
    }, delay);
    return () => window.clearInterval(interval);
  }, [invalidate, quality]);

  return null;
}

function GenomicStage({ quality, reducedMotion = false }: { quality: SpatialQualityTier; reducedMotion?: boolean }) {
  const { progress } = useJourneyState();
  return (
    <>
      <DnaDoubleHelix progress={progress} quality={quality} reducedMotion={reducedMotion} />
      {reducedMotion ? null : <SelectedVariant progress={progress} />}
    </>
  );
}

function ProteinStage({ reducedMotion = false, compact = false }: { reducedMotion?: boolean; compact?: boolean }) {
  const { progress } = useJourneyState();
  const group = useRef<Group>(null);

  useFrame(() => {
    if (!group.current) return;
    if (reducedMotion) {
      group.current.scale.setScalar(1);
      return;
    }
    const reveal = smoothRange(progress.current, 0.27, 0.48);
    group.current.scale.setScalar(0.04 + reveal * 1.02);
    group.current.position.x = (1 - reveal) * 2.2;
  });

  return (
    <group ref={group} scale={compact ? 0.7 : 0.04}>
      <ProteinTarget position={compact ? [4.8, -1, -10] : [0, 0, -41]} scale={compact ? 0.7 : 1.08} progress={progress} reducedMotion={reducedMotion} />
    </group>
  );
}

function FullBiologicalWorld({ quality }: { quality: SpatialQualityTier }) {
  const { progress } = useJourneyState();
  return (
    <>
      <GenomicStage quality={quality} />
      <RegulatoryLandscape progress={progress} />
      <SequenceToProteinBridge progress={progress} quality={quality} />
      <ProteinStage />
      <CellularEnvironment progress={progress} quality={quality} />
      <PathwaySystem progress={progress} quality={quality} />
      <BiologicalScaleContinuity progress={progress} />
      <IntelligenceConvergence progress={progress} quality={quality} />
    </>
  );
}

function ReducedBiologicalWorld({ quality }: { quality: SpatialQualityTier }) {
  const { progress } = useJourneyState();
  return (
    <>
      <GenomicStage quality={quality} reducedMotion />
      <ProteinStage reducedMotion compact />
      <PathwaySystem progress={progress} quality={quality} position={[-5.5, -1.3, -10]} />
    </>
  );
}

function BiologicalWorld({ quality }: { quality: SpatialQualityTier }) {
  const reducedMotion = quality === "reduced_motion";
  const balancedOrFull = quality === "full" || quality === "balanced";
  return (
    <>
      <color attach="background" args={[new Color("#020507")]} />
      <fog attach="fog" args={["#020507", 15, 72]} />
      <ambientLight intensity={0.08} color="#8b9a9b" />
      <hemisphereLight intensity={0.34} color="#d8e1df" groundColor="#010203" />
      <directionalLight
        position={[-8, 12, 14]}
        intensity={2.75}
        color="#f2f1e9"
        castShadow={quality === "full"}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0002}
      />
      {balancedOrFull ? <directionalLight position={[9, -1, -43]} intensity={0.72} color="#7899a0" /> : null}
      {balancedOrFull ? <spotLight position={[7, 8, 5]} intensity={28} angle={0.48} penumbra={0.92} distance={58} decay={2} color="#a8c4c5" /> : null}
      <pointLight position={[-6, 1, -25]} intensity={7} distance={22} decay={2} color="#738d9a" />
      {balancedOrFull ? <pointLight position={[6, -1, -55]} intensity={8} distance={25} decay={2} color="#94aaa3" /> : null}
      <pointLight position={[-5, 1, -75]} intensity={6} distance={23} decay={2} color="#b09b87" />
      {reducedMotion ? <ReducedBiologicalWorld quality={quality} /> : <FullBiologicalWorld quality={quality} />}
    </>
  );
}

function ScientificFallback({ reason }: { reason: string }) {
  return (
    <div className={styles.spatialFallback} data-biological-fallback={reason} aria-hidden="true">
      <div className={styles.fallbackHelix}>
        {Array.from({ length: 12 }, (_, index) => (
          <span key={index} style={{ "--helix-index": index } as CSSProperties} />
        ))}
      </div>
      <div className={styles.fallbackNetwork}>
        {Array.from({ length: 8 }, (_, index) => (
          <i key={index} style={{ "--node-index": index } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}

export default function BiologicalSpatialCanvas() {
  const capability = useSpatialCapability();
  const [pixelProbe, setPixelProbe] = useState<CanvasPixelProbeResult>("pending");
  const [renderFailed, setRenderFailed] = useState(false);
  const handleRenderFailure = useCallback(() => setRenderFailed(true), []);

  if (!capability.ready) return null;
  if (renderFailed || !capability.available || !capability.quality) {
    return <ScientificFallback reason={capability.reason || "unavailable"} />;
  }

  const quality = capability.quality;
  const dpr: [number, number] = quality === "full"
    ? [1, 1.35]
    : quality === "balanced"
      ? [0.8, 1.02]
      : quality === "light"
        ? [0.62, 0.8]
        : [0.68, 0.86];
  const fallback = <ScientificFallback reason="rendering_failure" />;

  return (
    <PublicSpatialErrorBoundary fallback={fallback} onFailure={handleRenderFailure}>
      <div
        className={styles.spatialCanvas}
        data-biological-canvas
        data-spatial-webgl
        data-spatial-quality={quality}
        data-spatial-profile={capability.profile}
        data-canvas-pixels={pixelProbe}
        aria-hidden="true"
      >
        <Canvas
          camera={{ position: [3.8, 1.8, 14], fov: 40, near: 0.1, far: 180 }}
          dpr={dpr}
          frameloop="demand"
          shadows={quality === "full" ? "percentage" : false}
          gl={{ antialias: quality === "full", alpha: false, powerPreference: "high-performance" }}
          resize={{ polyfill: SpatialResizeObserver }}
          onCreated={(state) => {
            state.gl.toneMapping = ACESFilmicToneMapping;
            state.gl.toneMappingExposure = 0.9;
            state.gl.outputColorSpace = SRGBColorSpace;
            probeRenderedCanvas(state, setPixelProbe);
          }}
        >
          <PublicSpatialContextGuard onFailure={handleRenderFailure} />
          <JourneyDirector profile={capability.profile} quality={quality}>
            <BiologicalWorld quality={quality} />
          </JourneyDirector>
          <FrameScheduler quality={quality} />
        </Canvas>
      </div>
    </PublicSpatialErrorBoundary>
  );
}

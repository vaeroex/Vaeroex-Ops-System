"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ACESFilmicToneMapping,
  MathUtils,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
} from "three";
import { PublicSpatialContextGuard } from "@/components/spatial/PublicSpatialCanvasGuard";
import { probeRenderedCanvas } from "@/components/spatial/CanvasPixelProbe";
import { SpatialResizeObserver } from "@/components/spatial/SpatialResizeObserver";
import {
  ClarityEngineWorld,
  type ClarityWorldController,
} from "./ClarityEngineWorld";
import {
  evaluateClarityMotion,
  normalizeClarityProgress,
  type ClarityVariant,
} from "./clarityMotion";
import styles from "./ClarityEngine.module.css";

type EngineCanvasProps = {
  active: boolean;
  progress: number;
  compact: boolean;
  variant: ClarityVariant;
  onReady: () => void;
  onFailure: () => void;
};

function DirectedStructure({
  active,
  progress,
  compact,
  variant,
  proofRef,
}: Pick<EngineCanvasProps, "active" | "progress" | "compact" | "variant"> & {
  proofRef: RefObject<HTMLDivElement | null>;
}) {
  const world = useRef<ClarityWorldController>(null);
  const { camera, gl, invalidate, size } = useThree();
  const desiredPointer = useRef({ x: 0, y: 0 });
  const current = useRef({
    x: 0,
    y: 0,
    progress: normalizeClarityProgress(progress),
    painted: false,
  });
  const requested = normalizeClarityProgress(progress);
  const layoutDirty = useRef(true);

  useEffect(() => {
    layoutDirty.current = true;
    invalidate();
  }, [compact, variant, size.width, size.height, invalidate]);

  useEffect(() => {
    if (active || !current.current.painted) invalidate();
  }, [
    active,
    requested,
    variant,
    compact,
    size.width,
    size.height,
    invalidate,
  ]);

  useEffect(() => {
    if (!active || compact) return;
    const updatePointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const bounds = gl.domElement.getBoundingClientRect();
      const inside =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;
      const x = inside
        ? ((event.clientX - bounds.left) / bounds.width - 0.5) * 2
        : 0;
      const y = inside
        ? ((event.clientY - bounds.top) / bounds.height - 0.5) * 2
        : 0;
      if (x === desiredPointer.current.x && y === desiredPointer.current.y)
        return;
      desiredPointer.current = { x, y };
      invalidate();
    };
    const resetPointer = () => {
      desiredPointer.current = { x: 0, y: 0 };
      invalidate();
    };
    window.addEventListener("pointermove", updatePointer, { passive: true });
    window.addEventListener("blur", resetPointer);
    document.documentElement.addEventListener("pointerleave", resetPointer);
    return () => {
      window.removeEventListener("pointermove", updatePointer);
      window.removeEventListener("blur", resetPointer);
      document.documentElement.removeEventListener(
        "pointerleave",
        resetPointer,
      );
    };
  }, [active, compact, gl, invalidate]);

  useFrame((_, delta) => {
    const next = current.current;
    if ((!active && next.painted && !layoutDirty.current) || !world.current)
      return;
    const elapsed = Math.min(delta, 0.05);
    if (active) {
      next.x = MathUtils.damp(
        next.x,
        compact ? 0 : desiredPointer.current.x,
        5,
        elapsed,
      );
      next.y = MathUtils.damp(
        next.y,
        compact ? 0 : desiredPointer.current.y,
        5,
        elapsed,
      );
      next.progress =
        Math.abs(next.progress - requested) < 0.0003
          ? requested
          : MathUtils.damp(next.progress, requested, 10, elapsed);
    }
    // A paused resize re-frames the frozen pose once; it never advances the story.
    if (compact) {
      next.x = 0;
      next.y = 0;
    }
    const state = evaluateClarityMotion(next.progress, variant, compact);
    camera.position.set(
      state.camera[0] + next.x * 0.15,
      state.camera[1] - next.y * 0.1,
      state.camera[2],
    );
    camera.lookAt(...state.target);
    if (camera instanceof PerspectiveCamera) {
      // Portrait stages get more breathing room without changing the four-act trajectory.
      const framing =
        Math.max(0, 1.06 - size.width / Math.max(1, size.height)) * 20;
      const fov = Math.min(62, state.fov + framing);
      if (Math.abs(camera.fov - fov) > 0.001) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    }
    world.current.apply(state);
    next.painted = true;
    layoutDirty.current = false;
    const proof = proofRef.current;
    if (proof) {
      proof.dataset.clarityProgress = state.progress.toFixed(4);
      proof.dataset.clarityStage = String(state.stage);
      proof.dataset.clarityCamera = camera.position
        .toArray()
        .map((value) => value.toFixed(3))
        .join(",");
      proof.dataset.clarityTarget = state.target
        .map((value) => value.toFixed(3))
        .join(",");
      proof.dataset.clarityCoreReveal = state.core.reveal.toFixed(3);
      proof.dataset.clarityPose = JSON.stringify({
        rotation: state.structure.rotation,
        firstLayer: state.layers[0].position,
        lastLayer: state.layers[state.layers.length - 1].position,
        fragment: state.fragments[0].position,
        core: state.core.position,
      });
    }
    // Scroll is the only narrative clock. The renderer sleeps once smoothing settles.
    const unsettled =
      Math.abs(next.progress - requested) +
        Math.abs(next.x - (compact ? 0 : desiredPointer.current.x)) +
        Math.abs(next.y - (compact ? 0 : desiredPointer.current.y)) >
      0.0004;
    if (active && unsettled) invalidate();
  });

  return <ClarityEngineWorld controllerRef={world} compact={compact} />;
}

export default function ClarityEngineCanvas({
  active,
  progress,
  compact,
  variant,
  onReady,
  onFailure,
}: EngineCanvasProps) {
  const proof = useRef<HTMLDivElement>(null);
  const [initial] = useState(() =>
    evaluateClarityMotion(progress, variant, compact),
  );
  const cameraSettings = useRef({
    position: [...initial.camera] as [number, number, number],
    fov: initial.fov,
    near: 0.1,
    far: 90,
  });
  return (
    <div
      ref={proof}
      className={styles.canvas}
      data-clarity-canvas
      data-spatial-webgl
      data-clarity-variant={variant}
      data-clarity-quality={compact ? "compact" : "full"}
      data-clarity-requested-progress={normalizeClarityProgress(
        progress,
      ).toFixed(4)}
      aria-hidden="true"
    >
      <Canvas
        camera={cameraSettings.current}
        dpr={compact ? 1 : [1, 1.5]}
        frameloop="demand"
        shadows={compact ? false : { type: PCFShadowMap }}
        gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
        resize={{ polyfill: SpatialResizeObserver }}
        onCreated={(state) => {
          state.gl.toneMapping = ACESFilmicToneMapping;
          state.gl.toneMappingExposure = 1.08;
          state.gl.outputColorSpace = SRGBColorSpace;
          state.gl.setClearColor("#08090b", 0);
          probeRenderedCanvas(state, (result) =>
            result === "nonblank" ? onReady() : onFailure(),
          );
        }}
      >
        <PublicSpatialContextGuard onFailure={onFailure} />
        <DirectedStructure
          active={active}
          progress={progress}
          compact={compact}
          variant={variant}
          proofRef={proof}
        />
      </Canvas>
    </div>
  );
}

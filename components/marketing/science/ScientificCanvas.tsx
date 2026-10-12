"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef, type RefObject } from "react";
import { ACESFilmicToneMapping, MathUtils, SRGBColorSpace } from "three";
import { PublicSpatialContextGuard } from "@/components/spatial/PublicSpatialCanvasGuard";
import { probeRenderedCanvas } from "@/components/spatial/CanvasPixelProbe";
import { SpatialResizeObserver } from "@/components/spatial/SpatialResizeObserver";
import { DrugDiscoveryWorld } from "./DrugDiscoveryWorld";
import { BiologicalWorld } from "./BiologicalWorld";
import type { ScienceKind } from "./scienceTypes";
import styles from "../clarity/ClarityEngine.module.css";

type Props = {
  active: boolean;
  progress: number;
  compact: boolean;
  variant: ScienceKind;
  onReady: () => void;
  onFailure: () => void;
};

function ScientificSequence({
  active,
  progress,
  compact,
  variant,
  onReady,
  onFailure,
  proof,
}: { proof: RefObject<HTMLDivElement | null> } & Props) {
  const current = useRef(progress);
  const painted = useRef(false);
  const frames = useRef(0);
  const state = useThree();
  const { invalidate, size, camera, gl } = state;
  useEffect(() => {
    invalidate();
  }, [active, progress, compact, variant, size.width, size.height, invalidate]);
  useEffect(() => {
    return probeRenderedCanvas(state, (result) =>
      result === "nonblank" ? onReady() : onFailure(),
    );
  }, [state, onReady, onFailure]);
  useFrame((_, delta) => {
    if (active || !painted.current) {
      current.current =
        Math.abs(current.current - progress) < 0.0002
          ? progress
          : MathUtils.damp(current.current, progress, 9, Math.min(0.05, delta));
      painted.current = true;
      if (active && Math.abs(current.current - progress) > 0.0001) invalidate();
    }
    if (proof.current) {
      proof.current.dataset.scienceProgress = current.current.toFixed(4);
      proof.current.dataset.scienceStage = String(
        Math.min(4, Math.round(current.current * 4)),
      );
    }
  }, -1);
  useFrame(() => {
    if (proof.current) {
      proof.current.dataset.scienceFrames = String(++frames.current);
      proof.current.dataset.scienceCamera = camera.position
        .toArray()
        .map((v) => v.toFixed(3))
        .join(",");
      proof.current.dataset.scienceDrawCalls = String(gl.info.render.calls);
      proof.current.dataset.scienceTriangles = String(gl.info.render.triangles);
    }
  });
  return variant === "drug-discovery" ? (
    <DrugDiscoveryWorld progress={current} compact={compact} />
  ) : (
    <BiologicalWorld progress={current} compact={compact} />
  );
}

export default function ScientificCanvas(props: Props) {
  const proof = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={proof}
      className={styles.canvas}
      data-clarity-canvas
      data-science-canvas={props.variant}
      data-spatial-webgl
      data-clarity-quality={props.compact ? "compact" : "full"}
      aria-hidden="true"
    >
      <Canvas
        camera={{ position: [0, 0, 24], fov: 43, near: 0.05, far: 160 }}
        dpr={props.compact ? 1 : [1, 1.5]}
        frameloop="demand"
        gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
        resize={{ polyfill: SpatialResizeObserver }}
        onCreated={({ gl }) => {
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.12;
          gl.outputColorSpace = SRGBColorSpace;
          gl.setClearColor("#08090b", 0);
          gl.localClippingEnabled = true;
        }}
      >
        <PublicSpatialContextGuard onFailure={props.onFailure} />
        <Suspense fallback={null}>
          <ScientificSequence {...props} proof={proof} />
        </Suspense>
      </Canvas>
    </div>
  );
}

"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, lazy, useEffect, useRef, type RefObject } from "react";
import { ACESFilmicToneMapping, MathUtils, SRGBColorSpace } from "three";
import { PublicSpatialContextGuard } from "@/components/spatial/PublicSpatialCanvasGuard";
import { probeRenderedCanvas } from "@/components/spatial/CanvasPixelProbe";
import { SpatialResizeObserver } from "@/components/spatial/SpatialResizeObserver";
const LandingWorld = lazy(() =>
  import("./LandingWorld").then((module) => ({ default: module.LandingWorld })),
);
const ExecutiveWorld = lazy(() =>
  import("./ExecutiveWorld").then((module) => ({
    default: module.ExecutiveWorld,
  })),
);
import type { SignatureKind } from "./signatureTypes";
import styles from "../clarity/ClarityEngine.module.css";

type Props = {
  active: boolean;
  progress: number;
  compact: boolean;
  variant: SignatureKind;
  onReady: () => void;
  onFailure: () => void;
};

function SignatureSequence({
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
      proof.current.dataset.signatureProgress = current.current.toFixed(4);
      proof.current.dataset.signatureStage = String(
        Math.min(4, Math.round(current.current * 4)),
      );
    }
  }, -1);
  useFrame(() => {
    if (proof.current) {
      proof.current.dataset.signatureFrames = String(++frames.current);
      proof.current.dataset.signatureCamera = camera.position
        .toArray()
        .map((v) => v.toFixed(3))
        .join(",");
      proof.current.dataset.signatureDrawCalls = String(gl.info.render.calls);
      proof.current.dataset.signatureTriangles = String(
        gl.info.render.triangles,
      );
    }
  });
  return variant === "landing" ? (
    <LandingWorld progress={current} compact={compact} />
  ) : (
    <ExecutiveWorld progress={current} compact={compact} />
  );
}

export default function SignatureCanvas(props: Props) {
  const proof = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={proof}
      className={styles.canvas}
      data-clarity-canvas
      data-signature-canvas={props.variant}
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
          <SignatureSequence {...props} proof={proof} />
        </Suspense>
      </Canvas>
    </div>
  );
}

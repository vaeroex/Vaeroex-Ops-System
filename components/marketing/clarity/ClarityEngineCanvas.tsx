"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import {
  ACESFilmicToneMapping,
  Group,
  MathUtils,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Vector3,
} from "three";
import { PublicSpatialContextGuard } from "@/components/spatial/PublicSpatialCanvasGuard";
import { probeRenderedCanvas } from "@/components/spatial/CanvasPixelProbe";
import { SpatialResizeObserver } from "@/components/spatial/SpatialResizeObserver";
import { ClarityEngineWorld } from "./ClarityEngineWorld";
import styles from "./ClarityEngine.module.css";

type EngineCanvasProps = {
  active: boolean;
  onReady: () => void;
  onFailure: () => void;
};
const BASE_CAMERA = new Vector3(4.3, 2.5, 9);
const LOOK_AT = new Vector3(-0.18, -0.22, 0);

function DirectedStructure({ active }: { active: boolean }) {
  const sculpture = useRef<Group>(null);
  const { camera, gl, invalidate, size } = useThree();
  const desired = useRef({ x: 0, y: 0, scroll: 0 });
  const current = useRef({ x: 0, y: 0, scroll: 0, entry: 0 });

  useEffect(() => {
    camera.position.copy(BASE_CAMERA);
    camera.lookAt(LOOK_AT);
    invalidate();
  }, [camera, invalidate]);

  useEffect(() => {
    if (camera instanceof PerspectiveCamera) {
      camera.fov = Math.min(
        46,
        38 + Math.max(0, 1.2 - size.width / Math.max(1, size.height)) * 12,
      );
      camera.updateProjectionMatrix();
      invalidate();
    }
  }, [camera, invalidate, size.width, size.height]);

  useEffect(() => {
    if (!active) return;
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
      if (x === desired.current.x && y === desired.current.y) return;
      desired.current.x = x;
      desired.current.y = y;
      invalidate();
    };
    const updateScroll = () => {
      const bounds = gl.domElement.getBoundingClientRect();
      desired.current.scroll = MathUtils.clamp(
        -bounds.top / Math.max(1, bounds.height),
        0,
        1,
      );
      invalidate();
    };
    const resetPointer = () => {
      desired.current.x = 0;
      desired.current.y = 0;
      invalidate();
    };
    updateScroll();
    window.addEventListener("pointermove", updatePointer, { passive: true });
    window.addEventListener("scroll", updateScroll, { passive: true });
    window.addEventListener("blur", resetPointer);
    document.documentElement.addEventListener("pointerleave", resetPointer);
    return () => {
      window.removeEventListener("pointermove", updatePointer);
      window.removeEventListener("scroll", updateScroll);
      window.removeEventListener("blur", resetPointer);
      document.documentElement.removeEventListener(
        "pointerleave",
        resetPointer,
      );
    };
  }, [active, gl, invalidate]);

  useFrame((_, delta) => {
    if (!active || !sculpture.current) return;
    const elapsed = Math.min(delta, 0.05);
    const next = current.current;
    const target = desired.current;
    next.x = MathUtils.damp(next.x, target.x, 4.2, elapsed);
    next.y = MathUtils.damp(next.y, target.y, 4.2, elapsed);
    next.scroll = MathUtils.damp(next.scroll, target.scroll, 4.2, elapsed);
    next.entry = MathUtils.damp(next.entry, 1, 3.4, elapsed);
    camera.position.set(
      BASE_CAMERA.x + next.x * 0.24 - next.scroll * 0.28,
      BASE_CAMERA.y - next.y * 0.15 + next.scroll * 0.22,
      BASE_CAMERA.z + next.scroll * 0.12,
    );
    camera.lookAt(LOOK_AT);
    sculpture.current.rotation.z = -0.15 + next.scroll * 0.035;
    const fragments = sculpture.current.getObjectByName("clarity-fragments");
    if (fragments) {
      fragments.position.x = -(1 - next.entry) * 0.32 + next.scroll * 0.27;
      fragments.position.z = (1 - next.entry) * 0.24 - next.scroll * 0.08;
    }
    // The renderer sleeps completely once this short transition has settled.
    const unsettled =
      Math.abs(next.x - target.x) +
        Math.abs(next.y - target.y) +
        Math.abs(next.scroll - target.scroll) +
        (1 - next.entry) >
      0.001;
    if (unsettled) invalidate();
  });

  return <ClarityEngineWorld motion={sculpture} />;
}

export default function ClarityEngineCanvas({
  active,
  onReady,
  onFailure,
}: EngineCanvasProps) {
  return (
    <div
      className={styles.canvas}
      data-clarity-canvas
      data-spatial-webgl
      aria-hidden="true"
    >
      <Canvas
        camera={{ position: [4.3, 2.5, 9], fov: 38, near: 0.1, far: 60 }}
        dpr={[1, 1.5]}
        frameloop="demand"
        shadows={{ type: PCFShadowMap }}
        gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
        resize={{ polyfill: SpatialResizeObserver }}
        onCreated={(state) => {
          state.gl.toneMapping = ACESFilmicToneMapping;
          state.gl.toneMappingExposure = 1.08;
          state.gl.outputColorSpace = SRGBColorSpace;
          state.gl.setClearColor("#090b10", 0);
          probeRenderedCanvas(state, (result) =>
            result === "nonblank" ? onReady() : onFailure(),
          );
        }}
      >
        <PublicSpatialContextGuard onFailure={onFailure} />
        <DirectedStructure active={active} />
      </Canvas>
    </div>
  );
}

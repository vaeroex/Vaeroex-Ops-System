"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, type ComponentRef } from "react";
import { MathUtils, Vector3 } from "three";

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;

export type SpatialCameraHandle = Readonly<{
  dollyIn: () => void;
  dollyOut: () => void;
}>;

type SpatialCameraBounds = Readonly<{
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  minAzimuthAngle: number;
  maxAzimuthAngle: number;
  targetX: readonly [number, number];
  targetY: readonly [number, number];
}>;

export const BoundedSpatialCamera = forwardRef<SpatialCameraHandle, {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  resetKey: number;
  bounds: SpatialCameraBounds;
  enablePan?: boolean;
}>(({ position, target, resetKey, bounds, enablePan = false }, ref) => {
  const { camera, invalidate } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const moving = useRef(true);
  const desiredPosition = useMemo(() => new Vector3(...position), [position]);
  const desiredTarget = useMemo(() => new Vector3(...target), [target]);

  useEffect(() => {
    moving.current = true;
    invalidate();
  }, [desiredPosition, desiredTarget, invalidate, resetKey]);

  useImperativeHandle(ref, () => ({
    dollyIn() {
      const controls = controlsRef.current;
      if (!controls) return;
      const direction = camera.position.clone().sub(controls.target).normalize();
      const distance = MathUtils.clamp(camera.position.distanceTo(controls.target) - 1.1, bounds.minDistance, bounds.maxDistance);
      camera.position.copy(controls.target).addScaledVector(direction, distance);
      controls.update();
      invalidate();
    },
    dollyOut() {
      const controls = controlsRef.current;
      if (!controls) return;
      const direction = camera.position.clone().sub(controls.target).normalize();
      const distance = MathUtils.clamp(camera.position.distanceTo(controls.target) + 1.1, bounds.minDistance, bounds.maxDistance);
      camera.position.copy(controls.target).addScaledVector(direction, distance);
      controls.update();
      invalidate();
    }
  }), [bounds.maxDistance, bounds.minDistance, camera.position, invalidate]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls || !moving.current) return;
    camera.position.lerp(desiredPosition, 0.085);
    controls.target.lerp(desiredTarget, 0.1);
    controls.update();
    const distance = camera.position.distanceTo(desiredPosition) + controls.target.distanceTo(desiredTarget);
    moving.current = distance > 0.018;
    if (moving.current) invalidate();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.075}
      enablePan={enablePan}
      maxAzimuthAngle={bounds.maxAzimuthAngle}
      maxDistance={bounds.maxDistance}
      maxPolarAngle={bounds.maxPolarAngle}
      minAzimuthAngle={bounds.minAzimuthAngle}
      minDistance={bounds.minDistance}
      minPolarAngle={bounds.minPolarAngle}
      onChange={() => {
        const controls = controlsRef.current;
        if (!controls || moving.current) return;
        controls.target.x = MathUtils.clamp(controls.target.x, bounds.targetX[0], bounds.targetX[1]);
        controls.target.y = MathUtils.clamp(controls.target.y, bounds.targetY[0], bounds.targetY[1]);
        controls.target.z = MathUtils.clamp(controls.target.z, -1.5, 1.5);
        invalidate();
      }}
      onStart={() => {
        moving.current = false;
      }}
    />
  );
});

BoundedSpatialCamera.displayName = "BoundedSpatialCamera";

export function SpatialCameraControls({
  onReset,
  onZoomIn,
  onZoomOut,
  className = ""
}: {
  onReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  className?: string;
}) {
  return (
    <div className={`vaeroex-spatial-camera-controls ${className}`.trim()} role="group" aria-label="Spatial camera controls" data-spatial-camera-controls>
      <button type="button" title="Zoom in" aria-label="Zoom in" onClick={onZoomIn}>
        <ZoomIn aria-hidden="true" className="h-4 w-4" />
      </button>
      <button type="button" title="Zoom out" aria-label="Zoom out" onClick={onZoomOut}>
        <ZoomOut aria-hidden="true" className="h-4 w-4" />
      </button>
      <button type="button" title="Reset view" aria-label="Reset view" onClick={onReset}>
        <RotateCcw aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}

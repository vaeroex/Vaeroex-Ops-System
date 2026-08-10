"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type MutableRefObject } from "react";
import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import type { ActiveSpatialWorkspaceDestination } from "@/components/spatial/spatial-destinations";
import { spatialDestinationDefinition } from "@/components/spatial/spatial-destinations";
import type { SpatialQualityTier } from "@/components/spatial/useSpatialCapability";

type CameraTransition = {
  fromPosition: Vector3;
  fromTarget: Vector3;
  controlPosition: Vector3;
  controlTarget: Vector3;
  toPosition: Vector3;
  toTarget: Vector3;
  fromFov: number;
  toFov: number;
  startedAt: number;
  duration: number;
  bankDirection: number;
  active: boolean;
};

export type WorkspaceTravelState = {
  active: boolean;
  progress: number;
  intensity: number;
  direction: number;
};

function smootherStep(value: number) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function quadraticBezier(out: Vector3, start: Vector3, control: Vector3, end: Vector3, progress: number) {
  const inverse = 1 - progress;
  return out
    .copy(start)
    .multiplyScalar(inverse * inverse)
    .addScaledVector(control, 2 * inverse * progress)
    .addScaledVector(end, progress * progress);
}

export function GuidedWorkspaceCamera({
  destination,
  quality,
  transitionMs,
  travelState
}: {
  destination: ActiveSpatialWorkspaceDestination;
  quality: SpatialQualityTier;
  transitionMs: number;
  travelState: MutableRefObject<WorkspaceTravelState>;
}) {
  const { camera, invalidate } = useThree();
  const target = useRef(new Vector3());
  const transition = useRef<CameraTransition | null>(null);
  const nextPosition = useRef(new Vector3());
  const nextTarget = useRef(new Vector3());

  useEffect(() => {
    const definition = spatialDestinationDefinition(destination);
    if (quality === "reduced_motion") {
      camera.position.set(...definition.camera.position);
      target.current.set(...definition.camera.target);
      if (camera instanceof PerspectiveCamera) {
        camera.fov = definition.camera.fov;
        camera.updateProjectionMatrix();
      }
      camera.lookAt(target.current);
      camera.updateMatrixWorld();
      transition.current = null;
      travelState.current = { active: false, progress: 1, intensity: 0, direction: 0 };
      invalidate();
      return;
    }

    const fromPosition = camera.position.clone();
    const fromTarget = target.current.clone();
    const toPosition = new Vector3(...definition.camera.position);
    const toTarget = new Vector3(...definition.camera.target);
    const direction = toPosition.clone().sub(fromPosition);
    const lateral = new Vector3(-direction.z, 0, direction.x);
    if (lateral.lengthSq() > 0.0001) lateral.normalize();
    const controlPosition = fromPosition
      .clone()
      .lerp(toPosition, 0.5)
      .addScaledVector(lateral, definition.camera.lateralBias)
      .add(new Vector3(0, definition.camera.arcHeight, 0));
    const controlTarget = fromTarget
      .clone()
      .lerp(toTarget, 0.5)
      .addScaledVector(lateral, definition.camera.lateralBias * 0.24)
      .add(new Vector3(0, definition.camera.arcHeight * 0.18, 0));

    transition.current = {
      fromPosition,
      fromTarget,
      controlPosition,
      controlTarget,
      toPosition,
      toTarget,
      fromFov: camera instanceof PerspectiveCamera ? camera.fov : definition.camera.fov,
      toFov: definition.camera.fov,
      startedAt: performance.now(),
      duration: transitionMs,
      bankDirection: Math.sign(direction.x || direction.z || 1),
      active: true
    };
    travelState.current = { active: true, progress: 0, intensity: 0, direction: Math.sign(direction.x || direction.z || 1) };
    invalidate();
  }, [camera, destination, invalidate, quality, transitionMs, travelState]);

  useFrame(() => {
    const current = transition.current;
    if (!current?.active) return;
    const progress = MathUtils.clamp((performance.now() - current.startedAt) / current.duration, 0, 1);
    const eased = smootherStep(progress);
    quadraticBezier(nextPosition.current, current.fromPosition, current.controlPosition, current.toPosition, eased);
    quadraticBezier(nextTarget.current, current.fromTarget, current.controlTarget, current.toTarget, eased);
    camera.position.copy(nextPosition.current);
    target.current.copy(nextTarget.current);
    if (camera instanceof PerspectiveCamera) {
      const travelWidening = Math.sin(Math.PI * eased) * 5.2;
      camera.fov = MathUtils.lerp(current.fromFov, current.toFov, eased) + travelWidening;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(target.current);
    camera.rotateZ(current.bankDirection * Math.sin(Math.PI * eased) * MathUtils.degToRad(1.65));
    camera.updateMatrixWorld();
    current.active = progress < 1;
    travelState.current = {
      active: current.active,
      progress,
      intensity: current.active ? Math.sin(Math.PI * eased) : 0,
      direction: current.bankDirection
    };
    if (current.active) invalidate();
  });

  return null;
}

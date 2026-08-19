import { MathUtils, Vector3 } from "three";
import type { SpatialViewportProfile } from "@/components/spatial/useSpatialCapability";

const FRAMING = {
  wide: { distance: 1, lateral: 1, vertical: 1, fov: 0 },
  tablet_landscape: { distance: 1.04, lateral: 0.9, vertical: 0.96, fov: 2 },
  tablet_portrait: { distance: 1.13, lateral: 0.72, vertical: 0.92, fov: 5 },
  phone: { distance: 1.2, lateral: 0.54, vertical: 0.88, fov: 8 }
} as const satisfies Record<SpatialViewportProfile, Readonly<{
  distance: number;
  lateral: number;
  vertical: number;
  fov: number;
}>>;

export function applySpatialCameraFraming(
  position: Vector3,
  target: Vector3,
  fov: number,
  profile: SpatialViewportProfile
) {
  if (profile === "wide") return fov;

  const framing = FRAMING[profile];
  const x = (position.x - target.x) * framing.lateral * framing.distance;
  const y = (position.y - target.y) * framing.vertical * framing.distance;
  const z = (position.z - target.z) * framing.distance;
  position.set(target.x + x, target.y + y, target.z + z);
  return MathUtils.clamp(fov + framing.fov, 32, 60);
}

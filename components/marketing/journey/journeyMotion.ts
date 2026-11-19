import { logoBounds, logoPieces, logoToWorld } from "./logoOutline";

export type JourneyPoint = [number, number, number];
export type SculpturePart = {
  id: string; role: "logo"; geometry: string; material: number;
  position: JourneyPoint; rotation: JourneyPoint; motion: number;
};
export type SculpturePose = { position: JourneyPoint; rotation: JourneyPoint; size: JourneyPoint };
export const journeyClamp = (value: number) => Number.isNaN(value) ? 0 : Math.max(0, Math.min(1, value));
const ease = (from: number, to: number, value: number) => {
  const t = journeyClamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

// All six solids are partitions of the existing mark. Nothing is added behind,
// between, or around them: the passages are the space left by the separated logo.
export const sculptureShapes = Object.fromEntries(logoPieces.map(piece => {
  const points = piece.points.map(logoToWorld);
  const min = [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1]))];
  const max = [Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  return [piece.id, {
    outline: points.map(p => [p[0] - center[0], p[1] - center[1]] as [number, number]),
    center: [center[0], center[1], 0] as JourneyPoint,
    size: [max[0] - min[0], max[1] - min[1], 3.2] as JourneyPoint,
    bevel: .10,
  }];
}));
export const sculptureEnvelope = { min: [-24, -logoBounds.worldHeight / 2, -1.6] as JourneyPoint, max: [24, logoBounds.worldHeight / 2, 1.6] as JourneyPoint };
export const sculpturePassages = {
  entry: { progress: .28, center: [-3, 3, 8] as JourneyPoint, normal: [0, 0, 1] as JourneyPoint },
  exit: { progress: .57, center: [3, 8, -64] as JourneyPoint, normal: [0, 0, 1] as JourneyPoint },
};
export function journeyAssembly(progress: number) {
  const p = journeyClamp(progress);
  return {
    opening: ease(.04, .24, p) * (1 - ease(.75, .93, p)),
    alignment: ease(.26, .42, p),
    docking: ease(.45, .59, p),
    unfolding: ease(.55, .70, p) * (1 - ease(.75, .93, p)),
    closure: ease(.75, .93, p),
  };
}
export function createJourneyWorld(compact = false) {
  return { quality: compact ? "compact" : "full", parts: logoPieces.map((piece, index): SculpturePart => ({
    id: piece.id, role: "logo", geometry: piece.id, material: index === 5 ? 1 : 0,
    position: [...sculptureShapes[piece.id].center], rotation: [0, 0, 0], motion: index,
  })) };
}
const separation: JourneyPoint[] = [
  [-4, 3, 1], [-7, 0, -14], [7, 9, -28], [3, 4, -43], [-14, 13, -22], [-5, 8, -55],
];
const turns = [-.22, .23, -.30, .26, -.42, .35];
export function journeyPart(part: SculpturePart, progress: number): SculpturePose {
  const state = journeyAssembly(progress), index = part.motion;
  const offset: JourneyPoint = [...separation[index]];
  // The lower diagonal docks into the already assembled right stroke. Both then
  // travel home together, so the integration is an actual fitted logo joint.
  if (index === 4) for (let axis = 0; axis < 3; axis++) {
    offset[axis] += (separation[3][axis] - offset[axis]) * state.docking;
  }
  const position = part.position.map((value, axis) => value + offset[axis] * state.opening) as JourneyPoint;
  const aligned = 1 - state.alignment * .60;
  let turn = turns[index] * aligned;
  if (index === 4) turn += (turns[3] * aligned - turn) * state.docking;
  if (index === 3 || index === 4) turn *= 1 - state.docking;
  // The right rail articulates outward, then returns to its profile.
  const unfold = index === 5 ? state.unfolding * -.30 : 0;
  return { position, rotation: [0, turn * state.opening + unfold, 0], size: [...sculptureShapes[part.geometry].size] };
}

const stops = [0, .14, .28, .40, .49, .57, .68, .81, .90, .94];
const cameraPoints: JourneyPoint[] = [
  [-4, 3, 110], [-2, 5, 45], [-3, 3, 8], [-2, 5, -11], [1, 4, -30],
  [3, 8, -64], [34, 10, -35], [30, 7, 50], [12, 4, 90], [4, 2, 100],
];
const cameraAngles: JourneyPoint[] = [
  [2, -2, 0], [2, -3, 0], [12, -2, 0], [35, -10, 0], [50, -16, 0],
  [130, -6, 0], [240, -10, 0], [325, -8, 0], [354, -2.3, 0], [357.42, -1.43, 0],
];
function path(points: JourneyPoint[], progress: number): JourneyPoint {
  const p = Math.min(.94, journeyClamp(progress));
  let i = 0;
  while (i < stops.length - 2 && p > stops[i + 1]) i++;
  const duration = stops[i + 1] - stops[i], t = (p - stops[i]) / duration;
  const t2 = t * t, t3 = t2 * t;
  const tangent = (at: number, axis: number) => {
    if (at === 0 || at === points.length - 1) return 0;
    return (points[at + 1][axis] - points[at - 1][axis]) / (stops[at + 1] - stops[at - 1]);
  };
  return points[i].map((value, axis) =>
    (2 * t3 - 3 * t2 + 1) * value + (t3 - 2 * t2 + t) * duration * tangent(i, axis) +
    (-2 * t3 + 3 * t2) * points[i + 1][axis] + (t3 - t2) * duration * tangent(i + 1, axis),
  ) as JourneyPoint;
}
export const journeyLens = (compact = false) => ({ fov: compact ? 57 : 47, near: .12, far: 350 });
export function journeyCamera(progress: number, compact = false, aspect = .46) {
  const p = journeyClamp(progress), portrait = compact && aspect < 1.15;
  const safeAspect = Math.max(.3, aspect), tan = Math.tan(journeyLens(compact).fov * Math.PI / 360);
  const distance = 48 / (2 * tan * safeAspect * (portrait ? .82 : .37));
  const finalDistance = Math.max(51, distance);
  const finalBlend = ease(.78, .94, p), openingBlend = 1 - ease(.06, .24, p);
  const points = cameraPoints.map(point => [...point] as JourneyPoint);
  points[0] = [-finalDistance * .04, finalDistance * .03, finalDistance * 1.06];
  points[8] = [finalDistance * .12, finalDistance * .04, finalDistance * .90];
  points[9] = [finalDistance * .045, finalDistance * .025, finalDistance];
  const position = path(points, p), angles = path(cameraAngles, p);
  const yaw = angles[0] * Math.PI / 180, pitch = angles[1] * Math.PI / 180;
  const direction: JourneyPoint = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const target = position.map((value, axis) => value + direction[axis] * 30) as JourneyPoint;
  const framing = Math.max(openingBlend, finalBlend);
  // Off-axis composition preserves the logo's front silhouette without a strong
  // oblique camera angle. The same ray is held for the complete final CTA.
  const offset: [number, number] = portrait ? [0, .21 * framing] : [-.19 - .05 * framing, 0];
  return { position, target, offset };
}

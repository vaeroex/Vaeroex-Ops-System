export type JourneyPoint = [number, number, number];
export type SculptureRole = "shell" | "layer" | "module" | "enhancement" | "surface" | "joint" | "seam";
export type SculpturePart = {
  id: string;
  role: SculptureRole;
  geometry: string;
  material: number;
  position: JourneyPoint;
  rotation: JourneyPoint;
  motion: "fixed" | "left" | "right" | "door-left" | "door-right" | "layer" | "dock" | "unfold";
};
export type SculpturePose = { position: JourneyPoint; rotation: JourneyPoint; size: JourneyPoint };

export const journeyClamp = (value: number) => Number.isNaN(value) ? 0 : Math.max(0, Math.min(1, value));
const ease = (from: number, to: number, value: number) => {
  const t = journeyClamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

export const sculptureShapes: Record<string, { size: JourneyPoint; bevel: number }> = {
  "long-arm": { size: [4.5, 30, 32], bevel: .28 },
  "rise-arm": { size: [4.2, 12, 32], bevel: .25 },
  "return-arm": { size: [4.3, 17, 32], bevel: .25 },
  "wing": { size: [3.4, 12, 22], bevel: .22 },
  "long-face": { size: [3.4, 29.2, .32], bevel: .06 },
  "rise-face": { size: [3.2, 11.2, .32], bevel: .06 },
  "return-face": { size: [3.3, 16.2, .32], bevel: .06 },
  "wing-face": { size: [2.5, 11.2, .30], bevel: .05 },
  "long-seam": { size: [.10, 28.4, .10], bevel: .015 },
  "rise-seam": { size: [.10, 10.4, .10], bevel: .015 },
  "return-seam": { size: [.10, 15.4, .10], bevel: .015 },
  "wing-seam": { size: [.10, 10.4, .10], bevel: .015 },
  "entry-leaf": { size: [3.6, 10.5, 1], bevel: .16 },
  "entry-inset": { size: [3.05, 9.5, .16], bevel: .035 },
  "entry-rail": { size: [15, .35, 1.7], bevel: .09 },
  "layer-a": { size: [1.1, 9, 7], bevel: .19 },
  "layer-b": { size: [1.2, 7.5, 8], bevel: .19 },
  "layer-c": { size: [1, 6.5, 7], bevel: .17 },
  "layer-seam": { size: [.07, 5.8, 5.4], bevel: .02 },
  "module-base": { size: [4.3, 2.4, 6], bevel: .22 },
  "module-top": { size: [4.3, 2, 6], bevel: .20 },
  "enhancement": { size: [4, 2.1, 5.8], bevel: .19 },
  "module-rail": { size: [.28, 7, .5], bevel: .06 },
  "module-joint": { size: [4, .10, 5.6], bevel: .025 },
  "frame-vertical": { size: [.65, 10, 1.2], bevel: .14 },
  "frame-horizontal": { size: [8.6, .65, 1.2], bevel: .14 },
  "folded-surface": { size: [3.2, 8.8, .7], bevel: .12 },
  "hinge": { size: [.35, 8.4, .65], bevel: .08 },
  "foundation": { size: [34, 1.2, 31], bevel: .28 },
};

export const sculptureEnvelope = { min: [-25, -15, -48] as JourneyPoint, max: [27, 22, 7] as JourneyPoint };
export const sculpturePassages = {
  entry: { progress: .27, center: [-1, 4, 1] as JourneyPoint, normal: [0, 0, 1] as JourneyPoint },
  exit: { progress: .65, center: [7, 5, -38] as JourneyPoint, normal: [0, 0, 1] as JourneyPoint },
};
export const enhancementSocket: JourneyPoint = [7, 1.6, -28];

export function journeyAssembly(progress: number) {
  const p = journeyClamp(progress);
  return {
    opening: ease(.06, .24, p) * (1 - ease(.84, 1, p)),
    alignment: ease(.24, .43, p),
    docking: ease(.43, .58, p),
    unfolding: ease(.55, .65, p) * (1 - ease(.86, 1, p)),
    closure: ease(.84, 1, p),
  };
}

export function createJourneyWorld(compact = false) {
  const parts: SculpturePart[] = [];
  const add = (id: string, role: SculptureRole, geometry: string, material: number,
    position: JourneyPoint, rotation: JourneyPoint = [0, 0, 0], motion: SculpturePart["motion"] = "fixed") => {
    parts.push({ id, role, geometry, material, position, rotation, motion });
  };
  const arms = [
    { id: "long", geometry: "long-arm", a: [-14, 18], b: [-1, -9], z: -15, motion: "left" as const },
    { id: "rise", geometry: "rise-arm", a: [-1, -9], b: [5, 1], z: -15, motion: "right" as const },
    { id: "return", geometry: "return-arm", a: [5, 1], b: [15, -12], z: -15, motion: "right" as const },
    { id: "wing", geometry: "wing", a: [13, 3], b: [20, 12], z: -16, motion: "right" as const },
  ];
  for (const arm of arms) {
    const x = (arm.a[0] + arm.b[0]) / 2, y = (arm.a[1] + arm.b[1]) / 2;
    const rz = Math.atan2(-(arm.b[0] - arm.a[0]), arm.b[1] - arm.a[1]);
    const front = arm.z + sculptureShapes[arm.geometry].size[2] / 2;
    add(arm.id + "-shell", "shell", arm.geometry, 0, [x, y, arm.z], [0, 0, rz], arm.motion);
    add(arm.id + "-face", "shell", arm.id + "-face", 1, [x, y, front + .2], [0, 0, rz], arm.motion);
    add(arm.id + "-seam", "seam", arm.id + "-seam", 3,
      [x + Math.cos(rz) * 1.15, y + Math.sin(rz) * 1.15, front + .43], [0, 0, rz], arm.motion);
  }
  add("left-entry-leaf", "surface", "entry-leaf", 2, [-1.85, 3.5, 1.5], [0, 0, -.18], "door-left");
  add("right-entry-leaf", "surface", "entry-leaf", 1, [1.85, 3.5, 1.5], [0, 0, -.18], "door-right");
  add("left-entry-inset", "surface", "entry-inset", 5, [-1.85, 3.5, 2.05], [0, 0, -.18], "door-left");
  add("right-entry-inset", "surface", "entry-inset", 2, [1.85, 3.5, 2.05], [0, 0, -.18], "door-right");
  add("entry-guide", "joint", "entry-rail", 0, [0, 8.8, .5]);
  add("intelligence-layer-a", "layer", "layer-a", 1, [-4.8, 3.3, -8], [0, .1, -.08], "layer");
  add("intelligence-layer-b", "layer", "layer-b", 2, [4.8, 5.4, -16], [0, -.12, .10], "layer");
  add("intelligence-layer-c", "layer", "layer-c", 1, [-5.9, 4.9, -29], [0, .1, -.08], "layer");
  if (!compact) {
    add("layer-inset-a", "seam", "layer-seam", 3, [-4.18, 3.3, -8], [0, .1, -.08], "layer");
    add("layer-inset-b", "seam", "layer-seam", 4, [4.12, 5.4, -16], [0, -.12, .10], "layer");
  }
  add("custom-base", "module", "module-base", 0, [7, -.9, -28]);
  add("custom-crown", "module", "module-top", 1, [7, 4.4, -28]);
  add("incoming-enhancement", "enhancement", "enhancement", 2, [...enhancementSocket], [0, 0, 0], "dock");
  add("enhancement-joint", "seam", "module-joint", 4, [7, .48, -28]);
  add("custom-guide-left", "joint", "module-rail", 1, [4.7, 1.7, -30.9]);
  add("custom-guide-right", "joint", "module-rail", 1, [9.3, 1.7, -30.9]);
  // One articulated aperture belongs to the rear fold, not a repeated passage tunnel.
  for (const side of [-1, 1]) {
    add("exit-upright-" + side, "joint", "frame-vertical", 1, [7 + side * 4, 5, -38]);
    add("exit-crossbar-" + side, "joint", "frame-horizontal", 1, [7, 5 + side * 4.7, -38]);
  }
  add("unfolded-left-surface", "surface", "folded-surface", 2, [4.7, 5, -38], [0, 0, 0], "unfold");
  add("unfolded-right-surface", "surface", "folded-surface", 1, [9.3, 5, -38], [0, 0, 0], "unfold");
  add("left-fold-hinge", "joint", "hinge", 0, [3.1, 5, -38]);
  add("right-fold-hinge", "joint", "hinge", 0, [10.9, 5, -38]);
  add("sculpture-foot", "shell", "foundation", 0, [1, -13.8, -15]);
  return { parts };
}

export function journeyPart(part: SculpturePart, progress: number): SculpturePose {
  const state = journeyAssembly(progress);
  const position: JourneyPoint = [...part.position];
  const rotation: JourneyPoint = [...part.rotation];
  switch (part.motion) {
    case "left": position[0] -= state.opening * 1.5; break;
    case "right": position[0] += state.opening * 1.5; break;
    case "door-left": position[0] -= state.opening * 4.8; break;
    case "door-right": position[0] += state.opening * 4.8; break;
    case "layer": {
      const side = part.position[0] < 0 ? -1 : 1;
      position[0] += side * (1 - state.alignment) * 1.5;
      rotation[1] += side * .22 * (1 - state.alignment);
      break;
    }
    case "dock":
      position[0] += (1 - state.docking) * 7.5;
      position[1] += (1 - state.docking) * 4;
      position[2] += (1 - state.docking) * 1.5;
      rotation[1] = (1 - state.docking) * .16;
      break;
    case "unfold": {
      const side = part.position[0] < 7 ? -1 : 1;
      const angle = -side * state.unfolding * 1.45;
      const hinge = 7 + side * 3.9;
      position[0] = hinge - side * Math.cos(angle) * 1.6;
      position[2] = -38 + side * Math.sin(angle) * 1.6;
      rotation[1] = angle;
      break;
    }
  }
  return { position, rotation, size: [...sculptureShapes[part.geometry].size] };
}

const stops = [0, .14, .30, .42, .50, .58, .64, .70, .80, .90, 1];
const cameraPoints: JourneyPoint[] = [
  [-44, 21, 100], [-18, 10, 42], [-1.8, 4.5, -3], [-3, 7, -13], [-5, 7, -17],
  [-4, 7, -22], [6.5, 6.7, -36], [-5, 12, -56], [22, 15, -34], [34, 18, 18], [38, 24, 61],
];
const cameraAngles: JourneyPoint[] = [
  [16, -10, 0], [8, -7, 0], [8, -4, 0], [29, -10, 0], [38, -16, 0],
  [57, -20, 0], [105, -8, 0], [132, -18, 0], [220, -16, 0], [300, -20, 0], [324, -15, 0],
];
const compactPoints: JourneyPoint[] = cameraPoints.map(point => [...point]);
compactPoints[2] = [-2.5, 5.7, 1];
compactPoints[3] = [-10.5, 14.5, -5];
compactPoints[4] = [-8, 13, -8];
compactPoints[5] = [-7.5, 12.5, -9];
compactPoints[6] = [6.5, 7.2, -36];
compactPoints[7] = [-6, 17, -65];
const compactAngles: JourneyPoint[] = cameraAngles.map(point => [...point]);
compactAngles[2] = [18, -8, 0];
compactAngles[3] = [43.5, -37, 0];
compactAngles[4] = [42, -38, 0];
compactAngles[5] = [42, -37, 0];
compactAngles[6] = [98, -14, 0];
compactAngles[7] = [154, -38, 0];
function path(points: JourneyPoint[], progress: number): JourneyPoint {
  const p = journeyClamp(progress);
  let i = 0;
  while (i < stops.length - 2 && p > stops[i + 1]) i++;
  const duration = stops[i + 1] - stops[i], t = (p - stops[i]) / duration;
  const t2 = t * t, t3 = t2 * t;
  const tangent = (at: number, axis: number) => {
    const a = Math.max(0, at - 1), b = Math.min(points.length - 1, at + 1);
    return (points[b][axis] - points[a][axis]) / (stops[b] - stops[a]);
  };
  return points[i].map((value, axis) =>
    (2 * t3 - 3 * t2 + 1) * value + (t3 - 2 * t2 + t) * duration * tangent(i, axis) +
    (-2 * t3 + 3 * t2) * points[i + 1][axis] + (t3 - t2) * duration * tangent(i + 1, axis),
  ) as JourneyPoint;
}
export const journeyLens = (compact = false) => ({ fov: compact ? 57 : 47, near: .12, far: 300 });

export function journeyCamera(progress: number, compact = false, aspect = .46) {
  const p = journeyClamp(progress);
  const position = path(compact ? compactPoints : cameraPoints, p);
  const angles = path(compact ? compactAngles : cameraAngles, p);
  const framing = compact ? 8 * (1 - ease(.14, .28, p)) + 10 * ease(.8, 1, p) : 0;
  const yaw = (angles[0] + framing) * Math.PI / 180, pitch = angles[1] * Math.PI / 180;
  const direction: JourneyPoint = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  if (compact) {
    const narrow = journeyClamp((.75 - Math.max(.2, aspect)) / .4);
    const openingRetreat = (20 + 10 * narrow) * (1 - ease(0, .22, p));
    const finalRetreat = (22 + 10 * narrow) * ease(.70, 1, p);
    // Use the final overview ray during the pullback, avoiding an extra sideways
    // acceleration from rotating an already-long mobile camera offset.
    const finalYaw = 334 * Math.PI / 180, finalPitch = -15 * Math.PI / 180;
    const finalDirection: JourneyPoint = [
      Math.sin(finalYaw) * Math.cos(finalPitch), Math.sin(finalPitch), -Math.cos(finalYaw) * Math.cos(finalPitch),
    ];
    for (let axis = 0; axis < 3; axis++) {
      position[axis] -= direction[axis] * openingRetreat + finalDirection[axis] * finalRetreat;
    }
  }
  const target = position.map((value, axis) => value + direction[axis] * 30) as JourneyPoint;
  return { position, target };
}

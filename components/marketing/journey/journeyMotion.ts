export type JourneyPoint = [number, number, number];

export type JourneyBlock = {
  position: JourneyPoint;
  size: JourneyPoint;
  rotation: number;
  material: number;
};

export type JourneyPanel = {
  position: JourneyPoint;
  rotation: JourneyPoint;
  scale: number;
  family: number;
};

export const journeyClamp = (value: number) => Math.max(0, Math.min(1, value));

const milestones = [0, .14, .30, .40, .50, .60, .70, .76, .84, 1];
const positions: JourneyPoint[] = [
  [-20, 12, 30], [-5, 5, 8], [-4, 3.2, -13], [-15, 3.4, -28],
  [-22, 3.6, -38], [-17, 4, -59], [0, 4.6, -65], [3, 6, -82],
  [25, 17, -98], [37, 43, -108],
];
const targets: JourneyPoint[] = [
  [2, 1, -27], [2, 2, -23], [6, 3, -30], [-6, 3, -44],
  [-9, 3, -52], [2, 3, -66], [30, 4, -73], [25, 5, -60],
  [5, 3, -61], [0, 2, -42],
];
// Keep the publication district to the right of the HTML, then turn toward the overview.
const authoredBearings: Array<number | undefined> = [
  undefined, undefined, undefined, undefined, undefined, 45, 45, 100, 170, undefined,
];
const viewAngles: JourneyPoint[] = [];
targets.forEach((target, index) => {
  const [dx, dy, dz] = target.map((value, axis) => value - positions[index][axis]);
  let yaw = authoredBearings[index] === undefined
    ? Math.atan2(dx, -dz)
    : authoredBearings[index] * Math.PI / 180;
  if (index) {
    const previous = viewAngles[index - 1][0];
    while (yaw - previous > Math.PI) yaw -= Math.PI * 2;
    while (yaw - previous < -Math.PI) yaw += Math.PI * 2;
  }
  viewAngles.push([yaw, Math.atan2(dy, Math.hypot(dx, dz)), 0]);
});

/** Nonuniform cubic Hermite interpolation shares tangents across every join. */
function samplePath(points: JourneyPoint[], progress: number): JourneyPoint {
  const p = journeyClamp(progress);
  let index = 0;
  while (index < milestones.length - 2 && p > milestones[index + 1]) index++;
  const duration = milestones[index + 1] - milestones[index];
  const t = (p - milestones[index]) / duration;
  const t2 = t * t, t3 = t2 * t;
  const tangent = (at: number, axis: number) => {
    const before = Math.max(0, at - 1), after = Math.min(points.length - 1, at + 1);
    return (points[after][axis] - points[before][axis]) / (milestones[after] - milestones[before]);
  };
  return points[index].map((value, axis) =>
    (2 * t3 - 3 * t2 + 1) * value +
    (t3 - 2 * t2 + t) * duration * tangent(index, axis) +
    (-2 * t3 + 3 * t2) * points[index + 1][axis] +
    (t3 - t2) * duration * tangent(index + 1, axis),
  ) as JourneyPoint;
}

/** Scroll moves only the camera. The architecture is a stable, reversible world. */
export function journeyCamera(progress: number, compact = false): {
  position: JourneyPoint;
  target: JourneyPoint;
} {
  const position = samplePath(positions, progress);
  const [bearing, pitch] = samplePath(viewAngles, progress);
  const yaw = bearing + (compact ? .04 : 0);
  const direction: JourneyPoint = [
    Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch),
  ];
  if (compact) {
    const p = journeyClamp(progress);
    const ease = (value: number) => {
      const t = journeyClamp(value);
      return t * t * (3 - 2 * t);
    };
    const retreat = 20 * (1 - ease(p / .2)) + 25 * ease((p - .84) / .16);
    position[1] += 1;
    for (let axis = 0; axis < 3; axis++) position[axis] -= direction[axis] * retreat;
  }
  // Interpolating unwrapped viewing angles avoids a rapidly rotating aim point
  // when the final overlook crosses behind the camera's earlier direction.
  const target = position.map((value, axis) => value + direction[axis] * 30) as JourneyPoint;
  return { position, target };
}

/** Fixed architecture: analysis atrium, connected operations, and publication gallery. */
export function createJourneyWorld(compact = false) {
  const blocks: JourneyBlock[] = [];
  const panels: JourneyPanel[] = [];
  const add = (position: JourneyPoint, size: JourneyPoint, material = 0, rotation = 0) => {
    blocks.push({ position, size, material, rotation });
  };
  const segment = (a: JourneyPoint, b: JourneyPoint, width: number, material: number, height = .07) => {
    const dx = b[0] - a[0], dz = b[2] - a[2];
    add([(a[0] + b[0]) / 2, a[1], (a[2] + b[2]) / 2],
      [Math.hypot(dx, dz), height, width], material, Math.atan2(-dz, dx));
  };
  const portal = (x: number, z: number, width: number, height: number, family: number) => {
    for (const side of [-1, 1]) {
      add([x + side * width / 2, height / 2 - 1.3, z], [.32, height, .65], 1);
      add([x + side * (width / 2 - .18), height / 2 - 1.3, z + .35], [.055, height, .06], family + 2);
    }
    add([x, height - 1.3, z], [width + .3, .34, .65], 1);
    add([x, height - 1.5, z + .35], [width, .045, .06], family + 2);
    add([x, -1.45, z], [width + 1, .3, 1.8]);
  };
  const panel = (family: number, position: JourneyPoint, scale: number, rotation = 0) => {
    panels.push({ family, position, scale, rotation: [0, rotation, 0] });
  };

  // A continuous ground route is visible from within the city and at the final overlook.
  const spine: JourneyPoint[] = [[0, -1.18, 18], [0, -1.18, -17], [-15, -1.18, -39],
    [-15, -1.18, -50], [10, -1.18, -70], [10, -1.18, -89]];
  for (let i = 0; i < spine.length - 1; i++) {
    const a = spine[i], b = spine[i + 1], family = Math.min(2, Math.floor(i / 2));
    segment([a[0], -1.48, a[2]], [b[0], -1.48, b[2]], 5, 0, .25);
    const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const nx = -(b[2] - a[2]) / length, nz = (b[0] - a[0]) / length;
    for (const side of [-1, 1]) {
      segment([a[0] + nx * side * 2, a[1], a[2] + nz * side * 2],
        [b[0] + nx * side * 2, b[1], b[2] + nz * side * 2], .075, family + 2);
    }
  }

  // Intelligence: a traversable nave with tall analytical fins and stacked data surfaces.
  for (const z of [5, -4, -13]) portal(0, z, 18, 11, 0);
  add([15, -1.55, -22], [24, .5, 25]);
  for (let i = 0; i < 6; i++) {
    const x = 9 + (i % 3) * 6, z = -17 - Math.floor(i / 3) * 13;
    const height = [10, 15, 12, 7, 11, 17][i];
    add([x, height / 2 - 1.3, z], [1.2, height, 5.5]);
    add([x - .65, height / 2 - 1.3, z + 2.75], [.09, height, .08], 2);
    add([x, height - 1.1, z], [1.6, .18, 5.9], 1);
    if (!compact || i % 2 === 0) {
      for (let level = 1; level < 4; level++) {
        add([x + 1.4, level * 2.1, z + 2.8], [2.8, .09, .08], 2);
      }
    }
    segment([0, -1.15, z], [x, -1.15, z], .06, 2);
  }
  panel(0, [8, 3.2, -15], 3.8, -.25);
  panel(0, [16, 5, -25], 4.5, -.3);
  panel(0, [22, 3, -33], 3.4, -.25);
  if (!compact) panel(0, [8, 7.8, -27], 2.7, -.3);

  // Custom systems: distinct connected modules, elevated bridges and routed floor circuitry.
  add([-8, -1.55, -46], [25, .5, 23]);
  portal(-17, -35, 16, 10, 1);
  portal(-17, -43, 16, 10, 1);
  const modules: JourneyPoint[] = [[-12, 0, -43], [-3, 0, -43], [-12, 0, -53], [-3, 0, -53]];
  for (let i = 0; i < modules.length; i++) {
    const [x, , z] = modules[i], height = i % 2 ? 7 : 5;
    add([x, .1, z], [5.4, 2.5, 5.4]);
    for (const dx of [-2.5, 2.5]) for (const dz of [-2.5, 2.5]) {
      add([x + dx, height / 2, z + dz], [.22, height, .22], 1);
    }
    add([x, height, z], [5.6, .25, 5.6], 1);
    for (const dz of [-2.85, 2.85]) add([x, height + .15, z + dz], [5.7, .06, .06], 3);
    panel(1, [x, 3.6, z + 2.9], compact ? 2.4 : 2.7, -.1);
    segment([-17, -1.15, z], [x, -1.15, z], .075, 3);
    if (i % 2 === 0) {
      add([x + 4.5, 5.4, z], [4.2, .35, 1.8], 1);
      add([x + 4.5, 5.65, z + .95], [4.2, .06, .06], 3);
    }
  }

  // Website development: layered page frames and a clear, repeating publication silhouette.
  add([19, -1.55, -73], [22, .5, 30]);
  for (let i = 0; i < 3; i++) {
    const x = 17 + i * 2, z = -63 - i * 10, width = 10, height = 10 + i * 2;
    portal(x, z, width, height, 2);
    add([x, 5.5, z - .4], [8.8, 10, .3]);
    add([x, height - 2.3, z + .25], [8.8, .25, .2], 4);
    panel(2, [x, 4.3, z + .15], 4.3, 0);
    for (let dot = 0; dot < 3; dot++) add([x - 3.4 + dot * .55, height - 2.3, z + .4], [.18, .18, .15], 1);
    segment([10, -1.15, z], [x, -1.15, z], .07, 4);
  }

  // Ground connections unite the districts without animated particles or floating ornaments.
  segment([8, -1.1, -32], [-3, -1.1, -42], .08, 2);
  segment([-3, -1.1, -54], [17, -1.1, -63], .08, 3);
  segment([22, -1.1, -30], [29, -1.1, -30], .06, 2);
  segment([29, -1.1, -30], [29, -1.1, -83], .06, 4);
  segment([29, -1.1, -83], [21, -1.1, -83], .06, 4);

  // Sparse peripheral buildings establish near/middle/far depth on the opening view.
  for (const [x, z, height] of [[-31, 8, 9], [30, 6, 15], [-32, -18, 14], [37, -39, 19],
    [-31, -65, 13], [34, -97, 12], [-13, -94, 8]]) {
    add([x, height / 2 - 1.6, z], [3, height, 5]);
    add([x, height - 1.5, z], [3.2, .1, 5.2], 1);
  }
  return { blocks, panels };
}

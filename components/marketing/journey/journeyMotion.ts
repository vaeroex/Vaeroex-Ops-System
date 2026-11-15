export type JourneyPoint = [number, number, number];

export type JourneyBlock = {
  position: JourneyPoint;
  size: JourneyPoint;
  rotation: number;
  material: number;
  shape?: "box" | "cylinder" | "ring";
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

/** A grounded operations center with three open rooms connected by a lit circulation route. */
export function createJourneyWorld(compact = false) {
  const blocks: JourneyBlock[] = [];
  const panels: JourneyPanel[] = [];
  const add = (position: JourneyPoint, size: JourneyPoint, material = 0, rotation = 0,
    shape: JourneyBlock["shape"] = "box") => {
    blocks.push({ position, size, material, rotation, shape });
  };
  const segment = (a: JourneyPoint, b: JourneyPoint, width: number, material: number, height = .06) => {
    const dx = b[0] - a[0], dz = b[2] - a[2];
    add([(a[0] + b[0]) / 2, a[1], (a[2] + b[2]) / 2],
      [Math.hypot(dx, dz), height, width], material, Math.atan2(-dz, dx));
  };
  const panel = (family: number, position: JourneyPoint, scale: number, rotation = 0) => {
    panels.push({ family, position, scale, rotation: [0, rotation, 0] });
  };
  const doorway = (x: number, z: number, width: number, height: number, family: number) => {
    for (const side of [-1, 1]) {
      add([x + side * width / 2, height / 2 - 1.3, z], [.5, height, .7], 1);
    }
    add([x, height - 1.3, z], [width + .5, .45, .8], 7);
    add([x, height - 1.55, z + .43], [width, .07, .07], family + 2);
  };
  const room = (x: number, z: number, width: number, depth: number, family: number) => {
    const right = x + width / 2, back = z - depth / 2, top = 7.4;
    add([x, -1.48, z], [width, .45, depth], 6);
    // Two glazed exterior walls and open circulation sides make the interior legible
    // while keeping the final aerial view and the authored camera route unobstructed.
    const backSpans = family === 1 ? [[x - width / 2, -22], [-14, right]] : [[x - width / 2, right]];
    for (const [start, end] of backSpans) {
      add([(start + end) / 2, -.55, back], [end - start, 1.4, .45], 7);
      add([(start + end) / 2, 3.65, back], [end - start - .3, 6.7, .10], 5);
    }
    if (family === 1) for (const jamb of [-22, -14]) {
      add([jamb, 3.1, back], [.22, 8.7, .3], 1);
    }
    add([right, -.55, z], [.45, 1.4, depth], 7);
    add([right, 3.65, z], [.10, 6.7, depth - .6], 5);
    for (const at of [-.5, 0, .5]) {
      add([x + width * at, 3.1, back], [.22, 8.7, .3], 1);
      add([right, 3.1, z + depth * at], [.3, 8.7, .22], 1);
    }
    add([x, top, back], [width + .5, .35, 1.4], 7);
    add([right, top, z], [1.4, .35, depth + .5], 7);
    add([x, top - .2, back + .65], [width, .06, .10], family + 2);
    add([right - .65, top - .2, z], [.10, .06, depth], family + 2);
    for (const side of [-1, 1]) {
      add([x, -1.22, z + side * (depth / 2 - .45)], [width - .8, .04, .07], 1);
      add([x + side * (width / 2 - .45), -1.22, z], [.07, .04, depth - .8], 1);
    }
    // Floor joints read as a deliberate interior surface; compact mode uses fewer.
    const joints = compact ? 2 : 4;
    for (let i = 1; i <= joints; i++) {
      add([x, -1.245, z - depth / 2 + depth * i / (joints + 1)], [width - .8, .015, .035], 0);
    }
  };

  add([1, -1.82, -41], [74, .3, 130], 0);
  room(9, -14, 36, 38, 0);
  room(-9, -45, 30, 25, 1);
  room(19, -74, 28, 31, 2);
  doorway(0, 5, 18, 9, 0);
  doorway(-17, -34, 15, 8, 1);
  // Short opaque returns and a glazed entry partition frame actual openings.
  add([18, 2.5, 5], [18, 7.6, .45], 7);
  add([-8.8, 2.5, -.5], [.35, 7.6, 9], 5);
  add([18, 2.5, 5.25], [10, 4.2, .10], 5);
  add([-3, 2.2, -32.5], [13, 7, .4], 7);
  add([29.5, 2.2, -58.5], [7, 7, .4], 7);

  const spine: JourneyPoint[] = [[0, -1.19, 17], [0, -1.19, -17], [-17, -1.19, -37],
    [-17, -1.19, -54], [9, -1.19, -69], [9, -1.19, -89]];
  for (let i = 0; i < spine.length - 1; i++) {
    const a = spine[i], b = spine[i + 1], family = Math.min(2, Math.floor(i / 2));
    segment([a[0], -1.40, a[2]], [b[0], -1.40, b[2]], 5.5, 6, .3);
    const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const nx = -(b[2] - a[2]) / length, nz = (b[0] - a[0]) / length;
    for (const side of [-1, 1]) {
      segment([a[0] + nx * side * 2.35, a[1], a[2] + nz * side * 2.35],
        [b[0] + nx * side * 2.35, b[1], b[2] + nz * side * 2.35], .055, family + 2);
    }
  }

  // Intelligence: one contained central equipment core, connected to supported displays.
  add([12, -.88, -23], [6.5, .8, 6.5], 1, 0, "cylinder");
  add([12, -.42, -23], [6, .12, 6], 2, 0, "ring");
  add([12, 2.9, -23], [4.7, 6.7, 4.7], 5, 0, "cylinder");
  add([12, 2.9, -23], [2.8, 6.7, 2.8], 0, 0, "cylinder");
  for (const y of [-.35, 1.8, 4.1, 6.3]) {
    add([12, y, -23], [4.9, .18, 4.9], 1, 0, "ring");
  }
  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    add([12 + Math.cos(angle) * 2.25, 2.9, -23 + Math.sin(angle) * 2.25], [.16, 6.8, .16], 1, 0, "cylinder");
    add([12 + Math.cos(angle) * 1.42, 2.9, -23 + Math.sin(angle) * 1.42], [.07, 6.3, .07], 2);
  }
  for (const [x, z, scale] of [[6, -15, 3.8], [14, -17, 4.3], [22, -25, 3.8]]) {
    panel(0, [x, 3.5, z], scale, -.3);
    add([x, -.95, z - .35], [3.4, .5, 2], 1);
    add([x, .7, z - .4], [.35, 3, .35], 1);
    add([x, 2.1, z - .4], [2.5, .2, .4], 1);
    segment([x, -1.17, z], [12, -1.17, -23], .055, 2);
  }
  if (!compact) {
    panel(0, [19, 4, -32.65], 2.8);
    add([19, 4, -32.9], [4.3, 3, .2], 7);
  }

  // Systems: three complete desk/seat/monitor pods, connected to a compact mechanism bay.
  // One partial canopy covers the front workstations, tied into the right wall frame
  // and two columns. The remaining roof area stays open for the final overlook.
  add([-6, 7.55, -41.5], [24, .3, 10], 7);
  add([-18, 7.3, -41.5], [.35, .45, 10], 1);
  for (const z of [-36.5, -46.5]) {
    add([-18, 3.05, z], [.35, 8.7, .35], 1);
    add([-6, 7.34, z + (z === -36.5 ? -1.2 : 1.2)], [21.5, .06, .14], 3);
  }
  for (const [x, z] of [[-12, -41], [-3.5, -43], [-10, -51]]) {
    add([x, 1.15, z], [5.4, .28, 2.3], 1);
    for (const side of [-1, 1]) {
      add([x + side * 2.1, -.05, z], [.32, 2.2, 1.5], 0);
    }
    add([x, .7, z - .75], [4.8, .18, .25], 7);
    add([x, 1.8, z - .4], [.16, 1.2, .16], 1, 0, "cylinder");
    panel(1, [x, 2.8, z - .35], 2.6, -.1);
    add([x + 1.85, 1.55, z + .1], [.65, .5, .7], 7);
    add([x + 1.85, 1.81, z + .1], [.4, .035, .35], 3);
    // A recognizable seat, backrest, pedestal and base, all resting on the floor.
    add([x, .1, z + 2.2], [1.7, .28, 1.65], 0);
    add([x, 1, z + 2.85], [1.7, 1.75, .25], 7);
    add([x, -.55, z + 2.2], [.16, 1.1, .16], 1, 0, "cylinder");
    add([x, -1.13, z + 2.2], [1.7, .12, 1.7], 1, 0, "cylinder");
    if (!compact) for (const side of [-1, 1]) {
      add([x + side * .95, .65, z + 2.15], [.12, .16, 1.25], 1);
    }
    segment([-17, -1.17, z], [x, -1.17, z], .055, 3);
  }
  add([1, -.95, -52], [7.5, .6, 5.5], 7);
  for (const x of [-1, 2.5]) {
    add([x, .7, -52], [2.5, 2.6, 3.5], 0);
    add([x, 2.3, -52], [2.2, 1.1, 2.2], 1, 0, "cylinder");
    add([x, 3.3, -52], [.35, 1.1, .35], 1, 0, "cylinder");
    add([x, 1.2, -50.2], [1.8, 1.7, .1], 5);
    add([x, 2.6, -50.1], [1.5, .055, .055], 3);
  }
  add([.75, 3.9, -52], [6.4, .3, .4], 1);
  segment([-10, -1.17, -51], [1, -1.17, -52], .055, 3);

  // Websites: three dimensional browser canvases on freestanding physical gallery mounts.
  for (const [x, z] of [[15, -68], [22, -77], [25, -85]]) {
    panel(2, [x, 4, z], 7, -.2);
    add([x, -.95, z - .4], [8.8, .5, 2.6], 7);
    for (const side of [-1, 1]) {
      add([x + side * 3.1, .9, z - .5], [.25, 3.5, .3], 1);
    }
    add([x, 1.3, z - .5], [7, .2, .35], 1);
    add([x, -.65, z + .95], [7.6, .055, .055], 4);
    segment([9, -1.17, z], [x, -1.17, z], .055, 4);
  }
  segment([12, -1.17, -27], [-3.5, -1.17, -43], .055, 2);
  segment([1, -1.17, -52], [15, -1.17, -68], .055, 3);
  return { blocks, panels };
}

/** Deterministic choreography. There is no wall-clock input: every pose reverses with scroll. */
export type ClarityVariant = "home" | "executive" | "systems" | "research";
export type ClarityVector = readonly [number, number, number];
export type ClarityPose = Readonly<{
  position: ClarityVector;
  rotation: ClarityVector;
  scale: number;
}>;
export type ClarityMotionState = Readonly<{
  progress: number;
  stage: number;
  camera: ClarityVector;
  target: ClarityVector;
  fov: number;
  structure: ClarityPose;
  front: ClarityPose;
  back: ClarityPose;
  layers: readonly ClarityPose[];
  fragments: readonly ClarityPose[];
  signals: readonly ClarityPose[];
  core: ClarityPose & { reveal: number };
}>;

export const CLARITY_STAGES = [0, 1 / 3, 2 / 3, 1] as const;
export const CLARITY_LAYER_COUNT = { full: 8, compact: 5 } as const;

/** NaN starts the journey; infinities clamp to their corresponding endpoint. */
export function normalizeClarityProgress(progress: number): number {
  return Number.isNaN(progress) ? 0 : Math.min(1, Math.max(0, progress));
}

function mix(from: number, to: number, fraction: number) {
  return from + (to - from) * fraction;
}
function vectorMix(
  from: ClarityVector,
  to: ClarityVector,
  fraction: number,
): ClarityVector {
  return [
    mix(from[0], to[0], fraction),
    mix(from[1], to[1], fraction),
    mix(from[2], to[2], fraction),
  ];
}
function pose(
  position: ClarityVector,
  rotation: ClarityVector = [0, 0, 0],
  scale = 1,
): ClarityPose {
  return { position, rotation, scale };
}
function poseMix(
  from: ClarityPose,
  to: ClarityPose,
  fraction: number,
): ClarityPose {
  return {
    position: vectorMix(from.position, to.position, fraction),
    rotation: vectorMix(from.rotation, to.rotation, fraction),
    scale: mix(from.scale, to.scale, fraction),
  };
}

const CAMERAS: Record<ClarityVariant, readonly ClarityVector[]> = {
  home: [
    [6.4, 3.5, 10.7],
    [-6.5, 1.8, 7.8],
    [5.8, 3.4, 7.8],
    [2.8, 1.55, 8.0],
  ],
  executive: [
    [7.0, 2.6, 11.0],
    [-7.0, 1.0, 7.2],
    [4.7, 4.1, 8.5],
    [2.4, 1.4, 8.0],
  ],
  systems: [
    [6.1, 4.4, 12.2],
    [-6.4, 5.4, 10.0],
    [5.9, 2.7, 8.4],
    [2.5, 1.6, 8.1],
  ],
  research: [
    [6.4, 5.2, 11.7],
    [-6.4, 2.9, 8.6],
    [4.9, 4.5, 8.7],
    [2.8, 1.7, 8.2],
  ],
};
const TARGETS: readonly ClarityVector[] = [
  [-0.1, 0.1, -0.5],
  [0.25, -0.32, -0.65],
  [0.12, 0, -0.25],
  [0.08, -0.14, 0.12],
];

function layerKeyframe(
  index: number,
  count: number,
  stage: number,
  variant: ClarityVariant,
): ClarityPose {
  const unit = index / Math.max(1, count - 1);
  const centered = unit - 0.5;
  const aligned = pose(
    [0, 0, 0.71 - unit * 1.659],
    [0, 0, 0],
    1 - unit * 0.056,
  );
  if (stage === 3) return aligned;
  if (stage === 2)
    return pose(
      [centered * 0.26, Math.sin(index * 1.7) * 0.09, 0.94 - unit * 2.2],
      [0.015 * centered, centered * 0.13, centered * 0.08],
      aligned.scale,
    );

  if (variant === "systems") {
    const branch = (index % 3) - 1;
    const rank = Math.floor(index / 3);
    return stage === 0
      ? pose(
          [branch * 3.05, branch === 0 ? 0.7 : -0.5, 1.3 - rank * 1.05],
          [0.07 * branch, -branch * 0.3, branch * 0.15],
          0.7,
        )
      : pose(
          [branch * 2.45, branch === 0 ? 0.5 : -0.3, 1.3 - rank * 1.4],
          [-0.08, -branch * 0.22, 0],
          0.76,
        );
  }
  if (variant === "executive") {
    return stage === 0
      ? pose(
          [centered * 2.55, Math.sin(index * 2.1) * 0.58, 2.05 - unit * 5.1],
          [centered * 0.16, centered * 0.65, centered * 0.34],
          aligned.scale,
        )
      : pose(
          [centered * 0.42, index % 2 ? 0.2 : -0.2, 2.6 - unit * 6.8],
          [0, centered * 0.1, 0],
          aligned.scale,
        );
  }
  if (variant === "research") {
    return stage === 0
      ? pose(
          [centered * 3.6, Math.sin(index * 0.9) * 0.75, 2.1 - unit * 4.5],
          [centered * 0.3, centered * 0.55, centered * 0.72],
          0.84 + unit * 0.1,
        )
      : pose(
          [
            Math.cos(index * 1.2) * 0.65,
            Math.sin(index * 1.2) * 0.65,
            2.7 - unit * 6.0,
          ],
          [centered * 0.12, 0, centered * 0.28],
          0.91,
        );
  }
  return stage === 0
    ? pose(
        [centered * 2.9, Math.sin(index * 1.8) * 0.65, 1.95 - unit * 4.9],
        [centered * 0.25, centered * 0.58, centered * 0.52],
        aligned.scale,
      )
    : pose(
        [centered * 0.45, Math.sin(index * 1.7) * 0.14, 2.6 - unit * 6.6],
        [0, centered * 0.14, centered * 0.045],
        aligned.scale,
      );
}

function fragmentKeyframe(index: number, stage: number): ClarityPose {
  const side = index % 2 ? 1 : -1;
  const rank = Math.floor(index / 2);
  if (stage === 0)
    return pose(
      [side * (3.0 + rank * 0.45), 1.75 - rank * 1.65, 2.1 - rank * 1.2],
      [0.12 * side, -0.3 * side, side * (0.28 + rank * 0.08)],
      0.95,
    );
  if (stage === 1)
    return pose(
      [side * 2.1, 1.2 - rank * 1.1, 2.1 - rank * 1.85],
      [0, side * 0.1, -side * 0.16],
      0.78,
    );
  if (stage === 2)
    return pose(
      [side * 1.94, 1.25 - rank * 1.2, 0.9 - rank * 0.54],
      [0, 0, 0],
      0.4,
    );
  return pose(
    [side * 1.89, 1.1 - rank * 1.15, 0.76 - rank * 0.4],
    [0, 0, 0],
    0.08,
  );
}

function signalKeyframe(
  index: number,
  count: number,
  stage: number,
): ClarityPose {
  const unit = index / Math.max(1, count - 1);
  if (stage === 0)
    return pose(
      [-3.6 + unit * 2.1, Math.sin(index * 1.4) * 1.45, 2.5 - unit * 3.5],
      [0, 0.35, Math.PI / 2],
      0.7,
    );
  if (stage === 1)
    return pose(
      [
        Math.sin(index * 1.6) * 0.42,
        Math.cos(index * 1.6) * 0.42,
        3.0 - unit * 6.2,
      ],
      [0, Math.PI / 2, 0],
      1.05,
    );
  if (stage === 2)
    return pose(
      [index % 2 ? 1.47 : -1.47, 1.05 - unit * 2.1, 0.1 - unit * 1.1],
      [0, 0, 0],
      0.65,
    );
  return pose(
    [index % 2 ? 1.4 : -1.4, 0.95 - unit * 1.9, -0.36],
    [0, 0, 0],
    0.4,
  );
}

/** Four keyed acts, joined with zero-velocity endpoints; compact preserves the same story. */
export function evaluateClarityMotion(
  progress: number,
  variant: ClarityVariant = "home",
  compact = false,
): ClarityMotionState {
  const normalized = normalizeClarityProgress(progress);
  const segment = Math.min(2, Math.floor(normalized * 3));
  const raw = normalized * 3 - segment;
  const fraction = raw * raw * (3 - 2 * raw);
  const next = segment + 1;
  const layerCount = compact
    ? CLARITY_LAYER_COUNT.compact
    : CLARITY_LAYER_COUNT.full;
  const fragmentCount = compact ? 3 : 6;
  const signalCount = compact ? 3 : 6;
  const samplePose = (keyframes: readonly ClarityPose[]) =>
    poseMix(keyframes[segment], keyframes[next], fraction);
  const camera = vectorMix(
    CAMERAS[variant][segment],
    CAMERAS[variant][next],
    fraction,
  );
  const target = vectorMix(TARGETS[segment], TARGETS[next], fraction);
  const compactDistance = mix(
    [0.94, 1.02, 1.03, 1.03][segment],
    [0.94, 1.02, 1.03, 1.03][next],
    fraction,
  );
  const compactLens = mix(
    [-3, -1, 0, 0][segment],
    [-3, -1, 0, 0][next],
    fraction,
  );
  const reveal = mix(
    [0.08, 0.24, 0.65, 1][segment],
    [0.08, 0.24, 0.65, 1][next],
    fraction,
  );
  return {
    progress: normalized,
    stage: Math.min(3, Math.floor(normalized * 3 + 1e-8)),
    camera: compact
      ? [
          camera[0] * compactDistance,
          camera[1] * compactDistance,
          camera[2] * compactDistance,
        ]
      : camera,
    target,
    fov:
      mix([44, 50, 43, 41][segment], [44, 50, 43, 41][next], fraction) +
      (compact ? compactLens : 0),
    structure: samplePose([
      pose([0, 0.05, 0], [-0.035, -0.14, -0.1]),
      pose([0, 0.12, 0], [0.015, 0.08, 0.04]),
      pose([0.12, 0.1, 0], [-0.06, -0.1, -0.08]),
      pose([0.12, 0.12, 0], [-0.025, -0.13, -0.1]),
    ]),
    front: samplePose([
      pose([-0.6, 0.32, 3.65], [-0.06, -0.32, -0.22], 1.02),
      pose([0, 0, 3.6], [0, 0, 0]),
      pose([0.06, 0, 1.5], [0, 0.035, -0.015]),
      pose([0, 0, 1.055]),
    ]),
    back: samplePose([
      pose([0.8, -0.3, -3.45], [0.1, 0.2, 0.15]),
      pose([0, 0, -4.3]),
      pose([0, 0, -1.6]),
      pose([0, 0, -1.18]),
    ]),
    layers: Array.from({ length: layerCount }, (_, index) =>
      poseMix(
        layerKeyframe(index, layerCount, segment, variant),
        layerKeyframe(index, layerCount, next, variant),
        fraction,
      ),
    ),
    fragments: Array.from({ length: fragmentCount }, (_, index) =>
      poseMix(
        fragmentKeyframe(index, segment),
        fragmentKeyframe(index, next),
        fraction,
      ),
    ),
    signals: Array.from({ length: signalCount }, (_, index) =>
      poseMix(
        signalKeyframe(index, signalCount, segment),
        signalKeyframe(index, signalCount, next),
        fraction,
      ),
    ),
    core: {
      ...samplePose([
        pose([0.15, 0, -3.55], [0, 0.45, 0.14], 0.73),
        pose([0, 0, -3.2], [0, -0.12, 0], 0.83),
        pose([0, 0, -1.28], [0, 0, 0], 0.96),
        pose([0, 0, -0.56], [0, 0, 0], 1.035),
      ]),
      reveal,
    },
  };
}

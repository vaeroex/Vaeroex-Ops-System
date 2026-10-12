/** A conceptual cell journey. Spatial scales are staged for legibility, not measurement. */
export type BiologyVector = readonly [number, number, number];
export type BiologyMotionState = Readonly<{
  progress: number;
  act: number;
  camera: BiologyVector;
  target: BiologyVector;
  fov: number;
  cutaway: number;
  membraneOpacity: number;
  membranePatchOpacity: number;
  membranePatchRotation: number;
  interiorLight: number;
  tissueReveal: number;
  transportPosition: BiologyVector;
  transportScale: number;
  proteinRotation: BiologyVector;
  cellBreath: number;
}>;

export const BIOLOGY_ACTS = [0, 0.25, 0.5, 0.75, 1] as const;

const CAMERA: readonly BiologyVector[] = [
  [7.6, 4.0, 10.8],
  [3.65, 1.85, 5.55],
  [1.9, 1.2, 2.07],
  [2.75, 0.3, 3.42],
  [12.4, 8.1, 19.4],
];
const TARGET: readonly BiologyVector[] = [
  [0.0, 0.0, 0.0],
  [1.3, 0.45, 2.65],
  [-0.4, -0.1, -0.35],
  [1.56, -0.22, 1.15],
  [0.0, 0.0, -2.5],
];
const VESICLE: readonly BiologyVector[] = [
  [1.42, 0.2, -0.18],
  [1.5, 0.12, 0.15],
  [1.88, -0.35, 0.58],
  [1.56, -0.22, 1.15],
  [1.1, 0.48, 2.54],
];

const mix = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;
const mixVector = (
  from: BiologyVector,
  to: BiologyVector,
  amount: number,
): BiologyVector => [
  mix(from[0], to[0], amount),
  mix(from[1], to[1], amount),
  mix(from[2], to[2], amount),
];

/** Every property is a pure function of scroll. No elapsed time, randomness, or drift. */
export function evaluateBiologyMotion(
  progress: number,
  compact = false,
): BiologyMotionState {
  const p = Number.isNaN(progress) ? 0 : Math.max(0, Math.min(1, progress));
  const segment = Math.min(3, Math.floor(p * 4));
  const raw = p * 4 - segment;
  const t = raw * raw * (3 - 2 * raw);
  const sample = (values: readonly number[]) =>
    mix(values[segment], values[segment + 1], t);
  const camera = mixVector(CAMERA[segment], CAMERA[segment + 1], t);
  const target = mixVector(TARGET[segment], TARGET[segment + 1], t);
  // The phone follows the same trajectory, with slightly more breathing room.
  const framing = compact ? sample([1.09, 1.07, 1.015, 1.09, 1.07]) : 1;
  return {
    progress: p,
    act: Math.min(4, Math.floor(p * 4 + 1e-8)),
    camera: [
      target[0] + (camera[0] - target[0]) * framing,
      target[1] + (camera[1] - target[1]) * framing,
      target[2] + (camera[2] - target[2]) * framing,
    ],
    target,
    fov: sample([41, 43, 61, 42, 43]),
    cutaway: sample([0.04, 0.52, 1.38, 1.49, 0.08]),
    membraneOpacity: sample([0.31, 0.22, 0.14, 0.09, 0.26]),
    membranePatchOpacity: sample([0.64, 1, 0.28, 0.08, 0.3]),
    membranePatchRotation: sample([0, 0, 0.68, 0.96, 0]),
    interiorLight: sample([0.55, 0.65, 1, 0.66, 0.65]),
    tissueReveal: sample([0.17, 0.035, 0, 0, 1]),
    transportPosition: mixVector(VESICLE[segment], VESICLE[segment + 1], t),
    transportScale: sample([0.33, 0.4, 0.53, 1.48, 0.35]),
    proteinRotation: [
      sample([0.2, 0.3, 0.15, -0.25, 0.4]),
      sample([0, 0.4, 1.15, 2.0, 2.3]),
      0.12 * Math.sin(p * Math.PI),
    ],
    cellBreath: Math.sin(p * Math.PI * 2) * 0.007,
  };
}

/** Business terrain is an illustrative spatial metaphor, never live business figures. */
export type ExecutiveVector = readonly [number, number, number];
export type ExecutivePose = Readonly<{
  position: ExecutiveVector;
  rotation: ExecutiveVector;
  scale: ExecutiveVector;
}>;
export type ExecutiveMotionState = Readonly<{
  progress: number;
  act: number;
  camera: ExecutiveVector;
  target: ExecutiveVector;
  fov: number;
  recordSpread: number;
  ledgerHeights: ExecutiveVector;
  columnRelief: number;
  relationshipReveal: number;
  riskHeight: number;
  riskEmphasis: number;
  evidence: readonly ExecutivePose[];
  evidenceReveal: number;
  briefing: ExecutivePose;
  briefingReveal: number;
}>;

export const EXECUTIVE_ACTS = [0, 0.25, 0.5, 0.75, 1] as const;
const CAMERAS: readonly ExecutiveVector[] = [
  [9.1, 8.0, 11.1],
  [5.5, 5.0, 7.0],
  [4.25, 3.75, 4.9],
  [-4.85, 4.65, 5.2],
  [5.2, 5.4, 8.0],
];
const TARGETS: readonly ExecutiveVector[] = [
  [-0.2, 0.25, 0],
  [0.45, 0.95, -1.12],
  [1.25, 1.12, 0.38],
  [-1.05, 1.1, 1.3],
  [0.0, 1.05, 0.35],
];
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const vector = (
  a: ExecutiveVector,
  b: ExecutiveVector,
  t: number,
): ExecutiveVector => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];

/** Reversible five-act choreography with zero-velocity joins and no wall-clock input. */
export function evaluateExecutiveMotion(
  progress: number,
  compact = false,
): ExecutiveMotionState {
  const p = Number.isNaN(progress) ? 0 : Math.max(0, Math.min(1, progress));
  const segment = Math.min(3, Math.floor(p * 4));
  const raw = p * 4 - segment;
  const t = raw * raw * (3 - 2 * raw);
  const sample = (values: readonly number[]) =>
    mix(values[segment], values[segment + 1], t);
  const target = vector(TARGETS[segment], TARGETS[segment + 1], t);
  const camera = vector(CAMERAS[segment], CAMERAS[segment + 1], t);
  const framing = compact ? sample([1.06, 1.08, 1.09, 1.05, 1.07]) : 1;
  const explosion = sample([0, 0.025, 0.09, 1, 0.15]);
  const evidence = Array.from(
    { length: 4 },
    (_, index): ExecutivePose => ({
      position: [
        -2.35 + index * 0.025 + explosion * (0.48 + index * 0.46),
        0.29 + index * 0.09 + explosion * (0.24 + index * 0.51),
        1.6 - index * 0.02 - explosion * index * 0.18,
      ],
      rotation: [
        explosion * (0.09 + index * 0.025),
        explosion * (-0.16 + index * 0.095),
        -explosion * index * 0.027,
      ],
      scale: [1, 1, 1],
    }),
  );
  const briefingReveal = sample([0, 0, 0, 0.015, 1]);
  return {
    progress: p,
    act: Math.min(4, Math.floor(p * 4 + 1e-8)),
    camera: [
      target[0] + (camera[0] - target[0]) * framing,
      target[1] + (camera[1] - target[1]) * framing,
      target[2] + (camera[2] - target[2]) * framing,
    ],
    target,
    fov: sample([42, 43, 45, 44, 43]),
    recordSpread: sample([1, 0.48, 0.4, 0.3, 0]),
    ledgerHeights: [
      sample([0.98, 1.65, 1.68, 0.75, 0.3]),
      sample([0.72, 1.13, 1.32, 0.56, 0.26]),
      sample([0.45, 0.79, 0.52, 0.4, 0.2]),
    ],
    columnRelief: sample([1, 0.85, 1.1, 0.55, 0.24]),
    relationshipReveal: sample([0.12, 1, 0.72, 0.38, 0.18]),
    riskHeight: sample([0.8, 0.96, 1.98, 1.05, 0.62]),
    riskEmphasis: sample([0.02, 0.06, 1, 0.65, 0.34]),
    evidence,
    evidenceReveal: sample([0.12, 0.14, 0.28, 1, 0.45]),
    briefing: {
      position: [0, 0.22 + briefingReveal * 0.88, 0.3],
      rotation: [0.52 * briefingReveal, -0.025, 0],
      scale: [0.86 + briefingReveal * 0.14, 1, 0.86 + briefingReveal * 0.14],
    },
    briefingReveal,
  };
}

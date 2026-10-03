/** An editorial journey around an observed structure, not a docking simulation. */
export type DrugVector = readonly [number, number, number];
export type DrugPose = Readonly<{
  position: DrugVector;
  rotation: DrugVector;
  scale: number;
  opacity: number;
}>;
export type DrugMotionState = Readonly<{
  progress: number;
  stage: number;
  camera: DrugVector;
  target: DrugVector;
  fov: number;
  protein: DrugPose;
  ribbonOpacity: number;
  surfaceOpacity: number;
  pocketOpacity: number;
  pocketAtomsOpacity: number;
  zincOpacity: number;
  contactOpacity: number;
  cutawayDepth: number;
  ribbonCutawayDepth: number;
  ligand: DrugPose;
  candidates: readonly [DrugPose, DrugPose];
}>;

export const DRUG_STAGES = [0, 0.25, 0.5, 0.75, 1] as const;
export function normalizeDrugProgress(progress: number) {
  return Number.isNaN(progress) ? 0 : Math.min(1, Math.max(0, progress));
}
/** Preserve the composed horizontal field on narrow split layouts. */
export function drugCameraFov(fov: number, aspect: number) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.3;
  return Math.min(
    75,
    (2 *
      Math.atan(
        Math.tan((fov * Math.PI) / 360) * Math.max(1, 1.3 / safeAspect),
      ) *
      180) /
      Math.PI,
  );
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function vec(a: DrugVector, b: DrugVector, t: number): DrugVector {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function pose(
  position: DrugVector,
  rotation: DrugVector = [0, 0, 0],
  scale = 1,
  opacity = 1,
): DrugPose {
  return { position, rotation, scale, opacity };
}
function interpolatePose(a: DrugPose, b: DrugPose, t: number): DrugPose {
  return {
    position: vec(a.position, b.position, t),
    rotation: vec(a.rotation, b.rotation, t),
    scale: lerp(a.scale, b.scale, t),
    opacity: lerp(a.opacity, b.opacity, t),
  };
}

/** The bound pose at .75 preserves the asset's observed AZM coordinates exactly. */
export function evaluateDrugMotion(
  progress: number,
  compact = false,
): DrugMotionState {
  const value = normalizeDrugProgress(progress);
  const stage = Math.min(3, Math.floor(value * 4));
  const raw = value * 4 - stage;
  const t = raw * raw * (3 - 2 * raw);
  const n = stage + 1;
  const sample = (values: readonly number[]) =>
    lerp(values[stage], values[n], t);
  const sampleVector = (values: readonly DrugVector[]) =>
    vec(values[stage], values[n], t);
  const samplePose = (values: readonly DrugPose[]) =>
    interpolatePose(values[stage], values[n], t);
  const camera = sampleVector([
    [5.8, 2.9, 9.1],
    [4.2, 2.2, 8.5],
    [-0.6, 1.3, 7.0],
    [1.32, 0.55, 2.85],
    [0, 1.0, 9.5],
  ]);
  const target = sampleVector([
    [0, -0.05, -1.4],
    [0, -0.05, -1.0],
    [0.3, 0.05, 0.6],
    [0, 0, -0.12],
    [0, 0.12, 0.45],
  ]);
  const compactCamera = sampleVector([
    [4.8, 2.4, 8.2],
    [3.6, 2.0, 8.0],
    [-0.5, 1.2, 7.0],
    [1.2, 0.5, 3.15],
    [0, 0.8, 8.1],
  ]);
  return {
    progress: value,
    stage: Math.min(4, Math.floor(value * 4 + 1e-8)),
    camera: compact ? compactCamera : camera,
    target,
    fov: sample(compact ? [43, 44, 48, 45, 42] : [42, 43, 47, 41, 42]),
    protein: samplePose([
      pose([0, 0, 0], [-0.04, -0.22, 0.05]),
      pose([0, 0, 0], [0, 0, 0]),
      pose([0, 0, 0], [0, 0, 0]),
      pose([0, 0, 0], [0, 0, 0]),
      pose([0, 2.4, -8], [0.08, -0.42, 0.15], 0.45, 0.24),
    ]),
    ribbonOpacity: sample([1, 0, 0, 0, 1]),
    surfaceOpacity: sample([0, 1, 1, 1, 0]),
    pocketOpacity: sample([0, 1, 1, 1, 0]),
    pocketAtomsOpacity: sample([0.02, 0.14, 0.65, 0.76, 0]),
    zincOpacity: sample([0.25, 0.8, 1, 1, 0]),
    contactOpacity: sample([0, 0, 0, 0.8, 0]),
    cutawayDepth: sample([-6, 5, 5, -0.1, -6]),
    ribbonCutawayDepth: sample([-6, 5, 5, 5, -6]),
    ligand: samplePose([
      pose([3.1, 0.7, 3.3], [0.5, -1.4, 0.3], 1.1, 0),
      pose([2.8, 0.5, 2.8], [0.35, -1.2, 0.2], 1.1, 0.1),
      pose([0.7, 0.65, 1.9], [0.35, -0.85, 0.2], 1.15, 1),
      pose([0, 0, 0], [0, 0, 0], 1, 1),
      pose(
        compact ? [-1.8, 0.4, 0.6] : [-2.1, 0.15, 0.55],
        [0.646, -0.933, 0.334],
        compact ? 1.3 : 1.55,
      ),
    ]),
    candidates: [
      samplePose([
        pose([-3.0, 0.5, 2.5], [0.2, 0.8, 0.1], 1, 0),
        pose([-1.25, -0.7, 1.2], [0.25, 0.6, -0.1], 1, 0),
        pose([-1.45, -0.7, 1.5], [0.25, 0.2, -0.12], 1.05, 1),
        pose([-0.55, 0.2, 0.25], [0.2, -0.2, -0.1], 0.55, 0),
        pose(
          compact ? [0, -0.43, 0.75] : [0, 0.5, 0.5],
          [0.16, 0.2, 0.08],
          compact ? 1.25 : 1.5,
        ),
      ]),
      samplePose([
        pose([3.6, -0.8, 2.7], [-0.25, -0.5, 0.2], 1, 0),
        pose([1.8, -0.65, 1.4], [-0.22, -0.4, 0.2], 1, 0),
        pose([1.9, -0.65, 1.5], [-0.22, -0.2, 0.2], 1.05, 1),
        pose([0.6, -0.2, 0.25], [-0.2, 0.05, 0.15], 0.55, 0),
        pose(
          compact ? [1.85, 0.35, 0.65] : [2.1, 0.05, 0.5],
          [-0.15, 0.25, 0.15],
          compact ? 1.3 : 1.55,
        ),
      ]),
    ],
  };
}

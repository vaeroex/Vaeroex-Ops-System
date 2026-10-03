/** A deterministic, editorial atlas of information becoming connected intelligence. */
export type LandingVector = readonly [number, number, number];
export type LandingPose = Readonly<{
  position: LandingVector;
  rotation: LandingVector;
  scale: number;
}>;
export type LandingMotionState = Readonly<{
  progress: number;
  stage: number;
  camera: LandingVector;
  target: LandingVector;
  fov: number;
  tiles: readonly LandingPose[];
  routeReveal: number;
  routeLift: number;
  crossLinkStrength: number;
  signalStrength: number;
  coreScale: number;
}>;
export const LANDING_STAGES = [0, 0.25, 0.5, 0.75, 1] as const;
export const LANDING_TILE_COUNT = 36;
export const LANDING_COMPACT_TILE_COUNT = 24;
export function normalizeLandingProgress(value: number) {
  return Number.isNaN(value) ? 0 : Math.max(0, Math.min(1, value));
}
export function landingCameraFov(fov: number, aspect: number) {
  const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.3;
  return Math.min(
    78,
    (2 *
      Math.atan(Math.tan((fov * Math.PI) / 360) * Math.max(1, 1.3 / safe)) *
      180) /
      Math.PI,
  );
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function vector(a: LandingVector, b: LandingVector, t: number): LandingVector {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}
function pose(
  position: LandingVector,
  rotation: LandingVector,
  scale = 1,
): LandingPose {
  return { position, rotation, scale };
}
function tileStops(index: number, compact: boolean): readonly LandingPose[] {
  const perDomain = compact ? 8 : 12;
  const columns = compact ? 2 : 3;
  const domain = Math.floor(index / perDomain);
  const local = index % perDomain;
  const row = Math.floor(local / columns);
  const column = ((local % columns) - (columns - 1) / 2) * (compact ? 1.65 : 1);
  const t = local / (perDomain - 1);
  const angle = (domain * Math.PI * 2) / 3 + 0.35;
  const radius = 0.8 + (3 - row) * 0.12;
  const tangent = column * 0.59;
  const branch = Math.floor(local / 4);
  const branchAngle = (branch - (compact ? 0.5 : 1)) * 1.65;
  const branchRadius = 0.35 + (local % 4) * 0.45;
  const waveT = Math.floor(local / 2) / (perDomain / 2 - 1);
  const waveAngle = waveT * Math.PI * 2 + (local % 2) * Math.PI;
  const sourceOrder = local * 3 + domain;
  const sourceFraction =
    sourceOrder /
    ((compact ? LANDING_COMPACT_TILE_COUNT : LANDING_TILE_COUNT) - 1);
  const sourceAngle = sourceOrder * 2.3999632297 + 0.4;
  const sourceRadius = 0.6 + Math.sqrt(sourceFraction) * 2.5;
  const domainPose =
    domain === 0
      ? pose(
          [
            -2.2 + column * 0.53,
            -0.3 + (row - 1.5) * 0.45 + column * 0.15,
            0.2 + row * 0.13,
          ],
          [0.12, -0.25, column * 0.1],
          0.52,
        )
      : domain === 1
        ? pose(
            [
              2.0 + Math.sin(branchAngle) * branchRadius,
              -0.75 + Math.cos(branchAngle) * branchRadius,
              0.1 + (local % 4) * 0.12,
            ],
            [0, 0.08, -branchAngle],
            0.42,
          )
        : pose(
            [
              (waveT - 0.5) * 2.9,
              2.05 + Math.cos(waveAngle) * 0.46,
              -0.9 + Math.sin(waveAngle) * 0.5,
            ],
            [Math.sin(waveAngle) * 0.28, -0.12, Math.sin(waveAngle) * 0.18],
            0.44,
          );
  return [
    pose(
      [
        Math.cos(sourceAngle) * sourceRadius * 0.94,
        Math.sin(sourceAngle) * sourceRadius * 0.84,
        1.1 - sourceFraction * 2.8 + Math.sin(sourceOrder * 0.85) * 0.45,
      ],
      [
        Math.sin(sourceOrder * 0.77) * 0.24,
        -0.15 + Math.sin(sourceOrder * 1.17) * 0.4,
        Math.sin(sourceOrder * 0.94) * 0.35,
      ],
      0.5 + 0.43 * (1 - sourceFraction),
    ),
    pose(
      [
        (domain - 1) * 1.4 + Math.sin(t * Math.PI * 2 + domain * 0.4) * 0.6,
        Math.sin(t * Math.PI * 2 + domain) * 0.2 + (domain - 1) * 0.17,
        4.2 - t * 8.4,
      ],
      [
        -Math.PI / 2 + Math.sin(t * Math.PI) * 0.08,
        Math.sin(t * Math.PI * 2) * 0.12,
        Math.cos(t * Math.PI) * 0.14,
      ],
      compact ? 0.7 : 0.62,
    ),
    pose(
      [column * 1.3, (1.5 - row) * 1.22, (domain - 1) * 1.46],
      [0, (domain - 1) * 0.07, 0],
      compact ? 0.76 : 0.72,
    ),
    domainPose,
    pose(
      [
        Math.sin(angle) * radius + Math.cos(angle) * tangent,
        (row - 1.5) * 1.1 + (1 - domain) * 0.2,
        Math.cos(angle) * radius - Math.sin(angle) * tangent,
      ],
      [0.05 + row * 0.025, angle, 0],
      0.61 + (3 - row) * 0.035,
    ),
  ];
}
const STOP_CACHE = new Map<boolean, readonly (readonly LandingPose[])[]>();
function stops(compact: boolean) {
  let values = STOP_CACHE.get(compact);
  if (!values) {
    values = Array.from(
      { length: compact ? LANDING_COMPACT_TILE_COUNT : LANDING_TILE_COUNT },
      (_, index) => tileStops(index, compact),
    );
    STOP_CACHE.set(compact, values);
  }
  return values;
}
export function createLandingLinks(
  compact = false,
): readonly (readonly [number, number])[] {
  const perDomain = compact ? 8 : 12;
  const columns = compact ? 2 : 3;
  const links: [number, number][] = [];
  for (let domain = 0; domain < 3; domain += 1) {
    for (let index = 0; index < perDomain; index += 1) {
      const from = domain * perDomain + index;
      if (index + columns < perDomain) links.push([from, from + columns]);
      if (index % columns < columns - 1) links.push([from, from + 1]);
      if (domain < 2 && (index % 2 === 0 || !compact))
        links.push([from, from + perDomain]);
    }
  }
  return links;
}
export function evaluateLandingMotion(
  progress: number,
  compact = false,
): LandingMotionState {
  const value = normalizeLandingProgress(progress);
  const stage = Math.min(3, Math.floor(value * 4));
  const raw = value * 4 - stage;
  const t = raw * raw * (3 - 2 * raw);
  const sample = (values: readonly number[]) =>
    mix(values[stage], values[stage + 1], t);
  const sampleVector = (values: readonly LandingVector[]) =>
    vector(values[stage], values[stage + 1], t);
  return {
    progress: value,
    stage: Math.min(4, Math.floor(value * 4 + 1e-8)),
    camera: sampleVector([
      [5.5, 2.8, 8.7],
      [2.3, 6.2, 8.9],
      [-5.6, 2.65, 8.1],
      [6.0, 3.0, 10.2],
      [5.4, 2.3, 7.8],
    ]),
    target: sampleVector([
      [0, 0.05, 0],
      [0, -0.2, -0.5],
      [0, 0, 0],
      [0, 0.55, 0],
      [0, 0.15, 0],
    ]),
    fov: sample(compact ? [43, 46, 45, 43, 42] : [40, 44, 43, 42, 40]),
    tiles: stops(compact).map((values) => ({
      position: vector(values[stage].position, values[stage + 1].position, t),
      rotation: vector(values[stage].rotation, values[stage + 1].rotation, t),
      scale: mix(values[stage].scale, values[stage + 1].scale, t),
    })),
    routeReveal: sample([0, 1, 1, 0.85, 0.8]),
    routeLift: sample([0.16, 0.18, 0.35, 0.3, 0.08]),
    crossLinkStrength: sample([0, 0.08, 1, 0.012, 0.35]),
    signalStrength: sample([0.2, 1, 0.8, 0.7, 0.6]),
    coreScale: sample([0, 0, 0, 0, 1]),
  };
}

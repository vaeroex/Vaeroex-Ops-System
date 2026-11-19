/** Pixel coordinates in the supplied 1080×1080 official VX symbol, with Y down. */
export type LogoPoint = [number, number];

// Straight edges were fitted to the half-opacity boundary of the supplied symbol.
// Source: assets/brand/originals/VX-Miami-Blue.png, SHA-256 d926e88e89b25438b0412d909919dc423a374d83727a41445325d1657d994901.
// Shared vertices close the construction seams exactly when all six pieces return.
const leftTip: LogoPoint = [114.58, 251];
const leftShoulder: LogoPoint = [441.96, 611.10];
const leftElbow: LogoPoint = [401.50, 665.95];
const rightTip: LogoPoint = [965.35, 251];
const rightShoulder: LogoPoint = [637.77, 611.14];
const rightElbow: LogoPoint = [678.57, 666.68];
const crossing: LogoPoint = [539.77, 525.9];
const openingTop: LogoPoint = [539.84, 594.53];
const openingLeft: LogoPoint = [479.59, 675.41];
const openingRight: LogoPoint = [599.93, 675.46];
const openingBottom: LogoPoint = [540.04, 768.77];
const baseSeam: LogoPoint = [540.04, 828];

const width = rightTip[0] - leftTip[0];
const height = baseSeam[1] - leftTip[1];
export const logoBounds = {
  minX: leftTip[0], maxX: rightTip[0], minY: leftTip[1], maxY: baseSeam[1],
  width, height,
  center: [(leftTip[0] + rightTip[0]) / 2, (leftTip[1] + baseSeam[1]) / 2] as LogoPoint,
  worldWidth: 48, worldHeight: height * 48 / width,
} as const;

export function logoToWorld([x, y]: LogoPoint): LogoPoint {
  const scale = logoBounds.worldWidth / width;
  return [(x - logoBounds.center[0]) * scale, (logoBounds.center[1] - y) * scale];
}

// The six solids tile one connected VX. Each stops at the edge of the central
// diamond, so both the extrusion and the static SVG leave that opening empty.
export const logoPieces: { id: string; points: LogoPoint[] }[] = [
  { id: "left-rail", points: [
    leftTip, [294, 251], [294, 309], [244.55, 309], leftShoulder, leftElbow,
  ] },
  { id: "left-base", points: [
    leftElbow, leftShoulder, openingLeft, openingBottom, baseSeam,
    [502.92, 828], [440.26, 729.44], [419.65, 756], [337.41, 756],
  ] },
  { id: "left-crossing", points: [
    leftShoulder, [477.08, 564.29], [307.62, 338], [406.23, 338], crossing, openingTop, openingLeft,
  ] },
  { id: "right-base", points: [
    rightShoulder, rightElbow, [742.20, 756], [660.09, 756], [639.64, 729.74],
    [576.87, 828], baseSeam, openingBottom, openingRight,
  ] },
  { id: "right-crossing", points: [
    crossing, [673.89, 338], [772.35, 338], [602.57, 564.19], rightShoulder, openingRight, openingTop,
  ] },
  { id: "right-rail", points: [
    rightShoulder, [835.01, 309], [785.90, 309], [785.49, 251], rightTip, rightElbow,
  ] },
];

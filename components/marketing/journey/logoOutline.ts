/** Source-image coordinates use the usual raster convention: X right, Y down. */
export type LogoPoint = [number, number];

export const logoAsset = {
  path: "/brand/vaeroex-logo-white-wordmark.png",
  width: 1536,
  height: 1024,
  comparisonAssets: [
    { path: "/favicon.png", width: 512, height: 512 },
    { path: "/apple-touch-icon.png", width: 180, height: 180 },
  ],
  trace: "Manual vector trace of the existing emblem's outer dark outline, excluding the wordmark, illumination and background.",
} as const;

/**
 * The source is a shaded, antialiased raster rather than an original vector file.
 * These pixel-center vertices follow its straight outer edges, including the dark
 * side faces. The lower spur and detached upper-right stroke are both intentional
 * parts of the source mark. Internal highlights are not additional silhouette edges.
 *
 * The two favicon variants were inspected to distinguish the emblem from the
 * large source image's blue illumination and to confirm those two small strokes.
 */
const a: LogoPoint = [174, 51];
const b: LogoPoint = [380, 54];
const c: LogoPoint = [740, 592];
const d: LogoPoint = [872, 401];
const e: LogoPoint = [973, 404];
const f: LogoPoint = [1255, 788];
const g: LogoPoint = [1139, 788];
const h: LogoPoint = [1029, 642];
const i: LogoPoint = [920, 788];
const j: LogoPoint = [815, 788];
const k: LogoPoint = [980, 579];
const l: LogoPoint = [925, 502];
const m: LogoPoint = [722, 790];

export const logoOutline: LogoPoint[] = [a, b, c, d, e, f, g, h, i, j, k, l, m];
export const logoDetachedStroke: LogoPoint[] = [
  [1064, 453], [1191, 286], [1296, 286], [1119, 521],
];

export const logoBounds = {
  minX: 174,
  minY: 51,
  maxX: 1296,
  maxY: 790,
  width: 1122,
  height: 739,
  center: [735, 420.5] as LogoPoint,
  worldWidth: 48,
  worldHeight: 739 * 48 / 1122,
} as const;

/** Center the complete emblem, preserve its proportions, and turn raster Y upward. */
export function logoToWorld([x, y]: LogoPoint): LogoPoint {
  const scale = logoBounds.worldWidth / logoBounds.width;
  return [(x - logoBounds.center[0]) * scale, (logoBounds.center[1] - y) * scale];
}

// This one new construction seam divides the long stroke at Y=300. Interpolate
// on the traced edges rather than round the seam endpoints off their boundaries.
const cutY = 300;
const cutLeft: LogoPoint = [a[0] + (m[0] - a[0]) * (cutY - a[1]) / (m[1] - a[1]), cutY];
const cutRight: LogoPoint = [b[0] + (c[0] - b[0]) * (cutY - b[1]) / (c[1] - b[1]), cutY];

/**
 * Six closed-outline components tile the emblem. Adjacent pieces share the exact
 * same cut vertices; all original negative space remains empty. Only the authored
 * upper-right stroke is detached in the completed mark. Point lists omit a repeated
 * last point because Three Shape and SVG polygons close them automatically.
 */
export const logoPieces: { id: string; points: LogoPoint[] }[] = [
  { id: "descending-upper", points: [a, b, cutRight, cutLeft] },
  { id: "descending-lower", points: [cutLeft, cutRight, c, m] },
  { id: "rising-return", points: [c, d, l, m] },
  { id: "right-diagonal", points: [d, e, f, g, h, k, l] },
  { id: "lower-spur", points: [h, i, j, k] },
  { id: "detached-wing", points: logoDetachedStroke },
];

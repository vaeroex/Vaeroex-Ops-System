import {
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from "three";

export type CellPoint = readonly [number, number, number];

/** A closed organic envelope with subtle non-periodic-looking lobes, not a perfect ball. */
export function organicSphere(
  width: number,
  height: number,
  depth: number,
  seed = 0,
  detail = 32,
) {
  const geometry = new SphereGeometry(
    1,
    detail,
    Math.max(12, Math.floor(detail * 0.67)),
  );
  const positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const radial =
      1 +
      0.038 * Math.sin(x * 7.3 + seed) * Math.sin(y * 5.7 + z * 2.3) +
      0.019 * Math.cos(z * 11 + x * 4 + seed) +
      0.009 *
        Math.sin(x * 19 + seed) *
        Math.sin(y * 17 - seed) *
        Math.cos(z * 21);
    positions.setXYZ(
      i,
      x * width * radial,
      y * height * radial,
      z * depth * radial,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

function envelopePoint(
  u: number,
  v: number,
  radius: number,
  breath = 0,
): CellPoint {
  const warp =
    1 +
    0.045 * Math.sin(3 * u + 0.6) * Math.sin(v) ** 2 +
    0.026 * Math.cos(5 * u - 1) * Math.sin(2 * v) +
    0.007 * Math.sin(11 * u + 0.6) * Math.sin(8 * v) ** 2 +
    breath;
  return [
    Math.cos(u) * Math.sin(v) * radius * 1.13 * warp,
    Math.sin(u) * Math.sin(v) * radius * 0.89 * warp,
    Math.cos(v) * radius * warp,
  ];
}

export function cellEnvelope(radius: number, compact: boolean, rim = false) {
  const columns = compact ? 42 : 72;
  const rows = rim ? 1 : compact ? 25 : 40;
  const geometry = new BufferGeometry();
  const position = new Float32Array((columns + 1) * (rows + 1) * 3);
  const indices: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setIndex(indices);
  geometry.userData = { columns, rows, radius, rim };
  updateCellEnvelope(geometry, 0.04);
  return geometry;
}

/** The opening changes actual vertices; the edge remains a visible bilayer-thickness surface. */
export function updateCellEnvelope(
  geometry: BufferGeometry,
  opening: number,
  breath = 0,
) {
  const { columns, rows, radius, rim } = geometry.userData as {
    columns: number;
    rows: number;
    radius: number;
    rim: boolean;
  };
  const position = geometry.getAttribute("position");
  for (let row = 0; row <= rows; row += 1) {
    const v = rim ? opening : opening + ((Math.PI - opening) * row) / rows;
    const r = rim ? radius - 0.095 * row : radius;
    for (let column = 0; column <= columns; column += 1) {
      const u = (column / columns) * Math.PI * 2;
      position.setXYZ(
        row * (columns + 1) + column,
        ...envelopePoint(u, v, r, breath),
      );
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

export function cellTube(
  points: readonly CellPoint[],
  radius: number,
  segments = 72,
  sides = 7,
  closed = false,
) {
  return new TubeGeometry(
    new CatmullRomCurve3(
      points.map((point) => new Vector3(...point)),
      closed,
      "centripetal",
      0.4,
    ),
    segments,
    radius,
    sides,
    closed,
  );
}

/** Continuous alpha-helical and looped scaffold: deliberately generic, not a claimed molecular structure. */
export function foldedProtein(compact: boolean, membrane = false) {
  const points: CellPoint[] = [];
  const count = membrane ? 7 : 6;
  const helixSamples = compact ? 28 : 46;
  for (let domain = 0; domain < count; domain += 1) {
    const angle = (domain / count) * Math.PI * 2;
    const cx = Math.cos(angle) * (membrane ? 0.2 : 0.3);
    const cz = Math.sin(angle) * (membrane ? 0.2 : 0.25);
    const direction = domain % 2 === 0 ? 1 : -1;
    for (let j = 0; j <= helixSamples; j += 1) {
      const unit = j / helixSamples;
      const spin = unit * Math.PI * (membrane ? 10 : 8);
      const y = (unit - 0.5) * (membrane ? 0.94 : 0.57) * direction;
      const splay = membrane ? 0 : 0.12 * Math.sin(y * 4 + angle);
      points.push([
        cx + Math.cos(spin) * 0.067 + splay,
        y,
        cz + Math.sin(spin) * 0.067,
      ]);
    }
    const nextAngle = ((domain + 1) / count) * Math.PI * 2;
    const lastY = direction * (membrane ? 0.47 : 0.285);
    if (domain < count - 1) {
      points.push([
        (cx + Math.cos(nextAngle) * (membrane ? 0.2 : 0.3)) / 2,
        lastY + direction * (0.13 + 0.05 * Math.sin(domain * 2.1)),
        (cz + Math.sin(nextAngle) * (membrane ? 0.2 : 0.25)) / 2 + 0.12,
      ]);
    }
  }
  return cellTube(
    points,
    membrane ? 0.035 : 0.037,
    compact ? 320 : 570,
    compact ? 5 : 8,
  );
}

/** Shared surface sampling keeps ribosomes and edge membranes attached to the ruffled ER. */
export function reticulumPoint(
  layer: number,
  along: number,
  across: number,
): CellPoint {
  const angle =
    0.06 +
    layer * 0.031 +
    along * Math.PI * (1.54 + 0.07 * Math.sin(layer * 1.1));
  const width =
    0.4 +
    0.11 * Math.sin(angle * 2.3 + layer * 0.7) +
    0.045 * Math.cos(angle * 5.1);
  const radial = 1.07 + layer * 0.017 + across * width;
  const fold =
    Math.sin(angle * 2.4 + layer * 0.77) * 0.15 +
    Math.sin(angle * 5.1 - layer * 0.35) * 0.064;
  return [
    -0.85 + Math.cos(angle) * radial,
    -0.55 +
      layer * 0.205 +
      fold +
      Math.sin(across * Math.PI * 1.5 + angle) * 0.065,
    -0.48 + Math.sin(angle) * radial * (0.73 + 0.025 * Math.sin(layer)),
  ];
}

/** Asymmetric cisternae wrap the nucleus; widths, folds and edges vary continuously. */
export function reticulumSheet(layer: number, compact: boolean) {
  const columns = compact ? 40 : 68;
  const rows = 6;
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col <= columns; col += 1) {
      vertices.push(...reticulumPoint(layer, col / columns, row / rows));
      if (row < rows && col < columns) {
        const a = row * (columns + 1) + col;
        const b = a + columns + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function golgiCisterna(layer: number, compact: boolean) {
  const geometry = organicSphere(
    0.81 - layer * 0.034,
    0.075,
    0.4 - layer * 0.021,
    layer,
    compact ? 20 : 38,
  );
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    position.setY(
      index,
      position.getY(index) +
        0.24 * x * x +
        0.04 * Math.sin(z * 8 + layer * 0.8) +
        0.035 * Math.sin(x * 6 + layer * 0.5) * z,
    );
    position.setZ(
      index,
      z + 0.22 * x * x + 0.035 * Math.sin(x * 5 + layer * 0.7),
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function mitochondrialEnvelope(compact: boolean) {
  const geometry = organicSphere(0.9, 0.36, 0.36, 1.5, compact ? 22 : 38);
  const position = geometry.getAttribute("position");
  // A bean silhouette; an open-facing shell is made by omitting the front cap.
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    position.setY(index, position.getY(index) + 0.16 * Math.cos(x * 2.6));
  }
  const original = geometry.getIndex();
  const retained: number[] = [];
  if (original)
    for (let index = 0; index < original.count; index += 3) {
      const a = original.getX(index),
        b = original.getX(index + 1),
        c = original.getX(index + 2);
      const front =
        (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
      if (front < 0.18) retained.push(a, b, c);
    }
  geometry.setIndex(retained);
  geometry.computeVertexNormals();
  return geometry;
}

export function mitochondrialCrista(
  index: number,
  count: number,
  compact: boolean,
) {
  const x = -0.7 + (index / (count - 1)) * 1.4;
  const height = 0.25 * Math.sqrt(Math.max(0.1, 1 - (x / 0.86) ** 2));
  const bend = 0.16 * Math.cos(x * 2.6);
  const points: CellPoint[] = [
    [x - 0.035, bend - height, -0.12],
    [x + 0.045, bend - height * 0.55, 0.17],
    [x - 0.04, bend, 0.21],
    [x + 0.03, bend + height * 0.65, 0.13],
    [x - 0.02, bend + height, -0.14],
  ];
  return cellTube(points, 0.037, compact ? 15 : 26, 6);
}

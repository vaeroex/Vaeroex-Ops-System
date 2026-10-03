import { ExtrudeGeometry, Path, Shape } from "three";

type CornerPoint = readonly [number, number];

function perimeter(width: number, height: number, cut: number): CornerPoint[] {
  const x = width / 2;
  const y = height / 2;
  return [
    [-x + cut, -y],
    [x - cut, -y],
    [x, -y + cut],
    [x, y - cut],
    [x - cut, y],
    [-x + cut, y],
    [-x, y - cut],
    [-x, -y + cut],
  ];
}

function trace(path: Shape | Path, points: CornerPoint[]) {
  path.moveTo(...points[0]);
  points.slice(1).forEach((point) => path.lineTo(...point));
  path.closePath();
}

/** Milled octagonal apertures: actual bevels and through-holes, never a texture. */
export function apertureGeometry(
  width: number,
  height: number,
  band: number,
  depth: number,
  cut = 0.45,
  bevel = 0.035,
) {
  const shape = new Shape();
  trace(shape, perimeter(width, height, cut));
  const hole = new Path();
  trace(
    hole,
    perimeter(
      width - band * 2,
      height - band * 2,
      Math.max(0.08, cut - band * 0.4),
    ).reverse(),
  );
  shape.holes.push(hole);
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    steps: 1,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

export function plateGeometry(
  width: number,
  height: number,
  depth: number,
  cut = 0.15,
  bevel = 0.035,
) {
  const shape = new Shape();
  trace(shape, perimeter(width, height, cut));
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    steps: 1,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

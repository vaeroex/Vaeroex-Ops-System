import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  ExtrudeGeometry,
  Float32BufferAttribute,
  LinearFilter,
  Object3D,
  RepeatWrapping,
  RGBAFormat,
  Shape,
  UnsignedByteType,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

function chamferedDocument(width: number, height: number, corner: number) {
  const x = width / 2,
    y = height / 2;
  const shape = new Shape();
  shape.moveTo(-x + corner, -y);
  shape.lineTo(x - corner, -y);
  shape.lineTo(x, -y + corner);
  shape.lineTo(x, y - corner * 3.8);
  shape.lineTo(x - corner * 3.8, y);
  shape.lineTo(-x + corner, y);
  shape.lineTo(-x, y - corner);
  shape.lineTo(-x, -y + corner);
  shape.closePath();
  return shape;
}
function extrude(shape: Shape, depth: number, bevel: number) {
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: bevel > 0,
    bevelSegments: 2,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}
function merged(parts: BufferGeometry[]) {
  const converted = parts.map((part) =>
    part.index ? part.toNonIndexed() : part,
  );
  const result = mergeGeometries(converted, false);
  if (!result)
    throw new Error("The landing atlas geometry could not be assembled");
  new Set([...parts, ...converted]).forEach((part) => part.dispose());
  result.computeBoundingSphere();
  return result;
}
function bar(
  parts: BufferGeometry[],
  x: number,
  y: number,
  width: number,
  height: number,
  z = 0.087,
) {
  const geometry = new BoxGeometry(width, height, 0.006);
  geometry.translate(x, y, z);
  parts.push(geometry);
}
function line(
  parts: BufferGeometry[],
  from: Vector3,
  to: Vector3,
  width: number,
) {
  const direction = to.clone().sub(from);
  const geometry = new CylinderGeometry(width, width, direction.length(), 6, 1);
  const transform = new Object3D();
  transform.position.copy(from).add(to).multiplyScalar(0.5);
  transform.quaternion.setFromUnitVectors(
    new Vector3(0, 1, 0),
    direction.normalize(),
  );
  transform.updateMatrix();
  geometry.applyMatrix4(transform.matrix);
  parts.push(geometry);
}
function documentEtching(domain: number, compact: boolean) {
  const parts: BufferGeometry[] = [];
  bar(parts, -0.12, 0.4, 0.43, 0.023);
  bar(parts, -0.2, 0.34, 0.27, 0.009);
  if (domain === 0) {
    [0.5, 0.4, 0.48, 0.3, 0.47, 0.38].forEach((width, index) =>
      bar(
        parts,
        -0.31 + width / 2,
        0.18 - index * 0.085,
        width,
        index === 2 ? 0.018 : 0.011,
      ),
    );
  } else if (domain === 1) {
    [0.16, 0.29, 0.23, 0.37, 0.43].forEach((height, index) =>
      bar(parts, -0.25 + index * 0.105, -0.25 + height / 2, 0.033, height),
    );
    bar(parts, -0.015, -0.3, 0.58, 0.009);
  } else {
    const points = [
      [-0.23, 0.09],
      [0.1, 0.18],
      [0.25, -0.12],
      [-0.05, -0.27],
      [-0.28, -0.11],
    ];
    points.forEach(([x, y], index) => {
      const disk = new CylinderGeometry(0.035, 0.035, 0.006, compact ? 8 : 12);
      disk.rotateX(Math.PI / 2);
      disk.translate(x, y, 0.087);
      parts.push(disk);
      const next = points[(index + 1) % points.length];
      line(
        parts,
        new Vector3(x, y, 0.087),
        new Vector3(next[0], next[1], 0.087),
        0.005,
      );
    });
  }
  for (let index = 0; index < (compact ? 6 : 11); index += 1)
    bar(
      parts,
      -0.3 + index * 0.037,
      -0.43,
      index % 3 === 0 ? 0.013 : 0.006,
      index % 2 === 0 ? 0.047 : 0.03,
    );
  return merged(parts);
}
function taperedCore() {
  const positions: number[] = [],
    colors: number[] = [];
  const levels = [
    [-2.3, 0.62],
    [1.75, 0.37],
    [2.63, 0.15],
  ];
  const ring = (height: number, radius: number) =>
    Array.from({ length: 6 }, (_, index) => {
      const angle = (index * Math.PI) / 3 + 0.35;
      return new Vector3(
        Math.sin(angle) * radius,
        height,
        Math.cos(angle) * radius,
      );
    });
  const triangle = (a: Vector3, b: Vector3, c: Vector3, color: Color) => {
    [a, b, c].forEach((point) => {
      positions.push(...point.toArray());
      colors.push(color.r, color.g, color.b);
    });
  };
  for (let level = 0; level < levels.length - 1; level += 1) {
    const lower = ring(...(levels[level] as [number, number])),
      upper = ring(...(levels[level + 1] as [number, number]));
    for (let index = 0; index < 6; index += 1) {
      const next = (index + 1) % 6,
        color = new Color(index % 2 === 0 ? "#6c91ff" : "#2a48a2");
      triangle(lower[index], lower[next], upper[next], color);
      triangle(lower[index], upper[next], upper[index], color);
    }
  }
  const top = ring(...(levels[levels.length - 1] as [number, number]));
  for (let index = 0; index < 6; index += 1)
    triangle(
      top[index],
      top[(index + 1) % 6],
      new Vector3(0, 2.8, 0),
      new Color("#9db5ff"),
    );
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
function foundation() {
  const parts: BufferGeometry[] = [];
  for (let level = 0; level < 3; level += 1) {
    const shape = new Shape();
    const radius = 2.0 - level * 0.18;
    for (let side = 0; side < 3; side += 1) {
      const angle = (side * Math.PI * 2) / 3 + 0.35;
      const x = Math.sin(angle) * radius,
        y = Math.cos(angle) * radius;
      if (side === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    const geometry = extrude(shape, 0.055, 0.03);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -2.45 + level * 0.1, 0);
    parts.push(geometry);
  }
  return merged(parts);
}
export function makeLandingFinish() {
  const size = 64,
    pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const value = Math.round(
        206 + Math.sin(x * 38.1 + y * 97.7) * Math.sin(y * 2.9) * 8,
      );
      const index = (y * size + x) * 4;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  const texture = new DataTexture(
    pixels,
    size,
    size,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(6, 24);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
export function makeLandingGeometry(compact: boolean) {
  const body = extrude(chamferedDocument(0.95, 1.28, 0.065), 0.105, 0.016);
  const face = extrude(chamferedDocument(0.82, 1.13, 0.055), 0.013, 0.004);
  face.translate(0, 0, 0.064);
  const trim: BufferGeometry[] = [],
    accent: BufferGeometry[] = [],
    rivets: BufferGeometry[] = [];
  bar(trim, -0.425, 0, 0.012, 0.93, 0.065);
  bar(trim, 0, -0.58, 0.68, 0.01, 0.065);
  bar(accent, -0.11, -0.51, 0.42, 0.019, 0.076);
  bar(accent, -0.31, 0.48, 0.042, 0.038, 0.08);
  [
    [-0.395, -0.54],
    [0.395, -0.54],
    [-0.395, 0.54],
  ].forEach(([x, y]) => {
    const rivet = new CylinderGeometry(0.014, 0.014, 0.009, compact ? 6 : 10);
    rivet.rotateX(Math.PI / 2);
    rivet.translate(x, y, 0.068);
    rivets.push(rivet);
  });
  const rails: BufferGeometry[] = [];
  for (let index = 0; index < 3; index += 1) {
    const angle = (index * Math.PI * 2) / 3 + 0.35;
    line(
      rails,
      new Vector3(Math.sin(angle) * 0.66, -2.2, Math.cos(angle) * 0.66),
      new Vector3(Math.sin(angle) * 0.19, 2.6, Math.cos(angle) * 0.19),
      0.034,
    );
    for (let level = 0; level < 13; level += 1) {
      const fin = new BoxGeometry(0.085, 0.024, 0.19);
      fin.rotateY(angle);
      fin.translate(
        Math.sin(angle) * (0.57 - level * 0.024),
        -1.9 + level * 0.32,
        Math.cos(angle) * (0.57 - level * 0.024),
      );
      rails.push(fin);
    }
  }
  return {
    body,
    face,
    trim: merged(trim),
    accent: merged(accent),
    rivets: merged(rivets),
    etchings: [0, 1, 2].map((domain) => documentEtching(domain, compact)),
    core: taperedCore(),
    foundation: foundation(),
    rails: merged(rails),
    conduit: new CylinderGeometry(1, 1, 1, compact ? 5 : 7, 1),
    packet: new BoxGeometry(0.055, 0.055, 0.17),
    node: new CylinderGeometry(0.035, 0.035, 0.025, compact ? 6 : 10),
  };
}

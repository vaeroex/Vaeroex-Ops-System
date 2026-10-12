import {
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Shape,
  Vector3,
} from "three";
import type { ExecutiveVector } from "./ExecutiveMotion";

/** A solid ledger or architectural slab, laid in X/Z with Y thickness. */
export function executiveSlab(
  width: number,
  depth: number,
  thickness: number,
  radius = 0.065,
  bevel = 0.022,
) {
  const x = width / 2,
    z = depth / 2,
    r = Math.min(radius, x * 0.5, z * 0.5);
  const shape = new Shape();
  shape.moveTo(-x + r, -z);
  shape.lineTo(x - r, -z);
  shape.quadraticCurveTo(x, -z, x, -z + r);
  shape.lineTo(x, z - r);
  shape.quadraticCurveTo(x, z, x - r, z);
  shape.lineTo(-x + r, z);
  shape.quadraticCurveTo(-x, z, -x, z - r);
  shape.lineTo(-x, -z + r);
  shape.quadraticCurveTo(-x, -z, -x + r, -z);
  const geometry = new ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 5,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

/** Asymmetric cut corner makes a source document distinct from a building tile. */
export function executiveDocument(
  width: number,
  depth: number,
  thickness: number,
) {
  const x = width / 2,
    z = depth / 2;
  const shape = new Shape();
  shape.moveTo(-x, -z);
  shape.lineTo(x - 0.16, -z);
  shape.lineTo(x, -z + 0.16);
  shape.lineTo(x, z);
  shape.lineTo(-x, z);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelSize: 0.018,
    bevelThickness: 0.015,
    bevelSegments: 2,
    curveSegments: 1,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

export function executiveFlow(segments = 40, sides = 6) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      new Float32Array((segments + 1) * (sides + 1) * 3),
      3,
    ),
  );
  geometry.setAttribute(
    "normal",
    new Float32BufferAttribute(
      new Float32Array((segments + 1) * (sides + 1) * 3),
      3,
    ),
  );
  const indices: number[] = [];
  for (let row = 0; row < segments; row += 1)
    for (let side = 0; side < sides; side += 1) {
      const a = row * (sides + 1) + side,
        b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  geometry.setIndex(indices);
  geometry.userData = { segments, sides };
  return geometry;
}

/** Rebuild only tube vertices, preserving all GPU objects during scroll. */
export function updateExecutiveFlow(
  geometry: BufferGeometry,
  start: ExecutiveVector,
  end: ExecutiveVector,
  arch: number,
  radius = 0.025,
) {
  const { segments, sides } = geometry.userData as {
    segments: number;
    sides: number;
  };
  const positions = geometry.getAttribute("position"),
    normals = geometry.getAttribute("normal");
  const a = new Vector3(...start),
    b = new Vector3(...end);
  const control = new Vector3(
    (a.x + b.x) / 2,
    Math.max(a.y, b.y) + arch,
    (a.z + b.z) / 2,
  );
  const axis = new Vector3(0, 1, 0),
    tangent = new Vector3(),
    normal = new Vector3(),
    binormal = new Vector3(),
    center = new Vector3();
  for (let row = 0; row <= segments; row += 1) {
    const t = row / segments,
      s = 1 - t;
    center
      .copy(a)
      .multiplyScalar(s * s)
      .addScaledVector(control, 2 * s * t)
      .addScaledVector(b, t * t);
    tangent
      .copy(control)
      .sub(a)
      .multiplyScalar(2 * s)
      .addScaledVector(new Vector3().copy(b).sub(control), 2 * t)
      .normalize();
    normal.crossVectors(tangent, axis);
    if (normal.lengthSq() < 0.001) normal.set(1, 0, 0);
    else normal.normalize();
    binormal.crossVectors(tangent, normal).normalize();
    for (let side = 0; side <= sides; side += 1) {
      const angle = (side / sides) * Math.PI * 2,
        c = Math.cos(angle),
        sine = Math.sin(angle);
      const nx = normal.x * c + binormal.x * sine,
        ny = normal.y * c + binormal.y * sine,
        nz = normal.z * c + binormal.z * sine;
      const index = row * (sides + 1) + side;
      positions.setXYZ(
        index,
        center.x + nx * radius,
        center.y + ny * radius,
        center.z + nz * radius,
      );
      normals.setXYZ(index, nx, ny, nz);
    }
  }
  positions.needsUpdate = true;
  normals.needsUpdate = true;
  geometry.computeBoundingSphere();
}

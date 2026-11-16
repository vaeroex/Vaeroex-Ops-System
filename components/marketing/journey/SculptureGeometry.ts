import {
  DataTexture, ExtrudeGeometry, RepeatWrapping, RGBAFormat, Shape, UnsignedByteType,
  type BufferGeometry,
} from "three";
import { sculptureShapes } from "./journeyMotion";

/** Inset the source polygon before beveling so the outer silhouette stays exact. */
function inset(points: [number, number][], amount: number): [number, number][] {
  const signedArea = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  const normal = (a: number[], b: number[]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    const sign = signedArea > 0 ? 1 : -1;
    return [-dy / length * sign, dx / length * sign];
  };
  return points.map((p, i) => {
    const before = normal(points[(i + points.length - 1) % points.length], p);
    const after = normal(p, points[(i + 1) % points.length]);
    const divisor = 1 + before[0] * after[0] + before[1] * after[1];
    return [p[0] + (before[0] + after[0]) * amount / divisor,
      p[1] + (before[1] + after[1]) * amount / divisor];
  });
}
export function createSculptureGeometries(compact = false): Record<string, BufferGeometry> {
  return Object.fromEntries(Object.entries(sculptureShapes).map(([key, { outline, size, bevel }]) => {
    const points = inset(outline, bevel), shape = new Shape();
    shape.moveTo(...points[0]);
    points.slice(1).forEach(point => shape.lineTo(...point));
    shape.closePath();
    const depth = size[2] - bevel * 2;
    const geometry = new ExtrudeGeometry(shape, {
      depth, steps: 1, bevelEnabled: true, bevelSize: bevel,
      bevelThickness: bevel, bevelSegments: compact ? 1 : 2, curveSegments: 1,
    }).translate(0, 0, -depth / 2);
    return [key, geometry];
  }));
}

/** A small deterministic brushed roughness map; no image asset or HDR download. */
export function createSculptureFinish() {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = (y * size + x) * 4;
    const grain = Math.sin(y * 127.1 + x * 311.7) * 43758.5453;
    const value = Math.round(219 + (grain - Math.floor(grain)) * 6);
    pixels[offset] = value; pixels[offset + 1] = value; pixels[offset + 2] = value; pixels[offset + 3] = 255;
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(16, 64);
  texture.needsUpdate = true;
  return texture;
}

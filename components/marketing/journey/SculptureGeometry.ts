import {
  BoxGeometry, DataTexture, ExtrudeGeometry, RepeatWrapping, RGBAFormat, Shape, UnsignedByteType,
  type BufferGeometry,
} from "three";
import { sculptureShapes } from "./journeyMotion";

/** Constant-width, planar chamfers keep the large pieces machined rather than pillowy. */
export function createSculptureGeometries(compact = false): Record<string, BufferGeometry> {
  return Object.fromEntries(Object.entries(sculptureShapes).map(([key, { size, bevel }]) => {
    if (!bevel) return [key, new BoxGeometry(...size)];
    const w = size[0] - bevel * 2, h = size[1] - bevel * 2;
    const cut = Math.min(.22, Math.min(w, h) * .12);
    const outline = new Shape();
    outline.moveTo(-w / 2 + cut, -h / 2);
    outline.lineTo(w / 2 - cut, -h / 2);
    outline.lineTo(w / 2, -h / 2 + cut);
    outline.lineTo(w / 2, h / 2 - cut);
    outline.lineTo(w / 2 - cut, h / 2);
    outline.lineTo(-w / 2 + cut, h / 2);
    outline.lineTo(-w / 2, h / 2 - cut);
    outline.lineTo(-w / 2, -h / 2 + cut);
    outline.closePath();
    const depth = size[2] - bevel * 2;
    const geometry = new ExtrudeGeometry(outline, {
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

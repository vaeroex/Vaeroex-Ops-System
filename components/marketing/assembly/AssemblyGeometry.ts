import {
  BoxGeometry,
  CylinderGeometry,
  Shape,
  ExtrudeGeometry,
  TorusGeometry,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
function box(x: number, y: number, z: number, px = 0, py = 0, pz = 0) {
  return new BoxGeometry(x, y, z).translate(px, py, pz);
}
function merge(parts: BufferGeometry[]) {
  const plain = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const result = mergeGeometries(plain);
  new Set([...parts, ...plain]).forEach((p) => p.dispose());
  return result;
}
export function recordGeometry(family: number) {
  const w = family === 2 ? 1.35 : 1.05,
    h = family === 4 ? 0.85 : 1.35,
    r = 0.1;
  const s = new Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const body = new ExtrudeGeometry(s, {
    depth: 0.12,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.035,
    bevelThickness: 0.025,
    curveSegments: 5,
  });
  const details: BufferGeometry[] = [
    box(w * 0.65, 0.035, 0.025, -w * 0.06, h * 0.34, 0.17),
  ];
  if (family === 0 || family === 3)
    for (let j = 0; j < 7; j++)
      details.push(
        box(
          w * (j % 3 === 0 ? 0.5 : 0.73),
          0.018,
          0.025,
          -0.02,
          h * 0.18 - j * 0.11,
          0.17,
        ),
      );
  if (family === 1) {
    for (let j = 0; j < 5; j++)
      details.push(
        box(0.018, h * 0.58, 0.025, -w * 0.35 + j * w * 0.175, -0.09, 0.17),
      );
    for (let j = 0; j < 6; j++)
      details.push(box(w * 0.7, 0.018, 0.025, 0, h * 0.16 - j * 0.12, 0.17));
  }
  if (family === 2) {
    for (let j = 0; j < 6; j++)
      details.push(
        box(
          0.11,
          0.16 + j * 0.065,
          0.045,
          -0.45 + j * 0.18,
          -0.28 + j * 0.033,
          0.18,
        ),
      );
    details.push(box(1.05, 0.018, 0.025, 0, -0.36, 0.17));
  }
  if (family === 4) {
    details.push(
      box(0.8, 0.022, 0.025, 0, -0.2, 0.17),
      box(0.022, 0.4, 0.025, -0.4, 0, 0.17),
      box(0.022, 0.4, 0.025, 0.4, 0, 0.17),
    );
    for (let j = 0; j < 4; j++) {
      const b = box(
        0.23,
        0.04,
        0.035,
        -0.27 + j * 0.18,
        -0.08 + Math.sin(j) * 0.12,
        0.18,
      );
      b.rotateZ(0.1);
      details.push(b);
    }
  }
  if (family === 5) {
    for (let j = 0; j < 6; j++) {
      const a = (j * Math.PI) / 3;
      details.push(
        new CylinderGeometry(0.065, 0.065, 0.035, 8)
          .rotateX(Math.PI / 2)
          .translate(Math.cos(a) * 0.32, Math.sin(a) * 0.32 - 0.08, 0.18),
      );
      const b = box(0.3, 0.018, 0.025, 0, 0, 0.18);
      b.rotateZ(a);
      b.translate(Math.cos(a) * 0.16, Math.sin(a) * 0.16 - 0.08, 0);
      details.push(b);
    }
  }
  const trace = merge(details);
  const frame = merge([
    box(w - 0.08, 0.025, 0.04, 0, -h / 2 + 0.035, 0.16),
    box(0.025, h - 0.08, 0.04, -w / 2 + 0.035, 0, 0.16),
    box(0.025, h - 0.08, 0.04, w / 2 - 0.035, 0, 0.16),
  ]);
  return { body, trace, frame };
}
export function assemblyResources() {
  return {
    records: Array.from({ length: 6 }, (_, i) => recordGeometry(i)),
    beam: new CylinderGeometry(1, 1, 1, 5),
    node: new BoxGeometry(0.08, 0.08, 0.08),
    ring: new TorusGeometry(2.05, 0.035, 5, 64),
    rib: new BoxGeometry(0.055, 7.1, 0.055),
  };
}

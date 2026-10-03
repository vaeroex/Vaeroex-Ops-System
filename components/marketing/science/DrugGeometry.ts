import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Float32BufferAttribute,
  TubeGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ProteinBackbonePoint, ScienceSurface } from "./dataTypes";

function mergeAndRelease(parts: BufferGeometry[]): BufferGeometry {
  if (!parts.length) return new BufferGeometry();
  const result = mergeGeometries(parts, false) ?? parts[0].clone();
  parts.forEach((part) => part.dispose());
  return result;
}

/** Sweeps the actual Cα trace using carbonyl oxygen to orient the ribbon. */
function ribbonGeometry(
  points: ProteinBackbonePoint[],
  compact: boolean,
  sheet: boolean,
) {
  const curve = new CatmullRomCurve3(
    points.map((point) => new Vector3(...point.position)),
    false,
    "centripetal",
  );
  const steps = Math.max(10, (points.length - 1) * (compact ? 3 : 6));
  const positions: number[] = [];
  const indices: number[] = [];
  const previous = new Vector3();
  for (let sample = 0; sample <= steps; sample += 1) {
    const t = sample / steps;
    const center = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const residueIndex = Math.min(
      points.length - 2,
      Math.floor(t * (points.length - 1)),
    );
    const fraction = t * (points.length - 1) - residueIndex;
    const left = points[residueIndex];
    const right = points[residueIndex + 1];
    const oxygen = new Vector3(...(left.oxygen ?? left.position)).lerp(
      new Vector3(...(right.oxygen ?? right.position)),
      fraction,
    );
    const backbone = new Vector3(...left.position).lerp(
      new Vector3(...right.position),
      fraction,
    );
    const width = oxygen.sub(backbone);
    width.addScaledVector(tangent, -width.dot(tangent));
    if (width.lengthSq() < 0.00001)
      width.crossVectors(
        tangent,
        Math.abs(tangent.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0),
      );
    width.normalize();
    if (sample > 0) {
      if (width.dot(previous) < 0) width.negate();
      width.lerp(previous, compact ? 0.68 : 0.8);
      width.addScaledVector(tangent, -width.dot(tangent)).normalize();
    }
    previous.copy(width);
    const normal = new Vector3().crossVectors(tangent, width).normalize();
    // Sheet arrowheads retain the deposited backbone path; only the cartoon width changes.
    const taper = sheet && t > 0.76 ? 1.8 * Math.max(0.045, (1 - t) / 0.24) : 1;
    const halfWidth = (sheet ? 0.145 : 0.105) * taper;
    const halfThickness = sheet ? 0.016 : 0.023;
    for (const [side, face] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const vertex = center
        .clone()
        .addScaledVector(width, side * halfWidth)
        .addScaledVector(normal, face * halfThickness);
      positions.push(vertex.x, vertex.y, vertex.z);
    }
    if (sample > 0) {
      const current = sample * 4;
      const prior = current - 4;
      for (let side = 0; side < 4; side += 1) {
        const nextSide = (side + 1) % 4;
        indices.push(
          prior + side,
          current + side,
          prior + nextSide,
          current + side,
          current + nextSide,
          prior + nextSide,
        );
      }
    }
  }
  indices.push(0, 2, 1, 0, 3, 2);
  const end = steps * 4;
  indices.push(end, end + 1, end + 2, end, end + 2, end + 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function makeDrugRibbons(
  backbone: ProteinBackbonePoint[],
  compact: boolean,
) {
  const coils: BufferGeometry[] = [];
  const helices: BufferGeometry[] = [];
  const sheets: BufferGeometry[] = [];
  const chains: ProteinBackbonePoint[][] = [];
  backbone.forEach((point) => {
    const chain = chains[chains.length - 1];
    const previous = chain?.[chain.length - 1];
    if (
      !previous ||
      previous.chain !== point.chain ||
      point.residue - previous.residue > 1
    )
      chains.push([point]);
    else chain.push(point);
  });
  chains.forEach((chain) => {
    if (chain.length < 2) return;
    const curve = new CatmullRomCurve3(
      chain.map((point) => new Vector3(...point.position)),
      false,
      "centripetal",
    );
    coils.push(
      new TubeGeometry(
        curve,
        Math.max(8, chain.length * (compact ? 2 : 4)),
        0.028,
        compact ? 5 : 7,
        false,
      ),
    );
    let start = 0;
    while (start < chain.length) {
      const secondary = chain[start].secondary;
      let end = start + 1;
      while (end < chain.length && chain[end].secondary === secondary) end += 1;
      if (secondary !== "coil" && end - start >= 2) {
        const points = chain.slice(
          Math.max(0, start - 1),
          Math.min(chain.length, end + 1),
        );
        (secondary === "helix" ? helices : sheets).push(
          ribbonGeometry(points, compact, secondary === "sheet"),
        );
      }
      start = end;
    }
  });
  return {
    coil: mergeAndRelease(coils),
    helix: mergeAndRelease(helices),
    sheet: mergeAndRelease(sheets),
  };
}

/** Splits the derived Gaussian envelope into a body and an illustrative local focus. */
export function makeDrugSurface(surface: ScienceSurface, pocketRadius: number) {
  const position = new Float32BufferAttribute(surface.positions, 3);
  const normal = new Float32BufferAttribute(surface.normals, 3);
  const colors = new Float32Array(surface.positions.length);
  const graphite = new Color("#667d88");
  const cyan = new Color("#4dabc5");
  const color = new Color();
  const point = new Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    const blend = Math.max(0, 1 - point.length() / (pocketRadius * 3.2));
    color.copy(graphite).lerp(cyan, blend * blend);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  const colorAttribute = new Float32BufferAttribute(colors, 3);
  const bodyIndices: number[] = [];
  const pocketIndices: number[] = [];
  for (let index = 0; index < surface.indices.length; index += 3) {
    const a = surface.indices[index],
      b = surface.indices[index + 1],
      c = surface.indices[index + 2];
    const x = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
    const y = (position.getY(a) + position.getY(b) + position.getY(c)) / 3;
    const z = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
    (Math.hypot(x, y, z) < pocketRadius * 2.05
      ? pocketIndices
      : bodyIndices
    ).push(a, b, c);
  }
  const create = (indices: number[]) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", position);
    geometry.setAttribute("normal", normal);
    geometry.setAttribute("color", colorAttribute);
    geometry.setIndex(indices);
    return geometry;
  };
  return { body: create(bodyIndices), pocket: create(pocketIndices) };
}

"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import {
  cellEnvelope,
  cellTube,
  foldedProtein,
  golgiCisterna,
  mitochondrialCrista,
  mitochondrialEnvelope,
  organicSphere,
  reticulumSheet,
  reticulumPoint,
  updateCellEnvelope,
  type CellPoint,
} from "./CellGeometry";
import { evaluateBiologyMotion } from "./biologyMotion";

const NUCLEUS: CellPoint = [-0.87, 0.15, -0.48];
const NEIGHBOR_CELLS: ReadonlyArray<{
  position: CellPoint;
  scale: number;
  rotation: CellPoint;
}> = [
  { position: [-6.15, 2.4, -3.1], scale: 0.71, rotation: [0.3, 0.5, 0.32] },
  { position: [6.05, 2.6, -4.0], scale: 0.78, rotation: [-0.2, -0.45, -0.32] },
  { position: [-4.5, -4.55, -4.2], scale: 0.74, rotation: [0.1, 0.8, 0.46] },
  { position: [4.35, -4.1, -3.4], scale: 0.69, rotation: [0.15, -0.1, -0.6] },
  { position: [0.2, 5.8, -5.5], scale: 0.81, rotation: [0.4, 0.4, 0.2] },
  { position: [-0.4, -0.65, -8.3], scale: 0.85, rotation: [-0.2, 0.3, 0.6] },
  { position: [-9.5, -1.7, -9.7], scale: 0.79, rotation: [0.1, 0.8, 0.1] },
  { position: [9.0, -2.0, -9.1], scale: 0.83, rotation: [0.2, -0.6, -0.4] },
];

type Material = MeshStandardMaterial | MeshPhysicalMaterial;

function useCellResources(compact: boolean) {
  const resources = useMemo(() => {
    const wet = (color: string, roughness = 0.34, opacity = 1) =>
      new MeshPhysicalMaterial({
        color,
        roughness,
        metalness: 0,
        clearcoat: 0.3,
        clearcoatRoughness: 0.32,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1,
        side: FrontSide,
        forceSinglePass: true,
      });
    const matte = (color: string, emissive: string, strength = 0.08) =>
      new MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: strength,
        roughness: 0.52,
        metalness: 0,
        side: DoubleSide,
      });
    const materials = {
      membrane: wet("#315c72", 0.34, 0.31),
      innerMembrane: wet("#17384f", 0.44, 0.1),
      membraneEdge: wet("#497b98", 0.34, 0.8),
      lipidHeads: wet("#79a7b5", 0.46, 0.94),
      lipidTails: wet("#25455d", 0.55, 0.82),
      receptor: wet("#38a6a2", 0.41),
      receptorDomain: wet("#5186a7", 0.52, 0.84),
      nucleusOuter: wet("#344e82", 0.38, 0.52),
      nucleusInner: wet("#456590", 0.5, 0.24),
      pores: matte("#7489b5", "#2c3d68", 0.045),
      nucleolus: wet("#273554", 0.6),
      chromatin: matte("#6086b0", "#30496f", 0.08),
      reticulum: wet("#203e61", 0.5),
      reticulumEdge: matte("#5684a0", "#1d3657", 0.085),
      ribosome: matte("#8ca5ba", "#314c68", 0.04),
      mitochondrialOuter: wet("#1c4359", 0.43),
      mitochondrialInner: wet("#287480", 0.48),
      mitochondrialCristae: wet("#68a89f", 0.46),
      golgi: wet("#2b476c", 0.53),
      golgiEdge: wet("#4f6c83", 0.48),
      vesicle: wet("#4aa4b4", 0.21, 0.47),
      vesicleInner: wet("#5e9dad", 0.34, 0.23),
      cargo: wet("#41aa9c", 0.38),
      proteinAccent: wet("#426baf", 0.43),
      fiber: new MeshStandardMaterial({
        color: "#518295",
        emissive: "#2e5e75",
        emissiveIntensity: 0.13,
        roughness: 0.64,
        transparent: true,
        opacity: 0.37,
        depthWrite: false,
      }),
      transportTrack: new MeshStandardMaterial({
        color: "#7ea4af",
        emissive: "#46808a",
        emissiveIntensity: 0.12,
        roughness: 0.6,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
      tissueMembrane: wet("#32647c", 0.28, 0.16),
      tissueNucleus: wet("#426799", 0.37, 0.45),
      tissueOrganelle: wet("#4b959b", 0.46, 0.55),
      tissueConnection: new MeshStandardMaterial({
        color: "#609fae",
        emissive: "#3a7484",
        emissiveIntensity: 0.24,
        roughness: 0.6,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      }),
    };
    for (const material of [
      materials.membrane,
      materials.innerMembrane,
      materials.membraneEdge,
      materials.nucleusOuter,
      materials.nucleusInner,
      materials.reticulum,
      materials.mitochondrialOuter,
      materials.mitochondrialInner,
    ]) {
      material.side = DoubleSide;
    }
    const geometry = {
      outer: cellEnvelope(3.22, compact),
      inner: cellEnvelope(3.125, compact),
      edge: cellEnvelope(3.22, compact, true),
      nucleusOuter: cellEnvelope(1.02, compact),
      nucleusInner: cellEnvelope(0.96, compact),
      nucleolus: organicSphere(0.34, 0.3, 0.31, 0.7, compact ? 18 : 32),
      pore: new TorusGeometry(0.066, 0.016, compact ? 5 : 7, compact ? 9 : 13),
      head: new SphereGeometry(0.054, compact ? 7 : 10, compact ? 5 : 7),
      tail: new CylinderGeometry(0.016, 0.018, 0.2, 5, 1),
      receptor: foldedProtein(compact, true),
      receptorDomain: organicSphere(0.25, 0.13, 0.21, 2, compact ? 16 : 24),
      protein: foldedProtein(compact),
      smallProtein: foldedProtein(true),
      ribosome: organicSphere(0.04, 0.03, 0.04, 0.4, 8),
      mitochondrion: mitochondrialEnvelope(compact),
      vesicle: organicSphere(0.48, 0.46, 0.48, 0.2, compact ? 22 : 38),
      cargoBead: new SphereGeometry(0.06, compact ? 8 : 12, compact ? 6 : 9),
      tissue: organicSphere(
        3.22 * 1.13,
        3.22 * 0.89,
        3.22,
        0.4,
        compact ? 20 : 34,
      ),
      tissueNucleus: organicSphere(1.06, 0.9, 0.92, 1.5, compact ? 14 : 24),
      tissueMito: organicSphere(0.7, 0.24, 0.27, 0.8, compact ? 12 : 20),
    };
    updateCellEnvelope(geometry.nucleusOuter, 0.96);
    updateCellEnvelope(geometry.nucleusInner, 1.02);
    const sheets = Array.from({ length: compact ? 4 : 6 }, (_, index) =>
      reticulumSheet(index, compact),
    );
    const sheetEdges = sheets.map((_, index) => {
      const points = Array.from(
        { length: 52 },
        (__, i): CellPoint => reticulumPoint(index, i / 51, 1),
      );
      return cellTube(points, 0.023, compact ? 48 : 82, 5);
    });
    const golgi = Array.from({ length: compact ? 5 : 7 }, (_, i) =>
      golgiCisterna(i, compact),
    );
    const cristaCount = compact ? 7 : 10;
    const cristae = Array.from({ length: cristaCount }, (_, index) =>
      mitochondrialCrista(index, cristaCount, compact),
    );
    const chromatin = Array.from({ length: compact ? 3 : 5 }, (_, strand) => {
      const points = Array.from({ length: 64 }, (_, index): CellPoint => {
        const t = (index / 63) * Math.PI * 3.7;
        const r = 0.45 + 0.12 * Math.sin(t * 2 + strand);
        return [
          Math.cos(t + strand * 1.4) * r,
          Math.sin(t * 1.2 + strand) * 0.55,
          Math.sin(t + strand * 1.4) * r,
        ];
      });
      return cellTube(points, 0.018, compact ? 64 : 102, 5);
    });
    const fibers = Array.from({ length: compact ? 9 : 17 }, (_, index) => {
      const angle = index * 2.39996;
      const z = -2.5 + ((index % 7) / 6) * 3.6;
      const r = Math.sqrt(Math.max(1, 8.4 - z * z));
      const end: CellPoint = [
        Math.cos(angle) * r * 1.08,
        Math.sin(angle) * r * 0.8,
        z,
      ];
      return cellTube(
        [
          [-0.5, -0.48, -0.4],
          [end[0] * 0.32 - 0.25, end[1] * 0.38 - 0.3, end[2] * 0.4 - 0.2],
          [end[0] * 0.7, end[1] * 0.73 + Math.sin(angle) * 0.2, end[2] * 0.75],
          end,
        ],
        index % 3 === 0 ? 0.029 : 0.017,
        compact ? 24 : 42,
        5,
      );
    });
    const smoothER = Array.from({ length: compact ? 3 : 5 }, (_, index) => {
      const points = Array.from({ length: 32 }, (__, i): CellPoint => {
        const t = i / 31;
        return [
          -2.45 + t * 1.05,
          -0.65 + Math.sin(t * Math.PI * 3 + index) * 0.23 + index * 0.19,
          0.38 + Math.cos(t * Math.PI * 2 + index) * 0.3,
        ];
      });
      return cellTube(points, 0.055, compact ? 28 : 48, 7);
    });
    const neighbors = NEIGHBOR_CELLS.slice(0, compact ? 6 : 8);
    const connections = neighbors.map((neighbor, index) => {
      const end = neighbor.position;
      const length = Math.hypot(...end);
      const begin = end.map((n) => (n / length) * 3.0) as unknown as CellPoint;
      const finish = end.map(
        (n) => n * (1 - 2.1 / length),
      ) as unknown as CellPoint;
      return cellTube(
        [
          begin,
          [
            (begin[0] + finish[0]) / 2,
            (begin[1] + finish[1]) / 2 + 0.12 * (index % 2 ? 1 : -1),
            (begin[2] + finish[2]) / 2 + 0.14,
          ],
          finish,
        ],
        0.035,
        24,
        6,
      );
    });
    const transportTrack = cellTube(
      [
        [1.25, 0.15, -0.55],
        [1.9, -0.4, 0.5],
        [1.56, -0.3, 1.17],
        [1.12, 0.38, 2.48],
      ],
      0.022,
      compact ? 32 : 56,
      6,
    );
    return {
      materials,
      geometry,
      sheets,
      sheetEdges,
      golgi,
      cristae,
      chromatin,
      fibers,
      smoothER,
      neighbors,
      connections,
      transportTrack,
    };
  }, [compact]);
  useEffect(
    () => () => {
      Object.values(resources.materials).forEach((material) =>
        material.dispose(),
      );
      const geometries = [
        ...Object.values(resources.geometry),
        ...resources.sheets,
        ...resources.sheetEdges,
        ...resources.golgi,
        ...resources.cristae,
        ...resources.chromatin,
        ...resources.fibers,
        ...resources.smoothER,
        ...resources.connections,
        resources.transportTrack,
      ];
      geometries.forEach((geometry) => geometry.dispose());
    },
    [resources],
  );
  return resources;
}

type CellResources = ReturnType<typeof useCellResources>;

function InstanceSet({
  matrices,
  geometry,
  material,
  colors,
}: {
  matrices: Matrix4[];
  geometry: BufferGeometry;
  material: Material;
  colors?: Color[];
}) {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    matrices.forEach((matrix, index) => {
      mesh.current!.setMatrixAt(index, matrix);
      if (colors?.[index]) mesh.current!.setColorAt(index, colors[index]);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor)
      mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [matrices, colors]);
  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, matrices.length]}
      frustumCulled={false}
    />
  );
}

function LipidBilayer({
  parts,
  compact,
}: {
  parts: CellResources;
  compact: boolean;
}) {
  const lipids = useMemo(() => {
    const heads: Matrix4[] = [];
    const tails: Matrix4[] = [];
    const colors: Color[] = [];
    const columns = compact ? 15 : 23;
    const rows = compact ? 12 : 18;
    const yAxis = new Vector3(0, 1, 0);
    const uniform = new Vector3(1, 1, 1);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = -0.4 + (column / (columns - 1)) * 3.04 + (row % 2) * 0.052;
        const y = -0.82 + (row / (rows - 1)) * 2.47;
        if (((x - 1.29) / 0.44) ** 2 + ((y - 0.44) / 0.42) ** 2 < 1) continue;
        const z = Math.sqrt(
          Math.max(0.1, 3.22 ** 2 - (x / 1.13) ** 2 - (y / 0.89) ** 2),
        );
        const center = new Vector3(x, y, z);
        const normal = new Vector3(x / 1.13 ** 2, y / 0.89 ** 2, z).normalize();
        const tangent = new Vector3(
          1,
          0,
          -normal.x / Math.max(0.1, normal.z),
        ).normalize();
        const rotation = new Quaternion().setFromUnitVectors(yAxis, normal);
        for (const side of [-1, 1]) {
          const headPosition = center
            .clone()
            .addScaledVector(normal, side * 0.17);
          const ripple = 0.9 + 0.12 * Math.sin(column * 1.71 + row * 2.21);
          heads.push(
            new Matrix4().compose(
              headPosition,
              rotation,
              new Vector3(ripple, 0.8, ripple),
            ),
          );
          colors.push(
            new Color(side === 1 ? "#9acbd6" : "#6fa6c0").multiplyScalar(
              0.84 + 0.13 * Math.sin(column * 2.18 + row * 1.25),
            ),
          );
          for (const pair of [-1, 1]) {
            const tailPosition = center
              .clone()
              .addScaledVector(normal, side * 0.065)
              .addScaledVector(tangent, pair * 0.032);
            tails.push(new Matrix4().compose(tailPosition, rotation, uniform));
          }
        }
      }
    }
    return { heads, tails, colors };
  }, [compact]);
  const receptorQuaternion = useMemo(
    () =>
      new Quaternion().setFromUnitVectors(
        new Vector3(0, 1, 0),
        new Vector3(0.39, 0.16, 0.907).normalize(),
      ),
    [],
  );
  return (
    <group>
      <InstanceSet
        matrices={lipids.heads}
        colors={lipids.colors}
        geometry={parts.geometry.head}
        material={parts.materials.lipidHeads}
      />
      <InstanceSet
        matrices={lipids.tails}
        geometry={parts.geometry.tail}
        material={parts.materials.lipidTails}
      />
      <group position={[1.29, 0.44, 2.98]} quaternion={receptorQuaternion}>
        <mesh
          geometry={parts.geometry.receptor}
          material={parts.materials.receptor}
        />
        <mesh
          position={[0.05, 0.62, 0]}
          geometry={parts.geometry.receptorDomain}
          material={parts.materials.receptorDomain}
          rotation={[0.2, -0.4, 0.15]}
        />
        <mesh
          position={[-0.06, -0.59, 0.02]}
          geometry={parts.geometry.receptorDomain}
          material={parts.materials.receptorDomain}
          scale={0.73}
          rotation={[0.15, 0.45, -0.2]}
        />
      </group>
    </group>
  );
}

function Nucleus({
  parts,
  compact,
}: {
  parts: CellResources;
  compact: boolean;
}) {
  const poreMatrices = useMemo(() => {
    const matrices: Matrix4[] = [];
    const count = compact ? 34 : 66;
    for (let index = 0; index < count; index += 1) {
      const angle = index * 2.39996;
      const z = 0.51 - (index / (count - 1)) * 1.49;
      const radius = Math.sqrt(Math.max(0, 1 - z * z));
      const normal = new Vector3(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        z,
      );
      const position = new Vector3(
        normal.x * 1.155,
        normal.y * 0.912,
        normal.z * 1.03,
      );
      const rotation = new Quaternion().setFromUnitVectors(
        new Vector3(0, 0, 1),
        normal,
      );
      matrices.push(
        new Matrix4().compose(position, rotation, new Vector3(1, 1, 1)),
      );
    }
    return matrices;
  }, [compact]);
  return (
    <group position={[...NUCLEUS]} rotation={[0.06, -0.12, 0.1]}>
      <mesh
        geometry={parts.geometry.nucleusOuter}
        material={parts.materials.nucleusOuter}
      />
      <mesh
        geometry={parts.geometry.nucleusInner}
        material={parts.materials.nucleusInner}
      />
      <InstanceSet
        matrices={poreMatrices}
        geometry={parts.geometry.pore}
        material={parts.materials.pores}
      />
      <mesh
        position={[-0.2, 0.04, 0.11]}
        geometry={parts.geometry.nucleolus}
        material={parts.materials.nucleolus}
      />
      {parts.chromatin.map((geometry, index) => (
        <mesh
          key={index}
          geometry={geometry}
          material={parts.materials.chromatin}
        />
      ))}
    </group>
  );
}

function Mitochondrion({
  parts,
  position,
  rotation,
  scale = 1,
}: {
  parts: CellResources;
  position: [number, number, number];
  rotation: [number, number, number];
  scale?: number;
}) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh
        geometry={parts.geometry.mitochondrion}
        material={parts.materials.mitochondrialOuter}
      />
      <mesh
        geometry={parts.geometry.mitochondrion}
        material={parts.materials.mitochondrialInner}
        scale={[0.9, 0.82, 0.88]}
      />
      {parts.cristae.map((geometry, index) => (
        <mesh
          key={index}
          geometry={geometry}
          material={parts.materials.mitochondrialCristae}
        />
      ))}
    </group>
  );
}

function CellInterior({
  parts,
  compact,
}: {
  parts: CellResources;
  compact: boolean;
}) {
  const ribosomes = useMemo(() => {
    const matrices: Matrix4[] = [];
    const count = compact ? 76 : 150;
    for (let index = 0; index < count; index += 1) {
      const layer = index % parts.sheets.length;
      const point = reticulumPoint(
        layer,
        (index * 0.618034) % 1,
        0.12 + ((index * 0.38197) % 1) * 0.8,
      );
      const position = new Vector3(point[0], point[1] + 0.039, point[2]);
      matrices.push(
        new Matrix4().compose(position, new Quaternion(), new Vector3(1, 1, 1)),
      );
    }
    return matrices;
  }, [compact, parts.sheets.length]);
  const vesicles = useMemo(
    () =>
      Array.from({ length: compact ? 8 : 13 }, (_, index) => ({
        position: [
          1.45 + Math.cos(index * 2.1) * (0.5 + index * 0.03),
          -0.45 + Math.sin(index * 1.3) * 0.8,
          -0.25 + Math.sin(index * 2.1) * 0.75,
        ] as [number, number, number],
        scale: 0.21 + (index % 4) * 0.045,
      })),
    [compact],
  );
  return (
    <group>
      {parts.fibers.map((geometry, index) => (
        <mesh
          key={`fiber-${index}`}
          geometry={geometry}
          material={parts.materials.fiber}
        />
      ))}
      <Nucleus parts={parts} compact={compact} />
      {parts.sheets.map((geometry, index) => (
        <mesh
          key={`er-${index}`}
          geometry={geometry}
          material={parts.materials.reticulum}
        />
      ))}
      {parts.sheetEdges.map((geometry, index) => (
        <mesh
          key={`edge-${index}`}
          geometry={geometry}
          material={parts.materials.reticulumEdge}
        />
      ))}
      {parts.smoothER.map((geometry, index) => (
        <mesh
          key={`smooth-${index}`}
          geometry={geometry}
          material={parts.materials.reticulum}
        />
      ))}
      <InstanceSet
        matrices={ribosomes}
        geometry={parts.geometry.ribosome}
        material={parts.materials.ribosome}
      />
      <group position={[1.25, -0.52, -0.58]} rotation={[0.17, -0.3, -0.19]}>
        {parts.golgi.map((geometry, index) => (
          <mesh
            key={index}
            position={[
              Math.sin(index * 1.3) * 0.065,
              index * 0.148,
              Math.sin(index * 0.7) * 0.028,
            ]}
            geometry={geometry}
            material={
              index % 3 === 0
                ? parts.materials.golgiEdge
                : parts.materials.golgi
            }
          />
        ))}
      </group>
      <Mitochondrion
        parts={parts}
        position={[1.05, -1.48, 0.27]}
        rotation={[0.22, -0.25, -0.32]}
        scale={0.95}
      />
      <Mitochondrion
        parts={parts}
        position={[-1.88, 1.13, 0.32]}
        rotation={[-0.1, 0.25, 0.75]}
        scale={0.82}
      />
      <Mitochondrion
        parts={parts}
        position={[1.34, 1.18, -0.73]}
        rotation={[0.2, -0.3, 0.47]}
        scale={0.84}
      />
      <Mitochondrion
        parts={parts}
        position={[-2.0, -0.97, -0.27]}
        rotation={[-0.3, 0.55, -0.7]}
        scale={0.67}
      />
      {!compact ? (
        <Mitochondrion
          parts={parts}
          position={[-0.02, 1.86, -0.7]}
          rotation={[0.25, 0.1, -0.1]}
          scale={0.67}
        />
      ) : null}
      {vesicles.map((vesicle, index) => (
        <group key={index} position={vesicle.position} scale={vesicle.scale}>
          <mesh
            geometry={parts.geometry.vesicle}
            material={parts.materials.vesicle}
          />
          <mesh
            geometry={parts.geometry.smallProtein}
            material={parts.materials.proteinAccent}
            scale={0.5}
            rotation={[index, index * 0.6, 0]}
          />
        </group>
      ))}
      <mesh
        geometry={parts.transportTrack}
        material={parts.materials.transportTrack}
      />
    </group>
  );
}

function TissueContext({ parts }: { parts: CellResources }) {
  return (
    <group>
      {parts.connections.map((geometry, index) => (
        <mesh
          key={`connection-${index}`}
          geometry={geometry}
          material={parts.materials.tissueConnection}
        />
      ))}
      {parts.neighbors.map((cell, index) => (
        <group
          key={index}
          position={[...cell.position]}
          rotation={[...cell.rotation]}
          scale={cell.scale}
        >
          <mesh
            geometry={parts.geometry.tissue}
            material={parts.materials.tissueMembrane}
          />
          <mesh
            position={[-0.55, 0.14, -0.1]}
            geometry={parts.geometry.tissueNucleus}
            material={parts.materials.tissueNucleus}
          />
          <mesh
            position={[1.17, -0.96, 0.45]}
            rotation={[0.3, 0.1, 0.55]}
            geometry={parts.geometry.tissueMito}
            material={parts.materials.tissueOrganelle}
          />
          <mesh
            position={[-1.65, 0.73, 0.32]}
            rotation={[0, 0.3, -0.55]}
            geometry={parts.geometry.tissueMito}
            material={parts.materials.tissueOrganelle}
          />
          <mesh
            position={[0.75, 0.6, -0.9]}
            scale={0.82}
            geometry={parts.geometry.tissueMito}
            material={parts.materials.tissueOrganelle}
          />
        </group>
      ))}
    </group>
  );
}

/**
 * Five staged spatial scales of a generic eukaryotic cell. Forms are conceptual,
 * not a reconstruction of a specific cell, protein, binding event, or measurement.
 * Canvas owns demand invalidation and advances progress in its priority -1 frame.
 */
export function BiologicalWorld({
  progress,
  compact,
}: {
  progress: MutableRefObject<number>;
  compact: boolean;
}) {
  const parts = useCellResources(compact);
  const { camera, size } = useThree();
  const membranePatch = useRef<Group>(null);
  const cell = useRef<Group>(null);
  const transport = useRef<Group>(null);
  const protein = useRef<Group>(null);
  const tissue = useRef<Group>(null);
  const interiorLight = useRef<PointLight>(null);
  const lastProgress = useRef(-1);
  const lastAspect = useRef(0);
  const target = useMemo(() => new Vector3(), []);

  useLayoutEffect(() => {
    lastProgress.current = -1;
  }, [parts, compact]);

  useFrame(() => {
    const state = evaluateBiologyMotion(progress.current, compact);
    const aspect = size.width / Math.max(1, size.height);
    if (
      lastProgress.current === state.progress &&
      lastAspect.current === aspect
    )
      return;
    lastProgress.current = state.progress;
    lastAspect.current = aspect;
    const framing = aspect < 1.1 ? 1.1 / aspect : 1;
    target.set(...state.target);
    camera.position.set(
      target.x + (state.camera[0] - target.x) * framing,
      target.y + (state.camera[1] - target.y) * framing,
      target.z + (state.camera[2] - target.z) * framing,
    );
    camera.lookAt(target);
    if (camera instanceof PerspectiveCamera) {
      camera.fov = state.fov;
      camera.near = 0.035;
      camera.far = 70;
      camera.updateProjectionMatrix();
    }
    updateCellEnvelope(parts.geometry.outer, state.cutaway, state.cellBreath);
    updateCellEnvelope(
      parts.geometry.inner,
      state.cutaway + 0.012,
      state.cellBreath,
    );
    updateCellEnvelope(parts.geometry.edge, state.cutaway, state.cellBreath);
    parts.materials.membrane.opacity = state.membraneOpacity;
    parts.materials.innerMembrane.opacity = state.membraneOpacity * 0.42;
    parts.materials.membraneEdge.opacity =
      0.25 + Math.sin(state.cutaway) * 0.45;
    parts.materials.lipidHeads.opacity = state.membranePatchOpacity;
    parts.materials.lipidTails.opacity = state.membranePatchOpacity * 0.85;
    if (membranePatch.current) {
      membranePatch.current.rotation.y = state.membranePatchRotation;
      membranePatch.current.visible = state.membranePatchOpacity > 0.055;
    }
    if (cell.current)
      cell.current.scale.set(
        1 + state.cellBreath,
        1 - state.cellBreath * 0.6,
        1,
      );
    if (transport.current) {
      transport.current.position.set(...state.transportPosition);
      transport.current.scale.setScalar(state.transportScale);
    }
    if (protein.current) protein.current.rotation.set(...state.proteinRotation);
    if (interiorLight.current)
      interiorLight.current.intensity = 2.8 * state.interiorLight;
    if (tissue.current) tissue.current.visible = state.tissueReveal > 0.005;
    parts.materials.tissueMembrane.opacity = 0.27 * state.tissueReveal;
    parts.materials.tissueNucleus.opacity = 0.65 * state.tissueReveal;
    parts.materials.tissueOrganelle.opacity = 0.74 * state.tissueReveal;
    parts.materials.tissueConnection.opacity = 0.64 * state.tissueReveal;
  }, 0);

  return (
    <group dispose={null}>
      <ambientLight intensity={0.2} color="#adc8dd" />
      <hemisphereLight args={["#c5dbea", "#0a1427", 0.68]} />
      <directionalLight position={[4, 7, 8]} intensity={2.25} color="#d0e4ef" />
      <directionalLight
        position={[-5, 2, -4]}
        intensity={1.9}
        color="#517fcb"
      />
      <pointLight
        position={[4, -1, 4]}
        intensity={12}
        distance={15}
        decay={2}
        color="#69cfc8"
      />
      <pointLight
        position={[-3, 4, 0]}
        intensity={11}
        distance={14}
        decay={2}
        color="#739fff"
      />
      <pointLight
        ref={interiorLight}
        position={[0.6, 0.5, 1.4]}
        intensity={2}
        distance={6}
        decay={1.5}
        color="#7aaec5"
      />
      <group ref={cell}>
        <mesh
          geometry={parts.geometry.outer}
          material={parts.materials.membrane}
          renderOrder={5}
        />
        <mesh
          geometry={parts.geometry.inner}
          material={parts.materials.innerMembrane}
          renderOrder={4}
        />
        <mesh
          geometry={parts.geometry.edge}
          material={parts.materials.membraneEdge}
          renderOrder={6}
        />
        <group ref={membranePatch}>
          <LipidBilayer parts={parts} compact={compact} />
        </group>
        <CellInterior parts={parts} compact={compact} />
        <group ref={transport} position={[1.42, 0.2, -0.18]} scale={0.33}>
          <mesh
            geometry={parts.geometry.vesicle}
            material={parts.materials.vesicle}
            renderOrder={3}
          />
          <mesh
            geometry={parts.geometry.vesicle}
            material={parts.materials.vesicleInner}
            scale={0.91}
            renderOrder={2}
          />
          <group ref={protein}>
            <mesh
              geometry={parts.geometry.protein}
              material={parts.materials.cargo}
              scale={0.78}
            />
            <mesh
              position={[0.14, 0.21, 0.03]}
              geometry={parts.geometry.cargoBead}
              material={parts.materials.proteinAccent}
            />
            <mesh
              position={[-0.21, -0.08, 0.13]}
              geometry={parts.geometry.cargoBead}
              material={parts.materials.proteinAccent}
              scale={0.72}
            />
          </group>
        </group>
      </group>
      <group ref={tissue}>
        <TissueContext parts={parts} />
      </group>
    </group>
  );
}

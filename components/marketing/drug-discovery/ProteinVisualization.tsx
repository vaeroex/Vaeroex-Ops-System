"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import {
  CatmullRomCurve3,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  MathUtils,
  MeshPhysicalMaterial,
  Quaternion,
  Shape,
  Vector3
} from "three";
import { MoleculeModel, validateMolecularGraph, type MolecularGraph } from "./MolecularVisualization";

type Point3 = readonly [number, number, number];

function segmentTransform(start: Point3, end: Point3) {
  const from = new Vector3(...start);
  const to = new Vector3(...end);
  const direction = to.clone().sub(from);
  return {
    position: from.clone().add(to).multiplyScalar(0.5),
    quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize()),
    length: direction.length()
  };
}

export function AlphaHelix({ start, end, color = "#67c9d4", radius = 0.34 }: { start: Point3; end: Point3; color?: string; radius?: number }) {
  const transform = useMemo(() => segmentTransform(start, end), [end, start]);
  const curve = useMemo(() => {
    const turns = Math.max(2.4, transform.length / 0.72);
    const points = Array.from({ length: 64 }, (_, index) => {
      const t = index / 63;
      const angle = t * Math.PI * 2 * turns;
      return new Vector3(
        Math.cos(angle) * radius,
        (t - 0.5) * transform.length,
        Math.sin(angle) * radius
      );
    });
    return new CatmullRomCurve3(points);
  }, [radius, transform.length]);

  return (
    <group position={transform.position} quaternion={transform.quaternion}>
      <mesh>
        <tubeGeometry args={[curve, 96, 0.105, 8, false]} />
        <meshPhysicalMaterial color={color} emissive="#123743" emissiveIntensity={0.28} roughness={0.34} metalness={0.26} clearcoat={0.24} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[0.055, 0.055, transform.length * 0.92, 8]} />
        <meshBasicMaterial color="#d4eef0" transparent opacity={0.2} />
      </mesh>
    </group>
  );
}

export function BetaSheet({ start, end, width = 0.78, color = "#a4d7ca" }: { start: Point3; end: Point3; width?: number; color?: string }) {
  const transform = useMemo(() => segmentTransform(start, end), [end, start]);
  const shape = useMemo(() => {
    const length = transform.length;
    const arrowStart = length * 0.22;
    const value = new Shape();
    value.moveTo(-width * 0.34, -length / 2);
    value.lineTo(width * 0.34, -length / 2);
    value.lineTo(width * 0.34, arrowStart);
    value.lineTo(width * 0.62, arrowStart);
    value.lineTo(0, length / 2);
    value.lineTo(-width * 0.62, arrowStart);
    value.lineTo(-width * 0.34, arrowStart);
    value.closePath();
    return value;
  }, [transform.length, width]);

  return (
    <group position={transform.position} quaternion={transform.quaternion}>
      <mesh rotation={[0, 0, 0]}>
        <extrudeGeometry args={[shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.045, bevelThickness: 0.045, bevelSegments: 2 }]} />
        <meshPhysicalMaterial color={color} emissive="#183c42" emissiveIntensity={0.18} roughness={0.42} metalness={0.2} side={DoubleSide} />
      </mesh>
    </group>
  );
}

export function ProteinLoop({ points, color = "#547f8c", radius = 0.09 }: { points: readonly Point3[]; color?: string; radius?: number }) {
  const curve = useMemo(() => new CatmullRomCurve3(points.map((point) => new Vector3(...point))), [points]);
  return (
    <mesh>
      <tubeGeometry args={[curve, Math.max(28, points.length * 16), radius, 7, false]} />
      <meshPhysicalMaterial color={color} emissive="#102c35" emissiveIntensity={0.18} roughness={0.48} metalness={0.18} clearcoat={0.2} />
    </mesh>
  );
}

function molecularSurfaceGeometry(radius: number, detail: number, cavityDirection: Point3, seed: number) {
  const geometry = new IcosahedronGeometry(radius, detail);
  const positions = geometry.getAttribute("position");
  const direction = new Vector3(...cavityDirection).normalize();
  const vertex = new Vector3();
  const normal = new Vector3();

  for (let index = 0; index < positions.count; index += 1) {
    vertex.fromBufferAttribute(positions, index);
    normal.copy(vertex).normalize();
    const topology =
      Math.sin(normal.x * 7.1 + seed) * 0.055 +
      Math.sin(normal.y * 10.7 - seed * 0.4) * 0.035 +
      Math.cos(normal.z * 8.3 + seed * 0.8) * 0.045;
    const pocketAlignment = Math.max(0, normal.dot(direction));
    const pocket = MathUtils.smoothstep(pocketAlignment, 0.54, 0.95) * 0.34;
    vertex.multiplyScalar(1 + topology - pocket);
    positions.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export function MolecularSurface({
  position,
  scale,
  color = "#3a8d96",
  opacity = 0.16,
  cavityDirection = [0.55, -0.08, 1],
  seed = 1,
  progress,
  fadeRange = [0.34, 0.5]
}: {
  position: Point3;
  scale: Point3;
  color?: string;
  opacity?: number;
  cavityDirection?: Point3;
  seed?: number;
  progress?: MutableRefObject<number>;
  fadeRange?: readonly [number, number];
}) {
  const material = useRef<MeshPhysicalMaterial>(null);
  const geometry = useMemo(() => molecularSurfaceGeometry(1, 3, cavityDirection, seed), [cavityDirection, seed]);

  useFrame(() => {
    if (!material.current || !progress) return;
    const close = MathUtils.smoothstep(progress.current, fadeRange[0], fadeRange[1]);
    material.current.opacity = opacity * MathUtils.lerp(1, 0.32, close);
  });

  return (
    <mesh position={position} scale={scale} geometry={geometry}>
      <meshPhysicalMaterial
        ref={material}
        color={color}
        transparent
        opacity={opacity}
        transmission={0.22}
        roughness={0.58}
        metalness={0.08}
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
  );
}

const POCKET_RESIDUES: readonly MolecularGraph[] = [
  {
    id: "acidic-pocket-residue",
    atoms: [
      { id: "r1a", element: "C", position: [-0.7, 0, 0] },
      { id: "r1b", element: "C", position: [0, 0.1, 0] },
      { id: "r1o1", element: "O", position: [0.65, 0.52, 0.08] },
      { id: "r1o2", element: "O", position: [0.62, -0.5, -0.08] }
    ],
    bonds: [
      { from: "r1a", to: "r1b", order: 1 },
      { from: "r1b", to: "r1o1", order: 2 },
      { from: "r1b", to: "r1o2", order: 1 }
    ]
  },
  {
    id: "basic-pocket-residue",
    atoms: [
      { id: "r2a", element: "C", position: [-0.75, 0, 0] },
      { id: "r2b", element: "C", position: [0, 0.12, 0.04] },
      { id: "r2n", element: "N", position: [0.72, -0.08, 0] }
    ],
    bonds: [
      { from: "r2a", to: "r2b", order: 1 },
      { from: "r2b", to: "r2n", order: 1 }
    ]
  },
  {
    id: "polar-pocket-residue",
    atoms: [
      { id: "r3a", element: "C", position: [-0.68, 0, 0] },
      { id: "r3b", element: "C", position: [0, -0.12, 0.08] },
      { id: "r3o", element: "O", position: [0.66, 0.12, -0.02] }
    ],
    bonds: [
      { from: "r3a", to: "r3b", order: 1 },
      { from: "r3b", to: "r3o", order: 1 }
    ]
  },
  {
    id: "sulfur-pocket-residue",
    atoms: [
      { id: "r4a", element: "C", position: [-0.72, 0, 0] },
      { id: "r4s", element: "S", position: [0, 0.08, 0.12] },
      { id: "r4b", element: "C", position: [0.78, -0.08, -0.04] }
    ],
    bonds: [
      { from: "r4a", to: "r4s", order: 1 },
      { from: "r4s", to: "r4b", order: 1 }
    ]
  }
] as const;

if (!POCKET_RESIDUES.every(validateMolecularGraph)) {
  throw new Error("Drug Discovery pocket residues contain an invalid atom/bond graph");
}

export function PocketResidues({ scale = 1 }: { scale?: number }) {
  const placements = [
    { position: [-1.2, 0.95, 0.9] as Point3, rotation: [0.2, -0.5, 1.2] as Point3 },
    { position: [1.15, 0.85, 0.55] as Point3, rotation: [-0.4, 0.2, -1.1] as Point3 },
    { position: [-1.05, -0.95, 0.6] as Point3, rotation: [0.6, 0.4, 1.9] as Point3 },
    { position: [1.05, -0.9, 0.82] as Point3, rotation: [-0.2, -0.6, -1.8] as Point3 }
  ] as const;

  return (
    <group scale={scale} data-pocket-residues>
      {placements.map((placement, index) => (
        <group key={POCKET_RESIDUES[index].id} position={placement.position} rotation={placement.rotation}>
          <MoleculeModel graph={POCKET_RESIDUES[index]} representation="stick" scale={0.62} accent="#8aaab0" />
        </group>
      ))}
    </group>
  );
}

const PROTEIN_LOOPS: readonly (readonly Point3[])[] = [
  [[-2.55, 1.15, -0.6], [-2.05, 1.9, -0.15], [-1.1, 2.1, 0.42], [-0.2, 1.78, 0.66]],
  [[1.4, 1.3, 0.4], [2.18, 1.0, 0.9], [2.55, 0.18, 1.02], [2.2, -0.7, 0.66]],
  [[1.2, -1.55, 0.25], [0.54, -2.25, -0.32], [-0.38, -2.12, -0.88], [-1.05, -1.5, -0.75]],
  [[-1.7, -0.82, -0.42], [-2.55, -0.45, 0.25], [-2.72, 0.42, 0.62], [-2.45, 1.02, -0.45]],
  [[-0.35, 1.66, 0.7], [0.22, 2.34, 0.12], [1.18, 2.18, -0.48], [1.62, 1.45, 0.32]],
  [[2.12, -0.62, 0.62], [2.75, -1.1, -0.2], [2.22, -1.92, -0.92], [1.28, -1.7, 0.18]]
] as const;

export function ProteinTarget({
  position = [0, 0, -7],
  scale = 1,
  progress,
  reducedMotion = false
}: {
  position?: Point3;
  scale?: number;
  progress?: MutableRefObject<number>;
  reducedMotion?: boolean;
}) {
  const group = useRef<Group>(null);
  const loops = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!group.current || !loops.current) return;
    const journey = progress?.current || 0;
    const motion = reducedMotion ? 0 : Math.sin(clock.elapsedTime * 0.22) * 0.018;
    group.current.rotation.set(-0.16 + motion, -0.42 + journey * 0.44, 0.08 - journey * 0.08);
    loops.current.rotation.z = motion * 0.45;
  });

  return (
    <group ref={group} position={position} scale={scale} data-protein-cartoon>
      <group ref={loops}>
        {PROTEIN_LOOPS.map((points, index) => (
          <ProteinLoop key={index} points={points} color={index % 3 === 0 ? "#426d7d" : index % 3 === 1 ? "#739e9f" : "#38596c"} radius={index % 2 === 0 ? 0.085 : 0.072} />
        ))}
      </group>
      <AlphaHelix start={[-2.65, -1.45, -0.65]} end={[-2.45, 1.18, -0.45]} color="#25859b" />
      <AlphaHelix start={[1.58, 1.45, 0.35]} end={[2.16, -0.7, 0.62]} color="#6dcbd0" radius={0.3} />
      <AlphaHelix start={[-1.05, -1.52, -0.7]} end={[1.25, -1.72, 0.2]} color="#1f657c" radius={0.28} />
      <AlphaHelix start={[-0.3, 1.78, 0.66]} end={[1.38, 1.42, 0.38]} color="#80d3d2" radius={0.25} />
      <BetaSheet start={[-1.9, 0.8, -1.22]} end={[-0.25, 0.05, -0.5]} color="#9bc9bb" />
      <BetaSheet start={[-1.45, 0.25, -1.42]} end={[0.35, -0.18, -0.72]} color="#79aaa8" />
      <BetaSheet start={[-0.75, -0.38, -1.5]} end={[1.1, -0.62, -0.74]} color="#bad8c0" width={0.7} />
      <MolecularSurface position={[-0.65, 0.15, -0.2]} scale={[3.15, 2.55, 1.8]} seed={1.7} opacity={0.12} progress={progress} fadeRange={[0.12, 0.24]} />
      <MolecularSurface position={[1.2, -0.15, 0.38]} scale={[1.95, 2.2, 1.55]} seed={4.2} color="#315f76" opacity={0.1} progress={progress} fadeRange={[0.12, 0.24]} />
      <group position={[1.35, -0.05, 1.42]} scale={0.7}>
        <PocketResidues scale={0.48} />
      </group>
      <mesh position={[-0.2, 1.95, -0.2]}>
        <torusGeometry args={[0.58, 0.022, 6, 48]} />
        <meshBasicMaterial color="#c7eda2" transparent opacity={0.34} />
      </mesh>
      <mesh position={[1.64, -1.45, 0.1]} rotation={[0.6, 0.2, 0.1]}>
        <torusGeometry args={[0.42, 0.018, 6, 42]} />
        <meshBasicMaterial color="#6acbd2" transparent opacity={0.3} />
      </mesh>
    </group>
  );
}

export function BindingPocket({ position = [0.4, 0, -43], progress }: { position?: Point3; progress: MutableRefObject<number> }) {
  return (
    <group position={position} data-binding-pocket>
      <MolecularSurface position={[-1.35, 1.1, -0.2]} scale={[1.9, 1.35, 1.45]} seed={2.3} opacity={0.28} progress={progress} fadeRange={[0.4, 0.5]} color="#357f89" />
      <MolecularSurface position={[1.35, 1.05, -0.15]} scale={[1.75, 1.3, 1.35]} seed={5.1} opacity={0.26} progress={progress} fadeRange={[0.4, 0.5]} color="#376c7e" cavityDirection={[-0.7, -0.15, 1]} />
      <MolecularSurface position={[-1.15, -1.15, 0.05]} scale={[1.7, 1.25, 1.28]} seed={7.6} opacity={0.25} progress={progress} fadeRange={[0.4, 0.5]} color="#3e7778" cavityDirection={[0.65, 0.4, 1]} />
      <MolecularSurface position={[1.2, -1.08, 0.08]} scale={[1.65, 1.25, 1.3]} seed={9.4} opacity={0.24} progress={progress} fadeRange={[0.4, 0.5]} color="#466c76" cavityDirection={[-0.55, 0.35, 1]} />
      <PocketResidues scale={0.86} />
      <mesh position={[0, 0, -0.45]} scale={[1.05, 0.82, 0.58]}>
        <sphereGeometry args={[1, 22, 16]} />
        <meshBasicMaterial color="#78e2d7" transparent opacity={0.055} depthWrite={false} />
      </mesh>
      <pointLight position={[0, 0, 1.5]} color="#83e9df" intensity={14} distance={7} />
    </group>
  );
}

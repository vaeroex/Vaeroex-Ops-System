"use client";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import {
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3
} from "three";
import type { SpatialQualityTier } from "@/components/spatial/useSpatialCapability";

type Point3 = readonly [number, number, number];
type Nucleobase = "A" | "T" | "G" | "C";

const BASE_COLORS: Record<Nucleobase, string> = {
  A: "#7da9b8",
  T: "#b99c7d",
  G: "#6e9c91",
  C: "#ad8581"
};

const BASE_SEQUENCE: readonly Nucleobase[] = ["A", "T", "G", "C", "G", "C", "A", "T", "G", "A", "C", "T"];

function smoothRange(value: number, from: number, to: number) {
  const normalized = MathUtils.clamp((value - from) / Math.max(0.001, to - from), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function deterministicValue(index: number, channel: number) {
  const value = Math.sin(index * 91.73 + channel * 37.19) * 43758.5453;
  return value - Math.floor(value);
}

function point(vector: Vector3): Point3 {
  return [vector.x, vector.y, vector.z];
}

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

function MolecularBond({
  start,
  end,
  radius = 0.035,
  color = "#aeb9b7",
  opacity = 1,
  castShadow = false
}: {
  start: Point3;
  end: Point3;
  radius?: number;
  color?: string;
  opacity?: number;
  castShadow?: boolean;
}) {
  const transform = useMemo(() => segmentTransform(start, end), [end, start]);
  return (
    <mesh position={transform.position} quaternion={transform.quaternion} castShadow={castShadow}>
      <cylinderGeometry args={[radius, radius, transform.length, 7]} />
      <meshStandardMaterial
        color={color}
        roughness={0.66}
        metalness={0.02}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={opacity > 0.72}
      />
    </mesh>
  );
}

type HelixPair = Readonly<{
  index: number;
  angleA: number;
  angleB: number;
  center: Point3;
  sugarA: Point3;
  sugarB: Point3;
  phosphateA: Point3;
  phosphateB: Point3;
  baseCenterA: Point3;
  baseCenterB: Point3;
  innerA: Point3;
  innerB: Point3;
  baseA: Nucleobase;
  baseB: Nucleobase;
  selected: boolean;
}>;

function complement(base: Nucleobase): Nucleobase {
  return base === "A" ? "T" : base === "T" ? "A" : base === "G" ? "C" : "G";
}

function buildHelix(pairCount: number) {
  const radius = 2.02;
  const rise = 0.285;
  const mutablePairs: Array<Omit<HelixPair, "phosphateA" | "phosphateB">> = [];

  for (let index = 0; index < pairCount; index += 1) {
    const normalized = (index - (pairCount - 1) / 2) / Math.max(1, pairCount - 1);
    const angleA = (index / 10.5) * Math.PI * 2 + Math.sin(index * 0.57) * 0.016;
    // The offset creates unequal major/minor grooves instead of a perfect ladder.
    const angleB = angleA + Math.PI + 0.27;
    const y = (index - (pairCount - 1) / 2) * rise;
    const bend = new Vector3(
      Math.sin(normalized * Math.PI * 1.25) * 0.23 + Math.sin(index * 0.43) * 0.018,
      y,
      Math.cos(normalized * Math.PI * 0.82) * 0.12
    );
    const radialVariation = 1 + Math.sin(index * 1.71) * 0.018 + Math.cos(index * 0.73) * 0.012;
    const directionA = new Vector3(Math.cos(angleA), 0, Math.sin(angleA));
    const directionB = new Vector3(Math.cos(angleB), 0, Math.sin(angleB));
    const sugarA = bend.clone().addScaledVector(directionA, radius * radialVariation);
    const sugarB = bend.clone().addScaledVector(directionB, radius * (2 - radialVariation));
    const baseA = BASE_SEQUENCE[index % BASE_SEQUENCE.length];
    const baseB = complement(baseA);

    mutablePairs.push({
      index,
      angleA,
      angleB,
      center: point(bend),
      sugarA: point(sugarA),
      sugarB: point(sugarB),
      baseCenterA: point(bend.clone().addScaledVector(directionA, 0.78)),
      baseCenterB: point(bend.clone().addScaledVector(directionB, 0.78)),
      innerA: point(bend.clone().addScaledVector(directionA, 0.2)),
      innerB: point(bend.clone().addScaledVector(directionB, 0.2)),
      baseA,
      baseB,
      selected: Math.abs(index - Math.floor(pairCount * 0.59)) <= 1
    });
  }

  const pairs: HelixPair[] = mutablePairs.map((current, index) => {
    const next = mutablePairs[Math.min(index + 1, mutablePairs.length - 1)];
    const phosphateA = new Vector3(...current.sugarA).lerp(new Vector3(...next.sugarA), 0.48);
    const phosphateB = new Vector3(...current.sugarB).lerp(new Vector3(...next.sugarB), 0.48);
    const center = new Vector3(...current.center);
    phosphateA.add(phosphateA.clone().sub(center).normalize().multiplyScalar(0.08));
    phosphateB.add(phosphateB.clone().sub(center).normalize().multiplyScalar(0.08));
    return { ...current, phosphateA: point(phosphateA), phosphateB: point(phosphateB) };
  });

  const strandA: Vector3[] = [];
  const strandB: Vector3[] = [];
  pairs.forEach((pairData) => {
    strandA.push(new Vector3(...pairData.sugarA), new Vector3(...pairData.phosphateA));
    strandB.push(new Vector3(...pairData.sugarB), new Vector3(...pairData.phosphateB));
  });

  return {
    pairs,
    curveA: new CatmullRomCurve3(strandA, false, "centripetal", 0.34),
    curveB: new CatmullRomCurve3(strandB, false, "centripetal", 0.34)
  };
}

function NucleobaseModel({
  base,
  position,
  angle,
  selected,
  detailed
}: {
  base: Nucleobase;
  position: Point3;
  angle: number;
  selected: boolean;
  detailed: boolean;
}) {
  const purine = base === "A" || base === "G";
  const color = BASE_COLORS[base];
  return (
    <group position={position} rotation={[0, -angle, 0]} scale={selected ? 1.08 : 1} data-nucleobase={base}>
      <mesh castShadow={detailed} scale={[1, 1, 0.8]}>
        <cylinderGeometry args={[0.24, 0.24, 0.09, 6]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 0.16 : 0.015} roughness={0.55} metalness={0.015} />
      </mesh>
      {purine ? (
        <mesh position={[0.26, 0, 0]} castShadow={detailed} scale={[0.88, 1, 0.76]}>
          <cylinderGeometry args={[0.21, 0.21, 0.09, 5]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 0.13 : 0.01} roughness={0.58} metalness={0.01} />
        </mesh>
      ) : null}
      {detailed && base === "T" ? (
        <mesh position={[-0.05, 0, 0.29]} castShadow>
          <sphereGeometry args={[0.075, 8, 6]} />
          <meshStandardMaterial color="#a58a72" roughness={0.7} />
        </mesh>
      ) : null}
    </group>
  );
}

function BackboneInstances({ pairs, quality }: { pairs: readonly HelixPair[]; quality: SpatialQualityTier }) {
  const sugars = useRef<InstancedMesh>(null);
  const phosphates = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const sugarPositions = useMemo(() => pairs.flatMap((pairData) => [pairData.sugarA, pairData.sugarB]), [pairs]);
  const phosphatePositions = useMemo(() => pairs.flatMap((pairData) => [pairData.phosphateA, pairData.phosphateB]), [pairs]);

  useLayoutEffect(() => {
    if (!sugars.current || !phosphates.current) return;
    sugarPositions.forEach((position, index) => {
      dummy.position.set(...position);
      dummy.rotation.set(index * 0.17, index * 0.31, index * 0.11);
      dummy.scale.set(0.14, 0.1, 0.13);
      dummy.updateMatrix();
      sugars.current?.setMatrixAt(index, dummy.matrix);
    });
    phosphatePositions.forEach((position, index) => {
      dummy.position.set(...position);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(index % 5 === 0 ? 0.118 : 0.104);
      dummy.updateMatrix();
      phosphates.current?.setMatrixAt(index, dummy.matrix);
    });
    sugars.current.instanceMatrix.needsUpdate = true;
    phosphates.current.instanceMatrix.needsUpdate = true;
  }, [dummy, phosphatePositions, sugarPositions]);

  const castShadow = quality === "full";
  return (
    <group data-sugar-phosphate-backbone>
      <instancedMesh ref={sugars} args={[undefined, undefined, sugarPositions.length]} frustumCulled={false} castShadow={castShadow}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#99a7a3" roughness={0.68} metalness={0.015} />
      </instancedMesh>
      <instancedMesh ref={phosphates} args={[undefined, undefined, phosphatePositions.length]} frustumCulled={false} castShadow={castShadow}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#829ba2" roughness={0.62} metalness={0.02} />
      </instancedMesh>
    </group>
  );
}

function BasePair({ pairData, quality }: { pairData: HelixPair; quality: SpatialQualityTier }) {
  const detailed = quality === "full";
  const center = new Vector3(...pairData.center);
  const sugarA = new Vector3(...pairData.sugarA);
  const sugarB = new Vector3(...pairData.sugarB);
  const outerA = point(center.clone().lerp(sugarA, 0.61));
  const outerB = point(center.clone().lerp(sugarB, 0.61));
  const innerA = new Vector3(...pairData.innerA);
  const innerB = new Vector3(...pairData.innerB);
  const tangent = sugarA.clone().sub(center).cross(new Vector3(0, 1, 0)).normalize();
  const hydrogenBondCount = pairData.baseA === "G" || pairData.baseA === "C" ? 3 : 2;

  return (
    <group data-base-pair={pairData.baseA + pairData.baseB}>
      <MolecularBond start={pairData.sugarA} end={outerA} radius={pairData.selected ? 0.047 : 0.036} color="#879895" castShadow={detailed} />
      <MolecularBond start={pairData.sugarB} end={outerB} radius={pairData.selected ? 0.047 : 0.036} color="#879895" castShadow={detailed} />
      <NucleobaseModel base={pairData.baseA} position={pairData.baseCenterA} angle={pairData.angleA} selected={pairData.selected} detailed={detailed} />
      <NucleobaseModel base={pairData.baseB} position={pairData.baseCenterB} angle={pairData.angleB} selected={pairData.selected} detailed={detailed} />
      {Array.from({ length: hydrogenBondCount }, (_, index) => {
        const offset = (index - (hydrogenBondCount - 1) / 2) * 0.075;
        const start = point(innerA.clone().addScaledVector(tangent, offset));
        const end = point(innerB.clone().addScaledVector(tangent, offset));
        return (
          <Line
            key={index}
            points={[start, end]}
            color={pairData.selected ? "#d8d1bd" : "#909c99"}
            lineWidth={pairData.selected ? 0.48 : 0.25}
            transparent
            opacity={pairData.selected ? 0.68 : 0.3}
            dashed
            dashScale={8}
            dashSize={0.055}
            gapSize={0.045}
          />
        );
      })}
    </group>
  );
}

export function DnaDoubleHelix({
  progress,
  quality,
  position = [0, 0, -7],
  reducedMotion = false
}: {
  progress?: MutableRefObject<number>;
  quality: SpatialQualityTier;
  position?: Point3;
  reducedMotion?: boolean;
}) {
  const group = useRef<Group>(null);
  const molecularFrame = useRef<Group>(null);
  const pairCount = quality === "full" ? 42 : quality === "constrained" ? 30 : 24;
  const helix = useMemo(() => buildHelix(pairCount), [pairCount]);

  useFrame((state) => {
    if (!group.current || !molecularFrame.current) return;
    const journey = progress?.current || 0;
    const selection = smoothRange(journey, 0.055, 0.2);
    const time = reducedMotion ? 0 : state.clock.elapsedTime;
    group.current.rotation.y = 0.44 + journey * 0.18 + Math.sin(time * 0.17) * 0.035;
    group.current.rotation.x = 0.08 + Math.sin(time * 0.13 + 0.8) * 0.018;
    group.current.rotation.z = -0.1 + selection * 0.12 + Math.sin(time * 0.11) * 0.012;
    group.current.position.x = position[0] - selection * 0.56;
    group.current.position.y = position[1] + selection * 0.18;
    group.current.position.z = position[2] - selection * 1.55;
    const torsion = reducedMotion ? 1 : 1 + Math.sin(time * 0.29) * 0.005;
    molecularFrame.current.scale.set(torsion, 1, 2 - torsion);
  });

  return (
    <group ref={group} position={position} rotation={[0.08, 0.44, -0.1]} data-dna-molecular-structure>
      <group ref={molecularFrame}>
        <mesh castShadow={quality === "full"}>
          <tubeGeometry args={[helix.curveA, quality === "full" ? 220 : 150, 0.072, 8, false]} />
          <meshPhysicalMaterial color="#718b92" roughness={0.62} metalness={0.015} clearcoat={0.12} clearcoatRoughness={0.72} />
        </mesh>
        <mesh castShadow={quality === "full"}>
          <tubeGeometry args={[helix.curveB, quality === "full" ? 220 : 150, 0.072, 8, false]} />
          <meshPhysicalMaterial color="#8d9a93" roughness={0.67} metalness={0.012} clearcoat={0.1} clearcoatRoughness={0.76} />
        </mesh>
        <BackboneInstances pairs={helix.pairs} quality={quality} />
        {helix.pairs.map((pairData) => <BasePair key={pairData.index} pairData={pairData} quality={quality} />)}
      </group>
    </group>
  );
}

export function SelectedVariant({ progress, position = [0, 0, -16] }: { progress: MutableRefObject<number>; position?: Point3 }) {
  const group = useRef<Group>(null);
  const left = useRef<Group>(null);
  const right = useRef<Group>(null);

  useFrame((state) => {
    const reveal = smoothRange(progress.current, 0.085, 0.22);
    const context = smoothRange(progress.current, 0.2, 0.31);
    if (group.current) {
      group.current.scale.setScalar(0.04 + reveal * 1.16);
      group.current.rotation.y = -0.28 + Math.sin(state.clock.elapsedTime * 0.16) * 0.025;
      group.current.position.x = position[0] + context * 1.05;
    }
    if (left.current) left.current.position.x = -0.52 - reveal * 0.22;
    if (right.current) right.current.position.x = 0.52 + reveal * 0.22;
  });

  return (
    <group ref={group} position={position} scale={0.04} data-selected-nucleotide-pair>
      <group ref={left} position={[-0.52, 0, 0]}>
        <NucleobaseModel base="G" position={[0, 0, 0]} angle={Math.PI} selected detailed />
        <MolecularBond start={[-1.18, 0, 0]} end={[-0.22, 0, 0]} radius={0.055} color="#82928e" />
        <mesh position={[-1.28, 0, 0]} rotation={[0.1, 0.2, 0.1]}>
          <dodecahedronGeometry args={[0.18, 0]} />
          <meshStandardMaterial color="#9ca8a1" roughness={0.7} />
        </mesh>
        <mesh position={[-1.62, 0.08, 0]}>
          <sphereGeometry args={[0.13, 9, 7]} />
          <meshStandardMaterial color="#829ba2" roughness={0.64} />
        </mesh>
      </group>
      <group ref={right} position={[0.52, 0, 0]}>
        <NucleobaseModel base="C" position={[0, 0, 0]} angle={0} selected detailed />
        <MolecularBond start={[0.22, 0, 0]} end={[1.18, 0, 0]} radius={0.055} color="#82928e" />
        <mesh position={[1.28, 0, 0]} rotation={[-0.1, 0.16, -0.1]}>
          <dodecahedronGeometry args={[0.18, 0]} />
          <meshStandardMaterial color="#9ca8a1" roughness={0.7} />
        </mesh>
        <mesh position={[1.62, -0.08, 0]}>
          <sphereGeometry args={[0.13, 9, 7]} />
          <meshStandardMaterial color="#829ba2" roughness={0.64} />
        </mesh>
      </group>
      {[-0.08, 0, 0.08].map((z) => (
        <Line key={z} points={[[ -0.18, 0, z ], [0.18, 0, z]]} color="#c9c5b4" lineWidth={0.42} transparent opacity={0.55} dashed dashScale={8} dashSize={0.05} gapSize={0.04} />
      ))}
      <mesh position={[0, -0.72, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.2, 0.026, 6, 36]} />
        <meshStandardMaterial color="#c5a37d" emissive="#725437" emissiveIntensity={0.16} roughness={0.5} />
      </mesh>
      <MolecularBond start={[0, -0.2, 0]} end={[0, -0.53, 0]} radius={0.024} color="#af9578" opacity={0.78} />
    </group>
  );
}

export function RegulatoryLandscape({ progress, position = [0, 0, -26] }: { progress: MutableRefObject<number>; position?: Point3 }) {
  const group = useRef<Group>(null);
  const transcriptMaterial = useRef<MeshStandardMaterial>(null);
  const geneCurve = useMemo(() => new CatmullRomCurve3([
    new Vector3(-6.4, -0.2, 0.5),
    new Vector3(-4.2, 0.2, -0.2),
    new Vector3(-1.8, -0.12, 0.25),
    new Vector3(0.4, 0.16, -0.1),
    new Vector3(3.2, -0.1, 0.3),
    new Vector3(6.4, 0.14, -0.35)
  ], false, "centripetal", 0.42), []);
  const transcriptCurve = useMemo(() => new CatmullRomCurve3([
    new Vector3(-5.8, 1.4, 0.5),
    new Vector3(-3.6, 1.65, 0.1),
    new Vector3(-1.1, 1.25, 0.65),
    new Vector3(1.2, 1.7, 0.15),
    new Vector3(3.8, 1.35, 0.62),
    new Vector3(6, 1.55, 0.2)
  ], false, "centripetal", 0.4), []);
  const regions = [
    { start: [-5.5, -0.1, 0.35] as Point3, end: [-4.1, 0.18, -0.1] as Point3, kind: "regulatory", color: "#657f8c" },
    { start: [-3.65, 0.12, -0.08] as Point3, end: [-1.9, -0.1, 0.2] as Point3, kind: "coding", color: "#789da5" },
    { start: [-0.75, 0.05, 0.12] as Point3, end: [0.05, 0.14, -0.02] as Point3, kind: "variant", color: "#b49a7f" },
    { start: [0.75, 0.12, -0.02] as Point3, end: [3.05, -0.08, 0.27] as Point3, kind: "coding", color: "#6e949c" },
    { start: [3.8, -0.05, 0.17] as Point3, end: [5.45, 0.12, -0.2] as Point3, kind: "regulatory", color: "#6f7894" }
  ] as const;

  useFrame((state) => {
    const reveal = smoothRange(progress.current, 0.17, 0.35);
    if (group.current) {
      group.current.scale.setScalar(0.06 + reveal * 0.94);
      group.current.rotation.y = -0.16 + reveal * 0.2;
      group.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 0.2) * 0.035;
    }
    if (transcriptMaterial.current) transcriptMaterial.current.opacity = 0.15 + reveal * 0.55;
  });

  return (
    <group ref={group} position={position} scale={0.06} data-regulatory-chromatin-landscape>
      <mesh>
        <tubeGeometry args={[geneCurve, 96, 0.055, 7, false]} />
        <meshStandardMaterial color="#697c81" roughness={0.7} />
      </mesh>
      {regions.map((region) => (
        <group key={`${region.kind}-${region.start[0]}`} data-genomic-region={region.kind}>
          <MolecularBond start={region.start} end={region.end} radius={region.kind === "variant" ? 0.15 : 0.11} color={region.color} />
          {region.kind === "variant" ? (
            <mesh position={[-0.34, 0.53, 0.35]}>
              <octahedronGeometry args={[0.18, 0]} />
              <meshStandardMaterial color="#c1a381" emissive="#77583b" emissiveIntensity={0.12} roughness={0.52} />
            </mesh>
          ) : null}
        </group>
      ))}
      {[-5.1, -3.2, -1.2, 1.2, 3.3, 5.1].map((x, index) => (
        <group key={x} position={[x, Math.sin(index * 1.4) * 0.17, Math.cos(index * 0.8) * 0.22]} rotation={[0.15 * index, 0.35 * index, 0.2]}>
          <mesh scale={[0.5, 0.34, 0.5]}>
            <sphereGeometry args={[0.52, 14, 10]} />
            <meshStandardMaterial color={index === 2 ? "#8b7980" : "#737f85"} roughness={0.72} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.33, 0.032, 6, 30]} />
            <meshStandardMaterial color="#a2aaa3" roughness={0.66} />
          </mesh>
        </group>
      ))}
      <mesh>
        <tubeGeometry args={[transcriptCurve, 112, 0.035, 6, false]} />
        <meshStandardMaterial ref={transcriptMaterial} color="#759e9b" transparent opacity={0.15} roughness={0.62} depthWrite={false} />
      </mesh>
      <Line points={[[-5.05, 0.3, 0.1], [-4.7, 1.12, 0.35], [-3.5, 1.48, 0.25]]} color="#718d96" lineWidth={0.32} transparent opacity={0.4} />
      <Line points={[[4.8, 0.26, -0.08], [4.5, 1.1, 0.26], [3.7, 1.44, 0.46]]} color="#737d9a" lineWidth={0.32} transparent opacity={0.36} />
    </group>
  );
}

export function SequenceToProteinBridge({
  progress,
  quality,
  position = [0, 0, -34]
}: {
  progress: MutableRefObject<number>;
  quality: SpatialQualityTier;
  position?: Point3;
}) {
  const group = useRef<Group>(null);
  const transcript = useMemo(() => new CatmullRomCurve3([
    new Vector3(-4.8, 1.1, 4.5),
    new Vector3(-3.2, 0.6, 3),
    new Vector3(-1.2, 0.9, 1.35),
    new Vector3(0.15, 0.15, 0),
    new Vector3(0.7, -0.4, -1.6)
  ], false, "centripetal", 0.42), []);
  const peptide = useMemo(() => new CatmullRomCurve3([
    new Vector3(0.7, -0.4, -1.6),
    new Vector3(1.5, -0.8, -2.35),
    new Vector3(1.15, -0.1, -3.25),
    new Vector3(0.35, 0.3, -4.65),
    new Vector3(0.05, 0.1, -6.2)
  ], false, "centripetal", 0.4), []);
  const beadCount = quality === "full" ? 17 : quality === "constrained" ? 10 : 7;
  const beads = useMemo(() => Array.from({ length: beadCount }, (_, index) => point(transcript.getPoint(index / Math.max(1, beadCount - 1)))), [beadCount, transcript]);

  useFrame((state) => {
    const reveal = smoothRange(progress.current, 0.23, 0.44);
    if (!group.current) return;
    group.current.scale.setScalar(0.035 + reveal * 0.965);
    group.current.rotation.y = -0.12 + Math.sin(state.clock.elapsedTime * 0.14) * 0.018;
    group.current.position.x = position[0] + (1 - reveal) * -1.3;
  });

  return (
    <group ref={group} position={position} scale={0.035} data-scale-transition="sequence-to-protein">
      <mesh>
        <tubeGeometry args={[transcript, 96, 0.045, 7, false]} />
        <meshStandardMaterial color="#789b98" roughness={0.66} />
      </mesh>
      {beads.map((bead, index) => (
        <mesh key={index} position={bead} scale={index % 3 === 0 ? 1.1 : 0.88}>
          <sphereGeometry args={[0.085, 8, 6]} />
          <meshStandardMaterial color={index % 4 === 0 ? "#a28b74" : "#788e8c"} roughness={0.68} />
        </mesh>
      ))}
      <group position={[0.65, -0.4, -1.55]} rotation={[0.15, -0.35, 0.2]} data-ribosome-complex>
        <mesh scale={[0.78, 0.52, 0.62]}>
          <sphereGeometry args={[0.72, 18, 12]} />
          <meshPhysicalMaterial color="#777e7c" roughness={0.72} metalness={0.01} />
        </mesh>
        <mesh position={[0.12, -0.42, 0.05]} scale={[0.58, 0.32, 0.48]}>
          <sphereGeometry args={[0.62, 16, 10]} />
          <meshStandardMaterial color="#656f70" roughness={0.76} />
        </mesh>
      </group>
      <mesh>
        <tubeGeometry args={[peptide, 72, 0.07, 7, false]} />
        <meshPhysicalMaterial color="#6d9293" roughness={0.62} clearcoat={0.08} />
      </mesh>
    </group>
  );
}

type Crowder = Readonly<{
  position: Point3;
  rotation: Point3;
  scale: Point3;
  color: string;
}>;

function createCrowders(count: number): Crowder[] {
  const palette = ["#697d7d", "#7c897f", "#77898e", "#8d8176", "#5f7478"];
  return Array.from({ length: count }, (_, index) => {
    const theta = deterministicValue(index, 1) * Math.PI * 2;
    const phi = Math.acos(2 * deterministicValue(index, 2) - 1);
    const radius = Math.cbrt(0.12 + deterministicValue(index, 3) * 0.86);
    let x = Math.sin(phi) * Math.cos(theta) * radius * 4.55;
    const y = Math.cos(phi) * radius * 3.65;
    const z = Math.sin(phi) * Math.sin(theta) * radius * 2.65;
    const nucleusDistance = Math.hypot(x + 1.35, y - 0.42, z + 0.2);
    if (nucleusDistance < 2.05) x += x > -1.35 ? 2.05 : -2.05;
    const size = 0.16 + deterministicValue(index, 4) * 0.2;
    return {
      position: [x, y, z],
      rotation: [deterministicValue(index, 5) * Math.PI, deterministicValue(index, 6) * Math.PI, deterministicValue(index, 7) * Math.PI],
      scale: [size * (0.8 + deterministicValue(index, 8) * 0.65), size, size * (0.75 + deterministicValue(index, 9) * 0.5)],
      color: palette[index % palette.length]
    };
  });
}

function MolecularCrowding({ quality, reducedMotion }: { quality: SpatialQualityTier; reducedMotion: boolean }) {
  const globular = useRef<InstancedMesh>(null);
  const elongated = useRef<InstancedMesh>(null);
  const layerA = useRef<Group>(null);
  const layerB = useRef<Group>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const count = quality === "full" ? 76 : quality === "constrained" ? 38 : 22;
  const crowders = useMemo(() => createCrowders(count), [count]);
  const globularCrowders = useMemo(() => crowders.filter((_, index) => index % 3 !== 0), [crowders]);
  const elongatedCrowders = useMemo(() => crowders.filter((_, index) => index % 3 === 0), [crowders]);

  useLayoutEffect(() => {
    if (!globular.current || !elongated.current) return;
    globularCrowders.forEach((crowder, index) => {
      dummy.position.set(...crowder.position);
      dummy.rotation.set(...crowder.rotation);
      dummy.scale.set(...crowder.scale);
      dummy.updateMatrix();
      globular.current?.setMatrixAt(index, dummy.matrix);
      globular.current?.setColorAt(index, new Color(crowder.color));
    });
    elongatedCrowders.forEach((crowder, index) => {
      dummy.position.set(...crowder.position);
      dummy.rotation.set(...crowder.rotation);
      dummy.scale.set(crowder.scale[0] * 0.72, crowder.scale[1] * 2.2, crowder.scale[2] * 0.72);
      dummy.updateMatrix();
      elongated.current?.setMatrixAt(index, dummy.matrix);
      elongated.current?.setColorAt(index, new Color(crowder.color));
    });
    globular.current.instanceMatrix.needsUpdate = true;
    elongated.current.instanceMatrix.needsUpdate = true;
    if (globular.current.instanceColor) globular.current.instanceColor.needsUpdate = true;
    if (elongated.current.instanceColor) elongated.current.instanceColor.needsUpdate = true;
  }, [dummy, elongatedCrowders, globularCrowders]);

  useFrame(({ clock }) => {
    if (reducedMotion) return;
    if (layerA.current) {
      layerA.current.rotation.y = Math.sin(clock.elapsedTime * 0.045) * 0.012;
      layerA.current.position.y = Math.sin(clock.elapsedTime * 0.13) * 0.035;
    }
    if (layerB.current) {
      layerB.current.rotation.z = Math.sin(clock.elapsedTime * 0.052 + 1.3) * 0.009;
      layerB.current.position.x = Math.sin(clock.elapsedTime * 0.1 + 0.7) * 0.028;
    }
  });

  return (
    <group data-molecular-crowding>
      <group ref={layerA}>
        <instancedMesh ref={globular} args={[undefined, undefined, globularCrowders.length]} frustumCulled={false}>
          <dodecahedronGeometry args={[1, 1]} />
          <meshStandardMaterial vertexColors roughness={0.72} metalness={0.01} />
        </instancedMesh>
      </group>
      <group ref={layerB}>
        <instancedMesh ref={elongated} args={[undefined, undefined, elongatedCrowders.length]} frustumCulled={false}>
          <cylinderGeometry args={[1, 1, 1, 8]} />
          <meshStandardMaterial vertexColors roughness={0.68} metalness={0.015} />
        </instancedMesh>
      </group>
    </group>
  );
}

function DirectionalSignaling({ progress, reducedMotion }: { progress: MutableRefObject<number>; reducedMotion: boolean }) {
  const carriers = useRef<Array<Mesh | null>>([]);
  const path = useMemo<Point3[]>(() => [
    [-4.1, 2.05, 0.75], [-2.9, 1.2, 0.25], [-1.2, 0.45, 0.05], [0.5, -0.25, 0.35], [2.25, -1.15, 0.4], [4, -2, 0.8]
  ], []);
  const pathVectors = useMemo(() => path.map((pathPoint) => new Vector3(...pathPoint)), [path]);

  useFrame(({ clock }) => {
    const reveal = smoothRange(progress.current, 0.43, 0.66);
    carriers.current.forEach((carrier, index) => {
      if (!carrier) return;
      const travel = reducedMotion ? (index + 1) / 4 : (clock.elapsedTime * 0.055 + index / 3) % 1;
      const segment = Math.min(path.length - 2, Math.floor(travel * (path.length - 1)));
      const local = travel * (path.length - 1) - segment;
      carrier.position.lerpVectors(pathVectors[segment], pathVectors[segment + 1], local);
      carrier.scale.setScalar(reveal * (0.72 + Math.sin(clock.elapsedTime * 0.8 + index) * 0.08));
    });
  });

  return (
    <group data-directional-signaling>
      {path.slice(0, -1).map((start, index) => (
        <Line key={index} points={[start, path[index + 1]]} color={index === 3 ? "#a98774" : "#678c94"} lineWidth={0.38} transparent opacity={0.38} dashed={index === 3} dashScale={6} dashSize={0.12} gapSize={0.1} />
      ))}
      {[0, 1, 2].map((index) => (
        <mesh key={index} ref={(node) => { carriers.current[index] = node; }}>
          <sphereGeometry args={[0.16, 10, 8]} />
          <meshStandardMaterial color={index === 2 ? "#b2987d" : "#779da4"} emissive={index === 2 ? "#4f3929" : "#294a51"} emissiveIntensity={0.12} roughness={0.55} />
        </mesh>
      ))}
    </group>
  );
}

export function CellularEnvironment({
  progress,
  quality,
  position = [0, 0, -57],
  reducedMotion = false
}: {
  progress: MutableRefObject<number>;
  quality: SpatialQualityTier;
  position?: Point3;
  reducedMotion?: boolean;
}) {
  const group = useRef<Group>(null);
  const membrane = useRef<Mesh>(null);
  const innerMembrane = useRef<Mesh>(null);
  const chromatinCurves = useMemo(() => [
    new CatmullRomCurve3([new Vector3(-2.35, 0.5, -0.5), new Vector3(-1.75, 1.1, 0.25), new Vector3(-0.75, 0.72, 0.5), new Vector3(-0.45, 0.05, -0.2)]),
    new CatmullRomCurve3([new Vector3(-2.2, -0.15, 0.35), new Vector3(-1.5, -0.72, 0.5), new Vector3(-0.55, -0.35, -0.25), new Vector3(-0.2, 0.35, 0.1)]),
    new CatmullRomCurve3([new Vector3(-2.05, 1.15, -0.15), new Vector3(-1.35, 0.25, -0.65), new Vector3(-0.85, -0.6, -0.35), new Vector3(-0.25, -0.2, 0.4)])
  ], []);
  const cytoskeleton = useMemo(() => [
    new CatmullRomCurve3([new Vector3(-4.5, -2.5, 1.2), new Vector3(-2.2, -1.1, -0.4), new Vector3(0.4, -0.7, 1), new Vector3(4.1, 1.8, -0.8)]),
    new CatmullRomCurve3([new Vector3(-4, 2.8, -0.8), new Vector3(-1.7, 1.2, 1.1), new Vector3(1.1, 0.9, -1), new Vector3(4.3, -2.1, 0.6)]),
    new CatmullRomCurve3([new Vector3(-3.7, 0.2, -1.9), new Vector3(-1, -1.6, 0.4), new Vector3(1.7, -0.5, 1.5), new Vector3(4.2, 0.4, -0.4)])
  ], []);
  const vesicles = [
    [3, 1.9, -0.3, 0.52], [2.1, 2.8, 0.8, 0.34], [3.4, -0.2, 1.4, 0.42], [1.5, -2.5, -0.7, 0.47], [-3.5, -2.1, 0.9, 0.38], [-3.7, 1.2, -0.8, 0.3]
  ] as const;

  useFrame((state) => {
    const reveal = smoothRange(progress.current, 0.39, 0.65);
    if (group.current) {
      group.current.scale.setScalar(0.28 + reveal * 0.82);
      group.current.rotation.y = -0.22 + (reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 0.1) * 0.025);
      group.current.rotation.z = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 0.075) * 0.012;
    }
    if (membrane.current && innerMembrane.current && !reducedMotion) {
      const breath = Math.sin(state.clock.elapsedTime * 0.21) * 0.008;
      membrane.current.scale.set(1.18 + breath, 1 - breath * 0.4, 0.76 + breath * 0.3);
      innerMembrane.current.scale.set(1.145 - breath * 0.3, 0.97 + breath * 0.25, 0.735);
    }
  });

  return (
    <group ref={group} position={position} scale={0.28} data-cellular-microenvironment>
      <mesh ref={membrane} scale={[1.18, 1, 0.76]}>
        <sphereGeometry args={[5.3, quality === "full" ? 56 : 36, quality === "full" ? 38 : 24]} />
        <meshPhysicalMaterial color="#5f7b80" transparent opacity={0.14} transmission={0.12} ior={1.37} thickness={0.15} roughness={0.72} metalness={0.01} side={DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={innerMembrane} scale={[1.145, 0.97, 0.735]}>
        <sphereGeometry args={[5.3, quality === "full" ? 48 : 30, quality === "full" ? 32 : 20]} />
        <meshPhysicalMaterial color="#758a86" transparent opacity={0.075} transmission={0.08} roughness={0.78} side={DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[-1.35, 0.42, -0.2]} scale={[1.15, 1, 0.82]}>
        <sphereGeometry args={[1.62, 32, 24]} />
        <meshPhysicalMaterial color="#646b81" transparent opacity={0.26} transmission={0.08} roughness={0.66} side={DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[-1.35, 0.42, -0.2]} scale={[0.42, 0.34, 0.38]}>
        <sphereGeometry args={[1.2, 18, 14]} />
        <meshStandardMaterial color="#766f78" roughness={0.76} />
      </mesh>
      {chromatinCurves.map((curve, index) => (
        <mesh key={index}>
          <tubeGeometry args={[curve, 48, 0.035, 6, false]} />
          <meshStandardMaterial color={index === 1 ? "#8e7c78" : "#7d818b"} roughness={0.72} />
        </mesh>
      ))}
      {cytoskeleton.slice(0, quality === "full" ? 3 : 2).map((curve, index) => (
        <mesh key={index}>
          <tubeGeometry args={[curve, 72, 0.025, 6, false]} />
          <meshStandardMaterial color={index === 1 ? "#7e7168" : "#61777b"} transparent opacity={0.38} roughness={0.7} depthWrite={false} />
        </mesh>
      ))}
      <MolecularCrowding quality={quality} reducedMotion={reducedMotion} />
      {vesicles.slice(0, quality === "full" ? vesicles.length : 4).map(([x, y, z, radius], index) => (
        <group key={index} position={[x, y, z]}>
          <mesh>
            <sphereGeometry args={[radius, 18, 14]} />
            <meshPhysicalMaterial color={index % 2 ? "#7c7a70" : "#687f82"} transparent opacity={0.2} transmission={0.08} roughness={0.7} side={DoubleSide} depthWrite={false} />
          </mesh>
          <mesh scale={0.35}>
            <sphereGeometry args={[radius, 10, 8]} />
            <meshStandardMaterial color="#8c8275" roughness={0.74} />
          </mesh>
        </group>
      ))}
      {[-3.8, -1.9, 0.3, 2.25, 3.75].map((x, index) => (
        <group key={x} position={[x, 3.72 - Math.abs(x) * 0.07, Math.sin(index * 1.4) * 0.5]} rotation={[0, 0, (index - 2) * -0.2]}>
          <MolecularBond start={[0, -0.5, 0]} end={[0, 0.5, 0]} radius={0.11} color="#677d7b" />
          <mesh position={[0, 0.65, 0]} scale={[0.28, 0.18, 0.24]}>
            <dodecahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#778a83" roughness={0.7} />
          </mesh>
          <mesh position={[0, -0.65, 0]} scale={[0.22, 0.17, 0.21]}>
            <dodecahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#6f7c79" roughness={0.72} />
          </mesh>
        </group>
      ))}
      <DirectionalSignaling progress={progress} reducedMotion={reducedMotion} />
      <mesh position={[4.5, -0.3, 2.3]} scale={[1.6, 1.1, 0.75]}>
        <dodecahedronGeometry args={[0.85, 1]} />
        <meshStandardMaterial color="#53676a" transparent opacity={0.22} roughness={0.8} depthWrite={false} />
      </mesh>
      <mesh position={[-4.2, 1.1, -2.1]} scale={[1.35, 0.9, 0.7]}>
        <dodecahedronGeometry args={[0.78, 1]} />
        <meshStandardMaterial color="#6f655f" transparent opacity={0.18} roughness={0.82} depthWrite={false} />
      </mesh>
    </group>
  );
}

type PathwayNodeKind = "gene" | "regulatory" | "protein" | "cellular_process" | "pathway" | "phenotype" | "finding";
type RelationshipKind = "expression" | "regulation" | "interaction" | "activation" | "inhibition" | "association" | "experimental_support";
type PathwayNode = Readonly<{ id: string; kind: PathwayNodeKind; position: Point3 }>;
type PathwayEdge = Readonly<{ from: number; to: number; relationship: RelationshipKind }>;

const PATHWAY_NODES: readonly PathwayNode[] = [
  { id: "g1", kind: "gene", position: [-6.2, 2.6, -0.5] },
  { id: "r1", kind: "regulatory", position: [-6, -2.35, 0.75] },
  { id: "p1", kind: "protein", position: [-3, 1.15, 0.25] },
  { id: "p2", kind: "protein", position: [-2.45, -2.25, -0.8] },
  { id: "cp", kind: "cellular_process", position: [0.2, -0.65, 0.9] },
  { id: "pw", kind: "pathway", position: [1.45, 1.35, -0.35] },
  { id: "f1", kind: "finding", position: [4.35, 2.65, 0.8] },
  { id: "f2", kind: "finding", position: [4.8, -2.15, -0.35] },
  { id: "ph", kind: "phenotype", position: [7.25, 0.25, 0.4] }
] as const;

const PATHWAY_EDGES: readonly PathwayEdge[] = [
  { from: 0, to: 2, relationship: "expression" },
  { from: 1, to: 0, relationship: "regulation" },
  { from: 1, to: 3, relationship: "regulation" },
  { from: 2, to: 5, relationship: "interaction" },
  { from: 3, to: 4, relationship: "activation" },
  { from: 4, to: 5, relationship: "activation" },
  { from: 5, to: 6, relationship: "experimental_support" },
  { from: 5, to: 7, relationship: "inhibition" },
  { from: 6, to: 8, relationship: "association" },
  { from: 7, to: 8, relationship: "experimental_support" }
] as const;

const NODE_COLORS: Record<PathwayNodeKind, string> = {
  gene: "#7296a2",
  regulatory: "#817d97",
  protein: "#74988d",
  cellular_process: "#9c8975",
  pathway: "#9b927e",
  phenotype: "#9fa98a",
  finding: "#8490a5"
};

function PathwayNodeShape({ node }: { node: PathwayNode }) {
  const color = NODE_COLORS[node.kind];
  return (
    <group position={node.position} data-biological-entity={node.kind}>
      {node.kind === "gene" ? (
        <group rotation={[0.1, 0.25, 0.2]}>
          <MolecularBond start={[-0.32, -0.34, 0]} end={[-0.32, 0.34, 0]} radius={0.045} color={color} />
          <MolecularBond start={[0.32, -0.34, 0]} end={[0.32, 0.34, 0]} radius={0.045} color={color} />
          {[-0.24, 0, 0.24].map((y) => <MolecularBond key={y} start={[-0.3, y, 0]} end={[0.3, y, 0]} radius={0.025} color="#a7aaa0" />)}
        </group>
      ) : null}
      {node.kind === "regulatory" ? (
        <group rotation={[0.15, -0.2, -0.1]}>
          <mesh scale={[0.72, 0.18, 0.42]}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={color} roughness={0.65} /></mesh>
          <mesh position={[0.18, 0.27, 0]} scale={[0.38, 0.08, 0.28]}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#a59a7e" roughness={0.62} /></mesh>
        </group>
      ) : null}
      {node.kind === "protein" ? (
        <mesh rotation={[0.4, 0.5, 0.1]} scale={0.72}>
          <torusKnotGeometry args={[0.34, 0.095, 56, 7, 2, 3]} />
          <meshStandardMaterial color={color} roughness={0.64} metalness={0.01} />
        </mesh>
      ) : null}
      {node.kind === "cellular_process" ? (
        <group>
          <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.42, 0.08, 8, 32]} /><meshStandardMaterial color={color} roughness={0.62} /></mesh>
          {[0, 1, 2].map((index) => {
            const angle = (index / 3) * Math.PI * 2;
            return <mesh key={index} position={[Math.cos(angle) * 0.42, Math.sin(angle) * 0.42, 0]}><sphereGeometry args={[0.11, 8, 6]} /><meshStandardMaterial color="#9a8773" roughness={0.66} /></mesh>;
          })}
        </group>
      ) : null}
      {node.kind === "pathway" ? (
        <group rotation={[0.25, 0.15, 0]}>
          <mesh><torusGeometry args={[0.56, 0.1, 10, 40]} /><meshStandardMaterial color={color} roughness={0.64} /></mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.32, 0.055, 8, 28]} /><meshStandardMaterial color="#798d89" roughness={0.68} /></mesh>
        </group>
      ) : null}
      {node.kind === "finding" ? (
        <group rotation={[0.12, 0.28, -0.08]}>
          {[-0.16, 0, 0.16].map((z, index) => <mesh key={z} position={[index * 0.08 - 0.08, index * 0.06 - 0.06, z]} scale={[0.62, 0.42, 0.06]}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={index === 1 ? "#9a837d" : color} roughness={0.67} /></mesh>)}
        </group>
      ) : null}
      {node.kind === "phenotype" ? (
        <group>
          <mesh><sphereGeometry args={[0.58, 18, 14]} /><meshPhysicalMaterial color={color} transparent opacity={0.34} transmission={0.1} roughness={0.68} depthWrite={false} /></mesh>
          <mesh scale={0.38}><dodecahedronGeometry args={[1, 1]} /><meshStandardMaterial color="#8f987e" roughness={0.72} /></mesh>
        </group>
      ) : null}
    </group>
  );
}

function edgeColor(relationship: RelationshipKind) {
  if (relationship === "inhibition") return "#9f7775";
  if (relationship === "experimental_support") return "#9da68a";
  if (relationship === "regulation") return "#777d96";
  if (relationship === "activation") return "#76959b";
  return "#637c83";
}

function RelationshipMarker({ edge }: { edge: PathwayEdge }) {
  if (edge.relationship !== "activation" && edge.relationship !== "inhibition") return null;
  const start = new Vector3(...PATHWAY_NODES[edge.from].position);
  const end = new Vector3(...PATHWAY_NODES[edge.to].position);
  const direction = end.clone().sub(start);
  const marker = start.clone().addScaledVector(direction, 0.82);
  const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize());
  return (
    <group position={marker} quaternion={quaternion}>
      {edge.relationship === "activation" ? (
        <mesh><coneGeometry args={[0.11, 0.28, 8]} /><meshStandardMaterial color="#829ba0" roughness={0.62} /></mesh>
      ) : (
        <mesh rotation={[0, 0, Math.PI / 2]}><boxGeometry args={[0.36, 0.055, 0.08]} /><meshStandardMaterial color="#a17b78" roughness={0.65} /></mesh>
      )}
    </group>
  );
}

function PathwayPulse({ edge, progress, index }: { edge: PathwayEdge; progress: MutableRefObject<number>; index: number }) {
  const pulse = useRef<Mesh>(null);
  const start = useMemo(() => new Vector3(...PATHWAY_NODES[edge.from].position), [edge.from]);
  const end = useMemo(() => new Vector3(...PATHWAY_NODES[edge.to].position), [edge.to]);
  useFrame(({ clock }) => {
    if (!pulse.current) return;
    const reveal = smoothRange(progress.current, 0.58 + index * 0.012, 0.76 + index * 0.01);
    const travel = (clock.elapsedTime * 0.075 + index * 0.19) % 1;
    pulse.current.position.lerpVectors(start, end, travel);
    pulse.current.scale.setScalar(reveal * (0.72 + Math.sin(clock.elapsedTime * 0.9 + index) * 0.08));
  });
  return (
    <mesh ref={pulse}>
      <sphereGeometry args={[0.09, 8, 6]} />
      <meshStandardMaterial color={edgeColor(edge.relationship)} emissive={edgeColor(edge.relationship)} emissiveIntensity={0.14} roughness={0.55} />
    </mesh>
  );
}

export function PathwaySystem({
  progress,
  quality,
  position = [0, 0, -75]
}: {
  progress: MutableRefObject<number>;
  quality: SpatialQualityTier;
  position?: Point3;
}) {
  const group = useRef<Group>(null);
  useFrame((state) => {
    const reveal = smoothRange(progress.current, 0.56, 0.81);
    if (!group.current) return;
    group.current.scale.setScalar(0.36 + reveal * 0.76);
    group.current.rotation.y = -0.08 + Math.sin(state.clock.elapsedTime * 0.12) * 0.018;
    group.current.position.x = position[0] + (1 - reveal) * 1.5;
  });

  return (
    <group ref={group} position={position} scale={0.36} data-biological-pathway-system>
      {PATHWAY_EDGES.map((edge, index) => (
        <group key={`${edge.from}-${edge.to}`} data-relationship={edge.relationship}>
          <Line
            points={[PATHWAY_NODES[edge.from].position, PATHWAY_NODES[edge.to].position]}
            color={edgeColor(edge.relationship)}
            lineWidth={edge.relationship === "experimental_support" ? 0.58 : 0.38}
            transparent
            opacity={edge.relationship === "inhibition" ? 0.42 : 0.55}
            dashed={edge.relationship === "inhibition" || edge.relationship === "association"}
            dashScale={6}
            dashSize={0.15}
            gapSize={0.11}
          />
          <RelationshipMarker edge={edge} />
          {quality === "full" && ["activation", "experimental_support", "expression"].includes(edge.relationship) ? <PathwayPulse edge={edge} progress={progress} index={index} /> : null}
        </group>
      ))}
      {PATHWAY_NODES.map((node) => <PathwayNodeShape key={node.id} node={node} />)}
    </group>
  );
}

export function BiologicalScaleContinuity({ progress }: { progress: MutableRefObject<number> }) {
  const cellMaterial = useRef<MeshStandardMaterial>(null);
  const evidenceMaterial = useRef<MeshStandardMaterial>(null);
  const cellToSystem = useMemo(() => new CatmullRomCurve3([
    new Vector3(3.9, -1.9, -56.2),
    new Vector3(4.7, -1.1, -62),
    new Vector3(1.8, 0.2, -67),
    new Vector3(-2.5, 1.2, -71),
    new Vector3(-5.8, 2.45, -74.6)
  ], false, "centripetal", 0.4), []);
  const systemToEvidence = useMemo(() => new CatmullRomCurve3([
    new Vector3(4.25, 2.55, -74.4),
    new Vector3(5.2, 2.2, -80),
    new Vector3(2.2, 1.4, -85),
    new Vector3(-2.4, 2.4, -90),
    new Vector3(-6.3, 3.1, -93.6)
  ], false, "centripetal", 0.4), []);

  useFrame(() => {
    if (cellMaterial.current) cellMaterial.current.opacity = smoothRange(progress.current, 0.48, 0.72) * 0.34;
    if (evidenceMaterial.current) evidenceMaterial.current.opacity = smoothRange(progress.current, 0.66, 0.88) * 0.32;
  });

  return (
    <group data-scale-continuity="cell-to-system-to-intelligence">
      <mesh>
        <tubeGeometry args={[cellToSystem, 92, 0.025, 6, false]} />
        <meshStandardMaterial ref={cellMaterial} color="#6d898c" transparent opacity={0} roughness={0.7} depthWrite={false} />
      </mesh>
      <mesh>
        <tubeGeometry args={[systemToEvidence, 92, 0.022, 6, false]} />
        <meshStandardMaterial ref={evidenceMaterial} color="#7d8798" transparent opacity={0} roughness={0.7} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function IntelligenceConvergence({
  progress,
  quality,
  position = [0, 0, -94]
}: {
  progress: MutableRefObject<number>;
  quality: SpatialQualityTier;
  position?: Point3;
}) {
  const group = useRef<Group>(null);
  const mechanism = useRef<Group>(null);
  const observations = useMemo<Point3[]>(() => [
    [-6.8, 3.2, 1.1], [-6, -2.65, -0.25], [-3.8, 1.35, 0.55], [-2.7, -3.2, -0.7], [3.35, 3.05, 0.7], [5.75, 1.05, -0.25], [5.4, -2.9, 0.85], [2.55, -2.15, -0.4]
  ], []);
  const outcomeAnchors = [
    [-1.8, -1.3, 0.25], [0, 1.25, 0.4], [0.1, -1.4, 0.15], [1.85, -1.1, 0.35]
  ] as const;

  useFrame(({ clock }) => {
    const convergence = smoothRange(progress.current, 0.75, 0.97);
    if (group.current) {
      group.current.scale.setScalar(0.46 + convergence * 0.62);
      group.current.rotation.y = -0.06 + convergence * 0.06;
    }
    if (mechanism.current) {
      mechanism.current.scale.setScalar(0.82 + convergence * 0.18 + Math.sin(clock.elapsedTime * 0.35) * 0.012);
    }
  });

  return (
    <group ref={group} position={position} scale={0.46} data-intelligence-derived-from-evidence>
      {observations.slice(0, quality === "full" ? observations.length : 6).map((observation, index) => {
        const conflicting = index === 1 || index === 6;
        const anchor = outcomeAnchors[index % outcomeAnchors.length];
        return (
          <group key={index} data-evidence-state={conflicting ? "conflicting" : index === 7 ? "gap" : "supporting"}>
            <Line points={[observation, anchor]} color={conflicting ? "#9f7775" : index === 7 ? "#9da68a" : "#6e8991"} lineWidth={conflicting ? 0.4 : 0.5} transparent opacity={conflicting ? 0.42 : 0.54} dashed={conflicting || index === 7} dashScale={6} dashSize={0.15} gapSize={0.11} />
            <group position={observation} rotation={[0.12, index * 0.22, 0.08]}>
              <mesh position={[-0.08, 0.06, -0.08]} scale={[0.52, 0.34, 0.05]}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={conflicting ? "#987574" : "#778797"} roughness={0.7} /></mesh>
              <mesh position={[0.08, -0.06, 0.08]} scale={[0.52, 0.34, 0.05]}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={index === 7 ? "#929b80" : "#6e858b"} roughness={0.72} /></mesh>
            </group>
          </group>
        );
      })}
      <group ref={mechanism} position={[0, 0.1, 0.15]} data-mechanism-convergence>
        <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[1.15, 0.075, 10, 54]} /><meshStandardMaterial color="#728d8d" roughness={0.62} /></mesh>
        <mesh rotation={[0.3, 0.25, 0]}><torusKnotGeometry args={[0.42, 0.085, 64, 7, 2, 3]} /><meshStandardMaterial color="#7e9a91" emissive="#29413c" emissiveIntensity={0.08} roughness={0.58} /></mesh>
        <MolecularBond start={[0, -0.95, 0]} end={[0, 0.95, 0]} radius={0.045} color="#9a9586" />
      </group>
      <group position={[-1.8, -1.3, 0.25]} data-intelligence-signal="conflicting-result">
        <mesh rotation={[0, 0, Math.PI / 4]} scale={[0.48, 0.08, 0.08]}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#9c7572" roughness={0.65} /></mesh>
        <mesh rotation={[0, 0, -Math.PI / 4]} scale={[0.48, 0.08, 0.08]}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#9c7572" roughness={0.65} /></mesh>
      </group>
      <group position={[0.1, -1.4, 0.15]} data-intelligence-signal="evidence-gap">
        <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.42, 0.055, 8, 26, Math.PI * 1.56]} /><meshStandardMaterial color="#9c9b84" roughness={0.68} /></mesh>
      </group>
      <group position={[1.85, -1.1, 0.35]} data-intelligence-signal="next-investigation">
        <mesh scale={[0.78, 0.22, 0.12]}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#9ba786" roughness={0.66} /></mesh>
        <mesh position={[0.5, 0, 0]} rotation={[0, 0, -Math.PI / 2]}><coneGeometry args={[0.16, 0.34, 8]} /><meshStandardMaterial color="#9ba786" roughness={0.66} /></mesh>
      </group>
      {[-2.4, 0, 2.4].map((x, index) => (
        <mesh key={x} position={[x, index === 1 ? 2.35 : -2.5, -0.75 - index * 0.18]} rotation={[0.04, 0.04 * (index - 1), 0]}>
          <boxGeometry args={[2.6, 0.07, 0.9]} />
          <meshPhysicalMaterial color={index === 1 ? "#667b82" : "#5e6d74"} transparent opacity={0.2} roughness={0.72} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

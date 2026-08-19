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
  Object3D,
  Quaternion,
  Vector3
} from "three";
import type { SpatialQualityTier } from "@/components/spatial/useSpatialCapability";

type Point3 = readonly [number, number, number];

const graphite = "#10161d";
const ceramic = "#060a0f";
const composite = "#1b2832";
const titanium = "#526875";
const electric = "#62d8ff";
const coolWhite = "#e7f8fd";
const evidenceBlue = "#6b9fba";
const opportunity = "#72b3a4";
const priority = "#c4a68a";

function smoothRange(value: number, from: number, to: number) {
  const normalized = MathUtils.clamp((value - from) / Math.max(0.001, to - from), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function deterministicValue(index: number, channel: number) {
  const value = Math.sin(index * 83.17 + channel * 31.91) * 43758.5453;
  return value - Math.floor(value);
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

function StructuralBeam({
  start,
  end,
  radius = 0.055,
  color = titanium,
  emissive = false
}: {
  start: Point3;
  end: Point3;
  radius?: number;
  color?: string;
  emissive?: boolean;
}) {
  const transform = useMemo(() => segmentTransform(start, end), [end, start]);
  return (
    <mesh position={transform.position} quaternion={transform.quaternion}>
      <cylinderGeometry args={[radius, radius, transform.length, 6]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive ? color : graphite}
        emissiveIntensity={emissive ? 0.62 : 0}
        metalness={0.82}
        roughness={0.3}
      />
    </mesh>
  );
}

function ArchitecturalSlab({
  position,
  scale,
  rotation = [0, 0, 0],
  tone = "graphite",
  emissive,
  emissiveIntensity = 0
}: {
  position: Point3;
  scale: Point3;
  rotation?: Point3;
  tone?: "graphite" | "ceramic" | "composite" | "titanium";
  emissive?: string;
  emissiveIntensity?: number;
}) {
  const color = tone === "ceramic" ? ceramic : tone === "composite" ? composite : tone === "titanium" ? titanium : graphite;
  return (
    <mesh position={position} rotation={rotation} scale={scale}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive || color}
        emissiveIntensity={emissiveIntensity}
        metalness={tone === "ceramic" ? 0.28 : 0.84}
        roughness={tone === "ceramic" ? 0.72 : 0.3}
      />
    </mesh>
  );
}

function SmokedPanel({
  position,
  scale,
  rotation = [0, 0, 0],
  color = "#153142",
  opacity = 0.22
}: {
  position: Point3;
  scale: Point3;
  rotation?: Point3;
  color?: string;
  opacity?: number;
}) {
  return (
    <mesh position={position} rotation={rotation} scale={scale}>
      <boxGeometry args={[1, 1, 1]} />
      <meshPhysicalMaterial
        color={color}
        metalness={0.45}
        roughness={0.2}
        transparent
        opacity={opacity}
        transmission={0.24}
        thickness={0.62}
        depthWrite={false}
      />
    </mesh>
  );
}

function PrecisionFrame({
  position,
  width,
  height,
  depth = 0.34,
  rotation = [0, 0, 0],
  accent = electric,
  emphasis = 1
}: {
  position: Point3;
  width: number;
  height: number;
  depth?: number;
  rotation?: Point3;
  accent?: string;
  emphasis?: number;
}) {
  const rail = Math.max(0.09, Math.min(width, height) * 0.022);
  return (
    <group position={position} rotation={rotation}>
      <ArchitecturalSlab position={[0, height / 2, 0]} scale={[width, rail, depth]} tone="composite" />
      <ArchitecturalSlab position={[0, -height / 2, 0]} scale={[width * 0.88, rail, depth]} />
      <ArchitecturalSlab position={[-width / 2, 0, 0]} scale={[rail, height, depth]} />
      <ArchitecturalSlab position={[width / 2, height * 0.06, 0]} scale={[rail, height * 0.88, depth]} tone="composite" />
      <Line
        points={[
          [-width / 2, -height * 0.32, depth / 2 + 0.02],
          [-width * 0.14, -height * 0.32, depth / 2 + 0.02],
          [width * 0.08, -height * 0.18, depth / 2 + 0.02],
          [width / 2, -height * 0.18, depth / 2 + 0.02]
        ]}
        color={accent}
        lineWidth={0.58 * emphasis}
        transparent
        opacity={0.34 + emphasis * 0.25}
      />
    </group>
  );
}

function CalibratedGrid({
  position,
  rotation = [0, 0, 0],
  width,
  height,
  columns = 8,
  rows = 5,
  accent = electric,
  opacity = 0.25
}: {
  position: Point3;
  rotation?: Point3;
  width: number;
  height: number;
  columns?: number;
  rows?: number;
  accent?: string;
  opacity?: number;
}) {
  return (
    <group position={position} rotation={rotation}>
      <SmokedPanel position={[0, 0, -0.08]} scale={[width, height, 0.12]} opacity={0.16} />
      {Array.from({ length: columns + 1 }, (_, index) => {
        const x = -width / 2 + (index / columns) * width;
        return <Line key={`column-${index}`} points={[[x, -height / 2, 0], [x, height / 2, 0]]} color={accent} lineWidth={0.3} transparent opacity={opacity * (index % 2 ? 0.58 : 1)} />;
      })}
      {Array.from({ length: rows + 1 }, (_, index) => {
        const y = -height / 2 + (index / rows) * height;
        return <Line key={`row-${index}`} points={[[-width / 2, y, 0], [width / 2, y, 0]]} color={accent} lineWidth={0.3} transparent opacity={opacity * (index % 2 ? 0.6 : 1)} />;
      })}
    </group>
  );
}

function SignalChannel({
  points,
  color = electric,
  opacity = 0.58,
  pulse = false,
  phase = 0,
  reducedMotion = false
}: {
  points: readonly Point3[];
  color?: string;
  opacity?: number;
  pulse?: boolean;
  phase?: number;
  reducedMotion?: boolean;
}) {
  const marker = useRef<Mesh>(null);
  const point = useMemo(() => new Vector3(), []);
  const tangent = useMemo(() => new Vector3(), []);
  const axis = useMemo(() => new Vector3(0, 0, 1), []);
  const curve = useMemo(() => new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x, y, z))), [points]);

  useFrame(({ clock }) => {
    if (!pulse || reducedMotion || !marker.current) return;
    const travel = (clock.elapsedTime * 0.055 + phase) % 1;
    curve.getPointAt(travel, point);
    curve.getTangentAt(travel, tangent).normalize();
    marker.current.position.copy(point);
    marker.current.quaternion.setFromUnitVectors(axis, tangent);
  });

  return (
    <group>
      <mesh>
        <tubeGeometry args={[curve, 56, 0.028, 5, false]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.72} metalness={0.48} roughness={0.28} transparent opacity={opacity} />
      </mesh>
      {pulse ? (
        <mesh ref={marker} scale={[0.075, 0.075, 0.52]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={coolWhite} transparent opacity={0.8} />
        </mesh>
      ) : null}
    </group>
  );
}

function InformationSlatField({ quality, reducedMotion }: { quality: SpatialQualityTier; reducedMotion: boolean }) {
  const mesh = useRef<InstancedMesh>(null);
  const group = useRef<Group>(null);
  const count = quality === "full" ? 34 : quality === "balanced" ? 22 : 14;

  useLayoutEffect(() => {
    if (!mesh.current) return;
    const object = new Object3D();
    for (let index = 0; index < count; index += 1) {
      const column = index % 7;
      const row = Math.floor(index / 7);
      object.position.set(
        (column - 3) * 2.35 + (deterministicValue(index, 1) - 0.5) * 0.55,
        (row - 2) * 1.75 + (deterministicValue(index, 2) - 0.5) * 0.4,
        -7 - deterministicValue(index, 3) * 17
      );
      object.rotation.set(
        (deterministicValue(index, 4) - 0.5) * 0.1,
        (deterministicValue(index, 5) - 0.5) * 0.28,
        (deterministicValue(index, 6) - 0.5) * 0.05
      );
      object.scale.set(1.2 + deterministicValue(index, 7) * 3.8, 0.035, 0.16 + deterministicValue(index, 8) * 0.28);
      object.updateMatrix();
      mesh.current.setMatrixAt(index, object.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [count]);

  useFrame(({ clock }) => {
    if (!group.current || reducedMotion) return;
    group.current.rotation.z = Math.sin(clock.elapsedTime * 0.12) * 0.008;
    group.current.position.y = Math.sin(clock.elapsedTime * 0.18) * 0.08;
  });

  return (
    <group ref={group} position={[1.4, 0.4, 0]} rotation={[0.04, -0.06, -0.04]}>
      <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#263845" emissive="#0e2733" emissiveIntensity={0.24} metalness={0.78} roughness={0.34} />
      </instancedMesh>
    </group>
  );
}

function BusinessComplexityScene({ quality, reducedMotion }: { quality: SpatialQualityTier; reducedMotion: boolean }) {
  return (
    <group position={[0, 0, -8]}>
      <InformationSlatField quality={quality} reducedMotion={reducedMotion} />
      <PrecisionFrame position={[3.7, 0.2, -4]} width={12.5} height={8.2} rotation={[0.03, -0.18, 0]} />
      <PrecisionFrame position={[-7.2, 2.7, -12]} width={8} height={4.4} rotation={[0.02, 0.28, 0.03]} accent={evidenceBlue} emphasis={0.68} />
      <CalibratedGrid position={[7.4, -2.5, -11]} rotation={[-0.32, -0.12, 0.04]} width={9} height={4.7} opacity={0.2} />
      <ArchitecturalSlab position={[-9, -4.2, -8]} scale={[11, 0.35, 5.5]} rotation={[0, 0.12, 0.03]} tone="ceramic" />
      <ArchitecturalSlab position={[10.5, 4.8, -18]} scale={[14, 0.28, 5]} rotation={[0, -0.18, -0.02]} tone="composite" />
      <SignalChannel reducedMotion={reducedMotion} pulse points={[[-10, -2.8, 3], [-4, -1.8, -2], [1, -2.1, -9], [8, -1.5, -17]]} phase={0.1} />
      <SignalChannel reducedMotion={reducedMotion} pulse points={[[11, 3.2, -2], [6, 2.6, -8], [1, 1.7, -15], [-8, 2.2, -22]]} color={evidenceBlue} phase={0.62} />
      <SignalChannel reducedMotion={reducedMotion} points={[[-11, 4.8, -7], [-4, 3.6, -12], [4, 4, -19], [11, 3.1, -25]]} color={priority} opacity={0.38} />
    </group>
  );
}

function CommandSurfaceScene({ reducedMotion }: { reducedMotion: boolean }) {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!group.current || reducedMotion) return;
    group.current.position.y = Math.sin(clock.elapsedTime * 0.2) * 0.06;
  });

  return (
    <group ref={group} position={[0, 0, -38]}>
      <ArchitecturalSlab position={[0, -4.4, 0]} scale={[22, 0.5, 9]} tone="ceramic" />
      <PrecisionFrame position={[1.8, 0, -1]} width={16.4} height={9.2} rotation={[0.01, -0.08, 0]} emphasis={1.2} />
      <SmokedPanel position={[1.7, 0, -0.55]} scale={[15.4, 8.2, 0.22]} opacity={0.28} />
      <PrecisionFrame position={[-8.9, 1.1, -4.8]} width={5.5} height={6.8} rotation={[0, 0.3, 0]} accent={evidenceBlue} emphasis={0.72} />
      <PrecisionFrame position={[10.6, -1, -6.5]} width={6.4} height={5.2} rotation={[0, -0.34, 0]} accent={opportunity} emphasis={0.72} />
      <CalibratedGrid position={[1.7, 0, -0.38]} width={14.7} height={7.5} columns={10} rows={6} opacity={0.16} />
      <ArchitecturalSlab position={[1.6, 4.9, -2]} scale={[18, 0.25, 1.8]} tone="titanium" />
      <StructuralBeam start={[-10, -3.8, 2]} end={[-10, 4.5, -4]} />
      <StructuralBeam start={[12, -3.8, 0]} end={[12, 4.5, -6]} />
      <SignalChannel reducedMotion={reducedMotion} pulse points={[[-11, -3.4, 2], [-5, -3.1, -1], [1, -3.2, -3], [10, -2.8, -7]]} phase={0.28} />
      <SignalChannel reducedMotion={reducedMotion} pulse points={[[11, 3.4, -8], [5, 2.9, -4], [0, 3.1, -2], [-9, 2.5, 0]]} color={opportunity} phase={0.78} />
    </group>
  );
}

const performanceTraces: readonly (readonly Point3[])[] = [
  [[-7, -1.2, 0], [-5, -0.4, 0], [-2.8, -0.8, 0], [-0.2, 1.1, 0], [2.5, 0.7, 0], [5.2, 2, 0], [7.2, 1.8, 0]],
  [[-7, 1.7, 0], [-4.5, 1.2, 0], [-2.1, 2.2, 0], [0.4, 1.4, 0], [3, 2.6, 0], [5.1, 2.1, 0], [7.2, 3.1, 0]],
  [[-7, -2.4, 0], [-4.8, -2.1, 0], [-2.2, -1.5, 0], [0, -1.8, 0], [2.8, -0.9, 0], [5.3, -1.2, 0], [7.2, -0.3, 0]]
] as const;

function PerformanceLandscape({ reducedMotion }: { reducedMotion: boolean }) {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!group.current || reducedMotion) return;
    group.current.rotation.y = Math.sin(clock.elapsedTime * 0.11) * 0.014;
  });
  return (
    <group ref={group} position={[0, 0, -68]}>
      {[0, 1, 2].map((layer) => (
        <group key={layer} position={[layer * 1.25 - 1.2, layer * 0.55 - 0.5, layer * -3]} rotation={[-0.12 + layer * 0.025, -0.16, -0.025]}>
          <CalibratedGrid position={[0, 0, 0]} width={15} height={7.4} columns={9} rows={5} opacity={0.14 + layer * 0.045} />
          <Line points={performanceTraces[layer]} color={layer === 0 ? evidenceBlue : layer === 1 ? electric : opportunity} lineWidth={0.72} transparent opacity={0.5 + layer * 0.12} />
        </group>
      ))}
      <SmokedPanel position={[-7.8, 0, -8]} scale={[0.18, 11, 8]} color="#122632" opacity={0.2} />
      <SmokedPanel position={[8.4, 1.4, -10]} scale={[0.18, 9, 9]} color="#122632" opacity={0.2} />
      <ArchitecturalSlab position={[0, -4.4, -6]} scale={[22, 0.45, 14]} tone="ceramic" />
      <Line points={[[-7.4, 0.4, 1], [7.4, 0.4, 1]]} color={priority} lineWidth={0.8} transparent opacity={0.56} />
      <SignalChannel reducedMotion={reducedMotion} pulse points={[[-10, -3.3, 3], [-4, -2.7, -3], [2, -2.4, -9], [10, -1.8, -15]]} phase={0.46} />
    </group>
  );
}

function BusinessHealthInstrument({ reducedMotion }: { reducedMotion: boolean }) {
  const outer = useRef<Mesh>(null);
  const middle = useRef<Mesh>(null);
  const inner = useRef<Mesh>(null);

  useFrame(({ clock }, delta) => {
    if (reducedMotion) return;
    if (outer.current) outer.current.rotation.z += delta * 0.035;
    if (middle.current) middle.current.rotation.z -= delta * 0.055;
    if (inner.current) inner.current.rotation.z = Math.sin(clock.elapsedTime * 0.2) * 0.08;
  });

  return (
    <group position={[-2.7, 0.2, -97]} rotation={[0.04, 0.17, 0]}>
      <mesh ref={outer} rotation={[0, 0, 0.22]}>
        <torusGeometry args={[3.7, 0.055, 7, 96, Math.PI * 1.68]} />
        <meshStandardMaterial color={titanium} emissive={evidenceBlue} emissiveIntensity={0.18} metalness={0.9} roughness={0.24} />
      </mesh>
      <mesh ref={middle} rotation={[0, 0, -0.4]}>
        <torusGeometry args={[3.1, 0.085, 7, 96, Math.PI * 1.42]} />
        <meshStandardMaterial color={electric} emissive={electric} emissiveIntensity={0.54} metalness={0.7} roughness={0.24} />
      </mesh>
      <mesh ref={inner}>
        <torusGeometry args={[2.28, 0.16, 8, 72, Math.PI * 1.18]} />
        <meshStandardMaterial color={coolWhite} emissive={electric} emissiveIntensity={0.24} metalness={0.62} roughness={0.3} />
      </mesh>
      <SmokedPanel position={[0, 0, -0.55]} scale={[5.3, 5.3, 0.26]} opacity={0.18} />
      {Array.from({ length: 20 }, (_, index) => {
        const angle = (index / 20) * Math.PI * 2;
        const radius = index % 4 === 0 ? 4.25 : 4.04;
        return (
          <mesh key={index} position={[Math.cos(angle) * radius, Math.sin(angle) * radius, 0]} rotation={[0, 0, angle]} scale={[index % 4 === 0 ? 0.46 : 0.24, 0.055, 0.12]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color={index % 4 === 0 ? coolWhite : evidenceBlue} emissive={electric} emissiveIntensity={index % 4 === 0 ? 0.36 : 0.12} metalness={0.7} roughness={0.3} />
          </mesh>
        );
      })}
      <StructuralBeam start={[-5.2, -4.6, -0.8]} end={[-5.2, 4.6, -0.8]} />
      <StructuralBeam start={[5.2, -4.6, -0.8]} end={[5.2, 4.6, -0.8]} />
    </group>
  );
}

function ExecutiveFocusScene({ progress, reducedMotion }: { progress: MutableRefObject<number>; reducedMotion: boolean }) {
  const secondary = useRef<Group>(null);
  const primary = useRef<Group>(null);
  useFrame(() => {
    if (reducedMotion) return;
    const focus = smoothRange(progress.current, 0.34, 0.52);
    if (secondary.current) {
      secondary.current.position.z = -101 - focus * 4.5;
      secondary.current.scale.setScalar(1 - focus * 0.16);
    }
    if (primary.current) {
      primary.current.position.z = -98 + focus * 1.2;
      primary.current.position.x = 5.1 - focus * 0.85;
    }
  });

  return (
    <group>
      <BusinessHealthInstrument reducedMotion={reducedMotion} />
      <group ref={secondary} position={[0, 0, -101]}>
        <PrecisionFrame position={[8.2, 2.8, 0]} width={6.3} height={3.5} rotation={[0, -0.22, 0]} accent={priority} emphasis={0.6} />
        <PrecisionFrame position={[9.1, -1.2, -2.2]} width={7.2} height={3.3} rotation={[0, -0.28, 0]} accent={evidenceBlue} emphasis={0.52} />
        <PrecisionFrame position={[7.3, -4, -4.8]} width={5.8} height={2.7} rotation={[0, -0.18, 0]} accent={opportunity} emphasis={0.46} />
      </group>
      <group ref={primary} position={[5.1, 0.3, -98]}>
        <PrecisionFrame position={[0, 0, 0]} width={8.5} height={6.4} rotation={[0, -0.18, 0]} emphasis={1.16} />
        <SmokedPanel position={[0, 0, -0.16]} scale={[7.8, 5.7, 0.18]} opacity={0.25} />
        <Line points={[[-3.1, 1.7, 0.1], [-1.5, 0.5, 0.1], [0.4, 1, 0.1], [2.8, -0.2, 0.1]]} color={priority} lineWidth={0.82} transparent opacity={0.72} />
      </group>
      <ArchitecturalSlab position={[0, -5.5, -101]} scale={[24, 0.55, 12]} tone="ceramic" />
      <SignalChannel reducedMotion={reducedMotion} pulse points={[[-10, -4.2, -93], [-5, -3.5, -96], [0, -3.8, -101], [10, -3, -106]]} phase={0.18} />
    </group>
  );
}

function EvidenceDepthScene({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <group position={[0, -1, -128]}>
      {Array.from({ length: 6 }, (_, index) => (
        <group key={index} position={[(index - 2.5) * 1.1, -index * 0.7, -index * 2.15]} rotation={[-0.22, -0.14 + index * 0.025, -0.02]}>
          <SmokedPanel position={[0, 0, 0]} scale={[14 - index * 0.7, 5.8, 0.16]} color="#163242" opacity={0.15 + index * 0.025} />
          <PrecisionFrame position={[0, 0, 0.1]} width={13.5 - index * 0.7} height={5.4} accent={index < 2 ? electric : evidenceBlue} emphasis={0.48 + index * 0.05} />
        </group>
      ))}
      <StructuralBeam start={[-6.4, 3.2, 1]} end={[-2.8, -6.8, -12]} color={electric} emissive />
      <StructuralBeam start={[6.4, 3.2, 1]} end={[2.8, -6.8, -12]} color={evidenceBlue} emissive />
      <SignalChannel reducedMotion={reducedMotion} pulse points={[[0, 4.5, 2], [-0.6, 1, -2], [0.8, -3, -7], [0, -7, -13]]} phase={0.52} />
      <ArchitecturalSlab position={[0, -7.6, -10]} scale={[22, 0.5, 15]} tone="ceramic" />
    </group>
  );
}

function LeadershipControlScene({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <group position={[0, 0.4, -159]}>
      <PrecisionFrame position={[-4.8, 0, -1]} width={8.2} height={8.8} rotation={[0, 0.18, 0]} accent={coolWhite} emphasis={0.82} />
      <PrecisionFrame position={[4.9, 1.6, -3]} width={7.2} height={4.3} rotation={[0, -0.18, 0]} emphasis={1.08} />
      <PrecisionFrame position={[5.8, -2.9, -6]} width={5.8} height={3.2} rotation={[0, -0.24, 0]} accent={opportunity} emphasis={0.66} />
      <CalibratedGrid position={[-4.8, 0, -0.75]} width={7.4} height={8} columns={5} rows={7} accent={coolWhite} opacity={0.13} />
      <ArchitecturalSlab position={[0, -5.4, -4]} scale={[22, 0.45, 11]} tone="ceramic" />
      <StructuralBeam start={[-10, -4.5, 1]} end={[-10, 5.2, -7]} />
      <StructuralBeam start={[10.5, -4.5, -1]} end={[10.5, 5.2, -9]} />
      <SignalChannel reducedMotion={reducedMotion} pulse points={[[-9, 3.8, 1], [-4.8, 3, -1], [0, 2.8, -3], [8.5, 2.1, -7]]} phase={0.34} />
      <SignalChannel reducedMotion={reducedMotion} points={[[8.8, -3.8, -7], [4, -3.2, -4], [-1, -3.4, -2], [-8, -2.5, 1]]} color={opportunity} opacity={0.42} />
    </group>
  );
}

function HistoricalContextScene({ reducedMotion }: { reducedMotion: boolean }) {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!group.current || reducedMotion) return;
    group.current.position.y = Math.sin(clock.elapsedTime * 0.13) * 0.05;
  });
  return (
    <group ref={group} position={[0, 0, -190]}>
      {Array.from({ length: 7 }, (_, index) => (
        <group key={index} position={[index * 1.15 - 3.6, index * 0.18 - 0.5, -index * 2.8]} rotation={[0, -0.16 + index * 0.015, 0]}>
          <SmokedPanel position={[0, 0, 0]} scale={[10.5, 7.2, 0.16]} color="#172c38" opacity={0.12 + index * 0.025} />
          <PrecisionFrame position={[0, 0, 0.1]} width={10.1} height={6.8} accent={index === 0 ? electric : evidenceBlue} emphasis={index === 0 ? 0.9 : 0.44} />
        </group>
      ))}
      <ArchitecturalSlab position={[-8.4, -4.6, -4]} scale={[6, 0.4, 15]} tone="ceramic" />
      <ArchitecturalSlab position={[8.8, 4.8, -11]} scale={[7, 0.35, 14]} tone="composite" />
      <SignalChannel reducedMotion={reducedMotion} pulse points={[[-10, -3.8, 3], [-4, -3.1, -4], [3, -2.7, -11], [10, -2.1, -19]]} color={evidenceBlue} phase={0.7} />
    </group>
  );
}

function FinalCommandScene({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <group position={[0, 0, -222]}>
      <ArchitecturalSlab position={[0, -5.1, -2]} scale={[25, 0.6, 14]} tone="ceramic" />
      <PrecisionFrame position={[0, 0.4, -2]} width={17.5} height={10} emphasis={1.24} />
      <SmokedPanel position={[0, 0.4, -1.72]} scale={[16.6, 9.1, 0.22]} opacity={0.23} />
      <PrecisionFrame position={[-9.5, 1.2, -7]} width={5.2} height={7.6} rotation={[0, 0.28, 0]} accent={evidenceBlue} emphasis={0.58} />
      <PrecisionFrame position={[9.5, 1.2, -7]} width={5.2} height={7.6} rotation={[0, -0.28, 0]} accent={evidenceBlue} emphasis={0.58} />
      <ArchitecturalSlab position={[0, 5.8, -3]} scale={[21, 0.28, 2.2]} tone="titanium" />
      <Line points={[[-6.3, -2.3, -1.5], [-2.3, -0.8, -1.5], [0, -1.1, -1.5], [3.1, 0.6, -1.5], [6.3, 0.2, -1.5]]} color={electric} lineWidth={0.9} transparent opacity={0.68} />
      <SignalChannel reducedMotion={reducedMotion} pulse points={[[-12, -4, 2], [-6, -3.4, -2], [0, -3.2, -4], [6, -3.4, -2], [12, -4, 2]]} phase={0.06} />
      <StructuralBeam start={[-12, -4.6, 1]} end={[-12, 5.2, -7]} />
      <StructuralBeam start={[12, -4.6, 1]} end={[12, 5.2, -7]} />
    </group>
  );
}

export function ExecutiveIntelligenceWorld({
  quality,
  progress
}: {
  quality: SpatialQualityTier;
  progress: MutableRefObject<number>;
}) {
  const reducedMotion = quality === "reduced_motion";
  const balancedOrFull = quality === "full" || quality === "balanced";
  return (
    <>
      <color attach="background" args={[new Color("#02060a")]} />
      <fog attach="fog" args={["#02060a", 18, 78]} />
      <ambientLight intensity={0.08} color="#849aa6" />
      <hemisphereLight intensity={0.3} color="#dcebf0" groundColor="#010304" />
      <directionalLight position={[-8, 13, 12]} intensity={2.8} color="#eefaff" />
      {balancedOrFull ? <directionalLight position={[10, -1, -98]} intensity={0.8} color="#6faec9" /> : null}
      {balancedOrFull ? <spotLight position={[8, 10, 8]} intensity={30} angle={0.42} penumbra={0.92} distance={62} decay={2} color="#b6deea" /> : null}
      <pointLight position={[-6, 1, -38]} intensity={8} distance={25} decay={2} color="#78d6ed" />
      {balancedOrFull ? <pointLight position={[6, -1, -96]} intensity={9} distance={27} decay={2} color="#7ec4de" /> : null}
      <pointLight position={[-5, -2, -128]} intensity={7} distance={24} decay={2} color="#769eb0" />
      {balancedOrFull ? <pointLight position={[5, 1, -159]} intensity={8} distance={25} decay={2} color="#9bc9d7" /> : null}
      <pointLight position={[0, 2, -222]} intensity={10} distance={30} decay={2} color="#8fe0f2" />

      <BusinessComplexityScene quality={quality} reducedMotion={reducedMotion} />
      <CommandSurfaceScene reducedMotion={reducedMotion} />
      <PerformanceLandscape reducedMotion={reducedMotion} />
      <ExecutiveFocusScene progress={progress} reducedMotion={reducedMotion} />
      <EvidenceDepthScene reducedMotion={reducedMotion} />
      <LeadershipControlScene reducedMotion={reducedMotion} />
      <HistoricalContextScene reducedMotion={reducedMotion} />
      <FinalCommandScene reducedMotion={reducedMotion} />

      <mesh position={[0, 0, -238]}>
        <planeGeometry args={[70, 42]} />
        <meshBasicMaterial color="#02060a" side={DoubleSide} />
      </mesh>
    </>
  );
}

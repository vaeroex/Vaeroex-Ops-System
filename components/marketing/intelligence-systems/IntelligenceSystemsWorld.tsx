"use client";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import {
  CatmullRomCurve3,
  Color,
  Group,
  MathUtils,
  Mesh,
  Quaternion,
  Vector3
} from "three";
import {
  MOLECULE_LIBRARY,
  MoleculeModel
} from "@/components/marketing/drug-discovery/MolecularVisualization";
import { ProteinTarget } from "@/components/marketing/drug-discovery/ProteinVisualization";
import type { SpatialQualityTier } from "@/components/spatial/useSpatialCapability";

type Point3 = readonly [number, number, number];

const graphite = "#111820";
const ceramic = "#070c12";
const silicon = "#1c2a35";
const steel = "#536a79";
const electric = "#65d9ff";
const coolWhite = "#dff7ff";
const researchTeal = "#67d9ca";
const biologicalBlue = "#78bfff";
const biologicalCoral = "#c88f84";

function smoothRange(value: number, from: number, to: number) {
  const normalized = MathUtils.clamp((value - from) / Math.max(0.001, to - from), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
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
  tone?: "graphite" | "ceramic" | "silicon" | "steel";
  emissive?: string;
  emissiveIntensity?: number;
}) {
  const color = tone === "ceramic" ? ceramic : tone === "silicon" ? silicon : tone === "steel" ? steel : graphite;
  return (
    <mesh position={position} rotation={rotation} scale={scale}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive || color}
        emissiveIntensity={emissiveIntensity}
        metalness={tone === "ceramic" ? 0.28 : 0.82}
        roughness={tone === "ceramic" ? 0.72 : 0.32}
      />
    </mesh>
  );
}

function SmokedPlane({
  position,
  scale,
  rotation = [0, 0, 0],
  color = "#18303e",
  opacity = 0.24
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
        metalness={0.42}
        roughness={0.2}
        transparent
        opacity={opacity}
        transmission={0.28}
        thickness={0.7}
        depthWrite={false}
      />
    </mesh>
  );
}

function TechnicalFrame({
  position,
  width,
  height,
  depth = 0.36,
  rotation = [0, 0, 0],
  accent = electric,
  opacity = 0.52
}: {
  position: Point3;
  width: number;
  height: number;
  depth?: number;
  rotation?: Point3;
  accent?: string;
  opacity?: number;
}) {
  const rail = Math.max(0.1, Math.min(width, height) * 0.025);
  return (
    <group position={position} rotation={rotation}>
      <ArchitecturalSlab position={[0, height / 2, 0]} scale={[width, rail, depth]} tone="silicon" />
      <ArchitecturalSlab position={[0, -height / 2, 0]} scale={[width * 0.86, rail, depth]} tone="graphite" />
      <ArchitecturalSlab position={[-width / 2, 0, 0]} scale={[rail, height, depth]} tone="graphite" />
      <ArchitecturalSlab position={[width / 2, height * 0.08, 0]} scale={[rail, height * 0.84, depth]} tone="silicon" />
      <Line
        points={[
          [-width / 2, -height * 0.3, depth / 2 + 0.02],
          [-width * 0.08, -height * 0.3, depth / 2 + 0.02],
          [width * 0.18, -height * 0.14, depth / 2 + 0.02],
          [width / 2, -height * 0.14, depth / 2 + 0.02]
        ]}
        color={accent}
        lineWidth={0.62}
        transparent
        opacity={opacity}
      />
    </group>
  );
}

function SignalConduit({
  points,
  color = electric,
  radius = 0.035,
  opacity = 0.68,
  pulse = false,
  phase = 0
}: {
  points: readonly Point3[];
  color?: string;
  radius?: number;
  opacity?: number;
  pulse?: boolean;
  phase?: number;
}) {
  const marker = useRef<Mesh>(null);
  const point = useMemo(() => new Vector3(), []);
  const tangent = useMemo(() => new Vector3(), []);
  const axis = useMemo(() => new Vector3(0, 0, 1), []);
  const curve = useMemo(
    () => new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x, y, z))),
    [points]
  );

  useFrame(({ clock }) => {
    if (!pulse || !marker.current) return;
    const travel = (clock.elapsedTime * 0.075 + phase) % 1;
    curve.getPointAt(travel, point);
    curve.getTangentAt(travel, tangent).normalize();
    marker.current.position.copy(point);
    marker.current.quaternion.setFromUnitVectors(axis, tangent);
  });

  return (
    <group>
      <mesh>
        <tubeGeometry args={[curve, 48, radius, 6, false]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.9}
          metalness={0.42}
          roughness={0.3}
          transparent
          opacity={opacity}
        />
      </mesh>
      {pulse ? (
        <mesh ref={marker} scale={[0.08, 0.08, 0.55]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={coolWhite} transparent opacity={0.82} />
        </mesh>
      ) : null}
    </group>
  );
}

function GridPlane({
  position,
  rotation = [0, 0, 0],
  width,
  height,
  columns = 6,
  rows = 4,
  accent = electric,
  opacity = 0.32
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
      <SmokedPlane position={[0, 0, -0.08]} scale={[width, height, 0.12]} color="#102532" opacity={0.18} />
      {Array.from({ length: columns + 1 }, (_, index) => {
        const x = -width / 2 + (index / columns) * width;
        return <Line key={`c-${index}`} points={[[x, -height / 2, 0], [x, height / 2, 0]]} color={accent} lineWidth={0.34} transparent opacity={opacity * (index % 2 ? 0.72 : 1)} />;
      })}
      {Array.from({ length: rows + 1 }, (_, index) => {
        const y = -height / 2 + (index / rows) * height;
        return <Line key={`r-${index}`} points={[[-width / 2, y, 0], [width / 2, y, 0]]} color={accent} lineWidth={0.34} transparent opacity={opacity * (index % 2 ? 0.72 : 1)} />;
      })}
    </group>
  );
}

function CylinderBetween({ start, end, radius = 0.035, color = steel }: { start: Point3; end: Point3; radius?: number; color?: string }) {
  const transform = useMemo(() => {
    const from = new Vector3(...start);
    const to = new Vector3(...end);
    const direction = to.clone().sub(from);
    return {
      position: from.clone().add(to).multiplyScalar(0.5),
      length: direction.length(),
      quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize())
    };
  }, [end, start]);
  return (
    <mesh position={transform.position} quaternion={transform.quaternion}>
      <cylinderGeometry args={[radius, radius, transform.length, 8]} />
      <meshStandardMaterial color={color} roughness={0.42} metalness={0.5} />
    </mesh>
  );
}

function RawComplexityScene({ quality }: { quality: SpatialQualityTier }) {
  const fragments = quality === "full" ? 14 : 8;
  return (
    <group position={[0, 0, -8]}>
      <TechnicalFrame position={[-2.2, 1.6, -1]} width={7.8} height={5.5} rotation={[0.12, 0.36, -0.05]} accent="#3e7894" opacity={0.3} />
      <TechnicalFrame position={[3.8, -1.2, -6]} width={8.6} height={6.2} rotation={[-0.08, -0.42, 0.04]} accent="#4d92ad" opacity={0.28} />
      <SmokedPlane position={[-1.4, 0.2, -2.2]} scale={[8.2, 5.8, 0.16]} rotation={[0.08, 0.5, -0.05]} opacity={0.3} />
      <SmokedPlane position={[2.4, 0.8, -3.8]} scale={[7.4, 6.6, 0.12]} rotation={[-0.12, -0.38, 0.08]} color="#16252f" opacity={0.26} />
      {Array.from({ length: fragments }, (_, index) => {
        const side = index % 2 ? 1 : -1;
        const x = side * (2.4 + (index % 5) * 0.82);
        const y = ((index * 7) % 9 - 4) * 0.72;
        const z = -2 - index * 1.18;
        return (
          <ArchitecturalSlab
            key={index}
            position={[x, y, z]}
            scale={[1.2 + (index % 3) * 0.65, 0.12 + (index % 2) * 0.08, 2.2 + (index % 4) * 0.8]}
            rotation={[0.08 * (index % 3), side * (0.18 + index * 0.018), side * 0.04]}
            tone={index % 3 === 0 ? "silicon" : "ceramic"}
          />
        );
      })}
      <SignalConduit points={[[-6, -2.8, 5], [-4.2, 1.5, -1], [-1.8, -1, -6], [-5, 2, -13]]} color="#4e9db8" opacity={0.42} pulse phase={0.1} />
      <SignalConduit points={[[6.5, 3.2, 3], [3.8, -1.8, -2], [5.2, 0.6, -7], [1.2, -2, -15]]} color="#396f9b" opacity={0.42} pulse phase={0.56} />
      <SignalConduit points={[[-2, 4, 1], [1.5, 2.8, -4], [-1, 1.2, -10], [3, 0.3, -15]]} color="#7aa1aa" opacity={0.28} />
    </group>
  );
}

function VisibilityScene({ progress }: { progress: MutableRefObject<number> }) {
  const leftPanel = useRef<Group>(null);
  const rightPanel = useRef<Group>(null);
  const center = useRef<Group>(null);

  useFrame(() => {
    const reveal = smoothRange(progress.current, 0.055, 0.17);
    if (leftPanel.current) leftPanel.current.position.x = -0.8 - reveal * 3.5;
    if (rightPanel.current) rightPanel.current.position.x = 0.8 + reveal * 3.5;
    if (center.current) center.current.scale.setScalar(0.82 + reveal * 0.18);
  });

  return (
    <group position={[0, 0, -33]}>
      <group ref={leftPanel} position={[-0.8, 0, 0]}>
        <SmokedPlane position={[0, 0, 0]} scale={[5.4, 8.4, 0.25]} rotation={[0, 0.06, -0.02]} opacity={0.42} />
        <ArchitecturalSlab position={[-2.4, 0, 0.1]} scale={[0.22, 8.8, 0.5]} tone="silicon" />
      </group>
      <group ref={rightPanel} position={[0.8, 0, 0]}>
        <SmokedPlane position={[0, 0, 0]} scale={[5.4, 8.4, 0.25]} rotation={[0, -0.06, 0.02]} opacity={0.42} />
        <ArchitecturalSlab position={[2.4, 0, 0.1]} scale={[0.22, 8.8, 0.5]} tone="silicon" />
      </group>
      <group ref={center}>
        <TechnicalFrame position={[0, 0, -1.4]} width={11.5} height={8.8} depth={0.5} accent={coolWhite} opacity={0.74} />
        <GridPlane position={[0, 0, -2.1]} width={8.4} height={5.8} columns={8} rows={5} opacity={0.38} />
        <SignalConduit points={[[-6.4, -2.7, 3], [-3.2, -1.5, 0.4], [0, 0, -2], [3.8, 1.8, -5], [6.2, 2.2, -9]]} color={coolWhite} opacity={0.72} pulse phase={0.3} />
      </group>
      <ArchitecturalSlab position={[0, -4.7, -1]} scale={[18, 0.5, 12]} tone="graphite" />
    </group>
  );
}

function AwarenessScene() {
  return (
    <group position={[0, 0, -57]}>
      <TechnicalFrame position={[-4.6, 1.1, 0]} width={6.4} height={7.6} rotation={[0, 0.14, 0]} accent="#7acde6" />
      <TechnicalFrame position={[4.8, -0.6, -1.8]} width={7.2} height={6.2} rotation={[0, -0.16, 0]} accent="#a5d8df" />
      <TechnicalFrame position={[0.4, 2.5, -5.8]} width={8.8} height={4.5} rotation={[0.08, 0, 0]} accent="#5599c4" opacity={0.46} />
      <ArchitecturalSlab position={[0, -4.6, -2]} scale={[19, 0.45, 14]} tone="ceramic" />
      <SignalConduit points={[[-7.2, -1.8, 1], [-3.6, 1.1, 0], [-0.8, 0.6, -2.8], [2.7, -0.5, -2], [7, 1.2, -5.2]]} color="#74d4e8" opacity={0.65} pulse phase={0.2} />
      <SignalConduit points={[[-5.8, 3.7, -1], [-2.5, 2.6, -3.8], [0.4, 2.5, -5.8], [4.4, -0.5, -1.8]]} color="#9cbbd8" opacity={0.5} />
      <ArchitecturalSlab position={[0, 0.1, -2.5]} scale={[5.2, 0.34, 0.5]} rotation={[0, 0.16, -0.12]} tone="steel" emissive="#2d718a" emissiveIntensity={0.24} />
      <ArchitecturalSlab position={[0.2, 1.6, -4]} scale={[0.34, 3.5, 0.52]} rotation={[0.1, 0, -0.18]} tone="silicon" />
    </group>
  );
}

function PredictionScene() {
  const paths: readonly { points: readonly Point3[]; color: string; opacity: number }[] = [
    { points: [[0, -0.2, 4], [-1.2, 0.6, 0], [-4.2, 1.4, -5], [-6.8, 0.5, -11]], color: "#77c8eb", opacity: 0.66 },
    { points: [[0, -0.2, 4], [0.2, 0.1, -0.6], [1.4, 2.3, -5.8], [2.8, 3.5, -12]], color: "#a7d5e5", opacity: 0.46 },
    { points: [[0, -0.2, 4], [1.5, -0.8, -1.4], [4.8, -2.2, -6], [7.2, -1, -12]], color: "#496e9d", opacity: 0.28 }
  ];
  return (
    <group position={[0, 0, -81]}>
      <TechnicalFrame position={[0, 0, 1.4]} width={9.4} height={7.8} accent={coolWhite} opacity={0.48} />
      {paths.map((path, index) => (
        <SignalConduit key={index} points={path.points} color={path.color} opacity={path.opacity} pulse={index === 0} phase={0.66} />
      ))}
      {[-5.8, 0, 5.8].map((x, index) => (
        <group key={x}>
          <TechnicalFrame position={[x, index === 1 ? 2.2 : -0.6, -10 - index]} width={4.8} height={index === 1 ? 4.2 : 5.8} rotation={[0, (index - 1) * -0.18, 0]} accent={index === 0 ? "#77c8eb" : index === 1 ? "#9ebbd1" : "#536983"} opacity={index === 0 ? 0.42 : 0.24} />
          <SmokedPlane position={[x, index === 1 ? 2.2 : -0.6, -10.2 - index]} scale={[4.1, index === 1 ? 3.5 : 5.1, 0.1]} color="#13222f" opacity={index === 0 ? 0.18 : 0.1} />
        </group>
      ))}
      <GridPlane position={[0, -4.2, -3]} rotation={[-Math.PI / 2, 0, 0]} width={17} height={18} columns={8} rows={9} accent="#38536f" opacity={0.18} />
    </group>
  );
}

function ActionScene() {
  return (
    <group position={[0, 0, -105]}>
      {[-5.4, -2.7, 0, 2.7, 5.4].map((x, index) => (
        <TechnicalFrame key={x} position={[x, 0, -index * 0.8]} width={2.1} height={7.8 - Math.abs(index - 2) * 0.55} rotation={[0, (index - 2) * -0.07, 0]} accent={index === 2 ? coolWhite : electric} opacity={index === 2 ? 0.7 : 0.34} />
      ))}
      <SignalConduit points={[[-6.4, 2.2, 3], [-3.1, 1.2, -1], [-1.2, 0.4, -4], [0, 0, -8]]} color="#6bb6dd" opacity={0.48} />
      <SignalConduit points={[[6.4, -2.4, 3], [3.1, -1.3, -1], [1.2, -0.4, -4], [0, 0, -8]]} color="#6bb6dd" opacity={0.48} />
      <SignalConduit points={[[0, 0, 4], [0, 0, -1], [0, 0, -8], [0, 0, -13]]} color={coolWhite} opacity={0.82} pulse phase={0.18} />
      <ArchitecturalSlab position={[0, -4.5, -4]} scale={[17, 0.38, 17]} tone="graphite" />
      <ArchitecturalSlab position={[0, 4.7, -5]} scale={[13, 0.3, 12]} tone="silicon" />
    </group>
  );
}

function IntelligenceRevealScene({ quality }: { quality: SpatialQualityTier }) {
  const frameCount = quality === "full" ? 8 : 5;
  return (
    <group position={[0, 0, -130]}>
      <ArchitecturalSlab position={[-6.6, 0, -0.6]} scale={[0.18, 9.8, 0.5]} tone="steel" emissive={electric} emissiveIntensity={2.2} />
      <ArchitecturalSlab position={[6.6, 0, -0.6]} scale={[0.18, 9.8, 0.5]} tone="steel" emissive={electric} emissiveIntensity={2.2} />
      <ArchitecturalSlab position={[0, 4.85, -0.6]} scale={[13.4, 0.18, 0.5]} tone="steel" emissive={coolWhite} emissiveIntensity={1.2} />
      <ArchitecturalSlab position={[0, -4.85, -0.6]} scale={[13.4, 0.18, 0.5]} tone="steel" emissive="#387697" emissiveIntensity={1.1} />
      {Array.from({ length: frameCount }, (_, index) => {
        const depth = index * 2.6;
        const scale = 1 + index * 0.15;
        return (
          <TechnicalFrame
            key={index}
            position={[index % 2 ? 0.35 : -0.35, index % 3 === 0 ? 0.2 : 0, -depth]}
            width={12.5 * scale}
            height={8.7 * scale}
            depth={0.58}
            rotation={[0, (index % 2 ? -1 : 1) * 0.015 * index, 0]}
            accent={index < 2 ? coolWhite : index % 2 ? electric : "#5a86ad"}
            opacity={Math.max(0.2, 0.76 - index * 0.07)}
          />
        );
      })}
      <GridPlane position={[0, 0, -7]} width={10.2} height={6.4} columns={10} rows={6} accent={coolWhite} opacity={0.28} />
      <ArchitecturalSlab position={[-8.8, 0, -9]} scale={[3.6, 11, 18]} rotation={[0, 0.06, 0]} tone="ceramic" />
      <ArchitecturalSlab position={[8.8, 0, -9]} scale={[3.6, 11, 18]} rotation={[0, -0.06, 0]} tone="ceramic" />
      <ArchitecturalSlab position={[0, -5.3, -9]} scale={[22, 0.7, 24]} tone="graphite" />
      {[-4.5, -1.5, 1.5, 4.5].map((x) => (
        <ArchitecturalSlab key={x} position={[x, -4.9, -8]} scale={[0.08, 0.06, 21]} tone="steel" emissive={x < 0 ? "#387697" : electric} emissiveIntensity={0.7} />
      ))}
      <ArchitecturalSlab position={[0, 5.5, -11]} scale={[18, 0.45, 18]} tone="silicon" />
      <SignalConduit points={[[-8, -3.6, 4], [-4, -2.2, -2], [0, 0, -7], [4, 2.2, -14], [7, 3.2, -20]]} color={electric} opacity={0.7} pulse phase={0.42} />
      <SignalConduit points={[[8, 3.5, 4], [4, 2, -2], [0, 0, -7], [-4, -2.2, -14], [-7, -3, -20]]} color="#9ccbe2" opacity={0.42} />
    </group>
  );
}

function SpecializationScene() {
  const destinations = [
    { x: -6.4, y: 1, accent: electric },
    { x: 0, y: -0.4, accent: researchTeal },
    { x: 6.4, y: 1.2, accent: biologicalBlue }
  ] as const;
  return (
    <group position={[0, 0, -154]}>
      <TechnicalFrame position={[0, 0, 3]} width={10.8} height={8.4} accent={coolWhite} opacity={0.56} />
      {destinations.map((destination, index) => (
        <group key={destination.x}>
          <TechnicalFrame position={[destination.x, destination.y, -9 - index * 1.2]} width={4.8} height={6.8} rotation={[0, (index - 1) * -0.16, 0]} accent={destination.accent} opacity={0.58} />
          <SignalConduit points={[[0, 0, 1], [destination.x * 0.28, destination.y * 0.3, -2], [destination.x * 0.7, destination.y * 0.8, -6], [destination.x, destination.y, -9]]} color={destination.accent} opacity={0.68} pulse phase={index * 0.28} />
        </group>
      ))}
      <ArchitecturalSlab position={[0, -4.8, -4]} scale={[21, 0.44, 21]} tone="ceramic" />
    </group>
  );
}

function ExecutiveDestination() {
  return (
    <group position={[0, 0, -179]}>
      <ArchitecturalSlab position={[0, 0, -9.4]} scale={[18, 11, 0.7]} tone="ceramic" />
      <TechnicalFrame position={[0, 0, -1]} width={15.6} height={9.4} accent={coolWhite} opacity={0.68} />
      <GridPlane position={[-3.5, 0.8, -2]} width={6.2} height={5.2} columns={6} rows={5} accent={electric} opacity={0.38} />
      <GridPlane position={[4, 1.4, -4.5]} width={5.6} height={3.8} columns={5} rows={3} accent="#9fbfd1" opacity={0.34} />
      <SmokedPlane position={[3.8, -2.3, -3.8]} scale={[5.8, 1.2, 0.16]} opacity={0.25} />
      {[-2, -1, 0, 1, 2].map((index) => (
        <ArchitecturalSlab key={index} position={[3.8 + index * 0.72, -2.3, -3.62]} scale={[0.38, 0.18 + (index + 3) * 0.12, 0.09]} tone="steel" emissive={index > 0 ? electric : "#426170"} emissiveIntensity={index > 0 ? 0.5 : 0.16} />
      ))}
      <SignalConduit points={[[-7.4, -3.4, 2], [-3.6, -1.8, -1], [0, 0, -3], [4.4, 1.5, -5], [7.2, 2.4, -8]]} color={electric} opacity={0.72} pulse phase={0.52} />
      <ArchitecturalSlab position={[0, -4.8, -3]} scale={[19, 0.52, 18]} tone="graphite" />
    </group>
  );
}

function DrugDiscoveryDestination({ progress }: { progress: MutableRefObject<number> }) {
  return (
    <group position={[0, 0, -204]}>
      <ArchitecturalSlab position={[0, 0, -9.6]} scale={[18.5, 11.2, 0.7]} tone="ceramic" />
      <TechnicalFrame position={[0, 0, -1]} width={16.2} height={10} accent={researchTeal} opacity={0.5} />
      <group position={[-2.8, -0.1, -0.2]} rotation={[0.3, -0.48, 0.08]}>
        <MoleculeModel graph={MOLECULE_LIBRARY[1]} scale={1.36} accent={researchTeal} flex={0.08} phase={0.4} />
      </group>
      <ProteinTarget position={[3.2, 0.3, -3.2]} scale={0.72} progress={progress} />
      <mesh position={[2.2, -0.1, -0.35]} rotation={[Math.PI / 2, 0.2, 0]}>
        <torusGeometry args={[1.15, 0.045, 8, 56, Math.PI * 1.62]} />
        <meshStandardMaterial color="#9de6b7" emissive="#286456" emissiveIntensity={0.44} transparent opacity={0.68} />
      </mesh>
      <SignalConduit points={[[-7.5, 2.8, 2], [-4.3, 1.2, -0.2], [-2.6, 0, -0.5], [0.5, -0.2, -1.5], [3.2, 0.3, -3.2], [7.4, -2.3, -8]]} color={researchTeal} opacity={0.62} pulse phase={0.1} />
      <GridPlane position={[0, -4.4, -4]} rotation={[-Math.PI / 2, 0, 0]} width={18} height={18} columns={9} rows={9} accent="#3b766f" opacity={0.2} />
    </group>
  );
}

function ComputationalHelix({ position }: { position: Point3 }) {
  const strands = useMemo(() => {
    const create = (phase: number) => Array.from({ length: 48 }, (_, index) => {
      const t = index / 47;
      const angle = t * Math.PI * 5 + phase;
      return [Math.cos(angle) * 0.78, (t - 0.5) * 5.5, Math.sin(angle) * 0.78] as Point3;
    });
    return [create(0), create(Math.PI)] as const;
  }, []);
  const rungs = useMemo(() => Array.from({ length: 12 }, (_, index) => {
    const t = index / 11;
    const angle = t * Math.PI * 5;
    return {
      start: [Math.cos(angle) * 0.78, (t - 0.5) * 5.5, Math.sin(angle) * 0.78] as Point3,
      end: [Math.cos(angle + Math.PI) * 0.78, (t - 0.5) * 5.5, Math.sin(angle + Math.PI) * 0.78] as Point3
    };
  }), []);
  return (
    <group position={position} rotation={[0.1, 0.25, -0.18]}>
      <SignalConduit points={strands[0]} color={biologicalBlue} radius={0.045} opacity={0.7} />
      <SignalConduit points={strands[1]} color={biologicalCoral} radius={0.045} opacity={0.58} />
      {rungs.map((rung, index) => <CylinderBetween key={index} start={rung.start} end={rung.end} radius={0.022} color={index % 2 ? "#718d9b" : "#8b8f94"} />)}
    </group>
  );
}

function BiologicalDestination() {
  return (
    <group position={[0, 0, -230]}>
      <ArchitecturalSlab position={[0, 0, -9.6]} scale={[18.8, 11.4, 0.7]} tone="ceramic" />
      <TechnicalFrame position={[0, 0, -1]} width={16.5} height={10.4} accent={biologicalBlue} opacity={0.48} />
      <ComputationalHelix position={[-4.5, 0.4, -1]} />
      <group position={[1.8, 0, -2.4]} rotation={[0.18, -0.3, 0.08]}>
        <mesh scale={[3.3, 2.35, 1.35]}>
          <icosahedronGeometry args={[1, 3]} />
          <meshPhysicalMaterial color="#315a6a" roughness={0.42} metalness={0.22} transparent opacity={0.24} transmission={0.3} thickness={0.5} depthWrite={false} />
        </mesh>
        <mesh scale={[1.25, 0.9, 0.68]}>
          <icosahedronGeometry args={[1, 2]} />
          <meshStandardMaterial color="#517c8c" emissive="#244b5e" emissiveIntensity={0.24} roughness={0.56} metalness={0.18} />
        </mesh>
        {[0.4, 1.15, 1.9].map((radius, index) => (
          <mesh key={radius} rotation={[Math.PI / 2 + index * 0.2, index * 0.42, 0]}>
            <torusGeometry args={[radius, 0.025 + index * 0.008, 7, 48]} />
            <meshBasicMaterial color={index === 1 ? biologicalCoral : biologicalBlue} transparent opacity={0.36 - index * 0.05} />
          </mesh>
        ))}
      </group>
      <SignalConduit points={[[-1.2, 2.8, 1], [1.1, 1.6, -0.7], [1.8, 0, -2.4], [4.2, -1.3, -5], [7, 0.4, -9]]} color={biologicalBlue} opacity={0.62} pulse phase={0.7} />
      <SignalConduit points={[[-1.2, -2.7, 0], [0.4, -1.1, -1.2], [1.8, 0, -2.4], [3.5, 2.2, -5.6]]} color={biologicalCoral} opacity={0.36} />
      <GridPlane position={[0, -4.6, -4]} rotation={[-Math.PI / 2, 0, 0]} width={18} height={18} columns={7} rows={7} accent="#365f78" opacity={0.18} />
    </group>
  );
}

function ClosingScene({ quality }: { quality: SpatialQualityTier }) {
  const count = quality === "full" ? 7 : 5;
  return (
    <group position={[0, 0, -256]}>
      {Array.from({ length: count }, (_, index) => (
        <TechnicalFrame
          key={index}
          position={[index % 2 ? 0.3 : -0.3, index * 0.16, -index * 2.8]}
          width={12 + index * 1.5}
          height={8 + index * 1.05}
          accent={index < 2 ? coolWhite : index % 3 === 0 ? researchTeal : biologicalBlue}
          opacity={Math.max(0.22, 0.72 - index * 0.08)}
        />
      ))}
      <SignalConduit points={[[-8, -3.4, 4], [-4, -1.8, -2], [0, 0, -7], [0, 0, -20]]} color={electric} opacity={0.62} pulse phase={0.25} />
      <SignalConduit points={[[0, 4, 4], [-1, 2, -3], [0, 0, -7], [0, 0, -20]]} color={researchTeal} opacity={0.44} />
      <SignalConduit points={[[8, -2.8, 4], [4, -1.4, -2], [0, 0, -7], [0, 0, -20]]} color={biologicalBlue} opacity={0.5} />
      <ArchitecturalSlab position={[0, -5.2, -10]} scale={[23, 0.65, 28]} tone="graphite" />
      <ArchitecturalSlab position={[-10, 0, -12]} scale={[3.8, 12, 22]} tone="ceramic" />
      <ArchitecturalSlab position={[10, 0, -12]} scale={[3.8, 12, 22]} tone="ceramic" />
    </group>
  );
}

function DeepEnvironment({ quality }: { quality: SpatialQualityTier }) {
  const anchors = quality === "full"
    ? [-18, -45, -69, -94, -120, -145, -170, -195, -221, -247, -273]
    : [-18, -57, -105, -154, -204, -256];
  return (
    <group>
      {anchors.map((z, index) => {
        const side = index % 2 ? 1 : -1;
        return (
          <group key={z}>
            <ArchitecturalSlab position={[side * 12.5, index % 3 - 1, z]} scale={[4.8 + (index % 3), 10 + (index % 4), 5.8]} rotation={[0.03 * (index % 2), side * -0.16, 0.02]} tone={index % 3 === 0 ? "silicon" : "ceramic"} />
            <ArchitecturalSlab position={[-side * 14.5, (index % 2) * 2 - 1, z - 7]} scale={[3.4, 8.5, 4.2]} rotation={[0, side * 0.12, 0]} tone="graphite" />
          </group>
        );
      })}
      <SignalConduit points={[[-15, -5.4, 4], [-12, -5.4, -60], [-14, -5.4, -132], [-11, -5.4, -202], [-14, -5.4, -282]]} color="#173d54" opacity={0.34} />
      <SignalConduit points={[[15, 5.3, 1], [12, 5.3, -68], [14, 5.3, -140], [11, 5.3, -211], [14, 5.3, -282]]} color="#245a71" opacity={0.3} />
    </group>
  );
}

export function IntelligenceSystemsWorld({
  quality,
  progress
}: {
  quality: SpatialQualityTier;
  progress: MutableRefObject<number>;
}) {
  return (
    <>
      <color attach="background" args={[new Color("#02050a")]} />
      <fog attach="fog" args={["#02050a", 18, 108]} />
      <ambientLight intensity={0.12} color="#6b8291" />
      <hemisphereLight intensity={0.32} color="#c4deea" groundColor="#010205" />
      <directionalLight position={[-9, 14, 18]} intensity={2.5} color="#d9eff7" />
      <directionalLight position={[11, -3, -118]} intensity={0.8} color="#4c7ca6" />
      <spotLight position={[8, 9, 5]} intensity={92} angle={0.44} penumbra={0.9} distance={70} decay={2} color="#5fc9ef" />
      <pointLight position={[-6, 1, -32]} intensity={18} distance={28} decay={2} color="#65d9ff" />
      <pointLight position={[6, 1, -79]} intensity={14} distance={30} decay={2} color="#7a9fd2" />
      <pointLight position={[0, 2, -129]} intensity={42} distance={40} decay={2} color="#c9f3ff" />
      <pointLight position={[-5, 1, -179]} intensity={18} distance={30} decay={2} color="#65d9ff" />
      <pointLight position={[5, 0, -204]} intensity={16} distance={28} decay={2} color="#67d9ca" />
      <pointLight position={[-4, 1, -230]} intensity={16} distance={30} decay={2} color="#78bfff" />
      <pointLight position={[0, 2, -257]} intensity={24} distance={34} decay={2} color="#dff7ff" />
      <RawComplexityScene quality={quality} />
      <VisibilityScene progress={progress} />
      <AwarenessScene />
      <PredictionScene />
      <ActionScene />
      <IntelligenceRevealScene quality={quality} />
      <SpecializationScene />
      <ExecutiveDestination />
      <DrugDiscoveryDestination progress={progress} />
      <BiologicalDestination />
      <ClosingScene quality={quality} />
      <DeepEnvironment quality={quality} />
    </>
  );
}

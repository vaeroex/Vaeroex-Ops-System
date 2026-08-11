"use client";

import { Html, Line, useCursor } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  MathUtils,
  type Vector3Tuple
} from "three";
import type { SpatialQualityTier } from "@/components/spatial/useSpatialCapability";
import {
  INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS,
  INTELLIGENCE_UNIVERSE_DESTINATION_POSITIONS,
  INTELLIGENCE_UNIVERSE_ENTRY_POSITIONS,
  INTELLIGENCE_UNIVERSE_PRIMARY_REGIONS,
  INTELLIGENCE_UNIVERSE_SYSTEMS,
  type IntelligenceUniverseDestination,
  type IntelligenceUniverseMotion,
  type IntelligenceUniverseRegionDestination,
  type IntelligenceUniverseState,
  type IntelligenceUniverseSystemDestination
} from "@/lib/marketing/intelligence-universe";
import styles from "@/components/marketing/intelligence-universe/intelligence-universe.module.css";

type IntelligenceUniverseWorldProps = Readonly<{
  active: boolean;
  state: IntelligenceUniverseState;
  motion: MutableRefObject<IntelligenceUniverseMotion>;
  quality: SpatialQualityTier;
  onEnterDestination: (destination: IntelligenceUniverseDestination) => void;
}>;

type DestinationLod = "distant" | "identified" | "near";

const EXECUTIVE_NODES: readonly Vector3Tuple[] = [
  [-2.1, 1.2, 0.2], [-0.9, -0.8, 0.6], [0.2, 1.45, -0.2], [1.35, -0.35, 0.4], [2.1, 0.95, -0.4]
];
const DRUG_ATOMS = [
  [-1.8, 0, 0, "#8ecfed"], [-0.9, 1.45, 0.15, "#d9f8ff"], [0.85, 1.42, -0.1, "#d9f8ff"],
  [1.75, 0, 0.1, "#8ecfed"], [0.86, -1.42, -0.15, "#d9f8ff"], [-0.9, -1.45, 0.1, "#d9f8ff"],
  [2.85, 0.1, -0.25, "#78ddd6"], [3.8, 1.1, 0.1, "#ff9b8f"], [3.85, -1.05, 0.15, "#d9f8ff"],
  [-2.9, 0.05, -0.2, "#78ddd6"], [-3.75, 1.05, 0.1, "#ff9b8f"], [-3.85, -0.95, -0.1, "#d9f8ff"]
] as const;
const DRUG_BONDS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [3, 6], [6, 7], [6, 8], [0, 9], [9, 10], [9, 11]
] as const;

const NETWORK_NODES: readonly Vector3Tuple[] = [
  [-4.4, 0.6, 0.2], [-2.1, 3.1, -0.4], [-0.5, 0.4, 0.8], [1.7, 2.7, -0.3],
  [4.3, 0.1, 0.2], [2.2, -2.7, 0.7], [-1.8, -2.5, -0.5]
];
const NETWORK_EDGES = [[0, 1], [0, 2], [1, 2], [1, 3], [2, 3], [2, 5], [2, 6], [3, 4], [3, 5], [5, 6]] as const;
const CAREER_BRANCHES: readonly (readonly Vector3Tuple[])[] = [
  [[0, -4.2, 0], [0, -1.3, 0], [-2.8, 1.4, 0.4], [-4.1, 3.8, -0.2]],
  [[0, -1.3, 0], [2.6, 1.1, -0.4], [4.4, 3.5, 0.3]],
  [[0, 0.2, 0], [0.4, 3.2, 0.2], [1.3, 5.1, -0.2]]
];

const DISTANT_FORMATIONS = [
  [-82, 30, -118, 14, 20, 7],
  [4, -34, -132, 24, 8, 6],
  [86, -18, -104, 18, 25, 7],
  [-96, -15, -78, 10, 13, 20],
  [74, 38, -138, 24, 10, 7],
  [-12, 48, -98, 20, 8, 10],
  [104, 12, -62, 13, 28, 6],
  [-76, 2, -16, 8, 22, 12]
] as const;

const CORRIDORS: readonly (readonly IntelligenceUniverseDestination[])[] = [
  ["company", "vaeroex", "intelligence-systems", "executive-intelligence"],
  ["trust", "intelligence-systems", "careers"],
  ["pricing", "vaeroex", "contact"],
  ["drug-discovery-intelligence", "intelligence-systems", "biological-intelligence"],
  ["contact", "network", "biological-intelligence"]
];

const SUPPORTING_SIGNALS = [
  { label: "Visibility", position: [-16, 17, -12] as Vector3Tuple, accent: "#78d9ed", anchor: "vaeroex" as IntelligenceUniverseDestination },
  { label: "Awareness", position: [17, 19, -19] as Vector3Tuple, accent: "#8bcfe0", anchor: "intelligence-systems" as IntelligenceUniverseDestination },
  { label: "Prediction", position: [31, 4, -31] as Vector3Tuple, accent: "#9cb9e2", anchor: "intelligence-systems" as IntelligenceUniverseDestination },
  { label: "Action", position: [-17, -9, -21] as Vector3Tuple, accent: "#70d6c6", anchor: "vaeroex" as IntelligenceUniverseDestination },
  { label: "Specialized", position: [-34, 25, -52] as Vector3Tuple, accent: "#7abdd6", anchor: "intelligence-systems" as IntelligenceUniverseDestination },
  { label: "Contextual", position: [4, -19, -40] as Vector3Tuple, accent: "#76c9ce", anchor: "intelligence-systems" as IntelligenceUniverseDestination },
  { label: "Inspectable", position: [-42, 10, -21] as Vector3Tuple, accent: "#81d7cb", anchor: "trust" as IntelligenceUniverseDestination }
] as const;

function tupleFor(destination: IntelligenceUniverseDestination): Vector3Tuple {
  const position = INTELLIGENCE_UNIVERSE_DESTINATION_POSITIONS[destination];
  return [position.x, position.y, position.z];
}

function effectiveCameraPosition(motion: IntelligenceUniverseMotion, destination: IntelligenceUniverseDestination) {
  const entry = INTELLIGENCE_UNIVERSE_ENTRY_POSITIONS[destination];
  const approach = motion.approachProgress;
  return {
    x: MathUtils.lerp(motion.position.x, entry.x, approach),
    y: MathUtils.lerp(motion.position.y, entry.y, approach),
    z: MathUtils.lerp(motion.position.z, entry.z, approach)
  };
}

function SignalField({
  motion,
  quality
}: {
  motion: MutableRefObject<IntelligenceUniverseMotion>;
  quality: SpatialQualityTier;
}) {
  const nearGroup = useRef<Group>(null);
  const farGroup = useRef<Group>(null);
  const geometries = useMemo(() => {
    const createLayer = (count: number, spread: number, depthOffset: number) => {
      const positions = new Float32Array(count * 3);
      for (let index = 0; index < count; index += 1) {
        const angle = index * 2.399963;
        const radial = 10 + (index % 71) / 70 * spread;
        positions[index * 3] = Math.cos(angle) * radial + Math.sin(index * 0.47) * 11;
        positions[index * 3 + 1] = ((index % 37) / 36 - 0.5) * spread * 0.58 + Math.sin(index * 0.31) * 3;
        positions[index * 3 + 2] = depthOffset - (index % 59) * spread * 0.047 + Math.cos(angle) * 8;
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(positions, 3));
      return geometry;
    };
    const nearCount = quality === "full" ? 520 : quality === "constrained" ? 280 : 140;
    const farCount = quality === "full" ? 760 : quality === "constrained" ? 390 : 190;
    return {
      near: createLayer(nearCount, 126, -30),
      far: createLayer(farCount, 218, -102)
    };
  }, [quality]);

  useFrame((_, delta) => {
    const currentMotion = motion.current;
    if (nearGroup.current) {
      nearGroup.current.rotation.y = MathUtils.damp(nearGroup.current.rotation.y, currentMotion.velocity.x * -0.0014, 4, delta);
      nearGroup.current.rotation.x = MathUtils.damp(nearGroup.current.rotation.x, currentMotion.velocity.y * 0.001, 4, delta);
    }
    if (farGroup.current) {
      farGroup.current.rotation.y = MathUtils.damp(farGroup.current.rotation.y, currentMotion.position.x * -0.00032, 2.4, delta);
    }
  });

  return (
    <>
      <group ref={farGroup}>
        <points geometry={geometries.far} frustumCulled>
          <pointsMaterial color="#6f9daf" size={0.105} sizeAttenuation transparent opacity={0.25} depthWrite={false} />
        </points>
      </group>
      <group ref={nearGroup}>
        <points geometry={geometries.near} frustumCulled>
          <pointsMaterial
            color="#8de7f5"
            size={quality === "full" ? 0.075 : 0.09}
            sizeAttenuation
            transparent
            opacity={0.46}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </points>
      </group>
    </>
  );
}

function DistantArchitecture({ quality }: { quality: SpatialQualityTier }) {
  const formations = quality === "full" ? DISTANT_FORMATIONS : DISTANT_FORMATIONS.slice(0, 5);
  return (
    <group>
      {formations.map(([x, y, z, width, height, depth], index) => (
        <group key={`${x}-${z}`} position={[x, y, z]} rotation={[index * 0.08, index * -0.17, index * 0.04]}>
          <mesh>
            <octahedronGeometry args={[Math.max(width, height) * 0.58, 0]} />
            <meshBasicMaterial color={index % 2 === 0 ? "#4a8599" : "#536f91"} transparent opacity={0.065} wireframe depthWrite={false} />
          </mesh>
          <Line
            points={[
              [-width * 0.8, 0, depth * 0.8],
              [0, height * 0.56, -depth],
              [width * 0.8, -height * 0.22, depth * 0.4]
            ]}
            color="#6da5b8"
            transparent
            opacity={0.14}
            lineWidth={0.55}
          />
        </group>
      ))}
    </group>
  );
}

function EnvironmentalArchitecture() {
  return (
    <group position={[0, 0, -50]}>
      {[-31, -18, -4, 11, 27].map((depth, index) => (
        <mesh key={depth} position={[0, 0, depth]} rotation={[0, index % 2 === 0 ? 0.035 : -0.035, 0]}>
          <ringGeometry args={[38 - index * 2.1, 38.08 - index * 2.1, 112]} />
          <meshBasicMaterial color={index % 2 === 0 ? "#65b8ce" : "#7ba4c0"} transparent opacity={0.08 + index * 0.008} depthWrite={false} />
        </mesh>
      ))}
      <Line points={[[-88, -24, 28], [-30, -6, -15], [22, 5, -39], [92, -20, -70]]} color="#65bad0" transparent opacity={0.16} lineWidth={0.65} />
      <Line points={[[-82, 31, 14], [-28, 18, -31], [28, 9, -55], [90, 34, -86]]} color="#829fca" transparent opacity={0.13} lineWidth={0.6} />
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -27, -13]}>
        <ringGeometry args={[62, 62.08, 140]} />
        <meshBasicMaterial color="#6ab7c9" transparent opacity={0.1} depthWrite={false} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 35, -65]}>
        <ringGeometry args={[78, 78.07, 160]} />
        <meshBasicMaterial color="#718bad" transparent opacity={0.075} depthWrite={false} />
      </mesh>
    </group>
  );
}

function WorldCorridors() {
  return (
    <group>
      {CORRIDORS.map((corridor, index) => (
        <Line
          key={corridor.join("-")}
          points={corridor.map(tupleFor)}
          color={index % 2 === 0 ? "#70cfe3" : "#79a8c8"}
          transparent
          opacity={0.16}
          lineWidth={0.72}
        />
      ))}
      {CORRIDORS.flatMap((corridor, corridorIndex) => corridor.slice(1, -1).map((destination, pointIndex) => (
        <mesh key={`${destination}-${corridorIndex}-${pointIndex}`} position={tupleFor(destination)} scale={0.15 + corridorIndex * 0.012}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color="#b9eff8" transparent opacity={0.6} />
        </mesh>
      )))}
    </group>
  );
}

function SupportingSignals() {
  return (
    <group>
      {SUPPORTING_SIGNALS.map((signal, index) => {
        const anchor = INTELLIGENCE_UNIVERSE_DESTINATION_POSITIONS[signal.anchor];
        return (
          <group key={signal.label}>
            <Line points={[[anchor.x, anchor.y, anchor.z], signal.position]} color={signal.accent} transparent opacity={0.1} lineWidth={0.45} />
            <group position={signal.position} rotation={[index * 0.12, index * 0.21, index * 0.08]}>
              <mesh>
                <octahedronGeometry args={[index === SUPPORTING_SIGNALS.length - 1 ? 0.72 : 0.48, 0]} />
                <meshStandardMaterial color={signal.accent} emissive={signal.accent} emissiveIntensity={0.32} transparent opacity={0.68} />
              </mesh>
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[index === SUPPORTING_SIGNALS.length - 1 ? 1.5 : 1.05, 0.025, 5, 48]} />
                <meshBasicMaterial color={signal.accent} transparent opacity={0.25} />
              </mesh>
              <Html center position={[0, 1.8, 0]} distanceFactor={28} zIndexRange={[3, 1]}>
                <span className={styles.supportingWorldLabel}>{signal.label}</span>
              </Html>
            </group>
          </group>
        );
      })}
    </group>
  );
}

function CoreStructure({ selected, detailed }: { selected: boolean; detailed: boolean }) {
  return (
    <group>
      {[0, 1, 2].map((index) => (
        <mesh key={index} rotation={[0.22 + index * 0.45, index * 0.72, index * 0.18]}>
          <octahedronGeometry args={[5.8 - index * 1.15, 0]} />
          <meshStandardMaterial color={index === 0 ? "#72dff5" : "#8eb7d2"} emissive="#256b82" emissiveIntensity={selected ? 0.38 : 0.18} transparent opacity={0.16 + index * 0.07} wireframe={index !== 2} roughness={0.34} metalness={0.5} />
        </mesh>
      ))}
      {[6.8, 8.7, 10.6].map((radius, index) => (
        <mesh key={radius} rotation={[Math.PI / 2 + index * 0.12, index * 0.28, 0]}>
          <torusGeometry args={[radius, index === 1 ? 0.055 : 0.035, 6, 120]} />
          <meshBasicMaterial color={index === 1 ? "#a9efff" : "#6bb7cf"} transparent opacity={selected ? 0.34 : 0.16} depthWrite={false} />
        </mesh>
      ))}
      {detailed ? <Line points={[[0, -10, 0], [0, -3, 0], [0, 3, 0], [0, 12, 0]]} color="#d2f8ff" transparent opacity={0.58} lineWidth={1} /> : null}
    </group>
  );
}

function SystemsHubStructure({ selected, detailed }: { selected: boolean; detailed: boolean }) {
  const hub = INTELLIGENCE_UNIVERSE_DESTINATION_POSITIONS["intelligence-systems"];
  return (
    <group>
      {[4.8, 7.2, 9.8].map((radius, index) => (
        <mesh key={radius} rotation={[Math.PI / 2 + index * 0.24, index * 0.3, 0]}>
          <torusGeometry args={[radius, index === 1 ? 0.09 : 0.045, 6, 110]} />
          <meshStandardMaterial color={index === 1 ? "#8adff0" : "#5a9fb8"} emissive="#25657a" emissiveIntensity={0.32} transparent opacity={selected ? 0.56 : 0.26} roughness={0.35} />
        </mesh>
      ))}
      <mesh>
        <icosahedronGeometry args={[3.15, detailed ? 2 : 1]} />
        <meshStandardMaterial color="#99e9f6" emissive="#2c8197" emissiveIntensity={selected ? 0.54 : 0.28} transparent opacity={0.38} roughness={0.28} metalness={0.32} />
      </mesh>
      {INTELLIGENCE_UNIVERSE_SYSTEMS.map((destination) => {
        const target = INTELLIGENCE_UNIVERSE_DESTINATION_POSITIONS[destination];
        return (
          <Line
            key={destination}
            points={[[0, 0, 0], [target.x - hub.x, target.y - hub.y, target.z - hub.z]]}
            color={INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS[destination].accent}
            transparent
            opacity={detailed ? 0.28 : 0.14}
            lineWidth={0.7}
          />
        );
      })}
    </group>
  );
}

function TrustStructure({ selected, detailed }: { selected: boolean; detailed: boolean }) {
  return (
    <group>
      {[-4.8, 0, 4.8].map((x, index) => (
        <mesh key={x} position={[x, 0, index === 1 ? -1.2 : 0]}>
          <boxGeometry args={[0.3, 10.5 - index * 1.2, 3.4]} />
          <meshStandardMaterial color="#75d6c4" emissive="#246d62" emissiveIntensity={0.25} transparent opacity={selected ? 0.5 : 0.25} roughness={0.4} metalness={0.45} />
        </mesh>
      ))}
      <mesh rotation={[0, Math.PI / 4, Math.PI / 4]}>
        <octahedronGeometry args={[3.4, detailed ? 1 : 0]} />
        <meshStandardMaterial color="#b5f1e5" emissive="#327d70" emissiveIntensity={0.42} transparent opacity={0.34} wireframe={!detailed} />
      </mesh>
      <Line points={[[-5.8, -5.5, 1.8], [-5.8, 5.5, 1.8], [5.8, 5.5, 1.8], [5.8, -5.5, 1.8]]} color="#a7eadc" transparent opacity={selected ? 0.5 : 0.2} lineWidth={0.8} />
    </group>
  );
}

function PricingStructure({ selected, detailed }: { selected: boolean; detailed: boolean }) {
  return (
    <group rotation={[0.08, -0.12, 0]}>
      {[-3.5, 0, 3.5].map((x, index) => (
        <group key={x} position={[x, index * 0.45 - 0.4, index * -0.8]}>
          <mesh>
            <boxGeometry args={[2.7, 6.8 + index * 0.8, 0.38]} />
            <meshStandardMaterial color={index === 0 ? "#e6cf8d" : "#7f9ead"} emissive={index === 0 ? "#806c31" : "#345766"} emissiveIntensity={0.22} transparent opacity={selected ? 0.52 : 0.25} roughness={0.44} metalness={0.42} />
          </mesh>
          {detailed ? [1.6, 0.3, -1].map((y) => <Line key={y} points={[[-0.85, y, 0.23], [0.85, y, 0.23]]} color="#f5eac1" transparent opacity={0.46} lineWidth={0.7} />) : null}
        </group>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[6.4, 0.045, 6, 96]} />
        <meshBasicMaterial color="#e8d18a" transparent opacity={selected ? 0.34 : 0.14} />
      </mesh>
    </group>
  );
}

function CompanyStructure({ selected, detailed }: { selected: boolean; detailed: boolean }) {
  return (
    <group>
      {[-4, -2, 0, 2, 4].map((x, index) => (
        <mesh key={x} position={[x, Math.abs(index - 2) * -0.4, index * -0.45]} rotation={[0, index * 0.08 - 0.16, 0]}>
          <boxGeometry args={[0.28, 8.6 - Math.abs(index - 2) * 0.8, 3.8]} />
          <meshStandardMaterial color="#9eb7d4" emissive="#324d6b" emissiveIntensity={0.22} transparent opacity={selected ? 0.5 : 0.24} roughness={0.42} metalness={0.48} />
        </mesh>
      ))}
      <mesh position={[0, 0.6, 1.2]} rotation={[0, Math.PI / 4, Math.PI / 4]}>
        <octahedronGeometry args={[detailed ? 2.1 : 1.6, 0]} />
        <meshStandardMaterial color="#e1edfa" emissive="#52729a" emissiveIntensity={0.42} />
      </mesh>
      <Line points={[[-6, -5.2, 2], [0, -6.4, -1], [6, -5.2, 2]]} color="#b9cae0" transparent opacity={selected ? 0.42 : 0.18} lineWidth={0.8} />
    </group>
  );
}

function NetworkStructure({ selected, detailed }: { selected: boolean; detailed: boolean }) {
  const edges = detailed ? NETWORK_EDGES : NETWORK_EDGES.slice(0, 7);
  return (
    <group rotation={[0.08, -0.2, -0.04]}>
      {edges.map(([from, to]) => (
        <Line key={`${from}-${to}`} points={[NETWORK_NODES[from], NETWORK_NODES[to]]} color="#9be1d8" transparent opacity={selected ? 0.66 : 0.3} lineWidth={0.9} />
      ))}
      {NETWORK_NODES.map((position, index) => (
        <mesh key={index} position={position}>
          <icosahedronGeometry args={[index === 2 ? 0.52 : 0.32, 1]} />
          <meshStandardMaterial color={index === 2 ? "#d8fff8" : "#7ac6bc"} emissive="#347b70" emissiveIntensity={selected ? 0.52 : 0.24} />
        </mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[6.3, 0.04, 5, 100]} />
        <meshBasicMaterial color="#7cd3c8" transparent opacity={selected ? 0.3 : 0.12} />
      </mesh>
    </group>
  );
}

function CareersStructure({ selected, detailed }: { selected: boolean; detailed: boolean }) {
  return (
    <group>
      {CAREER_BRANCHES.map((points, index) => (
        <Line key={index} points={points} color={index === 2 ? "#c7b9f2" : "#8fb6dd"} transparent opacity={selected ? 0.68 : 0.3} lineWidth={detailed ? 1.2 : 0.8} />
      ))}
      {CAREER_BRANCHES.flatMap((branch) => branch.slice(-1)).map((position, index) => (
        <mesh key={index} position={position}>
          <octahedronGeometry args={[0.48, 0]} />
          <meshStandardMaterial color="#d9d0fb" emissive="#665491" emissiveIntensity={0.48} />
        </mesh>
      ))}
      <mesh position={[0, -4.6, 0]}>
        <cylinderGeometry args={[2.3, 3.4, 0.35, 7]} />
        <meshStandardMaterial color="#7389ad" emissive="#384763" emissiveIntensity={0.2} transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

function ContactStructure({ selected, detailed }: { selected: boolean; detailed: boolean }) {
  return (
    <group rotation={[0.02, -0.22, 0]}>
      <mesh rotation={[0, 0, Math.PI * 0.24]}>
        <torusGeometry args={[4.4, 0.14, 8, 90, Math.PI * 1.48]} />
        <meshStandardMaterial color="#f0b69f" emissive="#874d3d" emissiveIntensity={0.36} transparent opacity={selected ? 0.72 : 0.34} />
      </mesh>
      <mesh rotation={[0, Math.PI, -Math.PI * 0.24]}>
        <torusGeometry args={[4.4, 0.07, 8, 90, Math.PI * 1.48]} />
        <meshBasicMaterial color="#8bd9e9" transparent opacity={selected ? 0.58 : 0.24} />
      </mesh>
      <mesh>
        <sphereGeometry args={[detailed ? 0.68 : 0.5, 16, 12]} />
        <meshStandardMaterial color="#fff1eb" emissive="#d0765c" emissiveIntensity={0.62} />
      </mesh>
      <Line points={[[0, -7.5, 0], [0, -1, 0], [0, 7.5, 0]]} color="#ffd3c5" transparent opacity={selected ? 0.46 : 0.18} lineWidth={0.75} />
    </group>
  );
}

function ExecutiveStructure({ selected, detailed }: { selected: boolean; detailed: boolean }) {
  const opacity = selected ? 0.74 : 0.34;
  return (
    <group>
      {[-2.2, 0, 2.2].map((x, index) => (
        <mesh key={x} position={[x, index === 1 ? 0.4 : -0.25, index * -0.55]}>
          <boxGeometry args={[1.25, 6.2 - index * 0.5, 1.4]} />
          <meshStandardMaterial color={index === 1 ? "#8ae5fb" : "#3d91b7"} transparent opacity={opacity} roughness={0.5} metalness={0.45} wireframe={!selected} />
        </mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[4.15, 0.05, 6, 88]} />
        <meshBasicMaterial color="#75ddf7" transparent opacity={selected ? 0.52 : 0.22} />
      </mesh>
      {detailed ? (
        <>
          <Line points={EXECUTIVE_NODES} color="#b9f3ff" transparent opacity={0.76} lineWidth={1} />
          {EXECUTIVE_NODES.map((position, index) => (
            <mesh key={index} position={position}>
              <octahedronGeometry args={[0.2, 0]} />
              <meshStandardMaterial color="#d5f8ff" emissive="#2c95b5" emissiveIntensity={0.7} />
            </mesh>
          ))}
        </>
      ) : null}
    </group>
  );
}

function DrugStructure({ selected, detailed }: { selected: boolean; detailed: boolean }) {
  const visibleAtoms = detailed ? DRUG_ATOMS : DRUG_ATOMS.slice(0, 6);
  const visibleBonds = detailed ? DRUG_BONDS : DRUG_BONDS.slice(0, 6);
  return (
    <group rotation={[0.16, -0.2, -0.1]}>
      {visibleBonds.map(([from, to]) => (
        <Line
          key={`${from}-${to}`}
          points={[
            DRUG_ATOMS[from].slice(0, 3) as unknown as Vector3Tuple,
            DRUG_ATOMS[to].slice(0, 3) as unknown as Vector3Tuple
          ]}
          color="#91d9e8"
          transparent
          opacity={selected ? 0.7 : 0.3}
          lineWidth={selected ? 1.2 : 0.7}
        />
      ))}
      {visibleAtoms.map(([x, y, z, color], index) => (
        <mesh key={index} position={[x, y, z]}>
          <sphereGeometry args={[index === 7 || index === 10 ? 0.36 : 0.3, selected ? 20 : 12, selected ? 16 : 10]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 0.24 : 0.09} roughness={0.36} metalness={0.12} />
        </mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[5.5, 0.04, 5, 96]} />
        <meshBasicMaterial color="#5ab8bc" transparent opacity={selected ? 0.35 : 0.14} />
      </mesh>
    </group>
  );
}

function BiologicalStructure({ selected, detailed }: { selected: boolean; detailed: boolean }) {
  const turns = detailed ? 38 : 22;
  const strandA = Array.from({ length: turns }, (_, index): Vector3Tuple => {
    const t = (index / Math.max(1, turns - 1)) * Math.PI * 3.4;
    return [Math.cos(t) * 1.55, (index / (turns - 1) - 0.5) * 7.4, Math.sin(t) * 0.82];
  });
  const strandB = strandA.map(([x, y, z]): Vector3Tuple => [-x, y, -z]);
  const bridgeStep = detailed ? 3 : 5;

  return (
    <group rotation={[0.08, 0.28, -0.14]}>
      <Line points={strandA} color="#86dcff" transparent opacity={selected ? 0.82 : 0.34} lineWidth={1.15} />
      <Line points={strandB} color="#74b6e8" transparent opacity={selected ? 0.7 : 0.3} lineWidth={1.15} />
      {strandA.map((point, index) => index % bridgeStep === 0 ? (
        <Line key={index} points={[point, strandB[index]]} color="#d4f6ff" transparent opacity={selected ? 0.48 : 0.18} lineWidth={0.7} />
      ) : null)}
      <mesh scale={[1.28, 1, 1.14]}>
        <icosahedronGeometry args={[5.1, selected ? 2 : 1]} />
        <meshBasicMaterial color="#438db2" transparent opacity={selected ? 0.13 : 0.065} wireframe depthWrite={false} />
      </mesh>
      {detailed ? (
        <Line points={[[-3.6, -3, -0.3], [-2.4, -1.2, 0.6], [-1.1, -2.2, 0.2], [0.1, -0.7, -0.5], [1.6, -1.9, 0.4], [3.4, -0.4, -0.2]]} color="#a7e8f7" transparent opacity={0.48} lineWidth={1} />
      ) : null}
    </group>
  );
}

function RegionStructure({ id, selected, detailed }: { id: IntelligenceUniverseRegionDestination; selected: boolean; detailed: boolean }) {
  const kind = INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS[id].kind;
  if (kind === "core") return <CoreStructure selected={selected} detailed={detailed} />;
  if (kind === "systems") return <SystemsHubStructure selected={selected} detailed={detailed} />;
  if (kind === "trust") return <TrustStructure selected={selected} detailed={detailed} />;
  if (kind === "pricing") return <PricingStructure selected={selected} detailed={detailed} />;
  if (kind === "company") return <CompanyStructure selected={selected} detailed={detailed} />;
  if (kind === "network") return <NetworkStructure selected={selected} detailed={detailed} />;
  if (kind === "careers") return <CareersStructure selected={selected} detailed={detailed} />;
  return <ContactStructure selected={selected} detailed={detailed} />;
}

function ProductStructure({ id, selected, detailed }: { id: IntelligenceUniverseSystemDestination; selected: boolean; detailed: boolean }) {
  if (id === "executive-intelligence") return <ExecutiveStructure selected={selected} detailed={detailed} />;
  if (id === "drug-discovery-intelligence") return <DrugStructure selected={selected} detailed={detailed} />;
  return <BiologicalStructure selected={selected} detailed={detailed} />;
}

function DestinationLabel({ id, lod, hovered }: { id: IntelligenceUniverseDestination; lod: DestinationLod; hovered: boolean }) {
  const definition = INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS[id];
  return (
    <Html center position={[0, id === "vaeroex" || id === "intelligence-systems" ? 12 : 8.2, 0]} distanceFactor={22} zIndexRange={[6, 1]}>
      <div className={styles.worldLabel} data-lod={lod} data-hovered={hovered} data-kind={definition.kind}>
        <span>{lod === "distant" ? definition.code : definition.name}</span>
        {lod !== "distant" ? <small>{definition.statusLabel}</small> : null}
        {lod === "near" ? <p>{definition.description}</p> : null}
      </div>
    </Html>
  );
}

function DestinationEnvironment({
  id,
  motion,
  onEnterDestination,
  selected,
  quality,
  children
}: {
  id: IntelligenceUniverseDestination;
  motion: MutableRefObject<IntelligenceUniverseMotion>;
  onEnterDestination: (destination: IntelligenceUniverseDestination) => void;
  selected: boolean;
  quality: SpatialQualityTier;
  children: (detailed: boolean) => ReactNode;
}) {
  const group = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);
  const [lod, setLod] = useState<DestinationLod>("distant");
  const base = INTELLIGENCE_UNIVERSE_DESTINATION_POSITIONS[id];
  const definition = INTELLIGENCE_UNIVERSE_DESTINATION_DEFINITIONS[id];
  const seed = id.length * 0.47 + id.charCodeAt(0) * 0.03;
  const detailed = lod !== "distant" && quality !== "reduced_motion";
  const hitRadius = definition.kind === "core" || definition.kind === "systems" ? 11.5 : 7.4;
  useCursor(hovered, "pointer", "grab");

  useFrame((_, delta) => {
    if (!group.current) return;
    const currentMotion = motion.current;
    const cameraPosition = selected ? effectiveCameraPosition(currentMotion, id) : currentMotion.position;
    const distance = Math.hypot(cameraPosition.x - base.x, cameraPosition.y - base.y, cameraPosition.z - base.z);
    const nextLod: DestinationLod = distance < 31 ? "near" : distance < 72 ? "identified" : "distant";
    if (nextLod !== lod) setLod(nextLod);
    const proximity = MathUtils.clamp(1 - (distance - 18) / 76, 0, 1);
    const approach = selected ? currentMotion.approachProgress : 0;
    const baseScale = definition.kind === "core" ? 0.86 : definition.kind === "systems" ? 0.8 : 0.7;
    const targetScale = baseScale + proximity * 0.38 + approach * 0.34 + (hovered ? 0.04 : 0);
    const drift = Math.sin(performance.now() * 0.00017 + seed) * (definition.kind === "system" ? 0.18 : 0.12);
    group.current.scale.setScalar(MathUtils.damp(group.current.scale.x, targetScale, currentMotion.dragging ? 15 : 5.5, delta));
    group.current.position.x = MathUtils.damp(group.current.position.x, base.x, 9, delta);
    group.current.position.y = MathUtils.damp(group.current.position.y, base.y + drift, 4.5, delta);
    group.current.position.z = MathUtils.damp(group.current.position.z, base.z, 7, delta);
    group.current.rotation.y = MathUtils.damp(group.current.rotation.y, currentMotion.velocity.x * -0.006 + seed * 0.002, 6, delta);
    group.current.rotation.x = MathUtils.damp(group.current.rotation.x, currentMotion.velocity.y * 0.0025, 6, delta);
  });

  return (
    <group
      ref={group}
      position={[base.x, base.y, base.z]}
      scale={0.7}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
      onClick={(event) => {
        event.stopPropagation();
        onEnterDestination(id);
      }}
    >
      <mesh>
        <sphereGeometry args={[hitRadius, 12, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {selected ? <pointLight color={definition.accent} intensity={24} distance={34} /> : null}
      {children(detailed)}
      <DestinationLabel id={id} lod={lod} hovered={hovered} />
    </group>
  );
}

function DynamicDestinations({ state, motion, onEnterDestination, quality }: Pick<IntelligenceUniverseWorldProps, "state" | "motion" | "onEnterDestination" | "quality">) {
  return (
    <group>
      {INTELLIGENCE_UNIVERSE_PRIMARY_REGIONS.map((id) => (
        <DestinationEnvironment key={id} id={id} motion={motion} onEnterDestination={onEnterDestination} selected={state.selectedDestination === id} quality={quality}>
          {(detailed) => <RegionStructure id={id} selected={state.selectedDestination === id} detailed={detailed} />}
        </DestinationEnvironment>
      ))}
      {INTELLIGENCE_UNIVERSE_SYSTEMS.map((id) => (
        <DestinationEnvironment key={id} id={id} motion={motion} onEnterDestination={onEnterDestination} selected={state.selectedDestination === id} quality={quality}>
          {(detailed) => <ProductStructure id={id} selected={state.selectedDestination === id} detailed={detailed} />}
        </DestinationEnvironment>
      ))}
    </group>
  );
}

export function IntelligenceUniverseWorld({
  active,
  state,
  motion,
  quality,
  onEnterDestination
}: IntelligenceUniverseWorldProps) {
  return (
    <>
      <color attach="background" args={["#07121b"]} />
      <fog attach="fog" args={["#07121b", 58, 214]} />
      <hemisphereLight intensity={0.76} color="#c6edf4" groundColor="#111a2a" />
      <ambientLight intensity={0.46} color="#9fc7d2" />
      <directionalLight position={[18, 28, 22]} intensity={1.8} color="#e4faff" />
      <directionalLight position={[-40, 8, -30]} intensity={0.82} color="#8a9fcb" />
      <pointLight position={[0, 5, 8]} intensity={38} distance={58} color="#6fdcf3" />
      <pointLight position={[2, 6, -18]} intensity={30} distance={58} color="#6abed0" />
      <EnvironmentalArchitecture />
      <DistantArchitecture quality={quality} />
      <WorldCorridors />
      <SupportingSignals />
      <DynamicDestinations state={state} motion={motion} quality={quality} onEnterDestination={onEnterDestination} />
      {active ? <SignalField quality={quality} motion={motion} /> : null}
    </>
  );
}

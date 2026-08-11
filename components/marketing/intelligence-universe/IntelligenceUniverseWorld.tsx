"use client";

import { Html, Line, useCursor } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState, type MutableRefObject } from "react";
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
  INTELLIGENCE_UNIVERSE_ENTRY_POSITIONS,
  INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS,
  type IntelligenceUniverseMotion,
  type IntelligenceUniverseState,
  type IntelligenceUniverseSystemDestination
} from "@/lib/marketing/intelligence-universe";
import styles from "@/components/marketing/intelligence-universe/intelligence-universe.module.css";

type IntelligenceUniverseWorldProps = Readonly<{
  active: boolean;
  state: IntelligenceUniverseState;
  motion: MutableRefObject<IntelligenceUniverseMotion>;
  quality: SpatialQualityTier;
  onEnterSystem: (destination: IntelligenceUniverseSystemDestination) => void;
}>;

type SystemLod = "distant" | "identified" | "near";

const SYSTEM_NAMES: Readonly<Record<IntelligenceUniverseSystemDestination, string>> = {
  "executive-intelligence": "Executive Intelligence",
  "drug-discovery-intelligence": "Drug Discovery Intelligence",
  "biological-intelligence": "Biological Intelligence"
};

const SYSTEM_CODES: Readonly<Record<IntelligenceUniverseSystemDestination, string>> = {
  "executive-intelligence": "EI / 01",
  "drug-discovery-intelligence": "DD / 02",
  "biological-intelligence": "BI / 03"
};

const SYSTEM_STATUS: Readonly<Record<IntelligenceUniverseSystemDestination, string>> = {
  "executive-intelligence": "Available",
  "drug-discovery-intelligence": "In Development",
  "biological-intelligence": "In Development"
};

const SYSTEM_DESCRIPTIONS: Readonly<Record<IntelligenceUniverseSystemDestination, string>> = {
  "executive-intelligence": "Operational signals resolved into an inspectable decision environment.",
  "drug-discovery-intelligence": "Molecular and structural research intelligence across a computational discovery field.",
  "biological-intelligence": "Multi-scale biological information shaped into coherent systems intelligence."
};

const SYSTEM_POSITIONS: Readonly<Record<IntelligenceUniverseSystemDestination, Vector3Tuple>> = {
  "executive-intelligence": [
    INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS["executive-intelligence"].x,
    INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS["executive-intelligence"].y,
    INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS["executive-intelligence"].z
  ],
  "drug-discovery-intelligence": [
    INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS["drug-discovery-intelligence"].x,
    INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS["drug-discovery-intelligence"].y,
    INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS["drug-discovery-intelligence"].z
  ],
  "biological-intelligence": [
    INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS["biological-intelligence"].x,
    INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS["biological-intelligence"].y,
    INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS["biological-intelligence"].z
  ]
};

const FRAME_DEPTHS = [-14, -7, 0, 7, 14] as const;
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

const DISTANT_FORMATIONS = [
  [-56, 22, -104, 9, 14, 5],
  [2, -24, -118, 18, 7, 4],
  [64, -14, -96, 12, 18, 6],
  [-70, -11, -74, 8, 9, 14],
  [58, 28, -126, 18, 8, 5],
  [-8, 34, -88, 15, 6, 7]
] as const;

function effectiveCameraPosition(motion: IntelligenceUniverseMotion, selectedSystem: IntelligenceUniverseSystemDestination) {
  const entry = INTELLIGENCE_UNIVERSE_ENTRY_POSITIONS[selectedSystem];
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
        const radial = 8 + (index % 71) / 70 * spread;
        positions[index * 3] = Math.cos(angle) * radial + Math.sin(index * 0.47) * 9;
        positions[index * 3 + 1] = ((index % 37) / 36 - 0.5) * spread * 0.58 + Math.sin(index * 0.31) * 2;
        positions[index * 3 + 2] = depthOffset - (index % 59) * spread * 0.042 + Math.cos(angle) * 7;
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(positions, 3));
      return geometry;
    };
    const nearCount = quality === "full" ? 420 : quality === "constrained" ? 240 : 120;
    const farCount = quality === "full" ? 660 : quality === "constrained" ? 340 : 170;
    return {
      near: createLayer(nearCount, 92, -24),
      far: createLayer(farCount, 176, -82)
    };
  }, [quality]);

  useFrame((_, delta) => {
    const currentMotion = motion.current;
    if (nearGroup.current) {
      nearGroup.current.rotation.y = MathUtils.damp(
        nearGroup.current.rotation.y,
        currentMotion.velocity.x * -0.0014,
        4,
        delta
      );
      nearGroup.current.rotation.x = MathUtils.damp(
        nearGroup.current.rotation.x,
        currentMotion.velocity.y * 0.001,
        4,
        delta
      );
    }
    if (farGroup.current) {
      farGroup.current.rotation.y = MathUtils.damp(
        farGroup.current.rotation.y,
        currentMotion.position.x * -0.00035,
        2.4,
        delta
      );
    }
  });

  return (
    <>
      <group ref={farGroup}>
        <points geometry={geometries.far} frustumCulled>
          <pointsMaterial color="#537f91" size={0.09} sizeAttenuation transparent opacity={0.19} depthWrite={false} />
        </points>
      </group>
      <group ref={nearGroup}>
        <points geometry={geometries.near} frustumCulled>
          <pointsMaterial
            color="#74d9f2"
            size={quality === "full" ? 0.065 : 0.08}
            sizeAttenuation
            transparent
            opacity={0.38}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </points>
      </group>
    </>
  );
}

function DistantArchitecture() {
  return (
    <group>
      {DISTANT_FORMATIONS.map(([x, y, z, width, height, depth], index) => (
        <group key={`${x}-${z}`} position={[x, y, z]} rotation={[index * 0.08, index * -0.17, index * 0.04]}>
          <mesh>
            <boxGeometry args={[width, height, depth]} />
            <meshBasicMaterial color={index % 2 === 0 ? "#34647b" : "#31566d"} transparent opacity={0.055} wireframe depthWrite={false} />
          </mesh>
          <Line
            points={[
              [-width * 0.8, 0, depth * 0.8],
              [0, height * 0.56, -depth],
              [width * 0.8, -height * 0.22, depth * 0.4]
            ]}
            color="#4f8398"
            transparent
            opacity={0.1}
            lineWidth={0.55}
          />
        </group>
      ))}
    </group>
  );
}

function MasterArchitecture() {
  return (
    <group position={[0, 0, -42]}>
      {FRAME_DEPTHS.map((depth, index) => (
        <mesh key={depth} position={[0, 0, depth]} rotation={[0, index % 2 === 0 ? 0.025 : -0.025, 0]}>
          <boxGeometry args={[68 - index * 3.5, 28 - index * 1.2, 0.05]} />
          <meshBasicMaterial color="#397b97" transparent opacity={0.027 + index * 0.006} wireframe depthWrite={false} />
        </mesh>
      ))}
      <Line points={[[-48, -15, 12], [0, 0, -18], [54, -18, -2]]} color="#4c9bb6" transparent opacity={0.09} lineWidth={0.6} />
      <Line points={[[-46, 18, 4], [8, 2, -24], [58, 22, -8]]} color="#4c9bb6" transparent opacity={0.075} lineWidth={0.6} />
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -14, -8]}>
        <torusGeometry args={[38, 0.04, 5, 150]} />
        <meshBasicMaterial color="#5bb4d0" transparent opacity={0.075} depthWrite={false} />
      </mesh>
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
        <Line
          points={[[-3.6, -3, -0.3], [-2.4, -1.2, 0.6], [-1.1, -2.2, 0.2], [0.1, -0.7, -0.5], [1.6, -1.9, 0.4], [3.4, -0.4, -0.2]]}
          color="#a7e8f7"
          transparent
          opacity={0.48}
          lineWidth={1}
        />
      ) : null}
    </group>
  );
}

function SystemEnvironment({
  id,
  motion,
  onEnterSystem,
  selected,
  quality
}: {
  id: IntelligenceUniverseSystemDestination;
  motion: MutableRefObject<IntelligenceUniverseMotion>;
  onEnterSystem: (destination: IntelligenceUniverseSystemDestination) => void;
  selected: boolean;
  quality: SpatialQualityTier;
}) {
  const group = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);
  const [lod, setLod] = useState<SystemLod>("distant");
  const basePosition = SYSTEM_POSITIONS[id];
  const seed = id === "executive-intelligence" ? 1.4 : id === "drug-discovery-intelligence" ? 3.8 : 6.2;
  const detailed = lod !== "distant" && quality !== "reduced_motion";
  useCursor(hovered, "pointer", "grab");

  useFrame((_, delta) => {
    if (!group.current) return;
    const currentMotion = motion.current;
    const cameraPosition = selected
      ? effectiveCameraPosition(currentMotion, id)
      : currentMotion.position;
    const distance = Math.hypot(
      cameraPosition.x - basePosition[0],
      cameraPosition.y - basePosition[1],
      cameraPosition.z - basePosition[2]
    );
    const nextLod: SystemLod = distance < 29 ? "near" : distance < 57 ? "identified" : "distant";
    if (nextLod !== lod) setLod(nextLod);
    const proximity = MathUtils.clamp(1 - (distance - 18) / 62, 0, 1);
    const approach = selected ? currentMotion.approachProgress : 0;
    const targetScale = 0.64 + proximity * 0.5 + approach * 0.42 + (hovered ? 0.04 : 0);
    const drift = Math.sin(performance.now() * 0.00019 + seed) * 0.18;
    group.current.scale.setScalar(MathUtils.damp(group.current.scale.x, targetScale, currentMotion.dragging ? 15 : 5.5, delta));
    group.current.position.x = MathUtils.damp(group.current.position.x, basePosition[0], 9, delta);
    group.current.position.y = MathUtils.damp(group.current.position.y, basePosition[1] + drift, 4.5, delta);
    group.current.position.z = MathUtils.damp(group.current.position.z, basePosition[2], 7, delta);
    group.current.rotation.y = MathUtils.damp(
      group.current.rotation.y,
      currentMotion.velocity.x * -0.008 + (selected ? 0 : seed * 0.004),
      6,
      delta
    );
    group.current.rotation.x = MathUtils.damp(group.current.rotation.x, currentMotion.velocity.y * 0.003, 6, delta);
  });

  return (
    <group
      ref={group}
      position={basePosition}
      scale={0.68}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
      onClick={(event) => {
        event.stopPropagation();
        onEnterSystem(id);
      }}
    >
      <mesh>
        <sphereGeometry args={[6.6, 12, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[6.3, selected ? 0.06 : 0.038, 6, 100]} />
        <meshBasicMaterial
          color={id === "drug-discovery-intelligence" ? "#6dd9d1" : "#6dcced"}
          transparent
          opacity={selected ? 0.32 : 0.12}
          depthWrite={false}
        />
      </mesh>
      {id === "executive-intelligence" ? <ExecutiveStructure selected={selected} detailed={detailed} /> : null}
      {id === "drug-discovery-intelligence" ? <DrugStructure selected={selected} detailed={detailed} /> : null}
      {id === "biological-intelligence" ? <BiologicalStructure selected={selected} detailed={detailed} /> : null}
      <Html center position={[0, 7.4, 0]} distanceFactor={20} zIndexRange={[6, 1]}>
        <div className={styles.worldLabel} data-lod={lod} data-hovered={hovered}>
          <span>{lod === "distant" ? SYSTEM_CODES[id] : SYSTEM_NAMES[id]}</span>
          {lod !== "distant" ? <small>{SYSTEM_STATUS[id]}</small> : null}
          {lod === "near" ? <p>{SYSTEM_DESCRIPTIONS[id]}</p> : null}
        </div>
      </Html>
    </group>
  );
}

function DynamicSystems({
  state,
  motion,
  onEnterSystem,
  quality
}: Pick<IntelligenceUniverseWorldProps, "state" | "motion" | "onEnterSystem" | "quality">) {
  return (
    <group>
      <SystemEnvironment id="executive-intelligence" motion={motion} onEnterSystem={onEnterSystem} selected={state.selectedSystem === "executive-intelligence"} quality={quality} />
      <SystemEnvironment id="drug-discovery-intelligence" motion={motion} onEnterSystem={onEnterSystem} selected={state.selectedSystem === "drug-discovery-intelligence"} quality={quality} />
      <SystemEnvironment id="biological-intelligence" motion={motion} onEnterSystem={onEnterSystem} selected={state.selectedSystem === "biological-intelligence"} quality={quality} />
    </group>
  );
}

export function IntelligenceUniverseWorld({
  active,
  state,
  motion,
  quality,
  onEnterSystem
}: IntelligenceUniverseWorldProps) {
  return (
    <>
      <color attach="background" args={["#02050a"]} />
      <fog attach="fog" args={["#02050a", 42, 164]} />
      <ambientLight intensity={0.36} color="#8bbbc9" />
      <directionalLight position={[12, 18, 18]} intensity={1.3} color="#d7f7ff" />
      <pointLight position={[-24, 8, -27]} intensity={34} distance={34} color="#52bde3" />
      <pointLight position={[18, -9, -52]} intensity={32} distance={36} color="#6bd8d1" />
      <pointLight position={[40, 16, -36]} intensity={34} distance={38} color="#62b7e8" />
      <MasterArchitecture />
      <DistantArchitecture />
      <DynamicSystems state={state} motion={motion} quality={quality} onEnterSystem={onEnterSystem} />
      {active ? <SignalField quality={quality} motion={motion} /> : null}
    </>
  );
}

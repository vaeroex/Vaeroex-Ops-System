"use client";

import { Line, useCursor } from "@react-three/drei";
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
import type {
  IntelligenceUniverseMotion,
  IntelligenceUniverseState,
  IntelligenceUniverseSystemDestination
} from "@/lib/marketing/intelligence-universe";
import { INTELLIGENCE_UNIVERSE_RAIL_ANCHORS } from "@/lib/marketing/intelligence-universe";

type IntelligenceUniverseWorldProps = Readonly<{
  active: boolean;
  state: IntelligenceUniverseState;
  motion: MutableRefObject<IntelligenceUniverseMotion>;
  quality: SpatialQualityTier;
  onEnterSystem: (destination: IntelligenceUniverseSystemDestination) => void;
}>;

const SYSTEM_POSITIONS: Readonly<Record<IntelligenceUniverseSystemDestination, Vector3Tuple>> = {
  "executive-intelligence": [-12, 0.7, -14],
  "drug-discovery-intelligence": [0, -0.8, -18],
  "biological-intelligence": [12, 1.1, -13.5]
};

const FRAME_DEPTHS = [-3.5, -1.8, 0, 1.8, 3.5] as const;
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

function SignalField({
  motion,
  quality
}: {
  motion: MutableRefObject<IntelligenceUniverseMotion>;
  quality: SpatialQualityTier;
}) {
  const group = useRef<Group>(null);
  const geometry = useMemo(() => {
    const count = quality === "full" ? 520 : quality === "constrained" ? 280 : 140;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const angle = index * 2.399963;
      const band = (index % 19) / 18;
      const radius = 8 + (index % 41) * 0.73;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = (band - 0.5) * 20 + Math.sin(index * 0.37) * 0.8;
      positions[index * 3 + 2] = -6 - Math.sin(angle) * radius * 0.48 - (index % 13) * 1.45;
    }
    const next = new BufferGeometry();
    next.setAttribute("position", new BufferAttribute(positions, 3));
    return next;
  }, [quality]);

  useFrame((_, delta) => {
    if (!group.current) return;
    const currentMotion = motion.current;
    group.current.position.x = MathUtils.damp(
      group.current.position.x,
      -currentMotion.railProgress * 1.6,
      currentMotion.dragging ? 16 : 5,
      delta
    );
    group.current.rotation.y = MathUtils.damp(
      group.current.rotation.y,
      currentMotion.railProgress * -0.026 + currentMotion.velocity * 0.012,
      6,
      delta
    );
  });

  return (
    <group ref={group}>
      <points geometry={geometry} frustumCulled>
        <pointsMaterial
          color="#74d9f2"
          size={quality === "full" ? 0.055 : 0.07}
          sizeAttenuation
          transparent
          opacity={0.34}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </points>
    </group>
  );
}

function MasterArchitecture({ motion }: { motion: MutableRefObject<IntelligenceUniverseMotion> }) {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    if (!group.current) return;
    group.current.position.x = MathUtils.damp(group.current.position.x, motion.current.railProgress * 0.8, 4, delta);
    group.current.rotation.y = MathUtils.damp(group.current.rotation.y, motion.current.railProgress * 0.018, 4, delta);
  });
  return (
    <group ref={group} position={[0, 0, -13]}>
      {FRAME_DEPTHS.map((depth, index) => (
        <mesh key={depth} position={[0, 0, depth]} rotation={[0, index % 2 === 0 ? 0.025 : -0.025, 0]}>
          <boxGeometry args={[34 - index * 1.5, 12 - index * 0.42, 0.05]} />
          <meshBasicMaterial color="#397b97" transparent opacity={0.055 + index * 0.012} wireframe depthWrite={false} />
        </mesh>
      ))}
      <Line points={[[-21, -5.4, 3], [0, 0, -4.5], [21, -5.4, 3]]} color="#4c9bb6" transparent opacity={0.13} lineWidth={0.7} />
      <Line points={[[-21, 5.4, 3], [0, 0, -4.5], [21, 5.4, 3]]} color="#4c9bb6" transparent opacity={0.1} lineWidth={0.7} />
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -4.8, -2]}>
        <torusGeometry args={[16, 0.035, 5, 120]} />
        <meshBasicMaterial color="#5bb4d0" transparent opacity={0.13} depthWrite={false} />
      </mesh>
    </group>
  );
}

function ExecutiveStructure({ selected, detailed }: { selected: boolean; detailed: boolean }) {
  const opacity = selected ? 0.72 : 0.27;
  return (
    <group>
      {[-1.7, 0, 1.7].map((x, index) => (
        <mesh key={x} position={[x, index === 1 ? 0.2 : -0.2, index * -0.4]}>
          <boxGeometry args={[1.05, 4.8 - index * 0.45, 1.15]} />
          <meshStandardMaterial color={index === 1 ? "#8ae5fb" : "#3d91b7"} transparent opacity={opacity} roughness={0.5} metalness={0.45} wireframe={!selected} />
        </mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[3.25, 0.045, 6, 72]} />
        <meshBasicMaterial color="#75ddf7" transparent opacity={selected ? 0.5 : 0.18} />
      </mesh>
      {detailed ? (
        <>
          <Line points={EXECUTIVE_NODES} color="#b9f3ff" transparent opacity={0.74} lineWidth={1} />
          {EXECUTIVE_NODES.map((position, index) => (
            <mesh key={index} position={position}>
              <octahedronGeometry args={[0.17, 0]} />
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
      {visibleBonds.map(([from, to], index) => (
        <Line
          key={`${from}-${to}`}
          points={[
            DRUG_ATOMS[from].slice(0, 3) as unknown as Vector3Tuple,
            DRUG_ATOMS[to].slice(0, 3) as unknown as Vector3Tuple
          ]}
          color="#91d9e8"
          transparent
          opacity={selected ? 0.66 : 0.25}
          lineWidth={selected ? 1.2 : 0.7}
        />
      ))}
      {visibleAtoms.map(([x, y, z, color], index) => (
        <mesh key={index} position={[x, y, z]}>
          <sphereGeometry args={[index === 7 || index === 10 ? 0.33 : 0.27, selected ? 20 : 12, selected ? 16 : 10]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 0.22 : 0.08} roughness={0.36} metalness={0.12} />
        </mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[4.7, 0.035, 5, 82]} />
        <meshBasicMaterial color="#5ab8bc" transparent opacity={selected ? 0.33 : 0.12} />
      </mesh>
    </group>
  );
}

function BiologicalStructure({ selected, detailed }: { selected: boolean; detailed: boolean }) {
  const turns = detailed ? 34 : 20;
  const strandA = Array.from({ length: turns }, (_, index): Vector3Tuple => {
    const t = (index / Math.max(1, turns - 1)) * Math.PI * 3.2;
    return [Math.cos(t) * 1.35, (index / (turns - 1) - 0.5) * 6.2, Math.sin(t) * 0.7];
  });
  const strandB = strandA.map(([x, y, z]): Vector3Tuple => [-x, y, -z]);
  const bridgeStep = detailed ? 3 : 5;

  return (
    <group rotation={[0.08, 0.28, -0.14]}>
      <Line points={strandA} color="#86dcff" transparent opacity={selected ? 0.8 : 0.28} lineWidth={1.15} />
      <Line points={strandB} color="#74b6e8" transparent opacity={selected ? 0.68 : 0.24} lineWidth={1.15} />
      {strandA.map((point, index) => index % bridgeStep === 0 ? (
        <Line key={index} points={[point, strandB[index]]} color="#d4f6ff" transparent opacity={selected ? 0.46 : 0.14} lineWidth={0.7} />
      ) : null)}
      <mesh scale={[1.28, 1, 1.14]}>
        <icosahedronGeometry args={[4.3, selected ? 2 : 1]} />
        <meshBasicMaterial color="#438db2" transparent opacity={selected ? 0.12 : 0.055} wireframe depthWrite={false} />
      </mesh>
      {detailed ? (
        <Line
          points={[[-3.1, -2.6, -0.3], [-2.2, -1.1, 0.6], [-1.1, -2, 0.2], [0.1, -0.7, -0.5], [1.4, -1.7, 0.4], [2.8, -0.4, -0.2]]}
          color="#a7e8f7"
          transparent
          opacity={0.45}
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
  const detailed = selected && quality !== "reduced_motion";
  const basePosition = SYSTEM_POSITIONS[id];
  useCursor(hovered, "pointer", "grab");

  useFrame((_, delta) => {
    if (!group.current) return;
    const currentMotion = motion.current;
    const anchor = INTELLIGENCE_UNIVERSE_RAIL_ANCHORS[id];
    const distance = Math.abs(currentMotion.railProgress - anchor);
    const focus = MathUtils.clamp(1 - distance * 0.82, 0, 1);
    const approach = selected ? currentMotion.approachProgress : 0;
    const targetScale = 0.74 + focus * 0.22 + approach * 0.7 + (hovered ? 0.035 : 0);
    const drift = Math.sin(performance.now() * 0.00022 + anchor * 2.4) * 0.12;
    group.current.scale.setScalar(MathUtils.damp(group.current.scale.x, targetScale, currentMotion.dragging ? 15 : 6, delta));
    group.current.position.x = MathUtils.damp(group.current.position.x, basePosition[0], 9, delta);
    group.current.position.y = MathUtils.damp(group.current.position.y, basePosition[1] + drift + focus * 0.16, 5, delta);
    group.current.position.z = MathUtils.damp(group.current.position.z, basePosition[2] - (1 - focus) * 2.4, 6, delta);
    group.current.rotation.y = MathUtils.damp(
      group.current.rotation.y,
      (currentMotion.railProgress - anchor) * -0.1 + currentMotion.velocity * 0.016,
      7,
      delta
    );
  });

  return (
    <group
      ref={group}
      position={basePosition}
      scale={0.8}
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
        <sphereGeometry args={[5.1, 12, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[5.5, selected ? 0.055 : 0.035, 6, 96]} />
        <meshBasicMaterial
          color={id === "drug-discovery-intelligence" ? "#6dd9d1" : "#6dcced"}
          transparent
          opacity={selected ? 0.3 : 0.11}
          depthWrite={false}
        />
      </mesh>
      {id === "executive-intelligence" ? <ExecutiveStructure selected={selected} detailed={detailed} /> : null}
      {id === "drug-discovery-intelligence" ? <DrugStructure selected={selected} detailed={detailed} /> : null}
      {id === "biological-intelligence" ? <BiologicalStructure selected={selected} detailed={detailed} /> : null}
    </group>
  );
}

function DynamicSystems({
  state,
  motion,
  onEnterSystem,
  quality
}: Pick<IntelligenceUniverseWorldProps, "state" | "motion" | "onEnterSystem" | "quality">) {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    if (!group.current) return;
    const currentMotion = motion.current;
    const travelScale = state.phase === "transitioning" || state.phase === "arriving" ? 1.02 : 1;
    group.current.scale.x = MathUtils.damp(group.current.scale.x, travelScale, 5, delta);
    group.current.scale.y = MathUtils.damp(group.current.scale.y, 1, 5, delta);
    group.current.scale.z = MathUtils.damp(group.current.scale.z, 1 + currentMotion.approachProgress * 0.035, 5, delta);
    group.current.position.x = MathUtils.damp(group.current.position.x, currentMotion.railProgress * -0.38, 8, delta);
    if (!state.reducedMotion && quality !== "reduced_motion") {
      group.current.rotation.y = MathUtils.damp(
        group.current.rotation.y,
        currentMotion.railProgress * 0.008 + currentMotion.velocity * -0.006,
        6,
        delta
      );
    }
  });

  return (
    <group ref={group}>
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
      <fog attach="fog" args={["#02050a", 30, 82]} />
      <ambientLight intensity={0.4} color="#8bbbc9" />
      <directionalLight position={[7, 10, 11]} intensity={1.35} color="#d7f7ff" />
      <pointLight position={[-10, 2, -4]} intensity={28} distance={24} color="#52bde3" />
      <pointLight position={[0, -2, -4]} intensity={24} distance={23} color="#6bd8d1" />
      <pointLight position={[10, 2, -4]} intensity={25} distance={24} color="#62b7e8" />
      <MasterArchitecture motion={motion} />
      <DynamicSystems state={state} motion={motion} quality={quality} onEnterSystem={onEnterSystem} />
      {active ? <SignalField quality={quality} motion={motion} /> : null}
    </>
  );
}

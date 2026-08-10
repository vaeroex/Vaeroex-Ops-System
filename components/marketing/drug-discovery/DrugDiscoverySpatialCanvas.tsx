"use client";

import { Line } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode
} from "react";
import {
  CatmullRomCurve3,
  Color,
  Euler,
  Group,
  InstancedMesh,
  MathUtils,
  Mesh,
  Object3D,
  Vector3
} from "three";
import styles from "@/app/drug-discovery-intelligence/drug-discovery.module.css";
import { probeRenderedCanvas, type CanvasPixelProbeResult } from "@/components/spatial/CanvasPixelProbe";
import { SpatialResizeObserver } from "@/components/spatial/SpatialResizeObserver";
import { useSpatialCapability, type SpatialQualityTier } from "@/components/spatial/useSpatialCapability";
import {
  AnimatedMolecule,
  MOLECULE_LIBRARY,
  MoleculeModel
} from "./MolecularVisualization";
import { BindingPocket, ProteinTarget } from "./ProteinVisualization";

type JourneyPoint = Readonly<{
  progress: number;
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fov: number;
}>;

type Point3 = readonly [number, number, number];

const JOURNEY: readonly JourneyPoint[] = [
  { progress: 0, position: [3.4, 2.4, 15], target: [0, 0, -7], fov: 42 },
  { progress: 0.12, position: [1.7, 1.1, 8], target: [0, 0, -8], fov: 40 },
  { progress: 0.23, position: [0.8, 0.3, -4], target: [0, 0, -14], fov: 43 },
  { progress: 0.34, position: [-5.1, 2.1, -18], target: [0, 0, -29], fov: 47 },
  { progress: 0.46, position: [4.2, 0.5, -32], target: [0, 0, -41], fov: 42 },
  { progress: 0.58, position: [-3.8, 1.2, -47], target: [0, 0, -57], fov: 44 },
  { progress: 0.7, position: [4.4, 1.4, -62], target: [0, 0, -72], fov: 43 },
  { progress: 0.81, position: [-3.2, 1.3, -77], target: [0, 0, -87], fov: 45 },
  { progress: 0.92, position: [2.2, 1.6, -91], target: [0, 0, -101], fov: 42 },
  { progress: 1, position: [0.2, 2.2, -104], target: [0, 0, -116], fov: 40 }
] as const;

type JourneyState = Readonly<{ progress: MutableRefObject<number> }>;

const JourneyContext = createContext<JourneyState | null>(null);

function useJourneyState() {
  const value = useContext(JourneyContext);
  if (!value) throw new Error("Drug Discovery journey context is unavailable");
  return value;
}

function smoothRange(value: number, from: number, to: number) {
  const normalized = MathUtils.clamp((value - from) / Math.max(0.001, to - from), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function sampleJourney(progress: number, key: "position" | "target", target: Vector3) {
  let index = 0;
  while (index < JOURNEY.length - 2 && progress > JOURNEY[index + 1].progress) index += 1;
  const from = JOURNEY[index];
  const to = JOURNEY[index + 1];
  const local = smoothRange(progress, from.progress, to.progress);
  target.set(
    MathUtils.lerp(from[key][0], to[key][0], local),
    MathUtils.lerp(from[key][1], to[key][1], local),
    MathUtils.lerp(from[key][2], to[key][2], local)
  );
  return MathUtils.lerp(from.fov, to.fov, local);
}

function JourneyDirector({ quality, children }: { quality: SpatialQualityTier; children: ReactNode }) {
  const { camera, pointer } = useThree();
  const targetProgress = useRef(0);
  const currentProgress = useRef(0);
  const nextPosition = useRef(new Vector3());
  const nextTarget = useRef(new Vector3());
  const reducedMotion = quality === "reduced_motion";

  useEffect(() => {
    const update = () => {
      const journey = document.querySelector<HTMLElement>("[data-drug-discovery-journey]");
      if (!journey) return;
      const bounds = journey.getBoundingClientRect();
      const travel = Math.max(1, journey.offsetHeight - window.innerHeight);
      targetProgress.current = MathUtils.clamp(-bounds.top / travel, 0, 1);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useFrame((_, delta) => {
    currentProgress.current = reducedMotion
      ? targetProgress.current
      : MathUtils.damp(currentProgress.current, targetProgress.current, 4.4, delta);

    if (reducedMotion) {
      camera.position.set(3.4, 2.4, 15);
      camera.lookAt(0, 0, -7);
      return;
    }

    const fov = sampleJourney(currentProgress.current, "position", nextPosition.current);
    sampleJourney(currentProgress.current, "target", nextTarget.current);
    if (quality === "full") {
      nextPosition.current.x += pointer.x * 0.28;
      nextPosition.current.y += pointer.y * 0.16;
    }
    camera.position.copy(nextPosition.current);
    camera.lookAt(nextTarget.current);
    if ("fov" in camera) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });

  return <JourneyContext.Provider value={{ progress: currentProgress }}>{children}</JourneyContext.Provider>;
}

function FrameScheduler({ quality }: { quality: SpatialQualityTier }) {
  const { invalidate } = useThree();

  useEffect(() => {
    const delay = quality === "full" ? 34 : quality === "constrained" ? 58 : 120;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "hidden") invalidate();
    }, delay);
    return () => window.clearInterval(interval);
  }, [invalidate, quality]);

  return null;
}

function FoldedTarget({ position = [0, 0, -7], reducedMotion = false }: { position?: readonly [number, number, number]; reducedMotion?: boolean }) {
  const { progress } = useJourneyState();
  return <ProteinTarget position={position} scale={reducedMotion ? 0.86 : 1.08} progress={progress} reducedMotion={reducedMotion} />;
}

type CandidateSeed = Readonly<{
  index: number;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  scale: number;
  cluster: number;
  analog: number;
  survivor: boolean;
  priority: boolean;
}>;

function deterministicValue(index: number, channel: number) {
  const value = Math.sin(index * 91.73 + channel * 37.19) * 43758.5453;
  return value - Math.floor(value);
}

function CandidateField({ quality }: { quality: SpatialQualityTier }) {
  const atomMesh = useRef<InstancedMesh>(null);
  const bondMesh = useRef<InstancedMesh>(null);
  const possibilityPoints = useRef<Group>(null);
  const { progress } = useJourneyState();
  const count = quality === "full" ? 84 : quality === "constrained" ? 42 : 18;
  const dummy = useMemo(() => new Object3D(), []);
  const up = useMemo(() => new Vector3(0, 1, 0), []);
  const clusterCenters = useMemo<readonly Point3[]>(() => [
    [-6.8, 2.4, -27], [-1.9, -1.4, -30.5], [4.4, 2.25, -34.5], [6.1, -2.2, -38], [-4.7, -3.1, -41]
  ], []);
  const localAtoms = useMemo(() => [
    ...Array.from({ length: 6 }, (_, index) => {
      const angle = (index / 6) * Math.PI * 2;
      return new Vector3(Math.cos(angle) * 0.46, Math.sin(angle) * 0.46, Math.sin(angle * 2) * 0.035);
    }),
    new Vector3(0.98, 0.05, 0.12)
  ], []);
  const localBonds = useMemo(() => [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 6]
  ] as const, []);
  const seeds = useMemo<CandidateSeed[]>(() => Array.from({ length: count }, (_, index) => {
    const cluster = index % clusterCenters.length;
    const analog = Math.floor(index / clusterCenters.length);
    const center = clusterCenters[cluster];
    const survivor = (cluster === 1 && analog < 7) || (cluster === 3 && analog < 2);
    return {
      index,
      cluster,
      analog,
      position: [
        center[0] + (deterministicValue(index, 1) - 0.5) * 3.8,
        center[1] + (deterministicValue(index, 2) - 0.5) * 2.7,
        center[2] + (deterministicValue(index, 3) - 0.5) * 3.2
      ],
      rotation: [
        (deterministicValue(index, 4) - 0.5) * 0.7,
        deterministicValue(index, 5) * Math.PI,
        (deterministicValue(index, 6) - 0.5) * 0.45
      ],
      scale: 0.52 + deterministicValue(index, 7) * 0.48,
      survivor,
      priority: cluster === 1 && analog < 3
    };
  }), [clusterCenters, count]);
  const distantPositions = useMemo(() => {
    const pointCount = quality === "full" ? 220 : quality === "constrained" ? 96 : 36;
    const positions = new Float32Array(pointCount * 3);
    for (let index = 0; index < pointCount; index += 1) {
      const cluster = clusterCenters[index % clusterCenters.length];
      positions[index * 3] = cluster[0] + (deterministicValue(index, 11) - 0.5) * 7;
      positions[index * 3 + 1] = cluster[1] + (deterministicValue(index, 12) - 0.5) * 5;
      positions[index * 3 + 2] = cluster[2] + (deterministicValue(index, 13) - 0.5) * 8;
    }
    return positions;
  }, [clusterCenters, quality]);

  useEffect(() => {
    if (!atomMesh.current || !bondMesh.current) return;
    seeds.forEach((seed) => {
      localAtoms.forEach((_, atomIndex) => {
        const instance = seed.index * localAtoms.length + atomIndex;
        const color = atomIndex === 6
          ? new Color(seed.cluster % 2 ? "#4d9fd1" : "#db726d")
          : new Color(seed.priority ? "#d7f7b5" : seed.survivor ? "#7ce8dc" : "#526b76");
        atomMesh.current?.setColorAt(instance, color);
      });
      localBonds.forEach((_, bondIndex) => {
        const instance = seed.index * localBonds.length + bondIndex;
        const color = new Color(seed.priority ? "#bcd98c" : seed.survivor ? "#559e9d" : "#344d58");
        bondMesh.current?.setColorAt(instance, color);
      });
    });
    if (atomMesh.current.instanceColor) atomMesh.current.instanceColor.needsUpdate = true;
    if (bondMesh.current.instanceColor) bondMesh.current.instanceColor.needsUpdate = true;
  }, [localAtoms, localBonds, seeds]);

  useFrame(({ clock }) => {
    const atoms = atomMesh.current;
    const bonds = bondMesh.current;
    if (!atoms || !bonds) return;
    const p = progress.current;
    const generated = smoothRange(p, 0.2, 0.38);
    const filtered = smoothRange(p, 0.45, 0.62);
    const compared = smoothRange(p, 0.58, 0.74);
    const converged = smoothRange(p, 0.74, 0.94);

    seeds.forEach((seed) => {
      const [baseX, baseY, baseZ] = seed.position;
      const ringAngle = seed.index * 0.74;
      const compareX = Math.cos(ringAngle) * (seed.survivor ? 4.8 : 8.5);
      const compareY = Math.sin(ringAngle) * (seed.survivor ? 2.9 : 5.2);
      const compareZ = -58 - (seed.index % 3) * 0.7;
      const priorityX = seed.priority ? (seed.index - 1) * 2.5 : compareX * 1.35;
      const priorityY = seed.priority ? Math.sin(seed.index * 1.7) * 0.8 : compareY * 1.3;
      const priorityZ = seed.priority ? -96 - seed.index * 0.5 : -74;
      const rejectedDrift = seed.survivor ? 1 : 1 + filtered * 1.7;
      const x = MathUtils.lerp(baseX * rejectedDrift, compareX, compared);
      const y = MathUtils.lerp(baseY * rejectedDrift, compareY, compared);
      const z = MathUtils.lerp(MathUtils.lerp(baseZ, -41 + (seed.index % 5) * 0.35, smoothRange(p, 0.35, 0.5)), compareZ, compared);
      const finalX = MathUtils.lerp(x, priorityX, converged);
      const finalY = MathUtils.lerp(y, priorityY, converged);
      const finalZ = MathUtils.lerp(z, priorityZ, converged);
      const rejectedScale = seed.survivor ? 1 : 1 - filtered * 0.96;
      const baseScale = Math.max(0.001, seed.scale * generated * rejectedScale);
      const idle = quality === "reduced_motion" ? 0 : Math.sin(clock.elapsedTime * 0.32 + seed.index) * 0.04;
      const center = new Vector3(finalX, finalY + idle, finalZ);
      const orientation = new Euler(seed.rotation[0] + p * 0.38, seed.rotation[1] - p * 0.3, seed.rotation[2]);
      const atomPositions = localAtoms.map((atom) => atom.clone().applyEuler(orientation).multiplyScalar(baseScale).add(center));

      atomPositions.forEach((atom, atomIndex) => {
        dummy.position.copy(atom);
        dummy.quaternion.identity();
        const radius = atomIndex === 6 ? 0.15 : 0.12;
        dummy.scale.setScalar(Math.max(0.001, radius * baseScale));
        dummy.updateMatrix();
        atoms.setMatrixAt(seed.index * localAtoms.length + atomIndex, dummy.matrix);
      });

      localBonds.forEach(([fromIndex, toIndex], bondIndex) => {
        const from = atomPositions[fromIndex];
        const to = atomPositions[toIndex];
        const direction = to.clone().sub(from);
        dummy.position.copy(from).add(to).multiplyScalar(0.5);
        dummy.quaternion.setFromUnitVectors(up, direction.clone().normalize());
        dummy.scale.set(Math.max(0.001, baseScale * 0.055), Math.max(0.001, direction.length()), Math.max(0.001, baseScale * 0.055));
        dummy.updateMatrix();
        bonds.setMatrixAt(seed.index * localBonds.length + bondIndex, dummy.matrix);
      });
    });
    atoms.instanceMatrix.needsUpdate = true;
    bonds.instanceMatrix.needsUpdate = true;
    if (possibilityPoints.current) possibilityPoints.current.rotation.z = quality === "reduced_motion" ? 0 : p * 0.08;
  });

  return (
    <group>
      <group ref={possibilityPoints}>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[distantPositions, 3]} />
          </bufferGeometry>
          <pointsMaterial color="#4da8bd" size={0.055} sizeAttenuation transparent opacity={0.42} depthWrite={false} />
        </points>
      </group>
      <instancedMesh ref={atomMesh} args={[undefined, undefined, count * localAtoms.length]} frustumCulled={false}>
        <sphereGeometry args={[1, 7, 6]} />
        <meshStandardMaterial vertexColors roughness={0.38} metalness={0.42} emissive="#143742" emissiveIntensity={0.34} />
      </instancedMesh>
      <instancedMesh ref={bondMesh} args={[undefined, undefined, count * localBonds.length]} frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 6]} />
        <meshStandardMaterial vertexColors roughness={0.46} metalness={0.28} emissive="#12333d" emissiveIntensity={0.24} />
      </instancedMesh>
      <group>
        <group position={[0, 0.3, -26.8]} scale={0.32}>
          <AnimatedMolecule graph={MOLECULE_LIBRARY[2]} representation="stick" accent="#8adfd7" progress={progress} phase={0.2} />
        </group>
        {MOLECULE_LIBRARY.slice(0, 4).map((graph, index) => {
          const analogPositions = [
            [-5.4, 2.4, -31], [-2.2, -2.1, -32.2], [2.6, 2.35, -33.1], [5.6, -1.8, -34.5]
          ] as const;
          const position = analogPositions[index];
          return (
            <group key={graph.id}>
              <group position={position} scale={0.25}>
                <AnimatedMolecule graph={graph} representation="graph" accent={index === 2 ? "#d1efa6" : "#70c9ca"} progress={progress} phase={index * 0.7} flex={0.11} />
              </group>
              <Line points={[[0, 0.3, -26.8], position]} color={index === 2 ? "#b8d988" : "#3f7f88"} lineWidth={0.34} transparent opacity={0.34} />
            </group>
          );
        })}
      </group>
    </group>
  );
}

function DockingField() {
  const { progress } = useJourneyState();
  const docked = useRef<Group>(null);
  const rejected = useRef<Group>(null);
  const trajectories = useMemo(() => [
    new CatmullRomCurve3([new Vector3(-7, 3, -33), new Vector3(-4, 1.8, -36), new Vector3(-1, 0.5, -40), new Vector3(0.4, 0, -43)]).getPoints(48),
    new CatmullRomCurve3([new Vector3(7, -2, -34), new Vector3(4, -1, -38), new Vector3(2, 0.6, -41), new Vector3(0.4, 0, -43)]).getPoints(48),
    new CatmullRomCurve3([new Vector3(-5, -3.5, -35), new Vector3(-2, -2.6, -38), new Vector3(2.5, -1.7, -41), new Vector3(5.8, -2, -44)]).getPoints(48)
  ], []);

  useFrame(() => {
    const p = smoothRange(progress.current, 0.37, 0.54);
    if (docked.current) {
      const orientationSearch = Math.sin(p * Math.PI * 5.5) * (1 - p);
      const conformationalAdjustment = Math.sin(p * Math.PI * 3) * (1 - p) * 0.06;
      docked.current.position.set(MathUtils.lerp(-5.8, 0.4, p), MathUtils.lerp(2.4, 0, p), MathUtils.lerp(-34, -42.35, p));
      docked.current.rotation.set(0.62 - p * 0.5 + orientationSearch * 0.22, 0.4 + p * 1.18 + orientationSearch, p * 0.26 - orientationSearch * 0.18);
      docked.current.scale.set(1 + conformationalAdjustment, 1, 1 - conformationalAdjustment * 0.45);
    }
    if (rejected.current) {
      const rejection = smoothRange(progress.current, 0.46, 0.6);
      rejected.current.position.set(MathUtils.lerp(5.4, 7.8, rejection), MathUtils.lerp(-1.7, -4.2, rejection), MathUtils.lerp(-36, -45, rejection));
      rejected.current.scale.setScalar(1 - rejection * 0.72);
    }
  });

  return (
    <group>
      <BindingPocket position={[0.4, 0, -43]} progress={progress} />
      {trajectories.map((points, index) => (
        <Line key={index} points={points} color={index === 2 ? "#53717b" : "#70dddc"} lineWidth={index === 2 ? 0.35 : 0.62} transparent opacity={index === 2 ? 0.28 : 0.52} />
      ))}
      <group ref={docked}>
        <MoleculeModel graph={MOLECULE_LIBRARY[2]} representation="ball-and-stick" accent="#b9dca0" scale={0.28} flex={0.12} phase={0.4} />
      </group>
      <group ref={rejected}>
        <MoleculeModel graph={MOLECULE_LIBRARY[1]} representation="stick" accent="#526d77" scale={0.25} />
      </group>
      <mesh position={[1.76, -0.08, -42.7]} scale={[0.7, 0.92, 0.65]}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color="#d87968" transparent opacity={0.09} depthWrite={false} />
      </mesh>
      <mesh position={[-0.15, 0.1, -42.72]} scale={[0.58, 0.42, 0.48]}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color="#4b9fd1" transparent opacity={0.1} depthWrite={false} />
      </mesh>
      <mesh position={[0.92, -0.3, -42.68]} scale={[0.65, 0.45, 0.42]}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color="#d8b762" transparent opacity={0.075} depthWrite={false} />
      </mesh>
      <Line points={[[0.05, 0.2, -42.3], [-0.78, 0.86, -42.45]]} color="#cce7a1" lineWidth={0.44} transparent opacity={0.68} dashed dashScale={5} dashSize={0.16} gapSize={0.12} />
      <Line points={[[0.65, -0.2, -42.32], [1.25, -0.86, -42.5]]} color="#7dd5dd" lineWidth={0.4} transparent opacity={0.62} dashed dashScale={5} dashSize={0.16} gapSize={0.12} />
      <Line points={[[0.42, 0.48, -42.28], [1.1, 0.9, -42.44]]} color="#9db7bf" lineWidth={0.32} transparent opacity={0.44} dashed dashScale={5} dashSize={0.14} gapSize={0.13} />
    </group>
  );
}

function ComparisonField() {
  const surface = useRef<Mesh>(null);
  const { progress } = useJourneyState();
  const positions = [
    [0.8, 2.65, -58.8], [2, 1.15, -58.5], [3.2, 2.7, -59.2], [4.45, 1.05, -58.7], [5.7, 2.35, -59.1]
  ] as const;

  useFrame(() => {
    if (!surface.current) return;
    const comparison = smoothRange(progress.current, 0.55, 0.7);
    surface.current.scale.set(Math.max(0.001, comparison), Math.max(0.001, comparison), 1);
  });

  return (
    <group>
      <mesh ref={surface} position={[0, 0, -60]}>
        <planeGeometry args={[13, 8, 1, 1]} />
        <meshPhysicalMaterial color="#0d2832" transparent opacity={0.2} transmission={0.28} roughness={0.3} metalness={0.32} side={2} />
      </mesh>
      {positions.map((position, index) => (
        <group key={index}>
          <group position={position} scale={index === 2 ? 0.36 : 0.28}>
            <AnimatedMolecule
              graph={MOLECULE_LIBRARY[index]}
              representation="ball-and-stick"
              accent={index === 2 ? "#daf3a8" : index % 2 ? "#72e3d7" : "#70b7d1"}
              progress={progress}
              phase={index * 0.82}
              flex={index === 3 ? 0.14 : 0.07}
            />
          </group>
          <mesh position={[position[0], position[1], position[2] - 0.18]} scale={index === 2 ? [1.65, 1.2, 0.3] : [1.25, 0.95, 0.24]}>
            <sphereGeometry args={[1, 18, 12]} />
            <meshBasicMaterial color={index === 2 ? "#b9d78e" : index % 2 ? "#4c9a9d" : "#3b7d91"} transparent opacity={index === 2 ? 0.08 : 0.045} depthWrite={false} />
          </mesh>
          <Line points={[position, [position[0] * 0.58, position[1] * 0.42, -60.2]]} color={index === 2 ? "#d8f3aa" : "#4b98a8"} lineWidth={index === 2 ? 0.7 : 0.38} transparent opacity={index === 2 ? 0.72 : 0.36} />
        </group>
      ))}
    </group>
  );
}

const evidenceNodes = [
  [-5.6, 2.6, -72], [-4.6, -2.6, -72.4], [-1.8, 3.7, -72.8], [-1.2, -3.5, -71.7],
  [2, 3.4, -72.4], [2.8, -3.1, -72], [5.7, 2.1, -72.7], [5.4, -2.5, -71.8]
] as const;

function EvidenceNetwork({ quality }: { quality: SpatialQualityTier }) {
  const nodeMesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const nodeCount = quality === "full" ? evidenceNodes.length : 6;
  const { progress } = useJourneyState();
  const featureAnchors = [
    [-0.72, 0.18, -71.95], [0.5, 0.35, -71.92], [-0.28, -0.5, -71.9], [0.78, -0.22, -71.94]
  ] as const;

  useEffect(() => {
    const nodes = nodeMesh.current;
    if (!nodes) return;
    evidenceNodes.slice(0, nodeCount).forEach((position, index) => {
      dummy.position.set(position[0], position[1], position[2]);
      dummy.rotation.set(0.15 * index, 0.22 * index, 0.1 * index);
      dummy.scale.setScalar(index === 6 ? 1.22 : 0.82);
      dummy.updateMatrix();
      nodes.setMatrixAt(index, dummy.matrix);
      nodes.setColorAt(index, new Color(index === 6 ? "#d9be78" : index % 3 === 0 ? "#d9f4b0" : "#72d7d5"));
    });
    nodes.instanceMatrix.needsUpdate = true;
    if (nodes.instanceColor) nodes.instanceColor.needsUpdate = true;
  }, [dummy, nodeCount]);

  return (
    <group>
      <group position={[0, 0, -72]} scale={0.42}>
        <AnimatedMolecule graph={MOLECULE_LIBRARY[0]} representation="ball-and-stick" accent="#d8f3aa" progress={progress} phase={0.3} flex={0.055} />
      </group>
      <instancedMesh ref={nodeMesh} args={[undefined, undefined, nodeCount]}>
        <boxGeometry args={[0.34, 0.34, 0.34]} />
        <meshStandardMaterial vertexColors roughness={0.35} metalness={0.54} emissive="#153b42" emissiveIntensity={0.42} />
      </instancedMesh>
      {evidenceNodes.slice(0, nodeCount).map((position, index) => (
        <Line key={index} points={[featureAnchors[index % featureAnchors.length], position]} color={index === 6 ? "#c8a66a" : index % 3 === 0 ? "#bde68d" : "#559faf"} lineWidth={index === 6 ? 0.35 : 0.52} transparent opacity={index === 6 ? 0.38 : 0.52} dashed={index === 6} dashScale={4} dashSize={0.18} gapSize={0.12} />
      ))}
      <Line points={[[-5.6, 2.6, -72], [-1.8, 3.7, -72.8], [2, 3.4, -72.4], [5.7, 2.1, -72.7]]} color="#365f6d" lineWidth={0.28} transparent opacity={0.42} />
    </group>
  );
}

function ExperimentLineage() {
  const paths = useMemo<readonly (readonly Point3[])[]>(() => [
    [[-6, 3, -82], [-3.8, 1.8, -85], [-1.5, 0.8, -87], [0, 0, -89]],
    [[-6, -2.5, -82], [-3.2, -1.4, -85], [-1.5, 0.8, -87]],
    [[-2, 4, -83], [-1.2, 2.5, -86], [0, 0, -89]],
    [[0, 0, -89], [2.2, 1.3, -92], [4.5, 0.4, -95]],
    [[2.2, 1.3, -92], [3.4, -2.1, -94], [5.4, -2.8, -97]]
  ], []);
  return (
    <group>
      {paths.map((path, index) => (
        <Line key={index} points={path} color={index === 4 ? "#c9ad6a" : index === 3 ? "#d6f4a9" : "#5cb7bc"} lineWidth={index >= 3 ? 0.72 : 0.42} transparent opacity={index === 4 ? 0.42 : 0.58} dashed={index === 4} dashScale={4} dashSize={0.2} gapSize={0.13} />
      ))}
      {paths.flatMap((path) => path).map((position, index) => (
        <mesh key={`${position.join("-")}-${index}`} position={position} rotation={[0.2, 0.4, 0.1]}>
          <boxGeometry args={[0.28, 0.28, 0.28]} />
          <meshStandardMaterial color={index % 5 === 0 ? "#d7f1a7" : "#6dcfd0"} emissive="#173e43" emissiveIntensity={0.46} roughness={0.36} metalness={0.42} />
        </mesh>
      ))}
      {[
        { graph: MOLECULE_LIBRARY[3], position: [-6, 3, -82] as Point3, scale: 0.18 },
        { graph: MOLECULE_LIBRARY[1], position: [-1.5, 0.8, -87] as Point3, scale: 0.2 },
        { graph: MOLECULE_LIBRARY[0], position: [0, 0, -89] as Point3, scale: 0.22 },
        { graph: MOLECULE_LIBRARY[2], position: [4.5, 0.4, -95] as Point3, scale: 0.24 }
      ].map((record, index) => (
        <group key={record.graph.id} position={record.position} scale={record.scale} rotation={[0.15 * index, 0.42 * index, -0.12 * index]}>
          <MoleculeModel graph={record.graph} representation="graph" accent={index === 3 ? "#d6f4a9" : "#67bdc1"} />
        </group>
      ))}
    </group>
  );
}

function LaboratoryBoundary() {
  return (
    <group position={[0, 0, -108]}>
      <mesh position={[0, 4.4, 0]}><boxGeometry args={[14, 0.35, 0.5]} /><meshStandardMaterial color="#1a3039" metalness={0.72} roughness={0.34} /></mesh>
      <mesh position={[0, -4.4, 0]}><boxGeometry args={[14, 0.35, 0.5]} /><meshStandardMaterial color="#1a3039" metalness={0.72} roughness={0.34} /></mesh>
      <mesh position={[-7, 0, 0]}><boxGeometry args={[0.35, 9.1, 0.5]} /><meshStandardMaterial color="#1a3039" metalness={0.72} roughness={0.34} /></mesh>
      <mesh position={[7, 0, 0]}><boxGeometry args={[0.35, 9.1, 0.5]} /><meshStandardMaterial color="#1a3039" metalness={0.72} roughness={0.34} /></mesh>
      <mesh position={[0, 0, -0.4]}>
        <planeGeometry args={[13.6, 8.5]} />
        <meshPhysicalMaterial color="#15333a" transparent opacity={0.16} transmission={0.42} roughness={0.22} side={2} />
      </mesh>
      <group position={[-2.8, 1.4, 2]} scale={0.3} rotation={[0.1, 0.4, 0.2]}><MoleculeModel graph={MOLECULE_LIBRARY[0]} representation="ball-and-stick" accent="#d8f4aa" /></group>
      <group position={[0, -0.5, 1.5]} scale={0.33} rotation={[-0.2, 0.8, -0.1]}><MoleculeModel graph={MOLECULE_LIBRARY[2]} representation="ball-and-stick" accent="#86e7db" /></group>
      <group position={[2.8, 1, 1.8]} scale={0.29} rotation={[0.25, -0.5, 0.3]}><MoleculeModel graph={MOLECULE_LIBRARY[4]} representation="ball-and-stick" accent="#76c9d7" /></group>
      <Line points={[[0, -0.5, 1.5], [0, -0.2, -4.5], [5, 3.5, -8]]} color="#d6f4aa" lineWidth={0.72} transparent opacity={0.62} />
      <Line points={[[5, 3.5, -8], [5.8, -2.8, -2], [1.6, -2.8, 1.2]]} color="#5d9eaa" lineWidth={0.42} transparent opacity={0.42} dashed dashScale={4} dashSize={0.2} gapSize={0.12} />
      <pointLight position={[0, 0, 2]} color="#bfeea3" intensity={24} distance={16} />
    </group>
  );
}

function ReducedScientificWorld() {
  return (
    <>
      <FoldedTarget reducedMotion />
      <group position={[0, 0, 0]}>
        <Line points={[[0, 0, -7], [4.2, 2.3, -8.5], [6.2, 0.8, -10]]} color="#6bd7d2" lineWidth={0.52} transparent opacity={0.5} />
        <Line points={[[0, 0, -7], [-4.3, -2.2, -8], [-6, -0.6, -10.2]]} color="#b6df91" lineWidth={0.45} transparent opacity={0.42} />
        <group position={[5.8, 0.8, -10]} scale={0.22} rotation={[0.2, 0.6, 0.1]}><MoleculeModel graph={MOLECULE_LIBRARY[1]} representation="graph" accent="#78ded4" /></group>
        <group position={[-5.6, -0.6, -10.2]} scale={0.2} rotation={[-0.2, -0.5, 0.2]}><MoleculeModel graph={MOLECULE_LIBRARY[3]} representation="graph" accent="#c7e99e" /></group>
      </group>
    </>
  );
}

function DrugDiscoveryWorld({ quality }: { quality: SpatialQualityTier }) {
  const reducedMotion = quality === "reduced_motion";
  return (
    <>
      <color attach="background" args={[new Color("#020609")]} />
      <fog attach="fog" args={["#020609", 12, 78]} />
      <ambientLight intensity={0.18} color="#759eaa" />
      <hemisphereLight intensity={0.34} color="#b9eaf0" groundColor="#010304" />
      <directionalLight position={[-8, 12, 14]} intensity={2.4} color="#daf5f4" />
      <directionalLight position={[10, -2, -44]} intensity={1.1} color="#247887" />
      <spotLight position={[7, 8, 5]} target-position={[0, 0, -10]} intensity={95} angle={0.5} penumbra={0.9} distance={62} color="#64d9dd" />
      <pointLight position={[-7, 1, -28]} intensity={28} distance={26} color="#4a9fc2" />
      <pointLight position={[6, -1, -56]} intensity={32} distance={28} color="#78e0d7" />
      <pointLight position={[-5, 1, -73]} intensity={24} distance={23} color="#d4eaa0" />
      {reducedMotion ? (
        <ReducedScientificWorld />
      ) : (
        <>
          <FoldedTarget />
          <CandidateField quality={quality} />
          <DockingField />
          <ComparisonField />
          <EvidenceNetwork quality={quality} />
          <ExperimentLineage />
          <LaboratoryBoundary />
        </>
      )}
    </>
  );
}

function ScientificFallback({ reason }: { reason: string }) {
  return (
    <div className={styles.spatialFallback} data-drug-discovery-fallback={reason} aria-hidden="true">
      <div className={styles.fallbackTarget}>
        {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
      </div>
      <div className={styles.fallbackCandidates}>
        {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
      </div>
    </div>
  );
}

export default function DrugDiscoverySpatialCanvas() {
  const capability = useSpatialCapability({ allowMobile: true });
  const [pixelProbe, setPixelProbe] = useState<CanvasPixelProbeResult>("pending");

  if (!capability.ready) return null;
  if (!capability.available || !capability.quality) {
    return <ScientificFallback reason={capability.reason || "unavailable"} />;
  }

  const quality = capability.quality;
  const dpr: [number, number] = quality === "full" ? [1, 1.4] : quality === "constrained" ? [0.85, 1.08] : [0.8, 1];

  return (
    <div className={styles.spatialCanvas} data-drug-discovery-canvas data-spatial-quality={quality} data-canvas-pixels={pixelProbe} aria-hidden="true">
      <Canvas
        camera={{ position: [3.4, 2.4, 15], fov: 42, near: 0.1, far: 180 }}
        dpr={dpr}
        frameloop="demand"
        gl={{ antialias: quality === "full", alpha: false, powerPreference: "high-performance" }}
        resize={{ polyfill: SpatialResizeObserver }}
        onCreated={(state) => probeRenderedCanvas(state, setPixelProbe)}
      >
        <JourneyDirector quality={quality}>
          <DrugDiscoveryWorld quality={quality} />
        </JourneyDirector>
        <FrameScheduler quality={quality} />
      </Canvas>
    </div>
  );
}

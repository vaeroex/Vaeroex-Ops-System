"use client";

import { Line, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CatmullRomCurve3,
  Color,
  Group,
  MathUtils,
  Mesh,
  Shape,
  Vector3
} from "three";
import { probeRenderedCanvas, type CanvasPixelProbeResult } from "@/components/spatial/CanvasPixelProbe";
import { PublicSpatialContextGuard, PublicSpatialErrorBoundary } from "@/components/spatial/PublicSpatialCanvasGuard";
import { SpatialResizeObserver } from "@/components/spatial/SpatialResizeObserver";
import { applySpatialCameraFraming } from "@/components/spatial/spatialCameraFraming";
import {
  useSpatialCapability,
  type SpatialQualityTier,
  type SpatialViewportProfile
} from "@/components/spatial/useSpatialCapability";

type JourneyPoint = Readonly<{
  progress: number;
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fov: number;
}>;

const JOURNEY: readonly JourneyPoint[] = [
  { progress: 0, position: [0.4, 1.4, 15], target: [0, 0.4, -5], fov: 43 },
  { progress: 0.12, position: [0.3, 1.3, 13.6], target: [-0.4, 0.3, -7], fov: 42 },
  { progress: 0.25, position: [-5.8, 2.1, -4], target: [0.2, 0.2, -20], fov: 46 },
  { progress: 0.39, position: [4.7, -0.2, -22], target: [-0.8, 0.3, -36], fov: 44 },
  { progress: 0.5, position: [0.5, 0.8, -38], target: [0, 0, -51], fov: 40 },
  { progress: 0.63, position: [-4.3, 1.4, -52], target: [0.4, 0.1, -66], fov: 45 },
  { progress: 0.76, position: [3.8, 0.2, -70], target: [-0.4, 0, -82], fov: 42 },
  { progress: 0.88, position: [-2.2, 1.1, -86], target: [0.2, 0, -98], fov: 44 },
  { progress: 1, position: [0.2, 1.2, -101], target: [0, 0.3, -116], fov: 40 }
] as const;

const graphite = "#111820";
const ceramic = "#080d13";
const silicon = "#202c37";
const edge = "#5a7286";
const signal = "#65dbff";

function smoothStep(value: number) {
  return value * value * (3 - 2 * value);
}

function sampleJourney(progress: number, key: "position" | "target", target: Vector3) {
  let index = 0;
  while (index < JOURNEY.length - 2 && progress > JOURNEY[index + 1].progress) index += 1;
  const from = JOURNEY[index];
  const to = JOURNEY[index + 1];
  const range = Math.max(0.001, to.progress - from.progress);
  const local = smoothStep(MathUtils.clamp((progress - from.progress) / range, 0, 1));
  target.set(
    MathUtils.lerp(from[key][0], to[key][0], local),
    MathUtils.lerp(from[key][1], to[key][1], local),
    MathUtils.lerp(from[key][2], to[key][2], local)
  );
  return MathUtils.lerp(from.fov, to.fov, local);
}

function FrameScheduler({ quality }: { quality: SpatialQualityTier }) {
  const { invalidate } = useThree();

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "hidden") invalidate();
    }, quality === "full" ? 34 : quality === "balanced" ? 58 : quality === "light" ? 90 : 180);
    return () => window.clearInterval(interval);
  }, [invalidate, quality]);

  return null;
}

function JourneyCamera({ profile, reducedMotion }: { profile: SpatialViewportProfile; reducedMotion: boolean }) {
  const { camera } = useThree();
  const targetProgress = useRef(0);
  const currentProgress = useRef(0);
  const nextPosition = useRef(new Vector3());
  const nextTarget = useRef(new Vector3());

  useEffect(() => {
    const update = () => {
      const journey = document.querySelector<HTMLElement>("[data-public-spatial-journey]");
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
      : MathUtils.damp(currentProgress.current, targetProgress.current, 4.2, delta);
    const sampledFov = sampleJourney(currentProgress.current, "position", nextPosition.current);
    sampleJourney(currentProgress.current, "target", nextTarget.current);
    const fov = applySpatialCameraFraming(nextPosition.current, nextTarget.current, sampledFov, profile);
    camera.position.copy(nextPosition.current);
    camera.lookAt(nextTarget.current);
    if ("fov" in camera) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}

type SlabProps = Readonly<{
  position: readonly [number, number, number];
  scale: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  tone?: "graphite" | "ceramic" | "silicon" | "glass";
  radius?: number;
}>;

function Slab({ position, scale, rotation = [0, 0, 0], tone = "graphite", radius = 0.12 }: SlabProps) {
  const material = tone === "ceramic" ? ceramic : tone === "silicon" ? silicon : graphite;
  return (
    <RoundedBox args={[...scale]} position={position} rotation={rotation} radius={radius} smoothness={3}>
      {tone === "glass" ? (
        <meshPhysicalMaterial color="#172838" roughness={0.22} metalness={0.42} transparent opacity={0.3} transmission={0.32} thickness={0.7} />
      ) : (
        <meshStandardMaterial color={material} roughness={tone === "ceramic" ? 0.72 : 0.34} metalness={tone === "ceramic" ? 0.28 : 0.82} />
      )}
    </RoundedBox>
  );
}

type PrecisionSurfaceProps = Readonly<{
  position: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  width: number;
  height: number;
  depth?: number;
  glass?: boolean;
  illuminated?: boolean;
}>;

function PrecisionSurface({
  position,
  rotation = [0, 0, 0],
  width,
  height,
  depth = 0.5,
  glass = false,
  illuminated = false
}: PrecisionSurfaceProps) {
  const cut = Math.min(width, height) * 0.12;
  const shape = useMemo(() => {
    const next = new Shape();
    next.moveTo(-width / 2 + cut, -height / 2);
    next.lineTo(width / 2 - cut * 0.35, -height / 2);
    next.lineTo(width / 2, -height / 2 + cut * 0.8);
    next.lineTo(width / 2, height / 2 - cut);
    next.lineTo(width / 2 - cut, height / 2);
    next.lineTo(-width / 2 + cut * 0.35, height / 2);
    next.lineTo(-width / 2, height / 2 - cut * 0.72);
    next.lineTo(-width / 2, -height / 2 + cut);
    next.closePath();
    return next;
  }, [cut, height, width]);
  const outline = useMemo(() => [
    [-width / 2 + cut, -height / 2, depth / 2 + 0.035],
    [width / 2 - cut * 0.35, -height / 2, depth / 2 + 0.035],
    [width / 2, -height / 2 + cut * 0.8, depth / 2 + 0.035],
    [width / 2, height / 2 - cut, depth / 2 + 0.035],
    [width / 2 - cut, height / 2, depth / 2 + 0.035],
    [-width / 2 + cut * 0.35, height / 2, depth / 2 + 0.035],
    [-width / 2, height / 2 - cut * 0.72, depth / 2 + 0.035],
    [-width / 2, -height / 2 + cut, depth / 2 + 0.035],
    [-width / 2 + cut, -height / 2, depth / 2 + 0.035]
  ] as const, [cut, depth, height, width]);

  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0, -depth / 2]}>
        <extrudeGeometry args={[shape, { depth, bevelEnabled: true, bevelSegments: 3, bevelSize: 0.08, bevelThickness: 0.08 }]} />
        {glass ? (
          <meshPhysicalMaterial color="#182b3a" roughness={0.18} metalness={0.34} transparent opacity={0.34} transmission={0.38} thickness={0.8} />
        ) : (
          <meshPhysicalMaterial color="#17232d" roughness={0.3} metalness={0.88} clearcoat={0.28} clearcoatRoughness={0.38} />
        )}
      </mesh>
      <Line points={outline} color={illuminated ? "#75e2ff" : edge} lineWidth={illuminated ? 0.72 : 0.42} transparent opacity={illuminated ? 0.68 : 0.34} />
      {illuminated ? (
        <Line
          points={[
            [-width * 0.34, -height * 0.18, depth / 2 + 0.055],
            [width * 0.1, -height * 0.18, depth / 2 + 0.055],
            [width * 0.34, -height * 0.02, depth / 2 + 0.055]
          ]}
          color="#dff8ff"
          lineWidth={0.82}
          transparent
          opacity={0.58}
        />
      ) : null}
    </group>
  );
}

type ConductorFrameProps = Readonly<{
  position: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  width: number;
  height: number;
  depth?: number;
}>;

function ConductorFrame({ position, rotation = [0, 0, 0], width, height, depth = 0.48 }: ConductorFrameProps) {
  const rail = Math.max(0.12, Math.min(width, height) * 0.035);
  return (
    <group position={position} rotation={rotation}>
      <Slab position={[0, height / 2, 0]} scale={[width, rail, depth]} tone="silicon" radius={0.06} />
      <Slab position={[0, -height / 2, 0]} scale={[width * 0.82, rail, depth]} tone="silicon" radius={0.06} />
      <Slab position={[-width / 2, 0, 0]} scale={[rail, height, depth]} tone="graphite" radius={0.06} />
      <Slab position={[width / 2, height * 0.08, 0]} scale={[rail, height * 0.84, depth]} tone="graphite" radius={0.06} />
      <Line points={[[-width / 2, -height * 0.3, depth / 2], [width * 0.08, -height * 0.3, depth / 2], [width / 2, -height * 0.08, depth / 2]]} color={signal} lineWidth={0.62} transparent opacity={0.5} />
    </group>
  );
}

type EmbeddedRailProps = Readonly<{
  position: readonly [number, number, number];
  scale: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  color?: string;
  intensity?: number;
}>;

function EmbeddedRail({ position, scale, rotation = [0, 0, 0], color = signal, intensity = 1.35 }: EmbeddedRailProps) {
  return (
    <mesh position={position} rotation={rotation}>
      <boxGeometry args={[...scale]} />
      <meshStandardMaterial
        color="#102734"
        emissive={color}
        emissiveIntensity={intensity}
        metalness={0.7}
        roughness={0.3}
      />
    </mesh>
  );
}

type ComputationalBankProps = Readonly<{
  position: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  width: number;
  height: number;
  depth: number;
  bays?: number;
  activeSide?: "left" | "right";
}>;

function ComputationalBank({
  position,
  rotation = [0, 0, 0],
  width,
  height,
  depth,
  bays = 6,
  activeSide = "right"
}: ComputationalBankProps) {
  const bayWidth = width / bays;

  return (
    <group position={position} rotation={rotation}>
      <Slab position={[0, 0, 0]} scale={[width, height, depth]} tone="ceramic" radius={0.18} />
      <Slab position={[activeSide === "right" ? width * 0.46 : -width * 0.46, 0, depth * 0.08]} scale={[0.16, height * 0.94, depth * 1.08]} tone="silicon" radius={0.04} />
      {Array.from({ length: bays }, (_, index) => {
        const x = -width / 2 + bayWidth * (index + 0.5);
        const railActive = index % 3 === 1;
        return (
          <group key={index} position={[x, 0, depth / 2 + 0.04]}>
            <Slab position={[0, 0, 0]} scale={[bayWidth * 0.72, height * 0.86, 0.13]} tone={index % 2 ? "silicon" : "graphite"} radius={0.04} />
            <EmbeddedRail position={[0, height * 0.2, 0.09]} scale={[bayWidth * 0.42, 0.035, 0.035]} color={railActive ? "#dff8ff" : signal} intensity={railActive ? 1.75 : 0.88} />
            <EmbeddedRail position={[0, -height * 0.24, 0.09]} scale={[bayWidth * 0.26, 0.025, 0.025]} color="#367b9b" intensity={0.52} />
          </group>
        );
      })}
    </group>
  );
}

type RecessedChannelDeckProps = Readonly<{
  position: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  width: number;
  depth: number;
  lanes?: number;
}>;

function RecessedChannelDeck({ position, rotation = [0, 0, 0], width, depth, lanes = 5 }: RecessedChannelDeckProps) {
  return (
    <group position={position} rotation={rotation}>
      <Slab position={[0, 0, 0]} scale={[width, 0.62, depth]} tone="graphite" radius={0.16} />
      <Slab position={[0, 0.34, 0]} scale={[width * 0.9, 0.07, depth * 0.86]} tone="glass" radius={0.04} />
      {Array.from({ length: lanes }, (_, index) => {
        const x = ((index + 1) / (lanes + 1) - 0.5) * width * 0.84;
        return (
          <EmbeddedRail
            key={index}
            position={[x, 0.4, 0]}
            scale={[index === Math.floor(lanes / 2) ? 0.055 : 0.035, 0.035, depth * 0.78]}
            color={index === Math.floor(lanes / 2) ? "#dff8ff" : signal}
            intensity={index === Math.floor(lanes / 2) ? 1.5 : 0.72}
          />
        );
      })}
    </group>
  );
}

type ArchitecturalBridgeProps = Readonly<{
  position: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  width: number;
  height: number;
  depth: number;
}>;

function ArchitecturalBridge({ position, rotation = [0, 0, 0], width, height, depth }: ArchitecturalBridgeProps) {
  return (
    <group position={position} rotation={rotation}>
      <Slab position={[0, height / 2, 0]} scale={[width, 0.62, depth]} tone="silicon" radius={0.12} />
      <Slab position={[-width / 2, 0, 0]} scale={[0.58, height, depth]} tone="ceramic" radius={0.1} />
      <Slab position={[width / 2, 0, 0]} scale={[0.58, height, depth]} tone="ceramic" radius={0.1} />
      <EmbeddedRail position={[0, height / 2 - 0.35, depth / 2 + 0.035]} scale={[width * 0.74, 0.045, 0.04]} color="#c9f5ff" intensity={1.15} />
      <Line
        points={[
          [-width * 0.36, -height * 0.28, depth / 2 + 0.05],
          [0, -height * 0.12, depth / 2 + 0.05],
          [width * 0.36, -height * 0.28, depth / 2 + 0.05]
        ]}
        color="#4db6d8"
        lineWidth={0.5}
        transparent
        opacity={0.4}
      />
    </group>
  );
}

type SuspendedPlaneArrayProps = Readonly<{
  position: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  width: number;
  height: number;
  count?: number;
}>;

function SuspendedPlaneArray({ position, rotation = [0, 0, 0], width, height, count = 3 }: SuspendedPlaneArrayProps) {
  return (
    <group position={position} rotation={rotation}>
      {Array.from({ length: count }, (_, index) => {
        const centered = index - (count - 1) / 2;
        return (
          <PrecisionSurface
            key={index}
            position={[centered * width * 0.2, centered * height * 0.08, centered * -1.1]}
            rotation={[0, centered * -0.035, centered * 0.018]}
            width={width}
            height={height}
            depth={0.18}
            glass
            illuminated={index === Math.floor(count / 2)}
          />
        );
      })}
    </group>
  );
}

function SignalCorridor({
  position,
  mirrored = false,
  dense = false
}: {
  position: readonly [number, number, number];
  mirrored?: boolean;
  dense?: boolean;
}) {
  const direction = mirrored ? -1 : 1;
  return (
    <group position={position}>
      <SignalBundle
        points={[
          [-8 * direction, -2.2, 5],
          [-4.2 * direction, -1.3, 1],
          [-0.6 * direction, -0.4, -4],
          [5.8 * direction, 0.7, -13]
        ]}
        phase={mirrored ? 0.37 : 0.13}
        count={dense ? 5 : 3}
      />
      <SignalBundle
        points={[
          [-7.2 * direction, 2.8, 3],
          [-3.4 * direction, 1.6, -1],
          [0.4 * direction, 0.7, -5],
          [6.6 * direction, -0.5, -15]
        ]}
        phase={mirrored ? 0.77 : 0.53}
        count={dense ? 4 : 2}
      />
    </group>
  );
}

function SignalBundle({ points, phase = 0, count = 3 }: { points: readonly (readonly [number, number, number])[]; phase?: number; count?: number }) {
  const curve = useMemo(() => new CatmullRomCurve3(points.map((point) => new Vector3(...point))), [points]);
  const pulse = useRef<Mesh>(null);
  const filaments = useMemo(() => Array.from({ length: count }, (_, index) => {
    const offset = (index - (count - 1) / 2) * 0.075;
    return curve.getPoints(72).map((point) => new Vector3(point.x, point.y + offset, point.z));
  }), [count, curve]);

  useFrame(({ clock }) => {
    if (!pulse.current) return;
    const progress = (clock.elapsedTime * 0.075 + phase) % 1;
    curve.getPointAt(progress, pulse.current.position);
  });

  return (
    <group>
      {filaments.map((path, index) => (
        <Line key={index} points={path} color={index === 1 ? "#e7f7ff" : signal} lineWidth={index === 1 ? 0.72 : 0.48} transparent opacity={0.48 - index * 0.05} />
      ))}
      <mesh ref={pulse}>
        <boxGeometry args={[0.08, 0.08, 0.42]} />
        <meshBasicMaterial color="#f3fbff" toneMapped={false} />
      </mesh>
    </group>
  );
}

function PrecisionAperture({ position, scale = 1 }: { position: readonly [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[3.8, 0.34, 8, 72]} />
        <meshStandardMaterial color="#101821" metalness={0.9} roughness={0.23} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[3.28, 0.045, 6, 72]} />
        <meshBasicMaterial color="#69dcff" transparent opacity={0.72} toneMapped={false} />
      </mesh>
      <Slab position={[-5.1, 0, 0]} scale={[3.7, 9.4, 1.1]} tone="ceramic" />
      <Slab position={[5.1, 0, 0]} scale={[3.7, 9.4, 1.1]} tone="ceramic" />
    </group>
  );
}

function HeroArchitecture({ quality }: { quality: SpatialQualityTier }) {
  return (
    <group>
      <Slab position={[6.7, 0.4, -3]} scale={[6.8, 10.5, 1.8]} rotation={[0.04, -0.18, -0.03]} tone="ceramic" radius={0.26} />
      <Slab position={[3.4, -3.8, -0.6]} scale={[11.4, 1.05, 3.7]} rotation={[0, -0.12, 0]} tone="graphite" />
      <Slab position={[-7.5, 3.7, -8]} scale={[5.8, 2.1, 12]} rotation={[0.12, 0.27, -0.08]} tone="silicon" radius={0.2} />
      <Slab position={[0, 4.8, -11]} scale={[14, 0.65, 8]} rotation={[0.02, 0, -0.04]} tone="graphite" />
      <Slab position={[5.2, 0.1, -1.7]} scale={[0.08, 8.4, 1.9]} tone="glass" />
      <RecessedChannelDeck position={[0.8, -4.3, -9.5]} rotation={[0.01, -0.03, 0]} width={18} depth={17} lanes={quality === "full" ? 7 : 4} />
      <ComputationalBank position={[-8.4, -0.4, -12.8]} rotation={[0.02, 0.24, -0.035]} width={5.6} height={9.5} depth={1.25} bays={quality === "full" ? 7 : 4} activeSide="right" />
      <ArchitecturalBridge position={[0, 1.4, -17.8]} rotation={[0.02, 0, -0.025]} width={19} height={9.2} depth={1.3} />
      <PrecisionSurface position={[5.1, 0.45, -1.45]} rotation={[0.04, -0.18, -0.03]} width={4.8} height={7.8} depth={0.42} illuminated />
      <ConductorFrame position={[-6.8, 1.3, -8.2]} rotation={[0.04, 0.24, -0.05]} width={5.2} height={7.2} depth={0.5} />
      <SignalBundle points={[[-4, -2.8, 2], [-1, -2.5, -2], [3.8, -1.6, -5], [7.2, 0.2, -12]]} phase={0.12} count={4} />
      <SignalCorridor position={[0, 0.8, -8]} dense={quality === "full"} />
      {quality === "full" ? (
        <SuspendedPlaneArray position={[8.1, 1.8, -13.5]} rotation={[0.03, -0.23, -0.02]} width={3.4} height={6.8} count={3} />
      ) : null}
    </group>
  );
}

function IntelligenceSystemsChamber({ quality }: { quality: SpatialQualityTier }) {
  return (
    <group position={[0, 0, -24]}>
      <Slab position={[-6.5, 1.5, 0]} scale={[2.6, 11, 2]} rotation={[0, 0.16, 0.04]} tone="silicon" />
      <Slab position={[5.8, -0.6, -2]} scale={[3.2, 8.4, 5.2]} rotation={[0.04, -0.2, -0.02]} tone="ceramic" />
      <Slab position={[0, -4.2, -1]} scale={[12.5, 0.72, 8.2]} tone="graphite" />
      <Slab position={[0.2, 3.4, -5]} scale={[8.4, 0.26, 6.2]} tone="glass" />
      <RecessedChannelDeck position={[-0.8, -4.45, -5.6]} rotation={[0, 0.04, 0]} width={17} depth={14} lanes={quality === "full" ? 6 : 4} />
      <ComputationalBank position={[-7.6, 0.3, -4.2]} rotation={[0.01, 0.2, 0.02]} width={5.2} height={10.4} depth={1.1} bays={quality === "full" ? 7 : 4} />
      <ArchitecturalBridge position={[0.4, 2.1, -10.8]} rotation={[0.025, -0.04, 0.01]} width={17.5} height={8.2} depth={1.15} />
      <PrecisionSurface position={[-3.5, 0.2, 1.25]} rotation={[0.02, 0.16, -0.04]} width={5.8} height={8.6} depth={0.52} illuminated />
      <ConductorFrame position={[4.7, 0.8, -3.6]} rotation={[-0.02, -0.2, 0.025]} width={5.5} height={7.8} />
      <SignalBundle points={[[-7, 3, 4], [-3.5, 1.5, 1], [0, 0, -2], [5.5, -0.4, -8]]} phase={0.48} count={5} />
      <SignalCorridor position={[0.5, 0.4, -4]} mirrored dense={quality === "full"} />
      <Line points={[[-5, -3.7, 3], [-1.4, -3.7, -2], [4.8, -3.7, -6]]} color="#34596d" lineWidth={0.7} transparent opacity={0.55} />
      {quality === "full" ? (
        <SuspendedPlaneArray position={[6.9, 1.2, -8.4]} rotation={[-0.02, -0.22, 0.02]} width={3.1} height={6.4} count={3} />
      ) : null}
    </group>
  );
}

function ConvergenceArchitecture({ quality }: { quality: SpatialQualityTier }) {
  return (
    <group position={[0, 0, -43]}>
      <Slab position={[-7.2, 0.8, 0]} scale={[3.8, 12, 10]} rotation={[0, 0.12, 0.03]} tone="ceramic" />
      <Slab position={[7.4, -0.5, -2]} scale={[3.6, 10, 7]} rotation={[0, -0.14, -0.04]} tone="silicon" />
      <Slab position={[7.7, 0.2, 6.2]} scale={[1.8, 10.8, 2.4]} rotation={[0.02, -0.18, -0.035]} tone="graphite" radius={0.16} />
      <RecessedChannelDeck position={[0, -4.5, -4.8]} width={18} depth={16} lanes={quality === "full" ? 7 : 4} />
      <ArchitecturalBridge position={[0, 1.1, 4.8]} rotation={[0, 0.02, 0]} width={18} height={10.4} depth={1.15} />
      <PrecisionSurface position={[-3.7, 0.4, -2]} rotation={[0.01, 0.18, 0.035]} width={4.4} height={8.8} depth={0.48} glass />
      <PrecisionAperture position={[0, 0, -5]} scale={0.86} />
      <SignalBundle points={[[-8, 2.8, 5], [-4, 1.2, 1], [0, 0, -5], [4.5, -1.1, -11]]} phase={0.72} count={3} />
      <SignalCorridor position={[0, -0.3, -2.2]} dense={quality === "full"} />
      {quality === "full" ? (
        <ComputationalBank position={[-8.6, 0.1, -9]} rotation={[0, 0.18, 0.02]} width={4.6} height={10} depth={1.2} bays={6} activeSide="left" />
      ) : null}
    </group>
  );
}

function ExecutiveIntelligenceDock({ quality }: { quality: SpatialQualityTier }) {
  return (
    <group position={[0, 0, -64]}>
      <Slab position={[0, -3.8, 0]} scale={[15, 0.85, 10]} tone="graphite" radius={0.24} />
      <Slab position={[3.8, 0.5, -2]} scale={[8.5, 6.5, 0.5]} rotation={[0, -0.08, 0]} tone="glass" radius={0.28} />
      <Slab position={[-5.7, 0.2, -4]} scale={[2.5, 9, 4.4]} rotation={[0.04, 0.2, -0.03]} tone="silicon" />
      <Slab position={[4, 3.9, -3]} scale={[9.8, 0.38, 2.8]} tone="ceramic" />
      <RecessedChannelDeck position={[0, -4.25, -5]} width={19} depth={16} lanes={quality === "full" ? 7 : 4} />
      <ArchitecturalBridge position={[0, 1.2, -10.2]} width={19.5} height={9.4} depth={1.2} />
      <ConductorFrame position={[0, 0.35, -8.4]} width={11.8} height={8.8} depth={0.42} />
      <ConductorFrame position={[3.7, 0.45, -1.7]} rotation={[0, -0.08, 0]} width={8.9} height={6.9} depth={0.36} />
      <Line points={[[-0.1, -2.7, 1], [2.5, -2.7, -1], [7.9, -2.7, -4]]} color={signal} lineWidth={0.9} transparent opacity={0.62} />
      <SignalBundle points={[[-8, -1.5, 5], [-3, -1, 1], [0.8, -0.8, -2], [7, -0.6, -7]]} phase={0.26} count={4} />
      <SignalCorridor position={[0, 0.6, -5]} mirrored dense={quality === "full"} />
      {quality === "full" ? (
        <>
          <SuspendedPlaneArray position={[7.5, 0.8, -8]} rotation={[0, -0.18, 0]} width={3.6} height={6.8} count={3} />
          <ComputationalBank position={[-7.7, 0, -10]} rotation={[0, 0.16, 0]} width={4.8} height={9.6} depth={1.2} bays={6} />
        </>
      ) : null}
    </group>
  );
}

function DecisionCorridor({ quality }: { quality: SpatialQualityTier }) {
  return (
    <group position={[0, 0, -74]}>
      <ArchitecturalBridge position={[-0.8, 1.2, 2.5]} rotation={[0.02, 0.03, -0.02]} width={17} height={9.8} depth={1.4} />
      <RecessedChannelDeck position={[0, -4.4, -2.8]} rotation={[0, -0.04, 0]} width={17.5} depth={15} lanes={quality === "full" ? 6 : 4} />
      <ComputationalBank position={[-7.3, 0.2, -3.8]} rotation={[0.01, 0.18, 0.015]} width={4.7} height={9.8} depth={1.15} bays={quality === "full" ? 6 : 4} />
      <PrecisionSurface position={[6.8, 0.5, -2]} rotation={[0.02, -0.18, -0.025]} width={4.1} height={8.2} depth={0.4} illuminated />
      <SignalCorridor position={[0.3, 0.2, -2]} dense={quality === "full"} />
      {quality === "full" ? (
        <SuspendedPlaneArray position={[4.2, 2.1, -8.5]} rotation={[0.04, -0.08, 0.04]} width={4.2} height={5.8} count={3} />
      ) : null}
    </group>
  );
}

function EvidenceArchitecture({ quality }: { quality: SpatialQualityTier }) {
  return (
    <group position={[0, 0, -83]}>
      <Slab position={[-3.4, 0.3, 0]} scale={[5.8, 7.8, 0.38]} rotation={[0, 0.1, 0]} tone="glass" radius={0.24} />
      <Slab position={[3.5, -0.2, -2.3]} scale={[5.8, 7.8, 0.38]} rotation={[0, -0.1, 0]} tone="glass" radius={0.24} />
      <Slab position={[0, -4.2, -1]} scale={[13.5, 0.6, 7]} tone="ceramic" />
      <Slab position={[-7.3, 1, -5]} scale={[2.3, 10, 6]} rotation={[0, 0.16, 0]} tone="graphite" />
      <RecessedChannelDeck position={[0, -4.5, -6]} width={18} depth={15} lanes={quality === "full" ? 6 : 4} />
      <ComputationalBank position={[-7.8, 0, -8.4]} rotation={[0, 0.17, 0]} width={5.1} height={10.2} depth={1.35} bays={quality === "full" ? 7 : 4} activeSide="left" />
      <ComputationalBank position={[7.8, 0.2, -9.8]} rotation={[0, -0.17, 0]} width={5.1} height={10.2} depth={1.35} bays={quality === "full" ? 7 : 4} />
      <ArchitecturalBridge position={[0, 1.7, -12]} width={19} height={9.5} depth={1.4} />
      <PrecisionSurface position={[3.5, -0.2, -2]} rotation={[0, -0.1, 0]} width={5.1} height={7.1} depth={0.32} glass illuminated />
      <SignalBundle points={[[-8, 2.3, 4], [-3, 1, 0], [0, 0, -1], [5.8, -1.2, -7]]} phase={0.58} count={3} />
      <SignalCorridor position={[0, 0.6, -5]} mirrored dense={quality === "full"} />
      {quality === "full" ? (
        <SuspendedPlaneArray position={[0, 2.2, -8.8]} rotation={[0.05, 0, 0]} width={6.2} height={4.8} count={3} />
      ) : null}
    </group>
  );
}

function ClosingArchitecture({ quality }: { quality: SpatialQualityTier }) {
  return (
    <group position={[0, 0, -104]}>
      <PrecisionAperture position={[0, 0, -5]} scale={1.12} />
      <Slab position={[0, -4.8, -8]} scale={[18, 0.8, 12]} tone="graphite" />
      <Slab position={[0, 5, -10]} scale={[15, 0.5, 8]} tone="silicon" />
      <RecessedChannelDeck position={[0, -4.65, -12]} width={20} depth={20} lanes={quality === "full" ? 7 : 4} />
      <ArchitecturalBridge position={[0, 1.8, -18]} width={21} height={11.4} depth={1.2} />
      <SignalBundle points={[[-9, -3.8, 5], [-4, -2.1, 0], [0, 0, -5], [0, 0, -16]]} phase={0.05} count={5} />
      <SignalCorridor position={[0, 0.4, -10]} dense={quality === "full"} />
      {quality === "full" ? (
        <>
          <ComputationalBank position={[-9.2, 0.4, -16]} rotation={[0, 0.12, 0]} width={4.6} height={9.2} depth={1.1} bays={6} />
          <ComputationalBank position={[9.2, 0.4, -16]} rotation={[0, -0.12, 0]} width={4.6} height={9.2} depth={1.1} bays={6} activeSide="left" />
        </>
      ) : null}
    </group>
  );
}

function DeepArchitecture({ quality }: { quality: SpatialQualityTier }) {
  const specs = quality === "full"
    ? [
        [-13, 3, -13, 5, 12, 4], [12, -2, -29, 5, 9, 5], [-12, -1, -46, 5, 13, 4],
        [12, 3, -61, 5, 12, 6], [-13, 2, -78, 6, 14, 5], [12, -2, -94, 6, 12, 5],
        [-14, 1, -111, 7, 15, 6], [11, -1, -125, 7, 12, 7]
      ]
    : quality === "balanced"
      ? [[-11, 2, -16, 4, 10, 3], [10, -2, -39, 5, 9, 4], [-10, 1, -65, 5, 11, 4], [9, 0, -89, 6, 10, 5], [-9, 1, -111, 5, 10, 4], [9, 0, -128, 6, 10, 5]]
      : [[-11, 2, -16, 4, 10, 3], [10, -2, -49, 5, 9, 4], [-10, 1, -89, 5, 11, 4], [9, 0, -118, 6, 10, 5]];
  return (
    <group>
      {specs.map(([x, y, z, sx, sy, sz], index) => (
        <Slab key={`${x}-${z}`} position={[x, y, z]} scale={[sx, sy, sz]} rotation={[0.04 * (index % 2), index % 2 ? -0.18 : 0.14, 0.02]} tone={index % 3 === 0 ? "silicon" : "ceramic"} />
      ))}
      <Line points={[[-15, -4.8, -8], [-11, -4.8, -38], [-13, -4.8, -72], [-10, -4.8, -124]]} color="#1b536b" lineWidth={0.52} transparent opacity={0.42} />
      <Line points={[[15, 4.6, -12], [11, 4.6, -42], [13, 4.6, -81], [10, 4.6, -128]]} color="#2a7898" lineWidth={0.42} transparent opacity={0.36} />
    </group>
  );
}

function PublicWorld({ quality }: { quality: SpatialQualityTier }) {
  const balancedOrFull = quality === "full" || quality === "balanced";
  return (
    <>
      <color attach="background" args={[new Color("#02050a")]} />
      <fog attach="fog" args={["#02050a", 14, 92]} />
      <ambientLight intensity={0.16} color="#7798ad" />
      <hemisphereLight intensity={0.3} color="#a8d8ed" groundColor="#010308" />
      <directionalLight position={[-8, 12, 16]} intensity={2.35} color="#d8f1ff" />
      {balancedOrFull ? <directionalLight position={[11, -3, -44]} intensity={1.1} color="#327da3" /> : null}
      {balancedOrFull ? <spotLight position={[8, 8, 4]} target-position={[0, 0, -28]} intensity={110} angle={0.48} penumbra={0.86} distance={65} color="#61cfff" /> : null}
      <pointLight position={[7, 1, -8]} intensity={30} distance={27} color="#65dbff" />
      {balancedOrFull ? <pointLight position={[-7, -1, -31]} intensity={34} distance={28} color="#2f85ff" /> : null}
      <pointLight position={[5, 1, -50]} intensity={24} distance={24} color="#d9f7ff" />
      {balancedOrFull ? <pointLight position={[-5, 1, -69]} intensity={30} distance={26} color="#49bde8" /> : null}
      <pointLight position={[6, 2, -88]} intensity={28} distance={25} color="#d9f7ff" />
      {balancedOrFull ? <pointLight position={[0, 1, -113]} intensity={34} distance={30} color="#65dbff" /> : null}
      <HeroArchitecture quality={quality} />
      <IntelligenceSystemsChamber quality={quality} />
      <ConvergenceArchitecture quality={quality} />
      <ExecutiveIntelligenceDock quality={quality} />
      <DecisionCorridor quality={quality} />
      <EvidenceArchitecture quality={quality} />
      <ClosingArchitecture quality={quality} />
      <DeepArchitecture quality={quality} />
    </>
  );
}

export default function PublicSpatialCanvas() {
  const capability = useSpatialCapability();
  const [pixelProbe, setPixelProbe] = useState<CanvasPixelProbeResult>("pending");
  const [renderFailed, setRenderFailed] = useState(false);
  const handleRenderFailure = useCallback(() => setRenderFailed(true), []);

  if (!capability.ready) return null;
  if (renderFailed || !capability.available || !capability.quality) {
    return <div className="vaeroex-public-spatial-fallback" data-public-spatial-fallback={capability.reason || "unavailable"} aria-hidden="true" />;
  }

  const quality = capability.quality;
  const dpr: [number, number] = quality === "full"
    ? [1, 1.45]
    : quality === "balanced"
      ? [0.85, 1.12]
      : quality === "light"
        ? [0.65, 0.86]
        : [0.7, 0.9];
  const fallback = <div className="vaeroex-public-spatial-fallback" data-public-spatial-fallback="rendering_failure" aria-hidden="true" />;

  return (
    <PublicSpatialErrorBoundary fallback={fallback} onFailure={handleRenderFailure}>
      <div
        className="vaeroex-public-spatial-canvas"
        data-public-spatial-canvas
        data-spatial-webgl
        data-spatial-quality={quality}
        data-spatial-profile={capability.profile}
        data-canvas-pixels={pixelProbe}
        aria-hidden="true"
      >
        <Canvas
          camera={{ position: [0.4, 1.4, 15], fov: 43, near: 0.1, far: 190 }}
          dpr={dpr}
          frameloop="demand"
          gl={{ antialias: quality === "full", alpha: false, powerPreference: "high-performance" }}
          resize={{ polyfill: SpatialResizeObserver }}
          onCreated={(state) => probeRenderedCanvas(state, setPixelProbe)}
        >
          <PublicSpatialContextGuard onFailure={handleRenderFailure} />
          <PublicWorld quality={quality} />
          <JourneyCamera profile={capability.profile} reducedMotion={quality === "reduced_motion"} />
          <FrameScheduler quality={quality} />
        </Canvas>
      </div>
    </PublicSpatialErrorBoundary>
  );
}

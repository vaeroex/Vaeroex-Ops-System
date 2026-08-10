"use client";

import { Edges, Line, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { CatmullRomCurve3, Group, PointLight as ThreePointLight, Quaternion, Vector3 } from "three";
import { probeRenderedCanvas, type CanvasPixelProbeResult } from "@/components/spatial/CanvasPixelProbe";
import { GuidedWorkspaceCamera, type WorkspaceTravelState } from "@/components/spatial/GuidedWorkspaceCamera";
import { SpatialResizeObserver } from "@/components/spatial/SpatialResizeObserver";
import {
  CinematicWorldArchitecture,
  DestinationArchitecture,
  VaeroexMaterial
} from "@/components/spatial/SpatialEnvironmentAssets";
import {
  SPATIAL_DESTINATIONS,
  spatialDestinationDefinition,
  type ActiveSpatialWorkspaceDestination,
  type SpatialDestinationDefinition
} from "@/components/spatial/spatial-destinations";
import { useSpatialVisibility } from "@/components/spatial/useSpatialVisibility";
import type { SpatialQualityTier } from "@/components/spatial/useSpatialCapability";

const SIGNAL_AXIS = new Vector3(0, 0, 1);
type WorkspaceTravelRef = MutableRefObject<WorkspaceTravelState>;

function PrecisionArc({
  radius,
  rotation,
  opacity
}: {
  radius: number;
  rotation: number;
  opacity: number;
}) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, rotation]}>
      <torusGeometry args={[radius, 0.025, 8, 80, Math.PI * 1.54]} />
      <VaeroexMaterial kind="polishedSilicon" opacity={opacity} />
    </mesh>
  );
}

function OverviewAssembly({ opacity }: { opacity: number }) {
  return (
    <group position={[2.2, -0.6, 0.15]}>
      <group position={[0, 0.75, 0]}>
        <PrecisionArc radius={1.35} rotation={-0.65} opacity={opacity} />
        <PrecisionArc radius={0.98} rotation={0.42} opacity={opacity * 0.7} />
        <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.68, 64]} />
          <VaeroexMaterial kind="anodizedMetal" opacity={opacity * 0.92} />
        </mesh>
      </group>
      {[-0.72, -0.24, 0.24, 0.72].map((x, index) => (
        <RoundedBox
          key={x}
          args={[0.18, 0.28 + index * 0.16, 0.34]}
          position={[x, -0.48 + index * 0.08, 1.45]}
          radius={0.025}
          smoothness={3}
        >
          <VaeroexMaterial kind={index === 3 ? "conductive" : "polishedSilicon"} accent="#77c8b7" opacity={opacity} />
        </RoundedBox>
      ))}
    </group>
  );
}

function IntelligenceAssembly({ opacity }: { opacity: number }) {
  return (
    <group position={[0.6, -0.1, 0]} rotation={[0, -0.18, 0]}>
      {[-1.25, 0, 1.25].map((x, index) => (
        <group key={x} position={[x, index === 1 ? 0.15 : -0.18, (index - 1) * -0.48]}>
          <RoundedBox args={[0.78, index === 1 ? 2.9 : 2.15, 0.18]} radius={0.05} smoothness={4}>
            <VaeroexMaterial kind={index === 1 ? "polishedSilicon" : "smokedGlass"} opacity={opacity * (index === 1 ? 0.92 : 0.66)} />
            <Edges color={index === 1 ? "#8bd3df" : "#577681"} opacity={opacity * 0.62} transparent />
          </RoundedBox>
          <RoundedBox args={[0.48, 0.035, 0.025]} position={[0, index === 1 ? 0.88 : 0.58, 0.12]} radius={0.01} smoothness={2}>
            <meshBasicMaterial color={index === 0 ? "#c38d83" : index === 2 ? "#71b69e" : "#a5dbe3"} opacity={opacity} transparent />
          </RoundedBox>
        </group>
      ))}
      <Line points={[[-2.05, -1.25, 0.55], [0, -0.25, 0.72], [2.05, -0.8, -0.35]]} color="#79abba" lineWidth={1.05} opacity={opacity * 0.68} transparent />
    </group>
  );
}

function PerformanceAssembly({ opacity }: { opacity: number }) {
  const points = [
    [-2.15, -0.75, 0.6],
    [-1.38, -0.28, 0.35],
    [-0.62, -0.5, 0.06],
    [0.16, 0.18, -0.22],
    [0.94, -0.02, -0.5],
    [1.75, 0.82, -0.78]
  ] as const;
  return (
    <group position={[0.2, -0.15, 0]} rotation={[0, -0.08, 0]}>
      <mesh position={[0, 0.1, -0.3]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[4.8, 1.1]} />
        <VaeroexMaterial kind="smokedGlass" opacity={opacity * 0.36} />
      </mesh>
      <Line points={points} color="#9bd7df" lineWidth={2} opacity={opacity} transparent />
      {points.map((point, index) => (
        <group key={index} position={point}>
          <Line points={[[0, -1.25 - point[1], 0], [0, 0, 0]]} color="#45616d" lineWidth={0.55} opacity={opacity * 0.5} transparent />
          <RoundedBox args={[0.2, 0.2, 0.2]} radius={0.035} smoothness={3}>
            <VaeroexMaterial kind={index === points.length - 1 ? "conductive" : "polishedSilicon"} accent="#dfeff1" opacity={opacity} />
          </RoundedBox>
        </group>
      ))}
      <Line points={[[-2.3, 0.42, -1], [2.3, 0.42, -1]]} color="#aa9c73" lineWidth={0.8} opacity={opacity * 0.64} transparent />
    </group>
  );
}

function EvidenceAssembly({ opacity }: { opacity: number }) {
  return (
    <group position={[0.4, -0.05, 0]} rotation={[0, -0.22, 0]}>
      {[0, 1, 2, 3].map((index) => (
        <group key={index} position={[-0.72 + index * 0.45, -0.08 + index * 0.08, index * -0.45]} rotation={[0, 0.04 - index * 0.018, -0.04 + index * 0.025]}>
          <RoundedBox args={[1.38, 2.25, 0.1]} radius={0.055} smoothness={4}>
            <VaeroexMaterial kind={index === 0 ? "ceramic" : "smokedGlass"} opacity={opacity * (0.92 - index * 0.12)} />
            <Edges color={index === 0 ? "#aa9e78" : "#5f7982"} opacity={opacity * 0.52} transparent />
          </RoundedBox>
          {[-0.52, -0.18, 0.16, 0.5].map((y, lineIndex) => (
            <Line key={y} points={[[-0.42, y, 0.07], [lineIndex === 3 ? 0.06 : 0.42, y, 0.07]]} color="#9fa98f" lineWidth={0.5} opacity={opacity * 0.58} transparent />
          ))}
        </group>
      ))}
      <RoundedBox args={[0.1, 2.72, 0.16]} position={[-1.36, 0.06, 0.18]} radius={0.02} smoothness={3}>
        <VaeroexMaterial kind="conductive" accent="#b9ad82" opacity={opacity} />
      </RoundedBox>
    </group>
  );
}

function AnalysisAssembly({ opacity }: { opacity: number }) {
  return (
    <group position={[0, -0.05, 0]} rotation={[0, 0.16, 0]}>
      {[-1.45, -0.86, -0.27, 0.32, 0.91, 1.5].map((x, index) => (
        <group key={x} position={[x, index % 2 ? -0.16 : 0.12, -Math.abs(index - 2.5) * 0.12]}>
          <RoundedBox args={[0.27, 2.25 - Math.abs(index - 2.5) * 0.18, 0.78]} radius={0.035} smoothness={3}>
            <VaeroexMaterial kind={index === 2 || index === 3 ? "polishedSilicon" : "smokedGlass"} opacity={opacity * (index === 2 || index === 3 ? 0.9 : 0.62)} />
            <Edges color="#7590a5" opacity={opacity * 0.42} transparent />
          </RoundedBox>
          <RoundedBox args={[0.1, 0.05, 0.48]} position={[0, 0.6, 0]} radius={0.012} smoothness={2}>
            <meshBasicMaterial color="#9cb7c9" opacity={opacity * 0.74} transparent />
          </RoundedBox>
        </group>
      ))}
      <Line points={[[-2.2, -1.34, 0.45], [2.2, -1.34, 0.45]]} color="#667f92" lineWidth={0.8} opacity={opacity * 0.58} transparent />
    </group>
  );
}

function DestinationStation({
  definition,
  active,
  quality
}: {
  definition: SpatialDestinationDefinition;
  active: boolean;
  quality: SpatialQualityTier;
}) {
  const opacity = active ? 0.98 : 0;
  return (
    <group position={definition.region}>
      <DestinationArchitecture destination={definition.id} accent={definition.environment.accent} active={active} quality={quality} />
      {active && definition.id === "overview" ? <OverviewAssembly opacity={opacity} /> : null}
      {active && definition.id === "intelligence" ? <IntelligenceAssembly opacity={opacity} /> : null}
      {active && definition.id === "kpis" ? <PerformanceAssembly opacity={opacity} /> : null}
      {active && definition.id === "sources" ? <EvidenceAssembly opacity={opacity} /> : null}
      {active && definition.id === "analyses" ? <AnalysisAssembly opacity={opacity} /> : null}
    </group>
  );
}

function ComputationalFinBank({
  position,
  rotation,
  quality,
  mirror = false
}: {
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  quality: SpatialQualityTier;
  mirror?: boolean;
}) {
  const finCount = quality === "full" ? 7 : 4;
  return (
    <group position={position} rotation={rotation} scale={[mirror ? -1 : 1, 1, 1]}>
      {Array.from({ length: finCount }, (_, index) => {
        const height = 2.35 + ((index * 3) % 4) * 0.42;
        return (
          <group key={index} position={[-0.78 + index * (1.56 / Math.max(finCount - 1, 1)), -0.1 + (index % 2) * 0.08, (index % 3) * -0.13]}>
            <RoundedBox args={[0.075, height, 0.86]} radius={0.018} smoothness={2}>
              <meshStandardMaterial color={index % 3 === 1 ? "#122833" : "#09151d"} metalness={0.86} roughness={0.24} />
              <Edges color={index % 3 === 1 ? "#75a8b5" : "#38535e"} opacity={0.42} transparent />
            </RoundedBox>
            <Line
              points={[[0, -height * 0.34, 0.44], [0, height * 0.34, 0.44]]}
              color={index % 3 === 1 ? "#91d6df" : "#4b7480"}
              lineWidth={0.5}
              opacity={index % 3 === 1 ? 0.62 : 0.26}
              transparent
            />
          </group>
        );
      })}
      <RoundedBox args={[2.2, 0.16, 1.3]} position={[0, -1.62, -0.08]} radius={0.025} smoothness={2}>
        <meshStandardMaterial color="#101f27" metalness={0.9} roughness={0.22} />
        <Edges color="#63828c" opacity={0.35} transparent />
      </RoundedBox>
    </group>
  );
}

function LayeredComputeStack({
  position,
  rotation,
  quality
}: {
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  quality: SpatialQualityTier;
}) {
  const layers = quality === "full" ? 5 : 3;
  return (
    <group position={position} rotation={rotation}>
      {Array.from({ length: layers }, (_, index) => (
        <RoundedBox
          key={index}
          args={[3.4 - index * 0.18, 0.13, 1.1 + index * 0.08]}
          position={[index * 0.08, -0.72 + index * 0.34, index * -0.06]}
          radius={0.025}
          smoothness={2}
        >
          <meshStandardMaterial color={index === layers - 1 ? "#17313c" : "#0a171f"} metalness={0.88} roughness={0.2} />
          <Edges color={index === layers - 1 ? "#88cbd5" : "#425f69"} opacity={index === layers - 1 ? 0.5 : 0.28} transparent />
        </RoundedBox>
      ))}
      <Line points={[[1.45, -0.67, 0.58], [1.45, 0.68, 0.58]]} color="#9bdce3" lineWidth={0.65} opacity={0.6} transparent />
    </group>
  );
}

function DataBusPortal({
  position,
  width,
  quality
}: {
  position: readonly [number, number, number];
  width: number;
  quality: SpatialQualityTier;
}) {
  const height = quality === "full" ? 5.2 : 4.4;
  return (
    <group position={position}>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * width / 2, 0, 0]}>
          <RoundedBox args={[0.16, height, 0.5]} radius={0.025} smoothness={2}>
            <meshStandardMaterial color="#09151d" metalness={0.86} opacity={0.92} roughness={0.24} transparent />
            <Edges color="#5d828d" opacity={0.38} transparent />
          </RoundedBox>
          <Line points={[[0, -height * 0.38, 0.27], [0, height * 0.38, 0.27]]} color="#7fc5d0" lineWidth={0.5} opacity={0.42} transparent />
        </group>
      ))}
      <RoundedBox args={[width + 0.16, 0.14, 0.5]} position={[0, height / 2, 0]} radius={0.025} smoothness={2}>
        <meshStandardMaterial color="#0b1b23" metalness={0.9} roughness={0.22} />
        <Edges color="#678994" opacity={0.34} transparent />
      </RoundedBox>
      <Line points={[[-width / 2, -1.45, 0.28], [-width * 0.18, -1.45, 0.28], [-width * 0.18, -0.9, 0.28], [width / 2, -0.9, 0.28]]} color="#7bc4cf" lineWidth={0.55} opacity={0.38} transparent />
    </group>
  );
}

function ForegroundPassByStructures({ quality }: { quality: SpatialQualityTier }) {
  const finBanks = [
    { position: [-4.8, 0.12, 9.4], rotation: [0, 0.38, 0], mirror: false },
    { position: [7.1, 0.02, 7.2], rotation: [0, -0.34, 0], mirror: true },
    { position: [-10.6, -0.08, -6.4], rotation: [0, 0.26, 0], mirror: false },
    { position: [12.7, -0.12, -9.5], rotation: [0, -0.25, 0], mirror: true },
    { position: [-10.1, -0.15, -23.5], rotation: [0, 0.18, 0], mirror: false },
    { position: [10.6, -0.18, -25.5], rotation: [0, -0.18, 0], mirror: true }
  ] as const;
  const visibleBanks = quality === "full" ? finBanks : finBanks.slice(0, quality === "constrained" ? 4 : 2);

  return (
    <group>
      <DataBusPortal position={[0, 0.15, 10.8]} width={8.4} quality={quality} />
      {quality === "full" ? <DataBusPortal position={[0, -0.05, -11.8]} width={12.5} quality={quality} /> : null}
      {visibleBanks.map((bank) => (
        <ComputationalFinBank key={bank.position.join(":")} {...bank} quality={quality} />
      ))}
      <LayeredComputeStack position={[-1.7, -0.55, 4.9]} rotation={[0, 0.18, 0]} quality={quality} />
      {quality !== "reduced_motion" ? <LayeredComputeStack position={[4.2, -0.62, -13.8]} rotation={[0, -0.24, 0]} quality={quality} /> : null}
      {quality === "full" ? <LayeredComputeStack position={[-2.4, -0.68, -27.3]} rotation={[0, 0.12, 0]} quality={quality} /> : null}
    </group>
  );
}

function SignalTrace({
  points,
  accent,
  phase,
  active,
  motion,
  glow,
  travelState
}: {
  points: readonly (readonly [number, number, number])[];
  accent: string;
  phase: number;
  active: boolean;
  motion: boolean;
  glow: boolean;
  travelState: WorkspaceTravelRef;
}) {
  const signalRef = useRef<Group>(null);
  const secondarySignalRef = useRef<Group>(null);
  const curve = useMemo(() => new CatmullRomCurve3(points.map((point) => new Vector3(...point)), false, "catmullrom", 0.22), [points]);
  const tracePoints = useMemo(() => curve.getPoints(48).map((point) => [point.x, point.y, point.z] as const), [curve]);
  const filamentPaths = useMemo(() => [-0.09, 0, 0.09].map((offset) => tracePoints.map((point) => [point[0] + offset, point[1] + Math.abs(offset) * 0.35, point[2]] as const)), [tracePoints]);
  const initialPose = useMemo(() => {
    const position = curve.getPointAt(phase);
    const tangent = curve.getTangentAt(phase).normalize();
    return {
      position,
      quaternion: new Quaternion().setFromUnitVectors(SIGNAL_AXIS, tangent)
    };
  }, [curve, phase]);
  const secondaryPose = useMemo(() => {
    const progress = (phase + 0.47) % 1;
    const position = curve.getPointAt(progress);
    const tangent = curve.getTangentAt(progress).normalize();
    return {
      position,
      quaternion: new Quaternion().setFromUnitVectors(SIGNAL_AXIS, tangent)
    };
  }, [curve, phase]);

  useFrame(({ clock }) => {
    const signal = signalRef.current;
    const secondarySignal = secondarySignalRef.current;
    if (!signal || !secondarySignal || !motion) return;
    const travel = travelState.current;
    const speed = travel.active ? 0.3 + travel.intensity * 0.12 : active ? 0.1 : 0.045;
    const progress = (clock.elapsedTime * speed + phase) % 1;
    const position = curve.getPointAt(progress);
    const tangent = curve.getTangentAt(progress).normalize();
    signal.position.copy(position);
    signal.quaternion.setFromUnitVectors(SIGNAL_AXIS, tangent);
    const secondaryProgress = (progress + 0.47) % 1;
    secondarySignal.position.copy(curve.getPointAt(secondaryProgress));
    secondarySignal.quaternion.setFromUnitVectors(SIGNAL_AXIS, curve.getTangentAt(secondaryProgress).normalize());
  });

  return (
    <>
      <Line points={tracePoints} color="#08151c" lineWidth={3.2} opacity={active ? 0.74 : 0.42} transparent />
      {filamentPaths.map((filament, index) => (
        <Line
          key={index}
          points={filament}
          color={index === 1 ? accent : index === 0 ? "#dcebed" : "#527d88"}
          lineWidth={index === 1 ? 0.72 : 0.34}
          opacity={active ? (index === 1 ? 0.82 : 0.42) : (index === 1 ? 0.35 : 0.2)}
          transparent
        />
      ))}
      <group ref={signalRef} position={initialPose.position} quaternion={initialPose.quaternion}>
        <mesh>
          <capsuleGeometry args={[0.035, active ? 0.62 : 0.34, 4, 8]} />
          <meshBasicMaterial color={accent} opacity={active ? 0.9 : 0.48} transparent />
        </mesh>
        {glow ? <pointLight color={accent} distance={active ? 2.2 : 1.2} intensity={active ? 1.8 : 0.55} /> : null}
      </group>
      <group ref={secondarySignalRef} position={secondaryPose.position} quaternion={secondaryPose.quaternion}>
        <mesh>
          <capsuleGeometry args={[0.018, active ? 0.34 : 0.2, 4, 8]} />
          <meshBasicMaterial color="#e2f1f2" opacity={active ? 0.76 : 0.34} transparent />
        </mesh>
      </group>
    </>
  );
}

function TravelRimLight({
  accent,
  quality,
  travelState
}: {
  accent: string;
  quality: SpatialQualityTier;
  travelState: WorkspaceTravelRef;
}) {
  const lightRef = useRef<ThreePointLight>(null);
  const lightOffset = useRef(new Vector3());
  const { camera } = useThree();
  useFrame(() => {
    const light = lightRef.current;
    if (!light) return;
    const travel = travelState.current;
    lightOffset.current.set(travel.direction * -3.1, 2.2, 1.6);
    light.position.copy(camera.position).add(lightOffset.current);
    light.intensity = (quality === "full" ? 1.6 : 1.05) + travel.intensity * (quality === "full" ? 4.6 : 2.7);
  });
  return <pointLight ref={lightRef} color={accent} distance={quality === "full" ? 15 : 11} decay={2} />;
}

function TechnicalSubstrate({ quality }: { quality: SpatialQualityTier }) {
  const etchedPaths = useMemo(() => [
    [[-27, -1.7, 8], [-17, -1.7, 8], [-17, -1.7, -5], [-27, -1.7, -5]],
    [[27, -1.7, 6], [19, -1.7, 6], [19, -1.7, -8], [27, -1.7, -8]],
    [[-26, -1.7, -39], [-26, -1.7, -22], [-17, -1.7, -22]],
    [[27, -1.7, -40], [27, -1.7, -24], [17, -1.7, -24]],
    [[-8, -1.69, -1], [-8, -1.69, -15], [-15, -1.69, -15]],
    [[8, -1.69, -3], [8, -1.69, -18], [16, -1.69, -18]]
  ] as const, []);
  return (
    <>
      <mesh position={[0, -1.82, -13]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[62, 68, 1, 1]} />
        <meshStandardMaterial color="#03080d" metalness={0.42} roughness={0.72} />
      </mesh>
      <RoundedBox args={[0.34, 0.18, 54]} position={[0, -1.66, -13]} radius={0.035} smoothness={3}>
        <meshStandardMaterial color="#13232c" metalness={0.78} roughness={0.3} />
      </RoundedBox>
      {etchedPaths.slice(0, quality === "full" ? etchedPaths.length : 2).map((points, index) => (
        <Line key={index} points={points} color={index % 2 ? "#263e48" : "#30464d"} lineWidth={0.55} opacity={0.62} transparent />
      ))}
      {(quality === "full" ? [-25, -20, 20, 25] : [-22, 22]).map((x) => (
        <group key={x} position={[x, -0.3, -14]}>
          <RoundedBox args={[0.4, 3.4, 12.8]} radius={0.04} smoothness={3}>
            <meshStandardMaterial color="#071018" metalness={0.64} opacity={0.54} roughness={0.34} transparent />
            <Edges color="#263d48" opacity={0.22} transparent />
          </RoundedBox>
          <Line points={[[0, -1.35, 6.42], [0, 1.35, 6.42]]} color="#47616b" lineWidth={0.55} opacity={0.28} transparent />
        </group>
      ))}
    </>
  );
}

function SpatialDepthArchitecture({ quality }: { quality: SpatialQualityTier }) {
  const layers = quality === "full"
    ? [
        { z: 11.8, width: 18, height: 5.1, opacity: 0.2 },
        { z: 2.2, width: 26, height: 5.8, opacity: 0.14 },
        { z: -10.8, width: 34, height: 6.5, opacity: 0.1 },
        { z: -24.5, width: 43, height: 7.2, opacity: 0.075 },
        { z: -39.5, width: 52, height: 8, opacity: 0.05 }
      ]
    : [
        { z: 9.5, width: 20, height: 4.8, opacity: 0.14 },
        { z: -10.5, width: 31, height: 6.1, opacity: 0.08 },
        { z: -31.5, width: 45, height: 7.2, opacity: 0.05 }
      ];

  return (
    <group>
      {layers.map((layer, index) => (
        <group key={layer.z} position={[index % 2 ? 0.65 : -0.65, -0.2, layer.z]}>
          <Line
            points={[
              [-layer.width / 2, -1.45, 0],
              [-layer.width / 2, layer.height - 1.45, 0],
              [layer.width / 2, layer.height - 1.45, 0],
              [layer.width / 2, -1.45, 0]
            ]}
            color={index % 2 ? "#66828c" : "#78929b"}
            lineWidth={0.55}
            opacity={layer.opacity}
            transparent
          />
          <Line
            points={[[0, -1.45, -1.8], [0, layer.height - 1.45, -1.8]]}
            color="#8aa7ae"
            lineWidth={0.4}
            opacity={layer.opacity * 0.72}
            transparent
          />
        </group>
      ))}
    </group>
  );
}

function WorkspaceEnvironment({
  destination,
  quality,
  transitionMs,
  travelState
}: {
  destination: ActiveSpatialWorkspaceDestination;
  quality: SpatialQualityTier;
  transitionMs: number;
  travelState: WorkspaceTravelRef;
}) {
  const activeDefinition = spatialDestinationDefinition(destination);
  const signalPaths = useMemo(() => [
    {
      destination: "intelligence",
      accent: "#8fd2dd",
      points: [[0.8, -1.56, 3.4], [-5.2, -1.52, -2.2], [-10.8, -1.46, -8.5], [-15.5, -1.4, -12.1]]
    },
    {
      destination: "kpis",
      accent: "#b5dce1",
      points: [[1.2, -1.56, 3.1], [5.8, -1.52, -2.5], [11.7, -1.46, -9.2], [15.8, -1.4, -14.6]]
    },
    {
      destination: "analyses",
      accent: "#91abc2",
      points: [[-15.5, -1.4, -17.2], [-16.2, -1.44, -23], [-13.8, -1.4, -29.4]]
    },
    {
      destination: "sources",
      accent: "#beb186",
      points: [[15.8, -1.4, -20.2], [14.2, -1.44, -26.1], [7.1, -1.4, -31.5]]
    },
    {
      destination: "analyses",
      accent: "#88c6d0",
      points: [[-10.2, -1.4, -32.1], [-3.4, -1.44, -34.8], [4.1, -1.4, -34]]
    },
    {
      destination: "overview",
      accent: "#a7e0e6",
      points: [[0, -1.56, 5.2], [0.2, -1.5, -7], [-0.2, -1.43, -21], [0, -1.38, -39]]
    }
  ] as const, []);
  const destinationConvergence = useMemo(() => [
    [0, -0.8, 4.8],
    [activeDefinition.region[0] * 0.28, -0.48, activeDefinition.region[2] * 0.36],
    [activeDefinition.region[0] * 0.68, -0.1, activeDefinition.region[2] * 0.74],
    [activeDefinition.region[0], 0.18, activeDefinition.region[2] + 1.9]
  ] as const, [activeDefinition]);

  return (
    <>
      <color attach="background" args={["#060b10"]} />
      <fog attach="fog" args={["#071017", 22, 88]} />
      <ambientLight intensity={quality === "full" ? 0.24 : 0.34} />
      <hemisphereLight args={["#b7d2d8", "#020406", quality === "full" ? 0.48 : 0.58]} />
      <directionalLight castShadow={quality === "full"} color="#dbe8ea" intensity={quality === "full" ? 1.65 : 1.3} position={[9, 14, 12]} shadow-bias={-0.0002} shadow-mapSize-height={1024} shadow-mapSize-width={1024} />
      <rectAreaLight color="#b8e1e6" intensity={quality === "full" ? 7.2 : 4.6} width={16} height={8} position={[0, 5.8, 13]} />
      <rectAreaLight color="#698895" intensity={quality === "full" ? 4.8 : 3.1} width={12} height={10} position={[-12, 3.5, 3]} rotation={[0, -0.55, 0]} />
      <rectAreaLight
        color={activeDefinition.environment.accent}
        intensity={quality === "full" ? 9.5 : 6}
        width={11}
        height={7}
        position={[activeDefinition.region[0], 4.2, activeDefinition.region[2] + 6.8]}
      />
      <spotLight angle={0.7} color="#d8ebed" decay={1.8} distance={58} intensity={quality === "full" ? 22 : 13} penumbra={0.94} position={[11, 12, 14]} />
      <pointLight color={activeDefinition.environment.accent} decay={1.7} distance={27} intensity={quality === "full" ? 12 : 7.4} position={[activeDefinition.region[0] + 1.4, 4.2, activeDefinition.region[2] + 4.8]} />
      <pointLight color="#dceef0" decay={2} distance={19} intensity={quality === "full" ? 3.8 : 2.1} position={[-6, 5.5, 5]} />
      <TravelRimLight accent={activeDefinition.environment.accent} quality={quality} travelState={travelState} />
      <CinematicWorldArchitecture quality={quality} />
      <TechnicalSubstrate quality={quality} />
      <SpatialDepthArchitecture quality={quality} />
      <ForegroundPassByStructures quality={quality} />
      {SPATIAL_DESTINATIONS.map((definition) => (
        <DestinationStation key={definition.id} definition={definition} active={definition.id === destination} quality={quality} />
      ))}
      {signalPaths.slice(0, quality === "full" ? signalPaths.length : quality === "constrained" ? 4 : 3).map((path, index) => (
        <SignalTrace
          key={index}
          points={path.points}
          accent={path.accent}
          phase={(index * 0.17 + activeDefinition.environment.signalPhase) % 1}
          active={path.destination === destination}
          glow={quality === "full"}
          motion={quality !== "reduced_motion"}
          travelState={travelState}
        />
      ))}
      <SignalTrace
        points={destinationConvergence}
        accent={activeDefinition.environment.accent}
        phase={activeDefinition.environment.signalPhase}
        active
        glow={quality === "full"}
        motion={quality !== "reduced_motion"}
        travelState={travelState}
      />
      <GuidedWorkspaceCamera destination={destination} quality={quality} transitionMs={transitionMs} travelState={travelState} />
    </>
  );
}

function SpatialFrameScheduler({
  quality,
  visible
}: {
  quality: SpatialQualityTier;
  visible: boolean;
}) {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    invalidate();
    if (!visible || quality === "reduced_motion") return;
    const interval = window.setInterval(
      () => {
        if (document.visibilityState !== "hidden") invalidate();
      },
      quality === "full" ? 34 : 66
    );
    return () => window.clearInterval(interval);
  }, [invalidate, quality, visible]);

  return null;
}

export default function SpatialWorkspaceCanvas({
  destination,
  onReady,
  quality,
  transitionMs
}: {
  destination: ActiveSpatialWorkspaceDestination;
  onReady: () => void;
  quality: SpatialQualityTier;
  transitionMs: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const visible = useSpatialVisibility(hostRef);
  const definition = spatialDestinationDefinition(destination);
  const travelState = useRef<WorkspaceTravelState>({ active: false, progress: 1, intensity: 0, direction: 0 });
  const [pixelProbe, setPixelProbe] = useState<CanvasPixelProbeResult>("pending");
  const dpr: [number, number] = quality === "full" ? [1, 1.35] : quality === "constrained" ? [1, 1.1] : [1, 1.15];

  return (
    <div
      className="vaeroex-workspace-canvas"
      data-spatial-webgl="workspace"
      data-spatial-visible={visible}
      data-canvas-pixels={pixelProbe}
      ref={hostRef}
    >
      <Canvas
        aria-hidden="true"
        camera={{ fov: definition.camera.fov, near: 0.1, far: 110, position: definition.camera.position }}
        dpr={dpr}
        frameloop={visible ? "demand" : "never"}
        gl={{ antialias: quality === "full", alpha: false, powerPreference: quality === "full" ? "high-performance" : "default" }}
        onCreated={(state) => probeRenderedCanvas(state, (result) => {
          setPixelProbe(result);
          if (result === "nonblank") onReady();
        })}
        resize={{ polyfill: SpatialResizeObserver }}
        shadows={quality === "full" ? "basic" : false}
      >
        <WorkspaceEnvironment destination={destination} quality={quality} transitionMs={transitionMs} travelState={travelState} />
        <SpatialFrameScheduler quality={quality} visible={visible} />
      </Canvas>
    </div>
  );
}

"use client";

import { Edges, Line, RoundedBox } from "@react-three/drei";
import { useLayoutEffect, useMemo, useRef } from "react";
import { DoubleSide, InstancedMesh, Object3D } from "three";
import type { ActiveSpatialWorkspaceDestination } from "@/components/spatial/spatial-destinations";
import type { SpatialQualityTier } from "@/components/spatial/useSpatialCapability";

type Vec3 = readonly [number, number, number];

export const VAEROEX_MATERIAL_LIBRARY = Object.freeze({
  anodizedMetal: { color: "#070d12", metalness: 0.92, roughness: 0.22, clearcoat: 0.32, clearcoatRoughness: 0.18 },
  satinGraphite: { color: "#111920", metalness: 0.58, roughness: 0.38, clearcoat: 0.2, clearcoatRoughness: 0.3 },
  ceramic: { color: "#171d22", metalness: 0.18, roughness: 0.52, clearcoat: 0.14, clearcoatRoughness: 0.42 },
  polishedSilicon: { color: "#314a55", metalness: 0.84, roughness: 0.16, clearcoat: 0.72, clearcoatRoughness: 0.12 },
  smokedGlass: { color: "#203944", metalness: 0.24, roughness: 0.14, clearcoat: 0.82, clearcoatRoughness: 0.08 }
});

type MaterialKind = keyof typeof VAEROEX_MATERIAL_LIBRARY | "conductive";

export function VaeroexMaterial({
  kind,
  accent = "#8fd2dd",
  opacity = 1
}: {
  kind: MaterialKind;
  accent?: string;
  opacity?: number;
}) {
  if (kind === "conductive") {
    return (
      <meshPhysicalMaterial
        clearcoat={0.52}
        clearcoatRoughness={0.15}
        color={accent}
        emissive={accent}
        emissiveIntensity={0.42}
        metalness={0.7}
        opacity={opacity}
        roughness={0.2}
        transparent={opacity < 1}
      />
    );
  }

  const material = VAEROEX_MATERIAL_LIBRARY[kind];
  const glass = kind === "smokedGlass";
  return (
    <meshPhysicalMaterial
      {...material}
      depthWrite={!glass}
      opacity={glass ? Math.min(opacity, 0.28) : opacity}
      side={glass ? DoubleSide : undefined}
      transparent={glass || opacity < 1}
    />
  );
}

export function ArchitecturalFrame({
  position,
  rotation = [0, 0, 0],
  width,
  height,
  depth = 0.72,
  accent,
  opacity = 1
}: {
  position: Vec3;
  rotation?: Vec3;
  width: number;
  height: number;
  depth?: number;
  accent: string;
  opacity?: number;
}) {
  const beam = Math.max(0.22, width * 0.032);
  return (
    <group position={position} rotation={rotation}>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * width / 2, 0, 0]}>
          <RoundedBox args={[beam, height, depth]} radius={beam * 0.18} smoothness={3}>
            <VaeroexMaterial kind="anodizedMetal" opacity={opacity} />
            <Edges color="#6f8b94" opacity={opacity * 0.48} transparent />
          </RoundedBox>
          <RoundedBox args={[0.035, height * 0.78, depth + 0.04]} position={[-side * beam * 0.58, -0.12, 0.02]} radius={0.01} smoothness={2}>
            <VaeroexMaterial kind="conductive" accent={accent} opacity={opacity * 0.72} />
          </RoundedBox>
        </group>
      ))}
      <RoundedBox args={[width + beam, beam, depth]} position={[0, height / 2, 0]} radius={beam * 0.18} smoothness={3}>
        <VaeroexMaterial kind="satinGraphite" opacity={opacity} />
        <Edges color="#7f969d" opacity={opacity * 0.42} transparent />
      </RoundedBox>
      <RoundedBox args={[width * 0.34, 0.055, depth + 0.06]} position={[width * 0.22, height / 2 - beam * 0.72, 0.02]} radius={0.015} smoothness={2}>
        <VaeroexMaterial kind="conductive" accent={accent} opacity={opacity * 0.9} />
      </RoundedBox>
    </group>
  );
}

export function ComputationalWall({
  position,
  rotation = [0, 0, 0],
  size,
  accent,
  opacity = 1,
  quality
}: {
  position: Vec3;
  rotation?: Vec3;
  size: Vec3;
  accent: string;
  opacity?: number;
  quality: SpatialQualityTier;
}) {
  const [width, height, depth] = size;
  const channels = quality === "full" ? [-0.34, -0.08, 0.24] : [-0.24, 0.2];
  return (
    <group position={position} rotation={rotation}>
      <RoundedBox args={[width, height, depth]} radius={0.18} smoothness={5} castShadow receiveShadow>
        <VaeroexMaterial kind="anodizedMetal" opacity={opacity} />
        <Edges color="#5d747c" opacity={opacity * 0.38} transparent />
      </RoundedBox>
      <RoundedBox args={[width * 0.86, height * 0.78, 0.09]} position={[0, 0.04, depth / 2 + 0.07]} radius={0.1} smoothness={4}>
        <VaeroexMaterial kind="smokedGlass" opacity={opacity * 0.72} />
        <Edges color={accent} opacity={opacity * 0.24} transparent />
      </RoundedBox>
      {channels.map((ratio, index) => (
        <group key={ratio} position={[ratio * width, 0, depth / 2 + 0.13]}>
          <RoundedBox args={[width * 0.12, height * (0.46 + index * 0.08), 0.12]} radius={0.035} smoothness={3}>
            <VaeroexMaterial kind={index === 1 ? "polishedSilicon" : "ceramic"} opacity={opacity * 0.96} />
            <Edges color="#75919a" opacity={opacity * 0.32} transparent />
          </RoundedBox>
          <RoundedBox args={[width * 0.07, 0.035, 0.025]} position={[0, height * (0.13 - index * 0.08), 0.08]} radius={0.01} smoothness={2}>
            <VaeroexMaterial kind="conductive" accent={accent} opacity={opacity * 0.9} />
          </RoundedBox>
        </group>
      ))}
      <Line
        points={[
          [-width * 0.4, -height * 0.38, depth / 2 + 0.15],
          [-width * 0.16, -height * 0.38, depth / 2 + 0.15],
          [-width * 0.16, height * 0.34, depth / 2 + 0.15],
          [width * 0.42, height * 0.34, depth / 2 + 0.15]
        ]}
        color={accent}
        lineWidth={0.75}
        opacity={opacity * 0.55}
        transparent
      />
    </group>
  );
}

export function SiliconArray({
  position,
  rotation = [0, 0, 0],
  count = 8,
  height = 5.8,
  accent,
  opacity = 1,
  quality
}: {
  position: Vec3;
  rotation?: Vec3;
  count?: number;
  height?: number;
  accent: string;
  opacity?: number;
  quality: SpatialQualityTier;
}) {
  const visibleCount = quality === "full" ? count : Math.min(count, quality === "constrained" ? 5 : 3);
  const blades = useRef<InstancedMesh>(null);
  const transform = useMemo(() => new Object3D(), []);

  useLayoutEffect(() => {
    if (!blades.current) return;
    for (let index = 0; index < visibleCount; index += 1) {
      const heightScale = 0.72 + (index % 4) * 0.09;
      transform.position.set((index - (visibleCount - 1) / 2) * 0.52, (heightScale - 1) * height / 2, index % 2 ? -0.24 : 0);
      transform.rotation.set(0, (index - (visibleCount - 1) / 2) * -0.018, 0);
      transform.scale.set(1, heightScale, 1);
      transform.updateMatrix();
      blades.current.setMatrixAt(index, transform.matrix);
    }
    blades.current.instanceMatrix.needsUpdate = true;
  }, [height, transform, visibleCount]);

  return (
    <group position={position} rotation={rotation}>
      <instancedMesh args={[undefined, undefined, visibleCount]} ref={blades} castShadow>
        <boxGeometry args={[0.2, height, 1.08]} />
        <VaeroexMaterial kind="polishedSilicon" opacity={opacity} />
      </instancedMesh>
      <RoundedBox args={[visibleCount * 0.56, 0.22, 1.42]} position={[0, -height / 2 - 0.12, 0]} radius={0.05} smoothness={3}>
        <VaeroexMaterial kind="anodizedMetal" opacity={opacity} />
        <Edges color="#68818a" opacity={opacity * 0.42} transparent />
      </RoundedBox>
      <Line points={[[-visibleCount * 0.25, -height * 0.35, 0.57], [visibleCount * 0.25, -height * 0.35, 0.57]]} color={accent} lineWidth={0.9} opacity={opacity * 0.72} transparent />
    </group>
  );
}

export function DataConduit({
  position,
  rotation = [0, 0, 0],
  width,
  length,
  accent,
  opacity = 1,
  quality
}: {
  position: Vec3;
  rotation?: Vec3;
  width: number;
  length: number;
  accent: string;
  opacity?: number;
  quality: SpatialQualityTier;
}) {
  const filamentOffsets = quality === "full" ? [-0.3, -0.1, 0.1, 0.3] : [-0.18, 0.18];
  return (
    <group position={position} rotation={rotation}>
      <RoundedBox args={[width, 0.32, length]} radius={0.08} smoothness={4} receiveShadow>
        <VaeroexMaterial kind="satinGraphite" opacity={opacity} />
        <Edges color="#516b74" opacity={opacity * 0.34} transparent />
      </RoundedBox>
      <RoundedBox args={[width * 0.74, 0.08, length * 0.96]} position={[0, 0.2, 0]} radius={0.035} smoothness={3}>
        <VaeroexMaterial kind="smokedGlass" opacity={opacity * 0.8} />
      </RoundedBox>
      {filamentOffsets.map((offset, index) => (
        <Line
          key={offset}
          points={[[offset * width, 0.24, length * -0.47], [offset * width, 0.24, length * 0.47]]}
          color={index % 2 ? "#d8edf0" : accent}
          lineWidth={index % 2 ? 0.35 : 0.7}
          opacity={opacity * (index % 2 ? 0.34 : 0.68)}
          transparent
        />
      ))}
    </group>
  );
}

export function SignalCorridor({
  position,
  width,
  length,
  accent,
  opacity = 1,
  quality
}: {
  position: Vec3;
  width: number;
  length: number;
  accent: string;
  opacity?: number;
  quality: SpatialQualityTier;
}) {
  const thresholds = quality === "full" ? [-0.42, -0.12, 0.2, 0.46] : [-0.32, 0.32];
  return (
    <group position={position}>
      <DataConduit position={[0, -1.55, 0]} width={width * 0.48} length={length} accent={accent} quality={quality} opacity={opacity} />
      {thresholds.map((ratio, index) => (
        <ArchitecturalFrame
          key={ratio}
          position={[index % 2 ? 0.35 : -0.35, 0.4, ratio * length]}
          width={width - index * 0.42}
          height={7.4 - index * 0.34}
          depth={index === 0 ? 1.05 : 0.72}
          accent={index % 2 ? "#d6e7e9" : accent}
          opacity={opacity * (0.58 - index * 0.07)}
        />
      ))}
    </group>
  );
}

export function SuspendedComputationPlane({
  position,
  rotation = [0, 0, 0],
  size,
  accent,
  opacity = 1
}: {
  position: Vec3;
  rotation?: Vec3;
  size: readonly [number, number];
  accent: string;
  opacity?: number;
}) {
  const [width, height] = size;
  return (
    <group position={position} rotation={rotation}>
      <RoundedBox args={[width, height, 0.1]} radius={0.1} smoothness={4}>
        <VaeroexMaterial kind="smokedGlass" opacity={opacity * 0.72} />
        <Edges color="#92abb2" opacity={opacity * 0.34} transparent />
      </RoundedBox>
      <Line points={[[-width * 0.38, height * 0.28, 0.08], [width * 0.22, height * 0.28, 0.08], [width * 0.22, -height * 0.18, 0.08], [width * 0.4, -height * 0.18, 0.08]]} color={accent} lineWidth={0.65} opacity={opacity * 0.62} transparent />
      <RoundedBox args={[width * 0.32, 0.045, 0.04]} position={[-width * 0.2, -height * 0.32, 0.08]} radius={0.01} smoothness={2}>
        <VaeroexMaterial kind="conductive" accent={accent} opacity={opacity * 0.76} />
      </RoundedBox>
    </group>
  );
}

export function PrecisionAperture({
  position,
  rotation = [0, 0, 0],
  radius,
  accent,
  opacity = 1
}: {
  position: Vec3;
  rotation?: Vec3;
  radius: number;
  accent: string;
  opacity?: number;
}) {
  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <torusGeometry args={[radius, radius * 0.075, 10, 96]} />
        <VaeroexMaterial kind="anodizedMetal" opacity={opacity} />
      </mesh>
      <mesh position={[0, 0, 0.08]}>
        <torusGeometry args={[radius * 0.86, radius * 0.012, 6, 96]} />
        <VaeroexMaterial kind="conductive" accent={accent} opacity={opacity * 0.82} />
      </mesh>
      <RoundedBox args={[radius * 0.9, 0.12, 0.48]} position={[radius * 0.56, -radius * 0.68, -0.04]} rotation={[0, 0, -0.32]} radius={0.03} smoothness={3}>
        <VaeroexMaterial kind="polishedSilicon" opacity={opacity} />
      </RoundedBox>
    </group>
  );
}

export function SubstrateLayer({
  position,
  rotation = [0, 0, 0],
  size,
  accent,
  opacity = 1
}: {
  position: Vec3;
  rotation?: Vec3;
  size: Vec3;
  accent: string;
  opacity?: number;
}) {
  const [width, height, depth] = size;
  return (
    <group position={position} rotation={rotation}>
      <RoundedBox args={[width, height, depth]} radius={Math.min(0.2, height * 0.4)} smoothness={4} receiveShadow>
        <VaeroexMaterial kind="ceramic" opacity={opacity} />
        <Edges color="#556a72" opacity={opacity * 0.3} transparent />
      </RoundedBox>
      <RoundedBox args={[width * 0.72, 0.04, depth * 0.84]} position={[width * 0.08, height / 2 + 0.035, 0]} radius={0.015} smoothness={2}>
        <VaeroexMaterial kind="smokedGlass" opacity={opacity * 0.62} />
      </RoundedBox>
      <Line points={[[-width * 0.42, height / 2 + 0.07, depth * 0.32], [width * 0.34, height / 2 + 0.07, depth * 0.32]]} color={accent} lineWidth={0.62} opacity={opacity * 0.52} transparent />
    </group>
  );
}

export function MemoryStructure({
  position,
  rotation = [0, 0, 0],
  accent,
  opacity = 1,
  quality
}: {
  position: Vec3;
  rotation?: Vec3;
  accent: string;
  opacity?: number;
  quality: SpatialQualityTier;
}) {
  const shelves = quality === "full" ? 7 : 4;
  return (
    <group position={position} rotation={rotation}>
      <ArchitecturalFrame position={[0, 0, 0]} width={5.2} height={6.8} depth={0.62} accent={accent} opacity={opacity} />
      {Array.from({ length: shelves }, (_, index) => (
        <RoundedBox key={index} args={[4.2 - index * 0.12, 0.15, 1.1]} position={[index * 0.06, -2.25 + index * 0.72, -0.2 - index * 0.12]} radius={0.035} smoothness={3}>
          <VaeroexMaterial kind={index % 3 === 1 ? "polishedSilicon" : "satinGraphite"} opacity={opacity * (0.74 + index * 0.025)} />
          <Edges color="#708792" opacity={opacity * 0.3} transparent />
        </RoundedBox>
      ))}
    </group>
  );
}

export function DestinationDock({
  accent,
  active,
  quality
}: {
  accent: string;
  active: boolean;
  quality: SpatialQualityTier;
}) {
  const opacity = active ? 1 : quality === "full" ? 0.3 : 0.2;
  return (
    <group>
      <SubstrateLayer position={[0, -1.5, 0]} size={[9.4, 0.34, 7.4]} accent={accent} opacity={opacity} />
      <ArchitecturalFrame position={[0, 1, -2.5]} width={9.1} height={6.9} depth={0.72} accent={accent} opacity={opacity} />
      <SuspendedComputationPlane position={[0.3, 0.85, -2.35]} size={[7.4, 4.7]} accent={accent} opacity={active ? 0.42 : 0.12} />
      <RoundedBox args={[5.6, 0.075, 0.16]} position={[0.75, -1.25, 3]} radius={0.02} smoothness={2}>
        <VaeroexMaterial kind="conductive" accent={accent} opacity={active ? 0.82 : 0.2} />
      </RoundedBox>
    </group>
  );
}

export function DestinationArchitecture({
  destination,
  accent,
  active,
  quality
}: {
  destination: ActiveSpatialWorkspaceDestination;
  accent: string;
  active: boolean;
  quality: SpatialQualityTier;
}) {
  if (!active) {
    return (
      <group>
        <ArchitecturalFrame position={[0, 0.6, -1.8]} width={8.6} height={6.2} accent={accent} opacity={quality === "full" ? 0.28 : 0.18} />
        <RoundedBox args={[3.8, 0.055, 0.12]} position={[0.8, -1.28, 1.9]} radius={0.015} smoothness={2}>
          <VaeroexMaterial kind="conductive" accent={accent} opacity={0.18} />
        </RoundedBox>
      </group>
    );
  }

  return (
    <group>
      <DestinationDock accent={accent} active quality={quality} />
      {destination === "overview" ? (
        <>
          <PrecisionAperture position={[-3.8, 1.15, -3.35]} rotation={[0.04, 0.18, -0.08]} radius={2.25} accent={accent} opacity={0.94} />
          <ComputationalWall position={[5.35, 0.8, -4.2]} rotation={[0, -0.24, 0]} size={[5.8, 6.8, 0.9]} accent={accent} quality={quality} opacity={0.92} />
        </>
      ) : null}
      {destination === "intelligence" ? (
        <>
          <ComputationalWall position={[-5.2, 1.1, -4.2]} rotation={[0, 0.2, 0]} size={[6.2, 8.2, 1.1]} accent={accent} quality={quality} opacity={0.94} />
          <SiliconArray position={[4.7, 0.45, -3.6]} rotation={[0, -0.18, 0]} count={9} height={7.2} accent={accent} quality={quality} opacity={0.92} />
          {quality === "full" ? <SuspendedComputationPlane position={[0.8, 4.1, -4.8]} rotation={[-0.14, 0.08, 0.03]} size={[7.2, 2.6]} accent={accent} opacity={0.6} /> : null}
        </>
      ) : null}
      {destination === "kpis" ? (
        <>
          <ArchitecturalFrame position={[0.4, 0.9, -4.6]} width={12.5} height={8.2} depth={0.95} accent={accent} opacity={0.92} />
          <ArchitecturalFrame position={[0.4, 0.9, -5.2]} width={9.8} height={6.3} depth={0.56} accent="#dcecef" opacity={0.54} />
          <SiliconArray position={[-4.8, -0.2, -3.7]} rotation={[0, 0.08, Math.PI / 2]} count={7} height={4.8} accent={accent} quality={quality} opacity={0.82} />
        </>
      ) : null}
      {destination === "sources" ? (
        <>
          <SubstrateLayer position={[0, -1.88, -2.4]} size={[13.5, 0.44, 10.2]} accent={accent} opacity={0.96} />
          <SubstrateLayer position={[-1.2, -2.25, -4.6]} size={[11.2, 0.5, 8.4]} accent={accent} opacity={0.84} />
          <ComputationalWall position={[5.6, 0.3, -4.5]} rotation={[0, -0.22, 0]} size={[6.8, 7.6, 1.2]} accent={accent} quality={quality} opacity={0.94} />
          <SuspendedComputationPlane position={[-4.6, 1.2, -3.7]} rotation={[0.02, 0.2, -0.04]} size={[5.4, 6.2]} accent={accent} opacity={0.68} />
        </>
      ) : null}
      {destination === "analyses" ? (
        <>
          <MemoryStructure position={[-4.7, 0.45, -4.1]} rotation={[0, 0.16, 0]} accent={accent} quality={quality} opacity={0.9} />
          <MemoryStructure position={[4.6, 0.2, -5.2]} rotation={[0, -0.15, 0]} accent={accent} quality={quality} opacity={0.72} />
          {quality === "full" ? <SuspendedComputationPlane position={[0.4, 4, -5.5]} rotation={[-0.12, 0, 0]} size={[8.2, 2.5]} accent={accent} opacity={0.48} /> : null}
        </>
      ) : null}
    </group>
  );
}

export function CinematicWorldArchitecture({ quality }: { quality: SpatialQualityTier }) {
  const accent = "#8fd2dd";
  return (
    <group>
      <SubstrateLayer position={[0, -1.92, -13]} size={[64, 0.46, 72]} accent={accent} opacity={0.9} />
      <SignalCorridor position={[0, 0, -11]} width={11.6} length={58} accent={accent} quality={quality} opacity={0.92} />
      <ArchitecturalFrame position={[0, 0.45, 10.8]} width={12.8} height={7.8} depth={1.05} accent={accent} opacity={0.95} />
      <ComputationalWall position={[-7.8, 1.15, 5.7]} rotation={[0, 0.3, 0]} size={[8.6, 8.8, 1.3]} accent={accent} quality={quality} opacity={0.96} />
      <ComputationalWall position={[8.8, 0.75, 3.3]} rotation={[0, -0.28, 0]} size={[6.8, 7.6, 1.15]} accent="#d4e8ea" quality={quality} opacity={0.9} />
      <SiliconArray position={[-4.6, -0.1, 8.4]} rotation={[0, 0.16, 0]} count={8} height={6.6} accent={accent} quality={quality} opacity={0.88} />
      <ArchitecturalFrame position={[0, 0.25, -11.6]} width={21.5} height={9.2} depth={1.15} accent="#b7dce1" opacity={0.74} />
      <ComputationalWall position={[-13.7, 0.8, -10.2]} rotation={[0, 0.18, 0]} size={[7.2, 9.6, 1.35]} accent="#80c8d4" quality={quality} opacity={0.88} />
      <ComputationalWall position={[14.2, 0.65, -13]} rotation={[0, -0.16, 0]} size={[7.4, 8.8, 1.3]} accent="#c1d7da" quality={quality} opacity={0.86} />
      <SiliconArray position={[8.1, -0.25, -7.5]} rotation={[0, -0.16, 0]} count={9} height={6.8} accent="#cbe2e5" quality={quality} opacity={0.82} />
      {quality !== "reduced_motion" ? <SuspendedComputationPlane position={[4.8, 3.7, -3.8]} rotation={[-0.12, -0.22, 0.03]} size={[7.4, 4.4]} accent={accent} opacity={0.62} /> : null}
      {quality === "full" ? (
        <>
          <PrecisionAperture position={[-7.4, 1.1, -20.8]} rotation={[0, 0.15, 0]} radius={3.6} accent="#85cad5" opacity={0.76} />
          <DataConduit position={[8.2, -1.45, -22]} rotation={[0, 0.18, 0]} width={3.2} length={25} accent="#d4e7e9" quality={quality} opacity={0.74} />
          <ComputationalWall position={[-22, 1.4, -24]} rotation={[0, 0.12, 0]} size={[9.2, 12.8, 1.8]} accent="#6da9b4" quality={quality} opacity={0.58} />
          <ComputationalWall position={[23, 1.2, -28]} rotation={[0, -0.12, 0]} size={[9.4, 13.8, 1.8]} accent="#879ea5" quality={quality} opacity={0.52} />
        </>
      ) : null}
    </group>
  );
}

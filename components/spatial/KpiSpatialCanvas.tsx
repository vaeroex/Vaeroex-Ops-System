"use client";

import { Html, Line, RoundedBox } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import {
  BoundedSpatialCamera,
  SpatialCameraControls,
  type SpatialCameraHandle
} from "@/components/spatial/BoundedSpatialCamera";
import { probeRenderedCanvas, type CanvasPixelProbeResult } from "@/components/spatial/CanvasPixelProbe";
import { SpatialResizeObserver } from "@/components/spatial/SpatialResizeObserver";
import { useSpatialVisibility } from "@/components/spatial/useSpatialVisibility";
import type { SpatialKpiPointV1, SpatialKpiSceneModelV1 } from "@/lib/presentation/spatial-kpi";

function formatValue(value: number, unit: string | null) {
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

function ObservationMarker({
  point,
  color,
  selected,
  hovered,
  unit,
  onHover,
  onSelect
}: {
  point: SpatialKpiPointV1;
  color: string;
  selected: boolean;
  hovered: boolean;
  unit: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const depth = selected ? 0.42 : 0.08;
  return (
    <group position={[point.position[0], point.position[1], depth]}>
      <Line points={[[0, -2.72 - point.position[1], -0.22], [0, 0, -0.02]]} color="#395665" lineWidth={selected ? 0.9 : 0.45} opacity={selected ? 0.72 : 0.26} transparent />
      <RoundedBox
        args={[selected ? 0.28 : 0.21, selected ? 0.28 : 0.21, selected ? 0.16 : 0.11]}
        radius={0.055}
        smoothness={4}
        castShadow
        onClick={(event) => {
          event.stopPropagation();
          onSelect(point.id);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = "pointer";
          onHover(point.id);
        }}
        onPointerOut={() => {
          document.body.style.cursor = "default";
          onHover(null);
        }}
      >
        <meshPhysicalMaterial
          color={selected ? "#eef9fa" : color}
          emissive={selected ? color : "#000000"}
          emissiveIntensity={selected ? 0.12 : 0}
          metalness={0.76}
          roughness={0.2}
        />
      </RoundedBox>
      {selected || hovered ? (
        <Html center distanceFactor={8.5} position={[0, 0.52, 0.08]} style={{ pointerEvents: "none" }}>
          <span className="vaeroex-spatial-annotation" style={{ "--annotation-accent": color } as CSSProperties}>
            {formatValue(point.value, unit)}
          </span>
        </Html>
      ) : null}
    </group>
  );
}

function TargetLayer({ model }: { model: SpatialKpiSceneModelV1 }) {
  const target = model.target;
  if (!target) return null;
  const centerY = (target.minimumY + target.maximumY) / 2;
  const height = target.kind === "range" ? Math.max(0.16, target.maximumY - target.minimumY) : 0.055;

  return (
    <group position={[0, centerY, -0.38]}>
      <mesh>
        <planeGeometry args={[10.2, height]} />
        <meshPhysicalMaterial color="#b7a879" opacity={target.kind === "range" ? 0.11 : 0.2} side={2} transparent />
      </mesh>
      <Line points={[[-5.1, -height / 2, 0.02], [5.1, -height / 2, 0.02]]} color="#a99567" lineWidth={0.8} opacity={0.62} transparent />
      {target.kind === "range" ? (
        <Line points={[[-5.1, height / 2, 0.02], [5.1, height / 2, 0.02]]} color="#a99567" lineWidth={0.8} opacity={0.62} transparent />
      ) : null}
    </group>
  );
}

function KpiScene({
  cameraRef,
  model,
  color,
  selectedId,
  hoveredId,
  onHover,
  onSelect,
  resetKey
}: {
  cameraRef: RefObject<SpatialCameraHandle | null>;
  model: SpatialKpiSceneModelV1;
  color: string;
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  resetKey: number;
}) {
  const selected = model.points.find((point) => point.id === selectedId) || null;
  const actualLine = useMemo(() => model.points.map((point) => [point.position[0], point.position[1], 0.08] as const), [model.points]);
  const historyLine = useMemo(() => model.points.map((point) => [point.position[0], point.position[1], -0.42] as const), [model.points]);
  const selectedPosition = selected?.position || null;
  const cameraPosition = useMemo(() => selectedPosition
    ? [selectedPosition[0] * 0.14 + 1.8, selectedPosition[1] * 0.08 + 2.8, 11.4] as const
    : [2.2, 3.2, 11.8] as const, [selectedPosition]);
  const cameraTarget = useMemo(() => selectedPosition
    ? [selectedPosition[0] * 0.34, selectedPosition[1] * 0.24, 0] as const
    : [0, 0, 0] as const, [selectedPosition]);
  const cameraBounds = useMemo(() => ({
    minDistance: 7.2,
    maxDistance: 16,
    minPolarAngle: 0.72,
    maxPolarAngle: 1.78,
    minAzimuthAngle: -0.62,
    maxAzimuthAngle: 0.62,
    targetX: [-5.4, 5.4] as const,
    targetY: [-3, 3] as const
  }), []);

  return (
    <>
      <color attach="background" args={["#040a10"]} />
      <fog attach="fog" args={["#040a10", 12, 27]} />
      <hemisphereLight args={["#c1dce2", "#010307", 1.2]} />
      <directionalLight castShadow intensity={3} position={[5, 8, 8]} shadow-bias={-0.00025} shadow-mapSize-height={1024} shadow-mapSize-width={1024} />
      <pointLight color={color} distance={16} intensity={10} position={[-4, 2.5, 5]} />
      <mesh position={[0, -2.75, -0.6]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[12.4, 7.8]} />
        <meshStandardMaterial color="#03070c" metalness={0.28} roughness={0.68} />
      </mesh>
      <Line points={[[-5.1, -2.72, 0], [5.1, -2.72, 0]]} color="#66808d" lineWidth={0.9} opacity={0.72} transparent />
      <Line points={[[-5.1, -2.72, 0], [-5.1, 2.62, 0]]} color="#66808d" lineWidth={0.9} opacity={0.72} transparent />
      <TargetLayer model={model} />
      {historyLine.length > 1 ? <Line points={historyLine} color="#36505d" lineWidth={1.25} opacity={0.45} transparent /> : null}
      {actualLine.length > 1 ? <Line points={actualLine} color={color} lineWidth={2.5} opacity={0.95} transparent /> : null}
      {model.points.map((point) => (
        <ObservationMarker
          key={point.id}
          point={point}
          color={color}
          selected={point.id === selectedId}
          hovered={point.id === hoveredId}
          unit={model.unit}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
      <BoundedSpatialCamera
        ref={cameraRef}
        position={cameraPosition}
        target={cameraTarget}
        resetKey={resetKey}
        bounds={cameraBounds}
        enablePan
      />
    </>
  );
}

export default function KpiSpatialCanvas({
  model,
  color,
  selectedId,
  onSelect
}: {
  model: SpatialKpiSceneModelV1;
  color: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<SpatialCameraHandle>(null);
  const visible = useSpatialVisibility(hostRef);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pixelProbe, setPixelProbe] = useState<CanvasPixelProbeResult>("pending");
  const [resetKey, setResetKey] = useState(0);
  const selected = model.points.find((point) => point.id === selectedId) || model.points.at(-1) || null;

  return (
    <div className="vaeroex-webgl-band vaeroex-webgl-band--kpi" data-spatial-webgl="kpi" data-spatial-visible={visible} data-canvas-pixels={pixelProbe} ref={hostRef}>
      <div className="vaeroex-webgl-stage vaeroex-webgl-stage--kpi">
        <Canvas
          camera={{ fov: 40, near: 0.1, far: 65, position: [2.2, 3.2, 11.8] }}
          dpr={[1, 1.5]}
          fallback={<div className="vaeroex-webgl-fallback">3D rendering is unavailable. Return to the 2D chart.</div>}
          frameloop={visible ? "demand" : "never"}
          gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
          onCreated={(state) => probeRenderedCanvas(state, setPixelProbe)}
          resize={{ polyfill: SpatialResizeObserver }}
          shadows="basic"
        >
          <KpiScene
            cameraRef={cameraRef}
            model={model}
            color={color}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onHover={setHoveredId}
            onSelect={onSelect}
            resetKey={resetKey}
          />
        </Canvas>
        <SpatialCameraControls
          className="vaeroex-spatial-camera-controls--scene"
          onReset={() => {
            const latestPointId = model.points.at(-1)?.id;
            if (latestPointId) onSelect(latestPointId);
            setResetKey((value) => value + 1);
          }}
          onZoomIn={() => cameraRef.current?.dollyIn()}
          onZoomOut={() => cameraRef.current?.dollyOut()}
        />
        <div className="vaeroex-kpi-layer-key" aria-hidden="true">
          <span><i style={{ backgroundColor: color }} />Actual</span>
          {model.target ? <span><i className="is-target" />Authoritative target</span> : null}
        </div>
        <div className="vaeroex-kpi-focus-rail" role="listbox" aria-label="KPI observations">
          {model.points.map((point) => (
            <button
              key={point.id}
              type="button"
              role="option"
              aria-selected={point.id === selectedId}
              className={point.id === selectedId ? "is-active" : undefined}
              onClick={() => onSelect(point.id)}
            >
              <span>{new Date(point.observedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              <strong>{formatValue(point.value, model.unit)}</strong>
            </button>
          ))}
        </div>
        <aside className="vaeroex-spatial-readout vaeroex-spatial-readout--kpi" aria-live="polite">
          <p>Selected observation</p>
          <h3>{model.label}</h3>
          {selected ? (
            <>
              <strong>{formatValue(selected.value, model.unit)}</strong>
              <span>{new Date(selected.observedAt).toLocaleDateString()}</span>
            </>
          ) : <span>Select an observation to inspect its stored value.</span>}
          <small>X is observation order. Y is the stored KPI value. Depth separates visual layers only.</small>
        </aside>
      </div>
    </div>
  );
}

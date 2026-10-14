"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  ACESFilmicToneMapping,
  Object3D,
  Vector3,
  type InstancedMesh,
  type Group,
} from "three";
import { PublicSpatialContextGuard } from "@/components/spatial/PublicSpatialCanvasGuard";
import { probeRenderedCanvas } from "@/components/spatial/CanvasPixelProbe";
import { SpatialResizeObserver } from "@/components/spatial/SpatialResizeObserver";
import { StudioEnvironment } from "../clarity/ClarityEngineWorld";
import { assemblyResources } from "./AssemblyGeometry";
import { assemblyCamera, assemblyPose, clamp } from "./assemblyMotion";

type Props = {
  progress: number;
  compact: boolean;
  active: boolean;
  onReady: () => void;
  onFailure: () => void;
};
const colors = [
  "#aebdd2",
  "#7fa9c3",
  "#7593db",
  "#b9b8cb",
  "#83bcb7",
  "#8e9fe5",
];
function World({ progress, compact, active, onReady, onFailure }: Props) {
  const state = useThree(),
    { camera, invalidate, size, gl } = state;
  const bodies = useRef<(InstancedMesh | null)[]>([]),
    traces = useRef<(InstancedMesh | null)[]>([]),
    frames = useRef<(InstancedMesh | null)[]>([]);
  const beams = useRef<InstancedMesh>(null),
    nodes = useRef<InstancedMesh>(null),
    architecture = useRef<Group>(null);
  const current = useRef(progress),
    painted = useRef(false),
    samples = useRef(0),
    slow = useRef(0);
  const count = compact ? 36 : 60,
    rows = count / 6;
  const resources = useMemo(() => assemblyResources(), []);
  const scratch = useMemo(
    () => ({
      o: new Object3D(),
      a: new Vector3(),
      b: new Vector3(),
      direction: new Vector3(),
      up: new Vector3(0, 1, 0),
      positions: Array.from({ length: 60 }, () => new Vector3()),
    }),
    [],
  );
  useEffect(
    () => () => {
      resources.records.forEach((r) =>
        Object.values(r).forEach((g) => g.dispose()),
      );
      resources.beam.dispose();
      resources.node.dispose();
      resources.ring.dispose();
      resources.rib.dispose();
    },
    [resources],
  );
  useEffect(() => {
    invalidate();
  }, [progress, active, compact, size.width, size.height, invalidate]);
  useEffect(
    () =>
      probeRenderedCanvas(state, (r) =>
        r === "nonblank" ? onReady() : onFailure(),
      ),
    [state, onReady, onFailure],
  );
  useFrame((_, delta) => {
    if (!active && painted.current) return;
    // A short, bounded settling motion preserves predictable scroll reversal.
    current.current += (progress - current.current) * Math.min(1, delta * 14);
    if (Math.abs(current.current - progress) < 0.0001)
      current.current = progress;
    const p = current.current;
    const { o, positions, a, b, direction, up } = scratch;
    for (let i = 0; i < count; i++) {
      const pose = assemblyPose(i, count, p),
        family = i % 6,
        row = Math.floor(i / 6);
      positions[i].set(...pose.position);
      o.position.copy(positions[i]);
      o.rotation.set(...pose.rotation);
      o.scale.setScalar(pose.scale);
      o.updateMatrix();
      bodies.current[family]?.setMatrixAt(row, o.matrix);
      traces.current[family]?.setMatrixAt(row, o.matrix);
      frames.current[family]?.setMatrixAt(row, o.matrix);
    }
    [...bodies.current, ...traces.current, ...frames.current].forEach((m) => {
      if (m) m.instanceMatrix.needsUpdate = true;
    });
    const strength =
      clamp((p - 0.08) * 5) * (0.15 + 0.6 * Math.sin(Math.PI * p));
    let edge = 0;
    for (let i = 0; i < count; i++)
      for (let k = 0; k < 2; k++) {
        const other = k === 0 ? (i + 6) % count : (i + 1) % count;
        a.copy(positions[i]);
        b.copy(positions[other]);
        direction.subVectors(b, a);
        const length = direction.length();
        o.position.copy(a).add(b).multiplyScalar(0.5);
        o.quaternion.setFromUnitVectors(up, direction.normalize());
        o.scale.set(0.014 * strength, length, 0.014 * strength);
        o.updateMatrix();
        beams.current?.setMatrixAt(edge, o.matrix);
        const t = (p * 3 + i * 0.137) % 1;
        o.position.copy(a).lerp(b, t);
        o.rotation.set(0, 0, 0);
        o.scale.setScalar(strength * (compact ? 0.8 : 1.2));
        o.updateMatrix();
        nodes.current?.setMatrixAt(edge++, o.matrix);
      }
    if (beams.current) beams.current.instanceMatrix.needsUpdate = true;
    if (nodes.current) nodes.current.instanceMatrix.needsUpdate = true;
    if (architecture.current) {
      architecture.current.scale.setScalar(clamp((p - 0.63) / 0.37));
      architecture.current.rotation.y = (1 - p) * 1.2;
    }
    const c = assemblyCamera(p),
      aspect = size.width / Math.max(1, size.height),
      framing = Math.max(1, 0.85 / aspect);
    camera.position.set(c[0] * framing, c[1] * framing, c[2] * framing);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    const element = gl.domElement.parentElement?.parentElement;
    if (element) {
      element.dataset.assemblyProgress = p.toFixed(4);
      element.dataset.assemblyCamera = c.map((v) => v.toFixed(2)).join(",");
      element.dataset.assemblyFrames = String(++samples.current);
      element.dataset.assemblyTriangles = String(gl.info.render.triangles);
    }
    if (delta > 0.045 && samples.current > 10) slow.current++;
    else slow.current = Math.max(0, slow.current - 1);
    if (slow.current > 30) {
      state.setDpr(0.8);
      slow.current = -1000;
    }
    painted.current = true;
    if (Math.abs(p - progress) > 0.0001 && active) invalidate();
  });
  return (
    <>
      <StudioEnvironment />
      <ambientLight intensity={0.7} />
      <directionalLight
        position={[6, 10, 10]}
        intensity={3.5}
        color="#d9e5ff"
      />
      <directionalLight position={[-8, 3, -4]} intensity={4} color="#4266f0" />
      <pointLight position={[0, -4, 6]} intensity={40} color="#8cccd2" />
      {resources.records.map((r, i) => (
        <group key={i}>
          <instancedMesh
            ref={(m) => {
              bodies.current[i] = m;
            }}
            args={[r.body, undefined, rows]}
            frustumCulled={false}
          >
            <meshPhysicalMaterial
              color={i % 2 ? "#1d304b" : "#35465e"}
              metalness={0.8}
              roughness={0.27}
              clearcoat={0.6}
            />
          </instancedMesh>
          <instancedMesh
            ref={(m) => {
              traces.current[i] = m;
            }}
            args={[r.trace, undefined, rows]}
            frustumCulled={false}
          >
            <meshStandardMaterial
              color={colors[i]}
              emissive={colors[i]}
              emissiveIntensity={0.35}
              metalness={0.5}
              roughness={0.35}
            />
          </instancedMesh>
          <instancedMesh
            ref={(m) => {
              frames.current[i] = m;
            }}
            args={[r.frame, undefined, rows]}
            frustumCulled={false}
          >
            <meshStandardMaterial
              color="#a5b8da"
              metalness={0.9}
              roughness={0.22}
            />
          </instancedMesh>
        </group>
      ))}
      <instancedMesh
        ref={beams}
        args={[resources.beam, undefined, count * 2]}
        frustumCulled={false}
      >
        <meshStandardMaterial
          color="#4c79be"
          emissive="#3255b2"
          emissiveIntensity={0.25}
          metalness={0.15}
          roughness={0.35}
        />
      </instancedMesh>
      <instancedMesh
        ref={nodes}
        args={[resources.node, undefined, count * 2]}
        frustumCulled={false}
      >
        <meshBasicMaterial color="#b0d5ff" />
      </instancedMesh>
      <group ref={architecture}>
        {Array.from({ length: 7 }, (_, i) => (
          <mesh
            key={i}
            geometry={resources.ring}
            rotation={[Math.PI / 2, 0, 0]}
            position={[0, (i - 3) * 1.12, 0]}
          >
            <meshStandardMaterial
              color="#9cadca"
              metalness={0.9}
              roughness={0.25}
            />
          </mesh>
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <mesh
            key={i}
            geometry={resources.rib}
            position={[
              Math.cos((i * Math.PI) / 3) * 1.9,
              0,
              Math.sin((i * Math.PI) / 3) * 1.9,
            ]}
          >
            <meshStandardMaterial
              color="#6a8ed7"
              emissive="#2849b7"
              emissiveIntensity={0.4}
              metalness={0.8}
              roughness={0.25}
            />
          </mesh>
        ))}
        <mesh>
          <cylinderGeometry args={[0.66, 0.66, 6.8, 6, 1, true]} />
          <meshPhysicalMaterial
            color="#91bfff"
            transparent
            opacity={0.2}
            depthWrite={false}
            metalness={0.1}
            roughness={0.2}
          />
        </mesh>
        <mesh position={[0, -3.8, 0]}>
          <cylinderGeometry args={[2.6, 2.8, 0.2, 6]} />
          <meshStandardMaterial
            color="#344966"
            metalness={0.85}
            roughness={0.3}
          />
        </mesh>
      </group>
    </>
  );
}
export default function AssemblyCanvas(props: Props) {
  return (
    <Canvas
      camera={{ position: [11, 6, 19], fov: 43, near: 0.1, far: 150 }}
      dpr={props.compact ? 1 : [1, 1.5]}
      frameloop="demand"
      resize={{ polyfill: SpatialResizeObserver }}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.25;
        gl.setClearColor("#08090b", 0);
      }}
    >
      <PublicSpatialContextGuard onFailure={props.onFailure} />
      <World {...props} />
    </Canvas>
  );
}

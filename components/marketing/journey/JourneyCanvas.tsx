"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { ACESFilmicToneMapping, BoxGeometry, Object3D, Vector3, type InstancedMesh } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PublicSpatialContextGuard } from "@/components/spatial/PublicSpatialCanvasGuard";
import { probeRenderedCanvas } from "@/components/spatial/CanvasPixelProbe";
import { SpatialResizeObserver } from "@/components/spatial/SpatialResizeObserver";
import { StudioEnvironment } from "../clarity/ClarityEngineWorld";
import { recordGeometry } from "../assembly/AssemblyGeometry";
import { journeyCamera, journeyFrame, journeyPanel } from "./journeyMotion";
type Props = {
  progress: number;
  active: boolean;
  compact: boolean;
  onReady: () => void;
  onFailure: () => void;
};
const tones = ["#9cb5ff", "#9ed8cc", "#c7b3eb"];
function makeGate() {
  const parts = [
    new BoxGeometry(.14, 4.7, .24).translate(-3.65, 0, 0),
    new BoxGeometry(.14, 4.7, .24).translate(3.65, 0, 0),
    new BoxGeometry(7.4, .14, .24).translate(0, 2.35, 0),
    new BoxGeometry(7.4, .14, .24).translate(0, -2.35, 0),
  ];
  const geometry = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  return geometry;
}
function World({ progress, active, compact, onReady, onFailure }: Props) {
  const state = useThree();
  const { gl, camera, invalidate, size } = state;
  const current = useRef(progress), painted = useRef(false), frames = useRef(0);
  const panels = useRef<Array<InstancedMesh | null>>([]);
  const traces = useRef<Array<InstancedMesh | null>>([]);
  const rims = useRef<Array<InstancedMesh | null>>([]);
  const gates = useRef<InstancedMesh>(null), rails = useRef<InstancedMesh>(null), glow = useRef<InstancedMesh>(null);
  const count = compact ? 18 : 30, rows = count / 3;
  const resources = useMemo(() => ({ records: [2, 5, 0].map(recordGeometry), gate: makeGate(), beam: new BoxGeometry(1, 1, 1) }), []);
  const scratch = useMemo(() => ({
    object: new Object3D(), a: new Vector3(), b: new Vector3(), direction: new Vector3(), up: new Vector3(0, 1, 0), positions: Array.from({ length: 30 }, () => new Vector3())
  }), []);
  useEffect(() => () => {
    resources.records.forEach(record => Object.values(record).forEach(geometry => geometry.dispose()));
    resources.gate.dispose();
    resources.beam.dispose();
  }, [resources]);
  useEffect(() => {
    if (active || !painted.current)
      invalidate();
  }, [progress, active, compact, size.width, size.height, invalidate]);
  useEffect(() => probeRenderedCanvas(state, result => result === "nonblank" ? onReady() : onFailure()), [state, onReady, onFailure]);
  useFrame((_, delta) => {
    if (!active && painted.current)
      return;
    current.current += (progress - current.current) * Math.min(1, Math.max(.016, delta) * 11);
    if (Math.abs(current.current - progress) < .0001)
      current.current = progress;
    const p = current.current, { object: o, a, b, direction, up, positions } = scratch;
    for (let i = 0; i < count; i++) {
      const pose = journeyPanel(i, count, p), family = i % 3, row = Math.floor(i / 3);
      positions[i].set(...pose.position);
      o.position.copy(positions[i]);
      o.rotation.set(...pose.rotation);
      o.scale.setScalar(pose.scale);
      o.updateMatrix();
      panels.current[family]?.setMatrixAt(row, o.matrix);
      traces.current[family]?.setMatrixAt(row, o.matrix);
      rims.current[family]?.setMatrixAt(row, o.matrix);
    }
    [...panels.current, ...traces.current, ...rims.current].forEach(mesh => {
      if (mesh)
        mesh.instanceMatrix.needsUpdate = true;
    });
    const gathering = Math.min(1, p / .24);
    for (let i = 0; i < 9; i++) {
      o.position.set(...journeyFrame(i, p));
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(.75 + .25 * gathering);
      o.updateMatrix();
      gates.current?.setMatrixAt(i, o.matrix);
    }
    if (gates.current)
      gates.current.instanceMatrix.needsUpdate = true;
    // Four illuminated rails establish perspective through the central corridor;
    // each splits toward a branch as the system becomes organized.
    let edge = 0;
    const beam = (start: Vector3, end: Vector3, width: number) => {
      direction.subVectors(end, start);
      const length = direction.length();
      o.position.copy(start).add(end).multiplyScalar(.5);
      o.quaternion.setFromUnitVectors(up, direction.normalize());
      o.scale.set(width, length, width);
      o.updateMatrix();
      rails.current?.setMatrixAt(edge, o.matrix);
      o.scale.set(width * .24, length, width * .24);
      o.updateMatrix();
      glow.current?.setMatrixAt(edge++, o.matrix);
    };
    for (let i = 0; i < 8; i++)
      for (let corner = 0; corner < 4; corner++) {
        const from = journeyFrame(i, p), to = journeyFrame(i + 1, p), x = corner % 2 ? 3.58 : -3.58, y = corner < 2 ? -2.25 : 2.25;
        a.set(from[0] + x, from[1] + y, from[2]);
        b.set(to[0] + x, to[1] + y, to[2]);
        beam(a, b, .045);
      }
    for (let i = 0; i < count; i++) {
      a.copy(positions[i]);
      b.copy(positions[(i + 3) % count]);
      beam(a, b, .018 * gathering);
    }
    if (rails.current)
      rails.current.instanceMatrix.needsUpdate = true;
    if (glow.current)
      glow.current.instanceMatrix.needsUpdate = true;
    const view = journeyCamera(p, compact);
    camera.position.set(...view.position);
    camera.lookAt(...view.target);
    camera.updateProjectionMatrix();
    const node = gl.domElement;
    node.dataset.journeyFrames = String(++frames.current);
    node.dataset.journeyProgress = p.toFixed(4);
    node.dataset.journeyTriangles = String(gl.info.render.triangles);
    node.dataset.journeyCamera = view.position.map(v => v.toFixed(2)).join(",");
    node.dataset.journeyQuality = compact ? "compact" : "full";
    painted.current = true;
    if (active && current.current !== progress)
      invalidate();
  });
  return <>
    <color attach="background" args={["#080d16"]} />
    <fog attach="fog" args={["#080d16", 22, 66]} />
    <StudioEnvironment />
    <ambientLight intensity={.5} />
    <directionalLight position={[4, 8, 12]} intensity={3} color="#dce8ff" />
    <directionalLight position={[-8, 2, -8]} intensity={2.5} color="#6685ef" />
    <pointLight position={[0, 1, -16]} intensity={65} color="#a1d9d2" distance={30} />
    {resources.records.map((record, i) => <group key={i}>
      <instancedMesh
        ref={mesh => {
          panels.current[i] = mesh;
        }}
        args={[record.body, undefined, rows]}
        frustumCulled={false}
      >
        <meshStandardMaterial color="#253548" metalness={.76} roughness={.3} />
      </instancedMesh>
      <instancedMesh
        ref={mesh => {
          traces.current[i] = mesh;
        }}
        args={[record.trace, undefined, rows]}
        frustumCulled={false}
      >
        <meshStandardMaterial
          color={tones[i]}
          emissive={tones[i]}
          emissiveIntensity={.7}
          metalness={.4}
          roughness={.3}
        />
      </instancedMesh>
      <instancedMesh
        ref={mesh => {
          rims.current[i] = mesh;
        }}
        args={[record.frame, undefined, rows]}
        frustumCulled={false}
      >
        <meshStandardMaterial color={tones[i]} metalness={.85} roughness={.25} />
      </instancedMesh>
    </group>)}
    <instancedMesh ref={gates} args={[resources.gate, undefined, 9]} frustumCulled={false}>
      <meshStandardMaterial color="#657e9d" metalness={.9} roughness={.26} />
    </instancedMesh>
    <instancedMesh ref={rails} args={[resources.beam, undefined, 32 + count]} frustumCulled={false}>
      <meshStandardMaterial color="#6386ab" metalness={.75} roughness={.3} />
    </instancedMesh>
    <instancedMesh ref={glow} args={[resources.beam, undefined, 32 + count]} frustumCulled={false}>
      <meshBasicMaterial color="#98c9e4" />
    </instancedMesh>
    <mesh position={[0, -2.55, -13]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[50, 75]} />
      <meshStandardMaterial color="#070c13" metalness={.05} roughness={.95} />
    </mesh>
  </>;
}
export default function JourneyCanvas(props: Props) {
  return <Canvas
    camera={{
      position: [6, 2.8, 3], fov: 32, near: .08, far: 110
    }}
    dpr={props.compact ? 1 : [1, 1.5]}
    frameloop="demand"
    resize={{ polyfill: SpatialResizeObserver }}
    gl={{ alpha: false, antialias: !props.compact, powerPreference: "low-power" }}
    onCreated={({ gl }) => {
      gl.toneMapping = ACESFilmicToneMapping;
      gl.toneMappingExposure = 1.15;
    }}
  >
    <PublicSpatialContextGuard onFailure={props.onFailure} />
    <World {...props} />
  </Canvas>;
}

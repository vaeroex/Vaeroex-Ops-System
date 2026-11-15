"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { ACESFilmicToneMapping, Object3D, type InstancedMesh } from "three";
import { PublicSpatialContextGuard } from "@/components/spatial/PublicSpatialCanvasGuard";
import { probeRenderedCanvas } from "@/components/spatial/CanvasPixelProbe";
import { SpatialResizeObserver } from "@/components/spatial/SpatialResizeObserver";
import { StudioEnvironment } from "../clarity/ClarityEngineWorld";
import { createSculptureFinish, createSculptureGeometries } from "./SculptureGeometry";
import { createJourneyWorld, journeyAssembly, journeyCamera, journeyLens, journeyPart } from "./journeyMotion";

type Props = {
  progress: number;
  active: boolean;
  compact: boolean;
  onReady: () => void;
  onFailure: () => void;
};

const materials = [
  { color: "#263545", metalness: .88, roughness: .29 },
  { color: "#a6b5c5", metalness: .94, roughness: .25 },
  { color: "#15232e", metalness: .12, roughness: .58 },
  { color: "#a2c8ff", metalness: .2, roughness: .28, emissive: "#6a9fff", emissiveIntensity: .9 },
  { color: "#9fdacb", metalness: .3, roughness: .3, emissive: "#6fb9aa", emissiveIntensity: .55 },
  { color: "#8bb1c7", metalness: .08, roughness: .56, transparent: true, opacity: .38, depthWrite: false },
];

function World({ progress, active, compact, onReady, onFailure }: Props) {
  const state = useThree();
  const { gl, camera, invalidate, size } = state;
  const current = useRef(progress);
  const painted = useRef(false);
  const frames = useRef(0);
  const meshes = useRef<Array<InstancedMesh | null>>([]);
  const resources = useMemo(() => ({
    geometry: createSculptureGeometries(compact), finish: createSculptureFinish(), object: new Object3D(),
  }), [compact]);
  const batches = useMemo(() => {
    const { parts } = createJourneyWorld(compact);
    const keys = [...new Set(parts.map(part => part.geometry + ":" + part.material))];
    return keys.map(key => {
      const group = parts.filter(part => part.geometry + ":" + part.material === key);
      return { geometry: group[0].geometry, material: group[0].material, parts: group };
    });
  }, [compact]);

  const paint = useCallback((p: number) => {
    const object = resources.object;
    batches.forEach((batch, index) => {
      const mesh = meshes.current[index];
      if (!mesh) return;
      batch.parts.forEach((part, row) => {
        const pose = journeyPart(part, p);
        object.position.set(...pose.position);
        object.rotation.set(...pose.rotation);
        object.scale.setScalar(1);
        object.updateMatrix();
        mesh.setMatrixAt(row, object.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  }, [batches, resources]);

  useLayoutEffect(() => {
    paint(current.current);
    gl.domElement.dataset.journeyWorld = "vaeroex-folded-sculpture";
    gl.domElement.dataset.journeyInstances = String(batches.reduce((sum, batch) => sum + batch.parts.length, 0));
    invalidate();
  }, [batches, paint, gl, invalidate]);

  useEffect(() => () => {
    Object.values(resources.geometry).forEach(geometry => geometry.dispose());
    resources.finish.dispose();
  }, [resources]);

  useEffect(() => {
    if (active || !painted.current) invalidate();
  }, [progress, active, compact, size.width, size.height, invalidate]);

  useEffect(() => probeRenderedCanvas(state, result => {
    if (result === "nonblank") onReady();
    else onFailure();
  }), [state, onReady, onFailure]);

  useFrame((_, delta) => {
    if (!active && painted.current) return;
    current.current += (progress - current.current) * Math.min(1, Math.max(.016, delta) * 10);
    if (Math.abs(current.current - progress) < .00005) current.current = progress;
    paint(current.current);
    const view = journeyCamera(current.current, compact, size.width / size.height);
    camera.position.set(...view.position);
    camera.lookAt(...view.target);
    const assembly = journeyAssembly(current.current), node = gl.domElement;
    node.dataset.journeyFrames = String(++frames.current);
    node.dataset.journeyProgress = current.current.toFixed(5);
    node.dataset.journeyTriangles = String(gl.info.render.triangles);
    node.dataset.journeyDrawCalls = String(gl.info.render.calls);
    node.dataset.journeyCamera = view.position.map(value => value.toFixed(2)).join(",");
    node.dataset.journeyTarget = view.target.map(value => value.toFixed(2)).join(",");
    node.dataset.journeyQuality = compact ? "compact" : "full";
    node.dataset.journeyAssembly = JSON.stringify(assembly);
    node.dataset.journeyDocking = assembly.docking.toFixed(4);
    painted.current = true;
    if (active && current.current !== progress) invalidate();
  });

  return <>
    <color attach="background" args={["#080d16"]} />
    <fog attach="fog" args={["#080d16", 85, 210]} />
    <StudioEnvironment />
    <hemisphereLight args={["#d6e4f2", "#131e2a", .9]} />
    <directionalLight position={[-22, 36, 32]} intensity={3} color="#e0ebfa" />
    <directionalLight position={[25, 15, -32]} intensity={2.2} color="#7b9fc8" />
    <pointLight position={[0, 7, -10]} intensity={120} color="#9abfff" distance={32} />
    <pointLight position={[8, 5, -29]} intensity={95} color="#aed7cd" distance={23} />
    {batches.map((batch, index) => <instancedMesh
      key={batch.geometry + "-" + batch.material}
      ref={mesh => { meshes.current[index] = mesh; }}
      args={[resources.geometry[batch.geometry], undefined, batch.parts.length]}
      frustumCulled={false}
    >
      <meshStandardMaterial
        {...materials[batch.material]}
        roughnessMap={batch.material < 2 ? resources.finish : undefined}
      />
    </instancedMesh>)}
    <mesh position={[0, -14.5, -15]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[180, 180]} />
      <meshStandardMaterial color="#0c1521" metalness={.22} roughness={.72} />
    </mesh>
  </>;
}

export default function JourneyCanvas(props: Props) {
  return <Canvas
    camera={{ position: [-44, 21, 100], ...journeyLens(props.compact) }}
    dpr={props.compact ? 1 : [1, 1.5]}
    frameloop="demand"
    resize={{ polyfill: SpatialResizeObserver }}
    gl={{ alpha: false, antialias: !props.compact, powerPreference: "low-power" }}
    onCreated={({ gl }) => {
      gl.toneMapping = ACESFilmicToneMapping;
      gl.toneMappingExposure = 1.05;
    }}
  >
    <PublicSpatialContextGuard onFailure={props.onFailure} />
    <World {...props} />
  </Canvas>;
}

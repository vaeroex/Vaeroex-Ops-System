"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { ACESFilmicToneMapping, Object3D, PerspectiveCamera, type InstancedMesh, type PointLight } from "three";
import { PublicSpatialContextGuard } from "@/components/spatial/PublicSpatialCanvasGuard";
import { probeRenderedCanvas } from "@/components/spatial/CanvasPixelProbe";
import { SpatialResizeObserver } from "@/components/spatial/SpatialResizeObserver";
import { StudioEnvironment } from "../clarity/ClarityEngineWorld";
import { createSculptureFinish, createSculptureGeometries } from "./SculptureGeometry";
import { createJourneyWorld, journeyAssembly, journeyCamera, journeyLens, journeyPart } from "./journeyMotion";

type Props = {
  progress: number;
  finalShift?: number;
  active: boolean;
  compact: boolean;
  onReady: () => void;
  onFailure: () => void;
};

const sceneBackground = "#101e2a";

const materials = [
  { color: "#557f9f", metalness: .78, roughness: .29 },
  { color: "#00a8d6", metalness: .82, roughness: .27 },
];

function World({ progress, finalShift = 0, active, compact, onReady, onFailure }: Props) {
  const state = useThree();
  const { gl, camera, invalidate, size } = state;
  const current = useRef(progress);
  const painted = useRef(false);
  const frames = useRef(0);
  const seamLight = useRef<PointLight>(null);
  const projection = useRef<number[]>([]);
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
    if (!(camera instanceof PerspectiveCamera)) return;
    // Canvas camera options initialize its default camera; responsive lens changes
    // must also update that existing camera before the next demand-rendered frame.
    const lens = journeyLens(compact);
    camera.fov = lens.fov;
    camera.near = lens.near;
    camera.far = lens.far;
    camera.updateProjectionMatrix();
    gl.domElement.dataset.journeyFov = String(camera.fov);
    invalidate();
  }, [camera, compact, gl, invalidate]);

  useLayoutEffect(() => {
    paint(current.current);
    gl.domElement.dataset.journeyWorld = "vaeroex-logo-sculpture";
    gl.domElement.dataset.journeyInstances = String(batches.reduce((sum, batch) => sum + batch.parts.length, 0));
    invalidate();
  }, [batches, paint, gl, invalidate]);

  useEffect(() => () => {
    Object.values(resources.geometry).forEach(geometry => geometry.dispose());
    resources.finish.dispose();
  }, [resources]);

  useEffect(() => {
    if (active || !painted.current) invalidate();
  }, [progress, finalShift, active, compact, size.width, size.height, invalidate]);

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
    if (camera instanceof PerspectiveCamera) {
      const next = [size.width, size.height, view.offset[0], view.offset[1] - finalShift];
      if (next.some((value, index) => value !== projection.current[index])) {
        camera.setViewOffset(size.width, size.height, view.offset[0] * size.width,
          (view.offset[1] - finalShift) * size.height, size.width, size.height);
        projection.current = next;
      }
    }
    if (seamLight.current) seamLight.current.intensity = 30 + 30 * journeyAssembly(current.current).closure;
    const assembly = journeyAssembly(current.current), node = gl.domElement;
    node.dataset.journeyFrames = String(++frames.current);
    node.dataset.journeyProgress = current.current.toFixed(5);
    node.dataset.journeyTriangles = String(gl.info.render.triangles);
    node.dataset.journeyDrawCalls = String(gl.info.render.calls);
    node.dataset.journeyCamera = view.position.map(value => value.toFixed(2)).join(",");
    node.dataset.journeyTarget = view.target.map(value => value.toFixed(2)).join(",");
    node.dataset.journeyQuality = compact ? "compact" : "full";
    node.dataset.journeyAssembly = JSON.stringify(assembly);
    node.dataset.journeyOffset = view.offset.join(",");
    node.dataset.journeyFinalShift = finalShift.toFixed(5);
    node.dataset.journeyDocking = assembly.docking.toFixed(4);
    painted.current = true;
    if (active && current.current !== progress) invalidate();
  });

  return <>
    <color attach="background" args={[sceneBackground]} />
    <fog attach="fog" args={[sceneBackground, 150, 320]} />
    <StudioEnvironment />
    <hemisphereLight args={["#d6e4f2", "#131e2a", .9]} />
    <directionalLight position={[-22, 36, 32]} intensity={3} color="#e0ebfa" />
    <directionalLight position={[25, 15, -32]} intensity={2.2} color="#7b9fc8" />
    <pointLight ref={seamLight} position={[0, 7, 8]} intensity={30} color="#62d8ef" distance={65} />
    <pointLight position={[8, 5, -29]} intensity={80} color="#97b6d7" distance={35} />
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

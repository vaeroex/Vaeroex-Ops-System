"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { ACESFilmicToneMapping, BoxGeometry, CylinderGeometry, Object3D, TorusGeometry, type InstancedMesh } from "three";
import { PublicSpatialContextGuard } from "@/components/spatial/PublicSpatialCanvasGuard";
import { probeRenderedCanvas } from "@/components/spatial/CanvasPixelProbe";
import { SpatialResizeObserver } from "@/components/spatial/SpatialResizeObserver";
import { StudioEnvironment } from "../clarity/ClarityEngineWorld";
import { operationsDisplayGeometry } from "./OperationsGeometry";
import { createJourneyWorld, journeyCamera } from "./journeyMotion";

type Props = {
  progress: number;
  active: boolean;
  compact: boolean;
  onReady: () => void;
  onFailure: () => void;
};

const tones = ["#91b6ff", "#91d5c3", "#bba5ed"];
const materials = [
  { color: "#253343", metalness: .55, roughness: .4 },
  { color: "#8a9baa", metalness: .85, roughness: .28 },
  ...tones.map(color => ({ color, metalness: .3, roughness: .38, emissive: color, emissiveIntensity: .85 })),
  { color: "#8caebf", metalness: .15, roughness: .12, transparent: true, opacity: .16, depthWrite: false },
  { color: "#213449", metalness: .18, roughness: .76 },
  { color: "#43576c", metalness: .4, roughness: .44 },
];
const shapes = ["box", "cylinder", "ring"] as const;

function World({ progress, active, compact, onReady, onFailure }: Props) {
  const state = useThree();
  const { gl, camera, invalidate, size } = state;
  const current = useRef(progress);
  const painted = useRef(false);
  const frames = useRef(0);
  const architecture = useRef<Array<InstancedMesh | null>>([]);
  const panels = useRef<Array<InstancedMesh | null>>([]);
  const faces = useRef<Array<InstancedMesh | null>>([]);
  const traces = useRef<Array<InstancedMesh | null>>([]);
  const rims = useRef<Array<InstancedMesh | null>>([]);
  const resources = useMemo(() => ({
    records: [0, 1, 2].map(operationsDisplayGeometry),
    box: new BoxGeometry(1, 1, 1),
    cylinder: new CylinderGeometry(.5, .5, 1, 32),
    ring: new TorusGeometry(.45, .05, 6, 32).rotateX(Math.PI / 2).scale(1, 10, 1),
  }), []);
  const world = useMemo(() => {
    const fixed = createJourneyWorld(compact);
    return {
      batches: materials.flatMap((_, material) => shapes.map(shape => ({
        material, shape, blocks: fixed.blocks.filter(block => block.material === material && block.shape === shape),
      }))).filter(batch => batch.blocks.length > 0),
      panels: tones.map((_, family) => fixed.panels.filter(panel => panel.family === family)),
    };
  }, [compact]);

  // Upload the world once when its quality changes. Scroll never rebuilds or moves it.
  useLayoutEffect(() => {
    const object = new Object3D();
    world.batches.forEach(({ blocks }, index) => {
      const mesh = architecture.current[index];
      if (!mesh) return;
      blocks.forEach((block, index) => {
        object.position.set(...block.position);
        object.rotation.set(0, block.rotation, 0);
        object.scale.set(...block.size);
        object.updateMatrix();
        mesh.setMatrixAt(index, object.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
    world.panels.forEach((records, family) => {
      const meshes = [panels.current[family], faces.current[family], traces.current[family], rims.current[family]];
      records.forEach((record, index) => {
        object.position.set(...record.position);
        object.rotation.set(...record.rotation);
        object.scale.setScalar(record.scale);
        object.updateMatrix();
        meshes.forEach(mesh => mesh?.setMatrixAt(index, object.matrix));
      });
      meshes.forEach(mesh => {
        if (!mesh) return;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      });
    });
    gl.domElement.dataset.journeyWorld = "vaeroex-operations-center";
    gl.domElement.dataset.journeyInstances = String(world.batches.reduce((sum, batch) => sum + batch.blocks.length, 0));
    invalidate();
  }, [world, gl, invalidate]);

  useEffect(() => () => {
    resources.records.forEach(record => Object.values(record).forEach(geometry => geometry.dispose()));
    resources.box.dispose();
    resources.cylinder.dispose();
    resources.ring.dispose();
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
    // A finite settle tail follows input; no ambient clock or perpetual render loop.
    current.current += (progress - current.current) * Math.min(1, Math.max(.016, delta) * 10);
    if (Math.abs(current.current - progress) < .00005) current.current = progress;
    const view = journeyCamera(current.current, compact);
    camera.position.set(...view.position);
    camera.lookAt(...view.target);
    const node = gl.domElement;
    node.dataset.journeyFrames = String(++frames.current);
    node.dataset.journeyProgress = current.current.toFixed(5);
    node.dataset.journeyTriangles = String(gl.info.render.triangles);
    node.dataset.journeyDrawCalls = String(gl.info.render.calls);
    node.dataset.journeyCamera = view.position.map(value => value.toFixed(2)).join(",");
    node.dataset.journeyTarget = view.target.map(value => value.toFixed(2)).join(",");
    node.dataset.journeyQuality = compact ? "compact" : "full";
    painted.current = true;
    if (active && current.current !== progress) invalidate();
  });

  return <>
    <color attach="background" args={["#080f1b"]} />
    <fog attach="fog" args={["#080f1b", 48, 180]} />
    <StudioEnvironment />
    <hemisphereLight args={["#d4e2ef", "#17283c", 1.1]} />
    <directionalLight position={[-30, 45, 25]} intensity={2.4} color="#e5edff" />
    <directionalLight position={[35, 15, -70]} intensity={1.8} color="#718bbd" />
    <pointLight position={[10, 9, -19]} intensity={210} color={tones[0]} distance={37} />
    <pointLight position={[-9, 6.6, -42]} intensity={180} color={tones[1]} distance={30} />
    <pointLight position={[19, 10, -74]} intensity={210} color={tones[2]} distance={35} />

    {world.batches.map(({ blocks, shape, material }, index) => <instancedMesh
      key={`${material}-${shape}`}
      ref={mesh => { architecture.current[index] = mesh; }}
      args={[resources[shape], undefined, blocks.length]}
    >
      <meshStandardMaterial {...materials[material]} />
    </instancedMesh>)}

    {resources.records.map((record, family) => <group key={family}>
      <instancedMesh
        ref={mesh => { panels.current[family] = mesh; }}
        args={[record.body, undefined, world.panels[family].length]}
      >
        <meshStandardMaterial color="#667b8e" metalness={.82} roughness={.27} />
      </instancedMesh>
      <instancedMesh
        ref={mesh => { faces.current[family] = mesh; }}
        args={[record.face, undefined, world.panels[family].length]}
      >
        <meshStandardMaterial color="#102438" emissive="#122f49" emissiveIntensity={.35} metalness={.2} roughness={.36} />
      </instancedMesh>
      <instancedMesh
        ref={mesh => { traces.current[family] = mesh; }}
        args={[record.trace, undefined, world.panels[family].length]}
      >
        <meshStandardMaterial
          color={tones[family]}
          emissive={tones[family]}
          emissiveIntensity={.6}
          metalness={.25}
          roughness={.35}
        />
      </instancedMesh>
      <instancedMesh
        ref={mesh => { rims.current[family] = mesh; }}
        args={[record.frame, undefined, world.panels[family].length]}
      >
        <meshStandardMaterial color="#526c81" metalness={.35} roughness={.4} />
      </instancedMesh>
    </group>)}

    <mesh position={[0, -1.85, -40]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[180, 230]} />
      <meshStandardMaterial color="#09121e" metalness={.15} roughness={.88} />
    </mesh>
  </>;
}

export default function JourneyCanvas(props: Props) {
  return <Canvas
    camera={{ position: [-20, 12, 30], fov: props.compact ? 58 : 48, near: .12, far: 260 }}
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

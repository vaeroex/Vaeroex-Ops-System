"use client";

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type RefObject,
} from "react";
import { useThree } from "@react-three/fiber";
import {
  DoubleSide,
  Color,
  DataTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PMREMGenerator,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  Vector3,
  RepeatWrapping,
  LinearFilter,
} from "three";
import { apertureGeometry, plateGeometry } from "./clarityGeometry";
import {
  CLARITY_LAYER_COUNT,
  type ClarityMotionState,
  type ClarityPose,
} from "./clarityMotion";

export const ENGINE_BLUE = "#446dff";

type StudioCard = {
  position: [number, number, number];
  scale: [number, number];
  color: string;
  strength: number;
};
const STUDIO_CARDS: StudioCard[] = [
  { position: [-6, 1, 7], scale: [4, 7], color: "#ebeef2", strength: 3.2 },
  { position: [-4, 7, 4], scale: [9, 4], color: "#eef2ff", strength: 7 },
  { position: [7, 1, 3], scale: [2, 8], color: "#c5d1ed", strength: 4.2 },
  { position: [-6, -1, 1], scale: [2, 6], color: "#657bbd", strength: 2.6 },
  { position: [0, 2, -8], scale: [7, 2], color: "#7d95ff", strength: 3.8 },
  { position: [1, -6, 2], scale: [7, 1.5], color: "#f0e8dc", strength: 1.3 },
];

/** A local studio reflection rig; no HDR downloads or third-party image requests. */
export function StudioEnvironment() {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const studio = new Scene();
    studio.background = new Color("#252a33");
    const cards: Mesh[] = [];
    STUDIO_CARDS.forEach(({ position, scale, color, strength }) => {
      const card = new Mesh(
        new PlaneGeometry(...scale),
        new MeshBasicMaterial({
          color: new Color(color).multiplyScalar(strength),
          side: DoubleSide,
        }),
      );
      card.position.set(...position);
      card.lookAt(new Vector3());
      studio.add(card);
      cards.push(card);
    });
    const generator = new PMREMGenerator(gl);
    const environment = generator.fromScene(studio, 0, 0.1, 60);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.88;
    invalidate();
    return () => {
      scene.environment = null;
      environment.dispose();
      generator.dispose();
      cards.forEach((card) => {
        card.geometry.dispose();
        (card.material as MeshBasicMaterial).dispose();
      });
    };
  }, [gl, scene, invalidate]);
  return null;
}

function makeFinish() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const grain = (Math.sin(y * 76.131 + x * 13.177) * 13254.5453) % 1;
      const value = Math.round(204 + grain * 10);
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  const texture = new DataTexture(
    data,
    size,
    size,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(5, 28);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function useEngineParts() {
  const parts = useMemo(() => {
    const finish = makeFinish();
    const materials = {
      graphite: new MeshPhysicalMaterial({
        color: "#343b45",
        metalness: 0.86,
        roughness: 0.36,
        roughnessMap: finish,
        clearcoat: 0.22,
        clearcoatRoughness: 0.24,
      }),
      ceramic: new MeshPhysicalMaterial({
        color: "#232935",
        metalness: 0.25,
        roughness: 0.38,
        clearcoat: 0.4,
      }),
      titanium: new MeshStandardMaterial({
        color: "#979faa",
        metalness: 1,
        roughness: 0.3,
        roughnessMap: finish,
      }),
      mark: new MeshStandardMaterial({
        color: "#7d8796",
        metalness: 0.8,
        roughness: 0.42,
      }),
      milled: new MeshStandardMaterial({
        color: "#656e7e",
        metalness: 1,
        roughness: 0.38,
      }),
      groove: new MeshStandardMaterial({
        color: "#03050a",
        metalness: 0.6,
        roughness: 0.62,
      }),
      blue: new MeshPhysicalMaterial({
        color: ENGINE_BLUE,
        metalness: 0.65,
        roughness: 0.2,
        emissive: ENGINE_BLUE,
        emissiveIntensity: 0.55,
        clearcoat: 0.5,
      }),
      softBlue: new MeshStandardMaterial({
        color: "#486197",
        metalness: 0.75,
        roughness: 0.25,
        emissive: ENGINE_BLUE,
        emissiveIntensity: 0.1,
      }),
      coreGlow: new MeshPhysicalMaterial({
        color: ENGINE_BLUE,
        emissive: ENGINE_BLUE,
        emissiveIntensity: 0.2,
        metalness: 0.55,
        roughness: 0.26,
      }),
      signal: new MeshStandardMaterial({
        color: "#7692ff",
        emissive: ENGINE_BLUE,
        emissiveIntensity: 1.15,
        metalness: 0.45,
        roughness: 0.28,
      }),
      core: new MeshPhysicalMaterial({
        color: "#1c2a43",
        metalness: 0.72,
        roughness: 0.43,
        roughnessMap: finish,
        clearcoat: 0.12,
      }),
    };
    const geometry = {
      signal: plateGeometry(0.45, 0.11, 0.12, 0.025, 0.007),
      bezel: apertureGeometry(4.16, 4.62, 0.34, 0.23, 0.52, 0.046),
      lip: apertureGeometry(4.08, 4.54, 0.035, 0.025, 0.5, 0.013),
      lamella: apertureGeometry(4.02, 4.48, 0.21, 0.1, 0.49, 0.026),
      lamellaEdge: apertureGeometry(4.015, 4.475, 0.023, 0.018, 0.49, 0.007),
      innerLight: apertureGeometry(3.56, 4.02, 0.028, 0.024, 0.37, 0.009),
      back: apertureGeometry(3.94, 4.4, 0.3, 0.19, 0.48, 0.035),
      core: plateGeometry(2.92, 3.41, 0.16, 0.34, 0.042),
      coreRim: apertureGeometry(2.99, 3.48, 0.033, 0.09, 0.38, 0.015),
      coreGroove: apertureGeometry(2.75, 3.24, 0.018, 0.01, 0.32, 0.004),
      coreRail: plateGeometry(0.13, 1.55, 0.07, 0.045, 0.018),
      coreChip: plateGeometry(0.62, 0.23, 0.05, 0.055, 0.018),
      fragment: plateGeometry(0.48, 1.58, 0.16, 0.16, 0.027),
      fragmentWide: plateGeometry(0.88, 0.42, 0.11, 0.12, 0.024),
      fastener: plateGeometry(0.065, 0.065, 0.013, 0.024, 0.006),
      engravedLine: plateGeometry(0.012, 0.43, 0.004, 0.003, 0),
      tab: plateGeometry(0.17, 0.52, 0.12, 0.04, 0.012),
      grooveA: apertureGeometry(4.01, 4.47, 0.012, 0.006, 0.49, 0.002),
      grooveB: apertureGeometry(3.91, 4.37, 0.009, 0.006, 0.47, 0.002),
      grooveC: apertureGeometry(3.81, 4.27, 0.009, 0.006, 0.45, 0.002),
    };
    return { materials, geometry, finish };
  }, []);
  useEffect(
    () => () => {
      Object.values(parts.materials).forEach((material) => material.dispose());
      Object.values(parts.geometry).forEach((geometry) => geometry.dispose());
      parts.finish.dispose();
    },
    [parts],
  );
  return parts;
}

export type ClarityWorldController = {
  apply: (state: ClarityMotionState) => void;
};

function applyPose(group: Group | Mesh | null | undefined, pose: ClarityPose) {
  if (!group) return;
  group.position.set(...pose.position);
  group.rotation.set(...pose.rotation);
  group.scale.setScalar(pose.scale);
}

export function ClarityEngineWorld({
  controllerRef,
  compact,
}: {
  controllerRef: RefObject<ClarityWorldController | null>;
  compact: boolean;
}) {
  const { materials: material, geometry: shape } = useEngineParts();
  const structure = useRef<Group>(null);
  const front = useRef<Group>(null);
  const back = useRef<Mesh>(null);
  const core = useRef<Group>(null);
  const mark = useRef<Group>(null);
  const layers = useRef<(Group | null)[]>([]);
  const fragments = useRef<(Group | null)[]>([]);
  const signals = useRef<(Mesh | null)[]>([]);
  useImperativeHandle(
    controllerRef,
    () => ({
      apply: (state) => {
        applyPose(structure.current, state.structure);
        applyPose(front.current, state.front);
        applyPose(back.current, state.back);
        applyPose(core.current, state.core);
        state.layers.forEach((pose, index) =>
          applyPose(layers.current[index], pose),
        );
        state.fragments.forEach((pose, index) =>
          applyPose(fragments.current[index], pose),
        );
        state.signals.forEach((pose, index) =>
          applyPose(signals.current[index], pose),
        );
        material.coreGlow.emissiveIntensity = 0.18 + state.core.reveal * 0.62;
        mark.current?.scale.setScalar(0.45 + state.core.reveal * 0.55);
      },
    }),
    [material],
  );
  return (
    <>
      <StudioEnvironment />
      <ambientLight intensity={compact ? 0.4 : 0.22} color="#c5d0ed" />
      <directionalLight
        position={[-3.5, 7.5, 7]}
        color="#edf0ff"
        intensity={3.4}
        castShadow={!compact}
        shadow-mapSize={[2048, 2048]}
        shadow-radius={3}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={0.1}
        shadow-camera-far={25}
        shadow-bias={-0.0005}
        shadow-normalBias={0.035}
      />
      <directionalLight
        position={[4, 0.5, -5]}
        color="#5b7cff"
        intensity={2.1}
      />
      <directionalLight
        position={[6, 2, 6]}
        color="#c4cde4"
        intensity={compact ? 1.0 : 0.65}
      />
      {!compact ? (
        <pointLight
          position={[-0.3, 0, 0.2]}
          color={ENGINE_BLUE}
          intensity={0.75}
          distance={5}
          decay={2}
        />
      ) : null}
      <group
        ref={structure}
        rotation={[-0.025, -0.13, -0.15]}
        position={[0.28, 0.12, 0]}
        dispose={null}
      >
        {/* The shell's repeated lamellae reveal actual depth and carry a continuous internal light seam. */}
        {Array.from(
          {
            length: compact
              ? CLARITY_LAYER_COUNT.compact
              : CLARITY_LAYER_COUNT.full,
          },
          (_, index) => (
            <group
              key={index}
              ref={(element) => {
                layers.current[index] = element;
              }}
              position={[0, 0, 0.71 - index * 0.237]}
              scale={1 - index * 0.008}
            >
              <mesh
                geometry={shape.lamella}
                material={
                  index % 3 === 0 ? material.titanium : material.graphite
                }
                castShadow
                receiveShadow
              />
              <mesh
                geometry={shape.lamellaEdge}
                material={material.milled}
                position={[0, 0, 0.063]}
              />
              <mesh
                geometry={shape.innerLight}
                material={
                  index === 3 || index === 6 ? material.blue : material.softBlue
                }
                position={[0, 0, 0.037]}
              />
              <mesh
                geometry={shape.tab}
                material={material.ceramic}
                position={[-1.995, 0.62, 0]}
                castShadow
              />
              <mesh
                geometry={shape.tab}
                material={material.ceramic}
                position={[1.995, -0.62, 0]}
                castShadow
              />
            </group>
          ),
        )}
        <mesh
          ref={back}
          geometry={shape.back}
          material={material.graphite}
          position={[0, 0, -1.18]}
          castShadow
          receiveShadow
        />
        <group ref={front} position={[0, 0, 1.055]}>
          <mesh
            geometry={shape.bezel}
            material={material.graphite}
            castShadow
            receiveShadow
          />
          <mesh
            geometry={shape.lip}
            material={material.titanium}
            position={[0, 0, 0.14]}
          />
          <mesh
            geometry={shape.grooveA}
            material={material.groove}
            position={[0, 0, 0.143]}
          />
          <mesh
            geometry={shape.grooveB}
            material={material.groove}
            position={[0, 0, 0.143]}
          />
          <mesh
            geometry={shape.grooveC}
            material={material.groove}
            position={[0, 0, 0.143]}
          />
          {[-1, 1].flatMap((x) =>
            [-1, 1].map((y) => (
              <mesh
                key={`${x}-${y}`}
                geometry={shape.fastener}
                material={material.titanium}
                position={[x * 1.824, y * 1.996, 0.167]}
                rotation={[0, 0, Math.PI / 4]}
              />
            )),
          )}
          {Array.from({ length: 9 }, (_, index) => (
            <mesh
              key={index}
              geometry={shape.engravedLine}
              material={material.titanium}
              position={[1.91, -0.7 + index * 0.066, 0.163]}
              rotation={[0, 0, Math.PI / 2]}
              scale={[1, index % 4 === 0 ? 0.35 : 0.2, 1]}
            />
          ))}
          <mesh
            geometry={shape.coreChip}
            material={material.titanium}
            position={[-0.72, -2.13, 0.148]}
            scale={[0.65, 0.3, 0.45]}
          />
          <mesh
            geometry={shape.coreChip}
            material={material.blue}
            position={[0.86, 2.13, 0.146]}
            scale={[0.7, 0.17, 0.4]}
          />
        </group>
        {/* The resolved core: machined ceramic, nested light, and a physical chevron. */}
        <group ref={core} position={[0, 0, -1.01]}>
          <mesh
            geometry={shape.core}
            material={material.core}
            castShadow
            receiveShadow
          />
          <mesh
            geometry={shape.coreRim}
            material={material.coreGlow}
            position={[0, 0, 0.012]}
          />
          <mesh
            geometry={shape.coreGroove}
            material={material.milled}
            position={[0, 0, 0.117]}
          />
          <group ref={mark}>
            <mesh
              geometry={shape.coreRail}
              material={material.mark}
              position={[-0.29, 0.16, 0.145]}
              rotation={[0, 0, 0.42]}
              castShadow
            />
            <mesh
              geometry={shape.coreRail}
              material={material.mark}
              position={[0.29, 0.16, 0.145]}
              rotation={[0, 0, -0.42]}
              castShadow
            />
            <mesh
              geometry={shape.coreChip}
              material={material.blue}
              position={[0, -0.86, 0.115]}
              scale={[0.5, 0.16, 0.7]}
            />
          </group>
          {Array.from({ length: 6 }, (_, index) => (
            <mesh
              key={index}
              geometry={shape.engravedLine}
              material={material.milled}
              position={[-0.19 + index * 0.076, 1.28, 0.119]}
              scale={[0.6, 0.24, 1]}
            />
          ))}
        </group>
        {/* The plates and illuminated signals physically travel into the stack as the story resolves. */}
        {Array.from({ length: compact ? 3 : 6 }, (_, index) => (
          <group
            key={`fragment-${index}`}
            ref={(element) => {
              fragments.current[index] = element;
            }}
          >
            <mesh
              geometry={index % 3 === 0 ? shape.fragment : shape.fragmentWide}
              material={index % 2 ? material.titanium : material.graphite}
              castShadow
              receiveShadow
            />
            <mesh
              geometry={shape.engravedLine}
              material={material.softBlue}
              position={[0.1, 0, 0.108]}
              scale={[1.5, index % 3 === 0 ? 1.5 : 0.4, 1]}
            />
          </group>
        ))}
        {Array.from({ length: compact ? 3 : 6 }, (_, index) => (
          <mesh
            key={`signal-${index}`}
            ref={(element) => {
              signals.current[index] = element;
            }}
            geometry={shape.signal}
            material={material.signal}
          />
        ))}
      </group>
      {!compact ? (
        <mesh
          receiveShadow
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -2.9, 0]}
        >
          <planeGeometry args={[40, 40]} />
          <shadowMaterial color="#000000" transparent opacity={0.23} />
        </mesh>
      ) : null}
    </>
  );
}

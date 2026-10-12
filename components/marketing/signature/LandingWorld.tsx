"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  Color,
  Group,
  InstancedMesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Vector3,
} from "three";
import { StudioEnvironment } from "../clarity/ClarityEngineWorld";
import { makeLandingFinish, makeLandingGeometry } from "./LandingGeometry";
import {
  createLandingLinks,
  evaluateLandingMotion,
  landingCameraFov,
  LANDING_COMPACT_TILE_COUNT,
  LANDING_TILE_COUNT,
} from "./LandingMotion";

const DOMAIN_COLORS = ["#8493a7", "#7d9eb4", "#8898ca"];
function routePoint(
  from: Vector3,
  to: Vector3,
  t: number,
  lift: number,
  result: Vector3,
) {
  result.copy(from).lerp(to, t);
  result.y += Math.sin(Math.PI * t) * lift;
  result.z += Math.sin(Math.PI * t) * lift * 0.35;
  return result;
}

/** The Signal Atlas: authored, reversible motion; no wall-clock animation or remote assets. */
export function LandingWorld({
  progress,
  compact,
}: {
  progress: MutableRefObject<number>;
  compact: boolean;
}) {
  const { camera, gl, size } = useThree();
  const body = useRef<InstancedMesh>(null),
    faces = useRef<InstancedMesh>(null),
    trim = useRef<InstancedMesh>(null);
  const accents = useRef<InstancedMesh>(null),
    rivets = useRef<InstancedMesh>(null),
    nodes = useRef<InstancedMesh>(null);
  const etchings = useRef<(InstancedMesh | null)[]>([]);
  const conduits = useRef<InstancedMesh>(null),
    packets = useRef<InstancedMesh>(null),
    core = useRef<Group>(null);
  const proof = useRef<HTMLElement | null>(null);
  const count = compact ? LANDING_COMPACT_TILE_COUNT : LANDING_TILE_COUNT;
  const perDomain = count / 3;
  const segments = compact ? 5 : 8;
  const packetCount = compact ? 18 : 30;
  const resources = useMemo(() => {
    const finish = makeLandingFinish();
    const geometry = makeLandingGeometry(compact);
    return {
      geometry,
      finish,
      links: createLandingLinks(compact),
      materials: {
        body: new MeshPhysicalMaterial({
          color: "#313946",
          metalness: 0.78,
          roughness: 0.34,
          roughnessMap: finish,
          clearcoat: 0.19,
          clearcoatRoughness: 0.35,
        }),
        face: new MeshPhysicalMaterial({
          color: "#414b5a",
          metalness: 0.6,
          roughness: 0.41,
          roughnessMap: finish,
          clearcoat: 0.14,
        }),
        trim: new MeshStandardMaterial({
          color: "#a9b3c0",
          metalness: 0.92,
          roughness: 0.3,
        }),
        etching: new MeshStandardMaterial({
          color: "#b1bccb",
          metalness: 0.56,
          roughness: 0.48,
        }),
        accent: new MeshPhysicalMaterial({
          color: "#5175f2",
          emissive: "#3051d6",
          emissiveIntensity: 0.38,
          metalness: 0.45,
          roughness: 0.28,
          clearcoat: 0.3,
        }),
        conduit: new MeshStandardMaterial({
          color: "#426498",
          emissive: "#274681",
          emissiveIntensity: 0.36,
          metalness: 0.62,
          roughness: 0.34,
        }),
        packet: new MeshStandardMaterial({
          color: "#a5c4fa",
          emissive: "#719cf9",
          emissiveIntensity: 0.8,
          metalness: 0.22,
          roughness: 0.24,
        }),
        core: new MeshPhysicalMaterial({
          color: "#9aafd8",
          vertexColors: true,
          emissive: "#20419e",
          emissiveIntensity: 0.12,
          metalness: 0.52,
          roughness: 0.33,
          envMapIntensity: 0.72,
          clearcoat: 0.3,
          clearcoatRoughness: 0.3,
        }),
        foundation: new MeshPhysicalMaterial({
          color: "#313c4a",
          metalness: 0.88,
          roughness: 0.36,
          roughnessMap: finish,
          clearcoat: 0.15,
        }),
      },
      object: new Object3D(),
      up: new Vector3(0, 1, 0),
      from: new Vector3(),
      to: new Vector3(),
      start: new Vector3(),
      end: new Vector3(),
      direction: new Vector3(),
      anchorPoints: Array.from(
        { length: compact ? LANDING_COMPACT_TILE_COUNT : LANDING_TILE_COUNT },
        () => new Vector3(),
      ),
      domainColors: DOMAIN_COLORS.map((color) => new Color(color)),
    };
  }, [compact]);
  useEffect(() => {
    proof.current =
      gl.domElement.closest<HTMLElement>("[data-signature-canvas]") ??
      gl.domElement.closest<HTMLElement>("[data-clarity-canvas]");
    return () => {
      proof.current = null;
    };
  }, [gl]);
  useEffect(
    () => () => {
      Object.entries(resources.geometry).forEach(([key, value]) => {
        if (key === "etchings")
          resources.geometry.etchings.forEach((geometry) => geometry.dispose());
        else if (!Array.isArray(value)) value.dispose();
      });
      Object.values(resources.materials).forEach((material) =>
        material.dispose(),
      );
      resources.finish.dispose();
    },
    [resources],
  );

  useFrame(() => {
    const state = evaluateLandingMotion(progress.current, compact);
    camera.position.set(...state.camera);
    camera.lookAt(...state.target);
    if (camera instanceof PerspectiveCamera) {
      camera.fov = landingCameraFov(
        state.fov,
        size.width / Math.max(1, size.height),
      );
      camera.updateProjectionMatrix();
    }
    const { object, start, end, direction, up } = resources;
    const instances = [
      body.current,
      faces.current,
      trim.current,
      accents.current,
      rivets.current,
    ];
    state.tiles.forEach((tile, index) => {
      object.position.set(...tile.position);
      object.rotation.set(...tile.rotation);
      object.scale.setScalar(tile.scale);
      object.updateMatrix();
      instances.forEach((mesh) => mesh?.setMatrixAt(index, object.matrix));
      const domain = Math.floor(index / perDomain);
      etchings.current[domain]?.setMatrixAt(index % perDomain, object.matrix);
      faces.current?.setColorAt(index, resources.domainColors[domain]);
      // A small edge port is separate from the etched face and anchors the conductors.
      resources.anchorPoints[index]
        .set(-0.29, -0.52, 0.1)
        .applyMatrix4(object.matrix);
      object.position.copy(resources.anchorPoints[index]);
      object.scale.setScalar(tile.scale);
      object.rotateX(Math.PI / 2);
      object.updateMatrix();
      nodes.current?.setMatrixAt(index, object.matrix);
    });
    [...instances, nodes.current, ...etchings.current].forEach((mesh) => {
      if (mesh) mesh.instanceMatrix.needsUpdate = true;
    });
    if (faces.current?.instanceColor)
      faces.current.instanceColor.needsUpdate = true;

    if (conduits.current && packets.current) {
      resources.links.forEach(([a, b], linkIndex) => {
        const from = resources.anchorPoints[a],
          to = resources.anchorPoints[b];
        const crossDomain =
          Math.floor(a / perDomain) !== Math.floor(b / perDomain);
        const primaryBridge = a % perDomain === Math.floor(perDomain / 2);
        const radius =
          (crossDomain
            ? 0.012 * (primaryBridge ? 0.8 : state.crossLinkStrength)
            : 0.015) * state.routeReveal;
        for (let segment = 0; segment < segments; segment += 1) {
          routePoint(from, to, segment / segments, state.routeLift, start);
          routePoint(from, to, (segment + 1) / segments, state.routeLift, end);
          direction.copy(end).sub(start);
          object.position.copy(start).add(end).multiplyScalar(0.5);
          const length = direction.length();
          object.quaternion.setFromUnitVectors(up, direction.normalize());
          object.scale.set(radius, length, radius);
          object.updateMatrix();
          conduits.current!.setMatrixAt(
            linkIndex * segments + segment,
            object.matrix,
          );
        }
      });
      for (let index = 0; index < packetCount; index += 1) {
        const [a, b] = resources.links[(index * 7) % resources.links.length];
        const t =
          0.15 +
          0.7 *
            (0.5 + 0.5 * Math.sin(state.progress * Math.PI * 3 + index * 0.91));
        routePoint(
          resources.anchorPoints[a],
          resources.anchorPoints[b],
          t,
          state.routeLift,
          start,
        );
        routePoint(
          resources.anchorPoints[a],
          resources.anchorPoints[b],
          Math.min(1, t + 0.02),
          state.routeLift,
          end,
        );
        object.position.copy(start);
        object.lookAt(end);
        const crossDomain =
          Math.floor(a / perDomain) !== Math.floor(b / perDomain);
        const routeStrength =
          crossDomain && a % perDomain !== Math.floor(perDomain / 2)
            ? state.crossLinkStrength
            : 1;
        object.scale.setScalar(
          state.routeReveal * routeStrength * (compact ? 0.9 : 1),
        );
        object.updateMatrix();
        packets.current.setMatrixAt(index, object.matrix);
      }
      conduits.current.visible = packets.current.visible =
        state.routeReveal > 0.015;
      conduits.current.instanceMatrix.needsUpdate =
        packets.current.instanceMatrix.needsUpdate = true;
    }
    resources.materials.packet.emissiveIntensity =
      0.4 + state.signalStrength * 0.5;
    if (core.current) {
      core.current.visible = state.coreScale > 0.001;
      core.current.scale.setScalar(state.coreScale);
    }
    if (proof.current) {
      proof.current.dataset.landingProgress = state.progress.toFixed(4);
      proof.current.dataset.landingStage = String(state.stage);
      proof.current.dataset.landingTiles = String(count);
      proof.current.dataset.landingCore = state.coreScale.toFixed(4);
      proof.current.dataset.landingRoutes = String(resources.links.length);
      proof.current.dataset.landingPose = JSON.stringify({
        first: state.tiles[0],
        middle: state.tiles[Math.floor(count / 2)],
        last: state.tiles[count - 1],
      });
      proof.current.dataset.landingCamera = camera.position
        .toArray()
        .map((value) => value.toFixed(3))
        .join(",");
    }
  });

  return (
    <>
      <StudioEnvironment />
      <ambientLight intensity={compact ? 0.6 : 0.42} color="#cbd8ea" />
      <hemisphereLight intensity={0.35} color="#d8e5f6" groundColor="#101622" />
      <directionalLight position={[-4, 7, 8]} intensity={3.1} color="#f1f4fa" />
      <directionalLight
        position={[6, 1, 5]}
        intensity={compact ? 1.5 : 1.2}
        color="#d1e3ff"
      />
      <directionalLight
        position={[-4, 2, -5]}
        intensity={2.3}
        color="#4778f5"
      />
      <group dispose={null}>
        <instancedMesh
          ref={body}
          args={[resources.geometry.body, resources.materials.body, count]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={faces}
          args={[resources.geometry.face, resources.materials.face, count]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={trim}
          args={[resources.geometry.trim, resources.materials.trim, count]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={accents}
          args={[resources.geometry.accent, resources.materials.accent, count]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={rivets}
          args={[resources.geometry.rivets, resources.materials.trim, count]}
          frustumCulled={false}
        />
        {resources.geometry.etchings.map((geometry, index) => (
          <instancedMesh
            key={index}
            ref={(value) => {
              etchings.current[index] = value;
            }}
            args={[geometry, resources.materials.etching, perDomain]}
            frustumCulled={false}
          />
        ))}
        <instancedMesh
          ref={nodes}
          args={[resources.geometry.node, resources.materials.accent, count]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={conduits}
          args={[
            resources.geometry.conduit,
            resources.materials.conduit,
            resources.links.length * segments,
          ]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={packets}
          args={[
            resources.geometry.packet,
            resources.materials.packet,
            packetCount,
          ]}
          frustumCulled={false}
        />
        <group ref={core} visible={false}>
          <mesh
            geometry={resources.geometry.core}
            material={resources.materials.core}
          />
          <mesh
            geometry={resources.geometry.rails}
            material={resources.materials.trim}
          />
          <mesh
            geometry={resources.geometry.foundation}
            material={resources.materials.foundation}
          />
        </group>
      </group>
    </>
  );
}

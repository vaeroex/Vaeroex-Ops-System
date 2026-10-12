"use client";

import {
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { StudioEnvironment } from "../clarity/ClarityEngineWorld";
import { loadScientificProteinData } from "./dataLoader";
import { makeDrugRibbons, makeDrugSurface } from "./DrugGeometry";
import {
  DRUG_ELEMENT_COLORS,
  DrugMolecule,
  type DrugMoleculeController,
} from "./DrugMolecule";
import { drugCameraFov, evaluateDrugMotion } from "./drugMotion";

function opacity(material: MeshPhysicalMaterial, value: number) {
  material.opacity = value;
  material.depthWrite = value > 0.98;
}

/** Deposited 1AZM coordinates; approach/comparison transforms are explicitly editorial. */
export function DrugDiscoveryWorld({
  progress,
  compact,
}: {
  progress: MutableRefObject<number>;
  compact: boolean;
}) {
  const data = use(loadScientificProteinData());
  const { camera, size, gl } = useThree();
  const protein = useRef<Group>(null);
  const backbone = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const pocket = useRef<Mesh>(null);
  const pocketAtoms = useRef<InstancedMesh>(null);
  const zinc = useRef<Mesh>(null);
  const contact = useRef<InstancedMesh>(null);
  const ligand = useRef<DrugMoleculeController>(null);
  const candidateOne = useRef<DrugMoleculeController>(null);
  const candidateTwo = useRef<DrugMoleculeController>(null);
  const proof = useRef<HTMLElement | null>(null);
  const resources = useMemo(() => {
    const ribbons = makeDrugRibbons(data.backbone, compact);
    const surface = makeDrugSurface(
      compact ? data.compactSurface : data.surface,
      data.pocket.radius,
    );
    const clip = new Plane(new Vector3(0, 0, -1), -6);
    const ribbonClip = new Plane(new Vector3(0, 0, 1), 6);
    const materials = {
      coil: new MeshPhysicalMaterial({
        color: "#83949c",
        metalness: 0.5,
        roughness: 0.35,
        clearcoat: 0.24,
        clippingPlanes: [ribbonClip],
      }),
      helix: new MeshPhysicalMaterial({
        color: "#c2cfd4",
        metalness: 0.46,
        roughness: 0.29,
        clearcoat: 0.3,
        side: DoubleSide,
        clippingPlanes: [ribbonClip],
      }),
      sheet: new MeshPhysicalMaterial({
        color: "#8eaab6",
        metalness: 0.5,
        roughness: 0.33,
        clearcoat: 0.28,
        side: DoubleSide,
        clippingPlanes: [ribbonClip],
      }),
      body: new MeshPhysicalMaterial({
        color: "#90a3ad",
        vertexColors: true,
        metalness: 0.22,
        roughness: 0.55,
        clearcoat: 0.08,
        depthWrite: true,
        side: DoubleSide,
        forceSinglePass: true,
        clippingPlanes: [clip],
      }),
      pocket: new MeshPhysicalMaterial({
        color: "#66b6ce",
        vertexColors: true,
        metalness: 0.23,
        roughness: 0.5,
        clearcoat: 0.1,
        emissive: "#1c5064",
        emissiveIntensity: 0.12,
        depthWrite: true,
        side: DoubleSide,
        forceSinglePass: true,
        clippingPlanes: [clip],
      }),
      atoms: new MeshPhysicalMaterial({
        color: "#ffffff",
        metalness: 0.35,
        roughness: 0.38,
        clearcoat: 0.15,
        transparent: true,
        depthWrite: false,
      }),
      zinc: new MeshPhysicalMaterial({
        color: "#b7d1dd",
        metalness: 0.72,
        roughness: 0.22,
        clearcoat: 0.42,
        emissive: "#285168",
        emissiveIntensity: 0.08,
        transparent: true,
      }),
      contact: new MeshPhysicalMaterial({
        color: "#92c8da",
        metalness: 0.25,
        roughness: 0.4,
        emissive: "#34667a",
        emissiveIntensity: 0.15,
        transparent: true,
        depthWrite: false,
      }),
    };
    const atoms = data.atoms
      .map((atom) => ({
        atom,
        distance: Math.min(
          ...data.ligand.atoms.map((ligandAtom) =>
            new Vector3(...atom.position).distanceToSquared(
              new Vector3(...ligandAtom.position),
            ),
          ),
        ),
      }))
      .filter(
        ({ atom, distance }) => atom.element !== "H" && distance < 0.72 ** 2,
      )
      .sort((a, b) => a.distance - b.distance)
      .slice(0, compact ? 38 : 82)
      .map(({ atom }) => atom);
    return {
      ribbons,
      surface,
      materials,
      atoms,
      clip,
      ribbonClip,
      ribbonColors: {
        coil: materials.coil.color.clone(),
        helix: materials.helix.color.clone(),
        sheet: materials.sheet.color.clone(),
      },
      sphere: new SphereGeometry(1, compact ? 10 : 18, compact ? 7 : 12),
      zinc: new SphereGeometry(0.115, compact ? 16 : 28, compact ? 10 : 20),
      contact: new CylinderGeometry(0.005, 0.005, 1, 6),
    };
  }, [compact, data]);
  const comparison = useMemo(() => {
    const first = data.candidates.find(
      (candidate) => candidate.ccdId === "MZM",
    );
    const second = data.candidates.find(
      (candidate) => candidate.ccdId === "EZL",
    );
    if (!first || !second)
      throw new Error("The verified comparison compounds are unavailable");
    return [first, second] as const;
  }, [data]);

  useEffect(() => {
    proof.current = gl.domElement.closest<HTMLElement>("[data-science-canvas]");
    return () => {
      proof.current = null;
    };
  }, [gl]);
  useLayoutEffect(() => {
    if (!pocketAtoms.current || !contact.current) return;
    const object = new Object3D();
    resources.atoms.forEach((atom, index) => {
      object.position.set(...atom.position);
      object.scale.setScalar(atom.element === "C" ? 0.041 : 0.053);
      object.updateMatrix();
      pocketAtoms.current!.setMatrixAt(index, object.matrix);
      pocketAtoms.current!.setColorAt(
        index,
        new Color(DRUG_ELEMENT_COLORS[atom.element.toUpperCase()] ?? "#8fadb8"),
      );
    });
    pocketAtoms.current.instanceMatrix.needsUpdate = true;
    if (pocketAtoms.current.instanceColor)
      pocketAtoms.current.instanceColor.needsUpdate = true;
    pocketAtoms.current.computeBoundingSphere();
    const donor = data.ligand.atoms.find(
      (atom) => atom.id === data.zinc.ligandAtomId,
    );
    if (donor) {
      const from = new Vector3(...donor.position),
        to = new Vector3(...data.zinc.position);
      const direction = to.clone().sub(from);
      const length = direction.length();
      const quaternion = new Quaternion().setFromUnitVectors(
        new Vector3(0, 1, 0),
        direction.normalize(),
      );
      for (let index = 0; index < 5; index += 1) {
        object.position.copy(from).lerp(to, 0.1 + index * 0.2);
        object.quaternion.copy(quaternion);
        object.scale.set(1, length * 0.085, 1);
        object.updateMatrix();
        contact.current.setMatrixAt(index, object.matrix);
      }
      contact.current.instanceMatrix.needsUpdate = true;
      contact.current.computeBoundingSphere();
    }
  }, [data, resources]);
  useEffect(
    () => () => {
      Object.values(resources.ribbons).forEach((geometry) =>
        geometry.dispose(),
      );
      Object.values(resources.surface).forEach((geometry) =>
        geometry.dispose(),
      );
      Object.values(resources.materials).forEach((material) =>
        material.dispose(),
      );
      resources.sphere.dispose();
      resources.zinc.dispose();
      resources.contact.dispose();
    },
    [resources],
  );

  useFrame(() => {
    const state = evaluateDrugMotion(progress.current, compact);
    camera.position.set(...state.camera);
    camera.lookAt(...state.target);
    if (camera instanceof PerspectiveCamera) {
      const aspect = size.width / Math.max(1, size.height);
      // Retain the composed horizontal field on narrower stages, including desktop
      // split layouts. No molecule enters from beyond the visible camera bounds.
      camera.fov = drugCameraFov(state.fov, aspect);
      camera.updateProjectionMatrix();
    }
    if (protein.current) {
      protein.current.position.set(...state.protein.position);
      protein.current.rotation.set(...state.protein.rotation);
      protein.current.scale.setScalar(state.protein.scale);
      protein.current.updateMatrixWorld();
    }
    const fade = state.protein.opacity;
    for (const key of ["coil", "helix", "sheet"] as const) {
      resources.materials[key].color
        .copy(resources.ribbonColors[key])
        .multiplyScalar(fade);
      resources.materials[key].envMapIntensity = fade;
      resources.materials[key].clearcoat = 0.24 * fade;
    }
    // Complex protein representations remain opaque. Complementary clipping sweeps
    // provide a deterministic change of representation without transparent self-overdraw.
    resources.clip.setComponents(0, 0, -1, state.cutawayDepth);
    resources.ribbonClip.setComponents(0, 0, 1, -state.ribbonCutawayDepth);
    if (protein.current) {
      resources.clip.applyMatrix4(protein.current.matrixWorld);
      resources.ribbonClip.applyMatrix4(protein.current.matrixWorld);
    }
    opacity(resources.materials.atoms, state.pocketAtomsOpacity * fade);
    opacity(resources.materials.zinc, state.zincOpacity * fade);
    opacity(resources.materials.contact, state.contactOpacity);
    if (backbone.current)
      backbone.current.visible = state.ribbonCutawayDepth < 4;
    if (body.current) body.current.visible = state.cutawayDepth > -5;
    if (pocket.current) pocket.current.visible = state.cutawayDepth > -5;
    if (pocketAtoms.current)
      pocketAtoms.current.visible = state.pocketAtomsOpacity * fade > 0.01;
    if (zinc.current) zinc.current.visible = state.zincOpacity * fade > 0.01;
    if (contact.current) contact.current.visible = state.contactOpacity > 0.01;
    ligand.current?.apply(state.ligand);
    candidateOne.current?.apply(state.candidates[0]);
    candidateTwo.current?.apply(state.candidates[1]);
    if (proof.current) {
      proof.current.dataset.drugPdb = data.pdbId;
      proof.current.dataset.drugStage = String(state.stage);
      proof.current.dataset.drugSurface = state.surfaceOpacity.toFixed(3);
      proof.current.dataset.drugRibbon = state.ribbonOpacity.toFixed(3);
      proof.current.dataset.drugCutaway = state.cutawayDepth.toFixed(3);
      proof.current.dataset.drugPose = JSON.stringify({
        protein: state.protein,
        ligand: state.ligand,
        candidates: state.candidates,
      });
      proof.current.dataset.drugSource =
        "observed-1AZM;derived-envelope;conceptual-motion";
      proof.current.dataset.drugComparison = "AZM,MZM,EZL";
    }
  });

  return (
    <>
      <StudioEnvironment />
      <ambientLight intensity={compact ? 0.6 : 0.38} color="#c9dce8" />
      <hemisphereLight intensity={0.4} color="#dce9ed" groundColor="#102630" />
      <directionalLight position={[-4, 6, 8]} intensity={3.0} color="#f3f7f7" />
      <directionalLight
        position={[6, 1, 4]}
        intensity={compact ? 1.5 : 1.1}
        color="#c1dceb"
      />
      <directionalLight
        position={[-3, 2, -7]}
        intensity={1.7}
        color="#5c97c1"
      />
      <group ref={protein} dispose={null}>
        <group ref={backbone}>
          <mesh
            geometry={resources.ribbons.coil}
            material={resources.materials.coil}
          />
          <mesh
            geometry={resources.ribbons.helix}
            material={resources.materials.helix}
          />
          <mesh
            geometry={resources.ribbons.sheet}
            material={resources.materials.sheet}
          />
        </group>
        <mesh
          ref={body}
          geometry={resources.surface.body}
          material={resources.materials.body}
          renderOrder={1}
        />
        <mesh
          ref={pocket}
          geometry={resources.surface.pocket}
          material={resources.materials.pocket}
          renderOrder={2}
        />
        <instancedMesh
          ref={pocketAtoms}
          args={[
            resources.sphere,
            resources.materials.atoms,
            resources.atoms.length,
          ]}
        />
        <mesh
          ref={zinc}
          position={data.zinc.position}
          geometry={resources.zinc}
          material={resources.materials.zinc}
        />
        <instancedMesh
          ref={contact}
          args={[resources.contact, resources.materials.contact, 5]}
        />
      </group>
      <DrugMolecule
        graph={data.ligand}
        compact={compact}
        controllerRef={ligand}
      />
      <DrugMolecule
        graph={comparison[0]}
        compact={compact}
        controllerRef={candidateOne}
      />
      <DrugMolecule
        graph={comparison[1]}
        compact={compact}
        controllerRef={candidateTwo}
      />
    </>
  );
}

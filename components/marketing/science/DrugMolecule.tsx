"use client";

import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from "react";
import {
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  MeshPhysicalMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import type { ScienceLigand } from "./dataTypes";
import type { DrugPose } from "./drugMotion";

export const DRUG_ELEMENT_COLORS: Record<string, string> = {
  C: "#b6c2c6",
  N: "#517fc5",
  O: "#cb7163",
  S: "#bca361",
  F: "#8ab59a",
  CL: "#86b59d",
  ZN: "#a8c5d3",
  H: "#e5e7e5",
};
export type DrugMoleculeController = { apply: (pose: DrugPose) => void };

export function DrugMolecule({
  graph,
  compact,
  controllerRef,
}: {
  graph: ScienceLigand;
  compact: boolean;
  controllerRef: RefObject<DrugMoleculeController | null>;
}) {
  const group = useRef<Group>(null);
  const atoms = useRef<InstancedMesh>(null);
  const bonds = useRef<InstancedMesh>(null);
  const resources = useMemo(
    () => ({
      atom: new SphereGeometry(1, compact ? 12 : 24, compact ? 8 : 16),
      bond: new CylinderGeometry(1, 1, 1, compact ? 6 : 10, 1, false),
      atomMaterial: new MeshPhysicalMaterial({
        color: "#ffffff",
        metalness: 0.22,
        roughness: 0.27,
        clearcoat: 0.38,
        clearcoatRoughness: 0.25,
        transparent: true,
      }),
      bondMaterial: new MeshPhysicalMaterial({
        color: "#ffffff",
        metalness: 0.48,
        roughness: 0.33,
        clearcoat: 0.2,
        transparent: true,
      }),
    }),
    [compact],
  );
  const heavyAtoms = useMemo(
    () =>
      graph.atoms
        .map((atom, index) => ({ ...atom, index }))
        .filter((atom) => atom.element.toUpperCase() !== "H"),
    [graph],
  );
  const segments = useMemo(() => {
    const result: {
      center: Vector3;
      quaternion: Quaternion;
      length: number;
      radius: number;
      color: Color;
    }[] = [];
    graph.bonds.forEach((bond) => {
      const a = graph.atoms[bond.a],
        b = graph.atoms[bond.b];
      if (!a || !b || a.element === "H" || b.element === "H") return;
      const from = new Vector3(...a.position),
        to = new Vector3(...b.position);
      const direction = to.clone().sub(from);
      const length = direction.length();
      if (length < 0.0001) return;
      direction.normalize();
      const adjacent = graph.bonds.find(
        (edge) => edge !== bond && (edge.a === bond.a || edge.b === bond.a),
      );
      const neighbor = adjacent
        ? graph.atoms[adjacent.a === bond.a ? adjacent.b : adjacent.a]
        : undefined;
      const perpendicular = neighbor
        ? new Vector3(...neighbor.position).sub(from)
        : new Vector3().crossVectors(
            direction,
            Math.abs(direction.z) < 0.8
              ? new Vector3(0, 0, 1)
              : new Vector3(0, 1, 0),
          );
      perpendicular.addScaledVector(direction, -perpendicular.dot(direction));
      if (perpendicular.lengthSq() < 0.000001)
        perpendicular.crossVectors(direction, new Vector3(0, 1, 0));
      perpendicular.normalize();
      const rails = bond.order >= 2 ? [-0.022, 0.022] : [0];
      rails.forEach((offset) => {
        const displacement = perpendicular.clone().multiplyScalar(offset);
        [0.25, 0.75].forEach((fraction) => {
          result.push({
            center: from.clone().lerp(to, fraction).add(displacement),
            quaternion: new Quaternion().setFromUnitVectors(
              new Vector3(0, 1, 0),
              direction,
            ),
            length: length * 0.5,
            radius: bond.order >= 2 ? 0.014 : 0.019,
            color: new Color(
              DRUG_ELEMENT_COLORS[
                (fraction < 0.5 ? a.element : b.element).toUpperCase()
              ] ?? "#a7b4ba",
            ).multiplyScalar(0.8),
          });
        });
      });
    });
    return result;
  }, [graph]);
  useLayoutEffect(() => {
    if (!atoms.current || !bonds.current) return;
    const object = new Object3D();
    heavyAtoms.forEach((atom, index) => {
      object.position.set(...atom.position);
      object.quaternion.identity();
      object.scale.setScalar(atom.radius * 0.36);
      object.updateMatrix();
      atoms.current!.setMatrixAt(index, object.matrix);
      atoms.current!.setColorAt(
        index,
        new Color(DRUG_ELEMENT_COLORS[atom.element.toUpperCase()] ?? "#a7b4ba"),
      );
    });
    segments.forEach((segment, index) => {
      object.position.copy(segment.center);
      object.quaternion.copy(segment.quaternion);
      object.scale.set(segment.radius, segment.length, segment.radius);
      object.updateMatrix();
      bonds.current!.setMatrixAt(index, object.matrix);
      bonds.current!.setColorAt(index, segment.color);
    });
    atoms.current.instanceMatrix.needsUpdate = true;
    bonds.current.instanceMatrix.needsUpdate = true;
    if (atoms.current.instanceColor)
      atoms.current.instanceColor.needsUpdate = true;
    if (bonds.current.instanceColor)
      bonds.current.instanceColor.needsUpdate = true;
    atoms.current.computeBoundingSphere();
    bonds.current.computeBoundingSphere();
  }, [heavyAtoms, segments, resources]);
  useImperativeHandle(
    controllerRef,
    () => ({
      apply: (pose) => {
        if (!group.current) return;
        group.current.position.set(...pose.position);
        group.current.rotation.set(...pose.rotation);
        group.current.scale.setScalar(pose.scale);
        group.current.visible = pose.opacity > 0.005;
        for (const material of [
          resources.atomMaterial,
          resources.bondMaterial,
        ]) {
          material.opacity = pose.opacity;
          material.depthWrite = pose.opacity > 0.98;
        }
      },
    }),
    [resources],
  );
  useEffect(
    () => () => {
      resources.atom.dispose();
      resources.bond.dispose();
      resources.atomMaterial.dispose();
      resources.bondMaterial.dispose();
    },
    [resources],
  );
  return (
    <group ref={group} dispose={null}>
      <instancedMesh
        ref={atoms}
        args={[resources.atom, resources.atomMaterial, heavyAtoms.length]}
      />
      <instancedMesh
        ref={bonds}
        args={[resources.bond, resources.bondMaterial, segments.length]}
      />
    </group>
  );
}

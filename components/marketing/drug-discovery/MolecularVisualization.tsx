"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import {
  Group,
  MathUtils,
  Quaternion,
  Vector3
} from "three";

export type MolecularElement = "C" | "N" | "O" | "S" | "F" | "Cl";

export type MolecularAtom = Readonly<{
  id: string;
  element: MolecularElement;
  position: readonly [number, number, number];
}>;

export type MolecularBond = Readonly<{
  from: string;
  to: string;
  order: 1 | 2;
  rotatable?: boolean;
}>;

export type MolecularGraph = Readonly<{
  id: string;
  atoms: readonly MolecularAtom[];
  bonds: readonly MolecularBond[];
}>;

type MoleculeRepresentation = "ball-and-stick" | "stick" | "graph";

const ELEMENT_STYLE: Record<MolecularElement, Readonly<{ color: string; radius: number; valence: number }>> = {
  C: { color: "#71858d", radius: 0.14, valence: 4 },
  N: { color: "#4d9fd1", radius: 0.15, valence: 3 },
  O: { color: "#db726d", radius: 0.15, valence: 2 },
  S: { color: "#d7b65d", radius: 0.18, valence: 6 },
  F: { color: "#a6d989", radius: 0.14, valence: 1 },
  Cl: { color: "#78bc87", radius: 0.18, valence: 1 }
};

function ringAtoms(
  prefix: string,
  center: readonly [number, number, number],
  radius: number,
  elements: readonly MolecularElement[] = ["C", "C", "C", "C", "C", "C"],
  phase = 0
): MolecularAtom[] {
  return elements.map((element, index) => {
    const angle = phase + (index / elements.length) * Math.PI * 2;
    return {
      id: `${prefix}${index}`,
      element,
      position: [
        center[0] + Math.cos(angle) * radius,
        center[1] + Math.sin(angle) * radius,
        center[2] + Math.sin(angle * 2 + phase) * 0.06
      ]
    };
  });
}

function ringBonds(prefix: string, count: number, aromatic = false): MolecularBond[] {
  return Array.from({ length: count }, (_, index) => ({
    from: `${prefix}${index}`,
    to: `${prefix}${(index + 1) % count}`,
    order: aromatic && index % 2 === 0 ? 2 : 1
  }));
}

function candidateA(): MolecularGraph {
  const left = ringAtoms("aL", [-1.65, 0, 0], 0.78, ["C", "C", "C", "C", "C", "C"], Math.PI / 6);
  const right = ringAtoms("aR", [1.55, 0.08, 0.26], 0.78, ["C", "C", "N", "C", "C", "C"], Math.PI / 6);
  return {
    id: "linked-aromatic-amide",
    atoms: [
      ...left,
      ...right,
      { id: "aC", element: "C", position: [-0.44, 0.02, 0.02] },
      { id: "aO", element: "O", position: [-0.35, 0.76, 0.05] },
      { id: "aN", element: "N", position: [0.4, -0.05, 0.16] }
    ],
    bonds: [
      ...ringBonds("aL", 6, true),
      ...ringBonds("aR", 6, true),
      { from: "aL0", to: "aC", order: 1 },
      { from: "aC", to: "aO", order: 2 },
      { from: "aC", to: "aN", order: 1, rotatable: true },
      { from: "aN", to: "aR3", order: 1, rotatable: true }
    ]
  };
}

function candidateB(): MolecularGraph {
  return {
    id: "fused-heterobicycle",
    atoms: [
      { id: "b0", element: "C", position: [-0.25, 0.58, 0] },
      { id: "b1", element: "C", position: [-0.25, -0.58, 0] },
      { id: "b2", element: "C", position: [-1.12, 1.02, 0.13] },
      { id: "b3", element: "C", position: [-1.72, 0.08, 0.28] },
      { id: "b4", element: "C", position: [-1.1, -1.02, 0.12] },
      { id: "b5", element: "N", position: [0.72, 1.02, -0.1] },
      { id: "b6", element: "C", position: [1.52, 0.1, -0.28] },
      { id: "b7", element: "O", position: [0.72, -1.02, -0.1] },
      { id: "b8", element: "F", position: [-2.48, 0.15, 0.36] }
    ],
    bonds: [
      { from: "b0", to: "b1", order: 1 },
      { from: "b0", to: "b2", order: 1 },
      { from: "b2", to: "b3", order: 1 },
      { from: "b3", to: "b4", order: 1 },
      { from: "b4", to: "b1", order: 1 },
      { from: "b0", to: "b5", order: 1 },
      { from: "b5", to: "b6", order: 1 },
      { from: "b6", to: "b7", order: 1 },
      { from: "b7", to: "b1", order: 1 },
      { from: "b3", to: "b8", order: 1 }
    ]
  };
}

function candidateC(): MolecularGraph {
  const core = ringAtoms("cR", [0, 0, 0], 0.9, ["C", "N", "C", "C", "N", "C"], Math.PI / 6);
  return {
    id: "polar-heterocycle",
    atoms: [
      ...core,
      { id: "cC", element: "C", position: [1.52, 0.05, 0.04] },
      { id: "cO1", element: "O", position: [2.12, 0.57, 0.08] },
      { id: "cN", element: "N", position: [1.88, -0.68, -0.05] },
      { id: "cS", element: "S", position: [-1.48, -0.1, 0.16] },
      { id: "cO2", element: "O", position: [-1.96, 0.56, 0.38] },
      { id: "cO3", element: "O", position: [-1.95, -0.78, -0.05] }
    ],
    bonds: [
      ...ringBonds("cR", 6, true),
      { from: "cR0", to: "cC", order: 1, rotatable: true },
      { from: "cC", to: "cO1", order: 2 },
      { from: "cC", to: "cN", order: 1 },
      { from: "cR3", to: "cS", order: 1 },
      { from: "cS", to: "cO2", order: 2 },
      { from: "cS", to: "cO3", order: 2 }
    ]
  };
}

function candidateD(): MolecularGraph {
  const phenyl = ringAtoms("dP", [-1.8, 0.25, 0], 0.74, ["C", "C", "C", "C", "C", "C"], Math.PI / 6);
  const hetero = ringAtoms("dH", [1.75, -0.28, 0.22], 0.64, ["N", "C", "C", "O", "C"], Math.PI / 2);
  return {
    id: "flexible-aryl-heterocycle",
    atoms: [
      ...phenyl,
      ...hetero,
      { id: "dC1", element: "C", position: [-0.72, 0.12, 0.04] },
      { id: "dC2", element: "C", position: [0.02, -0.2, 0.32] },
      { id: "dC3", element: "C", position: [0.82, 0.02, 0.06] },
      { id: "dCl", element: "Cl", position: [-2.72, 0.9, -0.08] }
    ],
    bonds: [
      ...ringBonds("dP", 6, true),
      ...ringBonds("dH", 5, false),
      { from: "dP0", to: "dC1", order: 1, rotatable: true },
      { from: "dC1", to: "dC2", order: 1, rotatable: true },
      { from: "dC2", to: "dC3", order: 1, rotatable: true },
      { from: "dC3", to: "dH2", order: 1, rotatable: true },
      { from: "dP2", to: "dCl", order: 1 }
    ]
  };
}

function candidateE(): MolecularGraph {
  const ring = ringAtoms("eR", [-0.55, 0, 0], 0.86, ["C", "C", "N", "C", "C", "C"], Math.PI / 6);
  return {
    id: "sulfonyl-polar-analog",
    atoms: [
      ...ring,
      { id: "eS", element: "S", position: [0.86, 0.02, 0.12] },
      { id: "eO1", element: "O", position: [1.22, 0.72, 0.38] },
      { id: "eO2", element: "O", position: [1.2, -0.7, -0.22] },
      { id: "eN", element: "N", position: [1.88, 0.02, 0.08] },
      { id: "eC", element: "C", position: [2.66, 0.46, 0.26] },
      { id: "eF", element: "F", position: [3.34, 0.12, 0.1] }
    ],
    bonds: [
      ...ringBonds("eR", 6, true),
      { from: "eR0", to: "eS", order: 1 },
      { from: "eS", to: "eO1", order: 2 },
      { from: "eS", to: "eO2", order: 2 },
      { from: "eS", to: "eN", order: 1 },
      { from: "eN", to: "eC", order: 1, rotatable: true },
      { from: "eC", to: "eF", order: 1 }
    ]
  };
}

export const MOLECULE_LIBRARY = [candidateA(), candidateB(), candidateC(), candidateD(), candidateE()] as const;

export function validateMolecularGraph(graph: MolecularGraph) {
  const atoms = new Map(graph.atoms.map((atom) => [atom.id, atom]));
  if (atoms.size !== graph.atoms.length || graph.atoms.length < 3) return false;
  const valence = new Map<string, number>();
  const edges = new Set<string>();

  for (const bond of graph.bonds) {
    if (!atoms.has(bond.from) || !atoms.has(bond.to) || bond.from === bond.to) return false;
    const edge = [bond.from, bond.to].sort().join(":");
    if (edges.has(edge)) return false;
    edges.add(edge);
    valence.set(bond.from, (valence.get(bond.from) || 0) + bond.order);
    valence.set(bond.to, (valence.get(bond.to) || 0) + bond.order);
  }

  return graph.atoms.every((atom) => (valence.get(atom.id) || 0) > 0 && (valence.get(atom.id) || 0) <= ELEMENT_STYLE[atom.element].valence);
}

if (!MOLECULE_LIBRARY.every(validateMolecularGraph)) {
  throw new Error("Drug Discovery molecular library contains an invalid atom/bond graph");
}

function BondSegment({
  start,
  end,
  radius,
  color,
  offset = 0
}: {
  start: readonly [number, number, number];
  end: readonly [number, number, number];
  radius: number;
  color: string;
  offset?: number;
}) {
  const transform = useMemo(() => {
    const from = new Vector3(...start);
    const to = new Vector3(...end);
    const direction = to.clone().sub(from);
    const length = direction.length();
    const normalized = direction.clone().normalize();
    const reference = Math.abs(normalized.z) < 0.88 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
    const perpendicular = new Vector3().crossVectors(normalized, reference).normalize().multiplyScalar(offset);
    return {
      position: from.clone().add(to).multiplyScalar(0.5).add(perpendicular),
      quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), normalized),
      length
    };
  }, [end, offset, start]);

  return (
    <mesh position={transform.position} quaternion={transform.quaternion}>
      <cylinderGeometry args={[radius, radius, transform.length, 8]} />
      <meshStandardMaterial color={color} roughness={0.4} metalness={0.26} emissive="#102b33" emissiveIntensity={0.2} />
    </mesh>
  );
}

export function MoleculeModel({
  graph,
  representation = "ball-and-stick",
  accent,
  scale = 1,
  flex = 0,
  phase = 0
}: {
  graph: MolecularGraph;
  representation?: MoleculeRepresentation;
  accent?: string;
  scale?: number;
  flex?: number;
  phase?: number;
}) {
  const flexibleGroup = useRef<Group>(null);
  const atoms = useMemo(() => new Map(graph.atoms.map((atom) => [atom.id, atom])), [graph]);
  const atomScale = representation === "graph" ? 0.72 : representation === "stick" ? 0.52 : 1;
  const bondRadius = representation === "graph" ? 0.045 : representation === "stick" ? 0.06 : 0.075;
  const bondColor = accent || "#91aab1";
  const partition = useMemo(() => {
    const rotatable = graph.bonds.find((bond) => bond.rotatable);
    if (!rotatable || flex <= 0) return null;
    const adjacency = new Map<string, string[]>();
    graph.bonds.forEach((bond) => {
      if (bond === rotatable) return;
      adjacency.set(bond.from, [...(adjacency.get(bond.from) || []), bond.to]);
      adjacency.set(bond.to, [...(adjacency.get(bond.to) || []), bond.from]);
    });
    const flexibleAtomIds = new Set<string>();
    const pending = [rotatable.to];
    while (pending.length > 0) {
      const atomId = pending.pop();
      if (!atomId || atomId === rotatable.from || flexibleAtomIds.has(atomId)) continue;
      flexibleAtomIds.add(atomId);
      (adjacency.get(atomId) || []).forEach((neighbor) => pending.push(neighbor));
    }
    if (flexibleAtomIds.has(rotatable.from)) return null;
    const pivot = atoms.get(rotatable.from)?.position;
    return pivot ? { rotatable, flexibleAtomIds, pivot } : null;
  }, [atoms, flex, graph]);

  useFrame(({ clock }) => {
    if (!flexibleGroup.current || !partition) return;
    const movement = Math.sin(clock.elapsedTime * 0.46 + phase) * flex;
    flexibleGroup.current.rotation.set(movement * 0.32, movement, movement * 0.18);
  });

  const offsetPosition = (position: readonly [number, number, number], pivot?: readonly [number, number, number]) => (
    pivot
      ? [position[0] - pivot[0], position[1] - pivot[1], position[2] - pivot[2]] as const
      : position
  );

  const renderBond = (bond: MolecularBond, pivot?: readonly [number, number, number]) => {
    const from = atoms.get(bond.from);
    const to = atoms.get(bond.to);
    if (!from || !to) return null;
    const bridge = partition?.rotatable === bond && pivot;
    const fromPosition = bridge ? [0, 0, 0] as const : offsetPosition(from.position, pivot);
    const toPosition = offsetPosition(to.position, pivot);
    return (
      <group key={`${bond.from}-${bond.to}`}>
        <BondSegment start={fromPosition} end={toPosition} radius={bondRadius} color={bondColor} offset={bond.order === 2 ? -0.055 : 0} />
        {bond.order === 2 ? <BondSegment start={fromPosition} end={toPosition} radius={bondRadius * 0.82} color={bondColor} offset={0.055} /> : null}
      </group>
    );
  };

  const renderAtom = (atom: MolecularAtom, pivot?: readonly [number, number, number]) => {
    const style = ELEMENT_STYLE[atom.element];
    return (
      <mesh key={atom.id} position={offsetPosition(atom.position, pivot)} scale={style.radius * atomScale}>
        <sphereGeometry args={[1, representation === "graph" ? 8 : 12, representation === "graph" ? 6 : 10]} />
        <meshStandardMaterial
          color={style.color}
          emissive={atom.element === "C" ? "#112c34" : style.color}
          emissiveIntensity={atom.element === "C" ? 0.18 : 0.08}
          roughness={0.36}
          metalness={0.18}
        />
      </mesh>
    );
  };

  const fixedAtoms = partition ? graph.atoms.filter((atom) => !partition.flexibleAtomIds.has(atom.id)) : graph.atoms;
  const fixedBonds = partition
    ? graph.bonds.filter((bond) => bond !== partition.rotatable && !partition.flexibleAtomIds.has(bond.from) && !partition.flexibleAtomIds.has(bond.to))
    : graph.bonds;
  const flexibleAtoms = partition ? graph.atoms.filter((atom) => partition.flexibleAtomIds.has(atom.id)) : [];
  const flexibleBonds = partition
    ? graph.bonds.filter((bond) => bond === partition.rotatable || (partition.flexibleAtomIds.has(bond.from) && partition.flexibleAtomIds.has(bond.to)))
    : [];

  return (
    <group scale={scale}>
      {fixedBonds.map((bond) => renderBond(bond))}
      {fixedAtoms.map((atom) => renderAtom(atom))}
      {partition ? (
        <group ref={flexibleGroup} position={partition.pivot}>
          {flexibleBonds.map((bond) => renderBond(bond, partition.pivot))}
          {flexibleAtoms.map((atom) => renderAtom(atom, partition.pivot))}
        </group>
      ) : null}
    </group>
  );
}

export function AnimatedMolecule({
  graph,
  representation = "ball-and-stick",
  accent,
  scale = 1,
  phase = 0,
  progress,
  flex = 0.08
}: {
  graph: MolecularGraph;
  representation?: MoleculeRepresentation;
  accent?: string;
  scale?: number;
  phase?: number;
  progress?: MutableRefObject<number>;
  flex?: number;
}) {
  const group = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const elapsed = clock.elapsedTime;
    const active = progress ? MathUtils.smoothstep(progress.current, 0.18, 0.82) : 1;
    group.current.rotation.y = phase + elapsed * 0.08 * active;
    group.current.rotation.x = Math.sin(elapsed * 0.18 + phase) * flex * active;
    group.current.rotation.z = Math.cos(elapsed * 0.13 + phase) * flex * 0.55 * active;
  });

  return (
    <group ref={group}>
      <MoleculeModel graph={graph} representation={representation} accent={accent} scale={scale} flex={flex * 0.72} phase={phase} />
    </group>
  );
}

"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  Group,
  InstancedMesh,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  Quaternion,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  Vector3,
} from "three";
import {
  executiveDocument,
  executiveFlow,
  executiveSlab,
  updateExecutiveFlow,
} from "./ExecutiveGeometry";
import {
  evaluateExecutiveMotion,
  type ExecutiveVector,
} from "./ExecutiveMotion";

const RECORD_COUNT = 12;
const LEDGER_X = [-0.65, 0.88, 2.4] as const;
const COLUMN_HEIGHTS = [
  0.56, 0.89, 0.7, 0.8, 0.62, 0.38, 0.65, 0.52, 0.91, 0.7,
];
const RISK_INDEX = 3;
const RISK_X = -0.95 + RISK_INDEX * 0.92;

type Mark = {
  position: [number, number, number];
  scale: [number, number, number];
};

/** A locally authored reflection studio. No downloaded HDRs or imagery. */
function ExecutiveStudio() {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const environmentScene = new Scene();
    environmentScene.background = new Color("#33363b");
    const cards: Mesh[] = [];
    const layouts: Array<{
      p: [number, number, number];
      s: [number, number];
      c: string;
      v: number;
    }> = [
      { p: [-6, 6, 5], s: [5, 9], c: "#f1f0ed", v: 5.2 },
      { p: [4, 8, -3], s: [7, 4], c: "#e5e8eb", v: 4.6 },
      { p: [7, 1, 3], s: [2.5, 7], c: "#ced3d9", v: 3.7 },
      { p: [-4, -1, -5], s: [5, 2], c: "#697789", v: 1.8 },
    ];
    for (const card of layouts) {
      const mesh = new Mesh(
        new PlaneGeometry(...card.s),
        new MeshBasicMaterial({
          color: new Color(card.c).multiplyScalar(card.v),
          side: DoubleSide,
        }),
      );
      mesh.position.set(...card.p);
      mesh.lookAt(0, 0, 0);
      environmentScene.add(mesh);
      cards.push(mesh);
    }
    const generator = new PMREMGenerator(gl);
    const texture = generator.fromScene(environmentScene, 0, 0.1, 50);
    const priorEnvironment = scene.environment;
    const priorIntensity = scene.environmentIntensity;
    scene.environment = texture.texture;
    scene.environmentIntensity = 0.88;
    invalidate();
    return () => {
      scene.environment = priorEnvironment;
      scene.environmentIntensity = priorIntensity;
      texture.dispose();
      generator.dispose();
      for (const card of cards) {
        card.geometry.dispose();
        (card.material as MeshBasicMaterial).dispose();
      }
    };
  }, [gl, scene, invalidate]);
  return null;
}

function machiningTexture() {
  const side = 64,
    data = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y += 1)
    for (let x = 0; x < side; x += 1) {
      const value = Math.round(
        182 + 17 * Math.sin(y * 2.17) + 9 * Math.sin(x * 17.1 + y * 11.7),
      );
      const offset = (y * side + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  const texture = new DataTexture(
    data,
    side,
    side,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(3, 14);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Local typography textures annotate geometry; there is no external font or image request. */
function executiveLabel(text: string) {
  let texture: CanvasTexture | null = null;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 144;
    const context = canvas.getContext("2d");
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.font =
        "500 72px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.shadowColor = "rgba(0,0,0,0.68)";
      context.shadowBlur = 10;
      context.shadowOffsetY = 3;
      context.fillStyle = "#eef0f2";
      context.fillText(text, 384, 75, 718);
      texture = new CanvasTexture(canvas);
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
    }
  }
  return {
    texture,
    material: new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      alphaTest: 0.015,
    }),
  };
}

function useExecutiveParts(compact: boolean) {
  const parts = useMemo(() => {
    const finish = machiningTexture();
    const metal = (color: string, roughness = 0.37) =>
      new MeshPhysicalMaterial({
        color,
        metalness: 0.6,
        roughness,
        roughnessMap: finish,
        clearcoat: 0.16,
        clearcoatRoughness: 0.4,
      });
    const materials = {
      terrain: metal("#313b49", 0.43),
      underside: metal("#24282f", 0.48),
      document: metal("#73869a", 0.39),
      documentEdge: metal("#c2c7cd", 0.36),
      ledger: metal("#495869", 0.38),
      column: metal("#3d4d62", 0.41),
      etching: metal("#c2c9cf", 0.46),
      darkEtching: metal("#252a32", 0.62),
      source: metal("#90a0b1", 0.38),
      context: metal("#64798e", 0.4),
      interpretation: metal("#4d6079", 0.38),
      folio: metal("#3c4c60", 0.4),
      folioPage: metal("#6c8199", 0.45),
      blue: new MeshPhysicalMaterial({
        color: "#3d6df4",
        metalness: 0.5,
        roughness: 0.27,
        emissive: "#315bdd",
        emissiveIntensity: 0.32,
        clearcoat: 0.3,
      }),
      caps: new MeshPhysicalMaterial({
        color: "#6b8eba",
        metalness: 0.5,
        roughness: 0.34,
        emissive: "#4268a1",
        emissiveIntensity: 0.06,
      }),
      amber: new MeshPhysicalMaterial({
        color: "#647a96",
        metalness: 0.55,
        roughness: 0.37,
        emissive: "#a76c24",
        emissiveIntensity: 0.025,
      }),
      flow: new MeshStandardMaterial({
        color: "#90aacb",
        emissive: "#4f6c95",
        emissiveIntensity: 0.36,
        metalness: 0.45,
        roughness: 0.36,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
      sourceFlow: new MeshStandardMaterial({
        color: "#a6b2c2",
        emissive: "#62738b",
        emissiveIntensity: 0.25,
        metalness: 0.45,
        roughness: 0.4,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
      target: new MeshStandardMaterial({
        color: "#8796a9",
        metalness: 0.45,
        roughness: 0.56,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      }),
    };
    const labels = {
      revenue: executiveLabel("Revenue"),
      costs: executiveLabel("Costs"),
      margin: executiveLabel("Margin"),
      sources: executiveLabel("Sources"),
      source: executiveLabel("Source"),
      measure: executiveLabel("Measure"),
      context: executiveLabel("Context"),
      interpretation: executiveLabel("Interpretation"),
    };
    const geometry = {
      terrain: executiveSlab(9.35, 5.9, 0.28, 0.21, 0.055),
      underside: executiveSlab(8.85, 5.43, 0.15, 0.19, 0.045),
      foot: executiveSlab(0.82, 0.65, 0.22, 0.08, 0.025),
      unit: new BoxGeometry(1, 1, 1),
      label: new PlaneGeometry(1, 1),
      record: executiveDocument(0.7, 0.6, 0.047),
      ledger: executiveSlab(1.14, 1.13, 0.1, 0.05, 0.018),
      ledgerFoot: executiveSlab(1.32, 1.37, 0.09, 0.06, 0.022),
      column: executiveSlab(0.52, 0.59, 1, 0.035, 0.024),
      cap: executiveSlab(0.49, 0.56, 0.035, 0.03, 0.008),
      evidence: Array.from({ length: 4 }, (_, i) =>
        executiveDocument(1.65 - i * 0.095, 1.13 - i * 0.025, 0.075),
      ),
      folio: executiveSlab(4.3, 2.86, 0.16, 0.13, 0.03),
      folioPage: executiveDocument(1.87, 2.54, 0.054),
      tab: executiveSlab(0.38, 0.86, 0.065, 0.065, 0.015),
    };
    const financialFlows = Array.from({ length: 6 }, () =>
      executiveFlow(compact ? 20 : 34, 5),
    );
    const evidenceFlows = Array.from({ length: 4 }, () =>
      executiveFlow(compact ? 24 : 36, 5),
    );
    return {
      materials,
      geometry,
      finish,
      financialFlows,
      evidenceFlows,
      labels,
    };
  }, [compact]);
  useEffect(
    () => () => {
      Object.values(parts.materials).forEach((material) => material.dispose());
      Object.values(parts.geometry)
        .flat()
        .forEach((geometry) => geometry.dispose());
      [...parts.financialFlows, ...parts.evidenceFlows].forEach((geometry) =>
        geometry.dispose(),
      );
      parts.finish.dispose();
      Object.values(parts.labels).forEach((label) => {
        label.material.dispose();
        label.texture?.dispose();
      });
    },
    [parts],
  );
  return parts;
}

type Parts = ReturnType<typeof useExecutiveParts>;
function Marks({
  parts,
  marks,
  dark = false,
  blue = false,
}: {
  parts: Parts;
  marks: Mark[];
  dark?: boolean;
  blue?: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const object = new Object3D();
    marks.forEach((mark, index) => {
      object.position.set(...mark.position);
      object.scale.set(...mark.scale);
      object.updateMatrix();
      ref.current?.setMatrixAt(index, object.matrix);
    });
    if (ref.current) {
      ref.current.instanceMatrix.needsUpdate = true;
      ref.current.computeBoundingSphere();
    }
  }, [marks]);
  return (
    <instancedMesh
      ref={ref}
      args={[
        parts.geometry.unit,
        blue
          ? parts.materials.blue
          : dark
            ? parts.materials.darkEtching
            : parts.materials.etching,
        marks.length,
      ]}
      frustumCulled={false}
    />
  );
}

function EvidenceLeaf({
  parts,
  index,
  labelRef,
}: {
  parts: Parts;
  index: number;
  labelRef: (mesh: Mesh | null) => void;
}) {
  const marks = useMemo<Mark[]>(
    () =>
      Array.from({ length: index === 3 ? 4 : 6 }, (_, line) => ({
        position: [-0.08, 0.058, -0.36 + line * 0.12],
        scale: [(index === 3 ? 0.74 : 1.12) - (line % 3) * 0.16, 0.01, 0.023],
      })),
    [index],
  );
  const material = [
    parts.materials.source,
    parts.materials.document,
    parts.materials.context,
    parts.materials.interpretation,
  ][index];
  return (
    <group>
      <mesh geometry={parts.geometry.evidence[index]} material={material} />
      <Marks parts={parts} marks={marks} dark={index < 2} />
      <mesh
        ref={labelRef}
        position={[0, 0.3, 0.05]}
        scale={[index === 3 ? 1.57 : 1.35, 0.253, 1]}
        geometry={parts.geometry.label}
        material={
          parts.labels[
            (["source", "measure", "context", "interpretation"] as const)[index]
          ].material
        }
      />
      <mesh
        position={[-0.62 + index * 0.03, 0.065, -0.32]}
        scale={[0.034, 0.011, 0.35]}
        geometry={parts.geometry.unit}
        material={parts.materials.blue}
      />
    </group>
  );
}

function BriefingFolio({ parts }: { parts: Parts }) {
  const leftMarks = useMemo<Mark[]>(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        position: [
          -1.03 + (i % 3 === 0 ? -0.08 : 0),
          0.159,
          -0.94 + Math.floor(i / 3) * 0.48 + (i % 3) * 0.075,
        ],
        scale: [
          i % 3 === 0 ? 1.34 : 0.98 - (i % 2) * 0.18,
          0.012,
          i % 3 === 0 ? 0.04 : 0.019,
        ],
      })),
    [],
  );
  const rightMarks = useMemo<Mark[]>(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        position: [0.98, 0.159, -0.91 + i * 0.153],
        scale: [1.35 - (i % 4) * 0.17, 0.012, 0.024],
      })),
    [],
  );
  const blueMarks = useMemo<Mark[]>(
    () => [
      { position: [-1.71, 0.16, -0.92], scale: [0.055, 0.014, 0.24] },
      { position: [-1.71, 0.16, -0.43], scale: [0.055, 0.014, 0.24] },
      { position: [-1.71, 0.16, 0.06], scale: [0.055, 0.014, 0.24] },
      { position: [-1.71, 0.16, 0.55], scale: [0.055, 0.014, 0.24] },
    ],
    [],
  );
  return (
    <group>
      <mesh geometry={parts.geometry.folio} material={parts.materials.folio} />
      <mesh
        position={[-1.0, 0.112, 0]}
        geometry={parts.geometry.folioPage}
        material={parts.materials.folioPage}
      />
      <mesh
        position={[1.0, 0.112, 0]}
        geometry={parts.geometry.folioPage}
        material={parts.materials.document}
      />
      <mesh
        position={[0, 0.14, 0]}
        scale={[0.07, 0.045, 2.43]}
        geometry={parts.geometry.unit}
        material={parts.materials.darkEtching}
      />
      <Marks parts={parts} marks={leftMarks} />
      <Marks parts={parts} marks={rightMarks} dark />
      <Marks parts={parts} marks={blueMarks} blue />
      <mesh
        position={[1.69, 0.163, 0.82]}
        scale={[0.085, 0.023, 0.19]}
        geometry={parts.geometry.unit}
        material={parts.materials.amber}
      />
      <group position={[2.58, 0.16, 0.78]} rotation={[0, 0.025, 0]}>
        <mesh
          geometry={parts.geometry.tab}
          material={parts.materials.folioPage}
        />
        <mesh
          position={[0, 0.053, 0]}
          scale={[0.16, 0.012, 0.47]}
          geometry={parts.geometry.unit}
          material={parts.materials.blue}
        />
      </group>
    </group>
  );
}

/** A business-specific landscape: records, relationships, divergence, evidence and a reviewable briefing. */
export function ExecutiveWorld({
  progress,
  compact,
}: {
  progress: MutableRefObject<number>;
  compact: boolean;
}) {
  const parts = useExecutiveParts(compact);
  const { camera, size } = useThree();
  const records = useRef<InstancedMesh>(null),
    recordMarks = useRef<InstancedMesh>(null);
  const ledger = useRef<InstancedMesh>(null),
    ledgerMarks = useRef<InstancedMesh>(null);
  const columns = useRef<InstancedMesh>(null),
    caps = useRef<InstancedMesh>(null),
    bands = useRef<InstancedMesh>(null);
  const riskCap = useRef<Mesh>(null),
    riskDelta = useRef<Mesh>(null),
    riskMarker = useRef<Group>(null);
  const evidence = useRef<Array<Group | null>>([]),
    briefing = useRef<Group>(null);
  const ledgerLabels = useRef<Array<Mesh | null>>([]),
    evidenceLabels = useRef<Array<Mesh | null>>([]),
    sourceLabel = useRef<Mesh>(null);
  const last = useRef(-1),
    lastAspect = useRef(0);
  const scratch = useMemo(
    () => ({
      object: new Object3D(),
      target: new Vector3(),
      parentRotation: new Quaternion(),
      viewRotation: new Quaternion(),
      amber: new Color("#c48a43"),
      neutral: new Color("#647a96"),
    }),
    [],
  );
  const terrainMarks = useMemo<Mark[]>(
    () => [
      { position: [-1.53, 0.202, 0], scale: [0.017, 0.009, 4.92] },
      { position: [1.02, 0.202, -0.37], scale: [4.27, 0.009, 0.017] },
      { position: [0.67, 0.202, 2.56], scale: [6.24, 0.009, 0.026] },
      { position: [-3.12, 0.202, -2.51], scale: [1.95, 0.009, 0.026] },
      ...Array.from(
        { length: 23 },
        (_, i): Mark => ({
          position: [-4.01 + i * 0.35, 0.202, 2.64],
          scale: [0.02, 0.009, i % 5 === 0 ? 0.2 : 0.09],
        }),
      ),
    ],
    [],
  );
  useLayoutEffect(() => {
    last.current = -1;
  }, [parts, compact]);

  useFrame(() => {
    const state = evaluateExecutiveMotion(progress.current, compact);
    const aspect = size.width / Math.max(1, size.height);
    if (last.current === state.progress && lastAspect.current === aspect)
      return;
    last.current = state.progress;
    lastAspect.current = aspect;
    scratch.target.set(...state.target);
    const framing = aspect < 1.15 ? 1.15 / aspect : 1;
    camera.position.set(
      scratch.target.x + (state.camera[0] - scratch.target.x) * framing,
      scratch.target.y + (state.camera[1] - scratch.target.y) * framing,
      scratch.target.z + (state.camera[2] - scratch.target.z) * framing,
    );
    camera.lookAt(scratch.target);
    if (camera instanceof PerspectiveCamera) {
      camera.fov = state.fov;
      camera.near = 0.05;
      camera.far = 70;
      camera.updateProjectionMatrix();
    }
    const set = (
      mesh: InstancedMesh | null,
      index: number,
      position: ExecutiveVector,
      scale: ExecutiveVector = [1, 1, 1],
      rotation: ExecutiveVector = [0, 0, 0],
    ) => {
      if (!mesh) return;
      scratch.object.position.set(...position);
      scratch.object.scale.set(...scale);
      scratch.object.rotation.set(...rotation);
      scratch.object.updateMatrix();
      mesh.setMatrixAt(index, scratch.object.matrix);
    };
    const recordTop: ExecutiveVector[] = [];
    for (let i = 0; i < RECORD_COUNT; i += 1) {
      const col = i % 2,
        row = Math.floor(i / 2);
      const x = -3.8 + col * 0.97 + (col ? 1 : -1) * 0.11 * state.recordSpread;
      const z = -1.87 + row * 0.71;
      const rise = 0.035 * (i % 4) * state.recordSpread;
      const yaw = Math.sin(i * 1.7) * 0.035 * state.recordSpread;
      for (let layer = 0; layer < 3; layer += 1)
        set(
          records.current,
          i * 3 + layer,
          [x + layer * 0.024, yBase(layer) + rise, z - layer * 0.015],
          [1, 1, 1],
          [0, yaw, 0],
        );
      const top = 0.374 + rise;
      recordTop.push([x, top, z]);
      for (let mark = 0; mark < 4; mark += 1)
        set(
          recordMarks.current,
          i * 4 + mark,
          [x - 0.035, top + 0.01, z - 0.17 + mark * 0.098],
          [0.42 - (mark % 2) * 0.1, 0.008, 0.018],
          [0, yaw, 0],
        );
    }
    for (let district = 0; district < 3; district += 1) {
      const height = state.ledgerHeights[district];
      ledgerLabels.current[district]?.position.set(
        LEDGER_X[district],
        0.65 + height,
        -1.33,
      );
      for (let layer = 0; layer < 8; layer += 1)
        set(
          ledger.current,
          district * 8 + layer,
          [LEDGER_X[district], 0.29 + (layer / 7) * height, -1.33],
          [1, Math.min(1, height / 0.88), 1],
        );
      for (let mark = 0; mark < 5; mark += 1)
        set(
          ledgerMarks.current,
          district * 5 + mark,
          [LEDGER_X[district] - 0.02, 0.37 + height, -1.67 + mark * 0.16],
          [0.83 - (mark % 3) * 0.11, 0.009, 0.025],
        );
    }
    let capIndex = 0;
    for (let i = 0; i < 10; i += 1) {
      const x = -0.95 + (i % 5) * 0.92,
        z = 0.39 + Math.floor(i / 5) * 1.23;
      const h =
        i === RISK_INDEX
          ? state.riskHeight
          : COLUMN_HEIGHTS[i] * state.columnRelief;
      set(columns.current, i, [x, 0.21 + h / 2, z], [1, h / 1.048, 1]);
      if (i === RISK_INDEX) {
        if (riskCap.current) riskCap.current.position.set(x, 0.23 + h, z);
      } else {
        set(caps.current, capIndex, [x, 0.23 + h, z]);
        capIndex += 1;
      }
      for (let band = 0; band < 3; band += 1)
        set(
          bands.current,
          i * 3 + band,
          [x, 0.26 + h * (0.25 + band * 0.22), z + 0.325],
          [0.36, 0.016, 0.009],
        );
    }
    if (riskDelta.current) {
      riskDelta.current.position.set(
        RISK_X + 0.38,
        0.21 + (1.04 + state.riskHeight) / 2,
        0.39,
      );
      riskDelta.current.scale.set(
        0.02,
        Math.max(0.025, Math.abs(state.riskHeight - 1.04)),
        0.025,
      );
    }
    if (riskMarker.current)
      riskMarker.current.visible = state.riskEmphasis > 0.15;
    parts.materials.amber.color
      .copy(scratch.neutral)
      .lerp(scratch.amber, state.riskEmphasis);
    parts.materials.amber.emissiveIntensity = 0.025 + state.riskEmphasis * 0.29;
    parts.materials.flow.opacity = 0.08 + 0.79 * state.relationshipReveal;
    parts.materials.flow.emissiveIntensity =
      0.12 + 0.45 * state.relationshipReveal;
    parts.materials.sourceFlow.opacity = 0.09 + 0.67 * state.evidenceReveal;
    parts.financialFlows.forEach((flow, index) => {
      const from = recordTop[index * 2];
      const district = index % 3;
      updateExecutiveFlow(
        flow,
        [from[0] + 0.33, from[1] + 0.045, from[2]],
        [LEDGER_X[district] - 0.56, 0.3 + state.ledgerHeights[district], -1.33],
        0.38 + index * 0.045,
        compact ? 0.027 : 0.023,
      );
    });
    state.evidence.forEach((pose, index) => {
      const group = evidence.current[index];
      if (group) {
        group.position.set(...pose.position);
        group.rotation.set(...pose.rotation);
        group.scale.set(...pose.scale);
      }
      updateExecutiveFlow(
        parts.evidenceFlows[index],
        [RISK_X - 0.2, 0.27 + state.riskHeight, 0.4],
        [pose.position[0] + 0.62, pose.position[1] + 0.09, pose.position[2]],
        0.28 + index * 0.08,
        0.018,
      );
    });
    if (briefing.current) {
      briefing.current.visible = state.briefingReveal > 0.025;
      briefing.current.position.set(...state.briefing.position);
      briefing.current.rotation.set(...state.briefing.rotation);
      briefing.current.scale.set(...state.briefing.scale);
    }
    const labelOpacity = Math.max(0, (state.evidenceReveal - 0.5) * 2);
    for (const label of [
      parts.labels.source,
      parts.labels.measure,
      parts.labels.context,
      parts.labels.interpretation,
    ])
      label.material.opacity = labelOpacity;
    camera.getWorldQuaternion(scratch.viewRotation);
    for (const label of [
      ...ledgerLabels.current,
      ...evidenceLabels.current,
      sourceLabel.current,
    ])
      if (label) {
        label.parent?.updateWorldMatrix(true, false);
        if (label.parent)
          label.parent.getWorldQuaternion(scratch.parentRotation).invert();
        else scratch.parentRotation.identity();
        label.quaternion
          .copy(scratch.parentRotation)
          .multiply(scratch.viewRotation);
      }
    for (const mesh of [
      records.current,
      recordMarks.current,
      ledger.current,
      ledgerMarks.current,
      columns.current,
      caps.current,
      bands.current,
    ])
      if (mesh) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
  }, 0);

  return (
    <group dispose={null}>
      <ExecutiveStudio />
      <ambientLight intensity={0.3} color="#d4d8dd" />
      <hemisphereLight args={["#eceeed", "#181c23", 0.55]} />
      <directionalLight position={[-4, 8, 6]} intensity={2.4} color="#f1f0ed" />
      <directionalLight position={[5, 4, -5]} intensity={1.4} color="#b5c1cf" />
      <pointLight
        position={[3, 7, 5]}
        intensity={15}
        distance={16}
        color="#e1e6eb"
      />
      <pointLight
        position={[-4, 1, -3]}
        intensity={4}
        distance={12}
        color="#527ac9"
      />
      <mesh
        geometry={parts.geometry.terrain}
        material={parts.materials.terrain}
      />
      <mesh
        position={[0, -0.19, 0]}
        geometry={parts.geometry.underside}
        material={parts.materials.underside}
      />
      {[
        [-3.65, -0.36, -2.1],
        [3.65, -0.36, -2.1],
        [-3.65, -0.36, 2.1],
        [3.65, -0.36, 2.1],
      ].map((position, index) => (
        <mesh
          key={index}
          position={position as [number, number, number]}
          geometry={parts.geometry.foot}
          material={parts.materials.underside}
        />
      ))}
      <Marks parts={parts} marks={terrainMarks} dark />
      <mesh
        position={[0, -0.105, 2.93]}
        scale={[7.7, 0.021, 0.015]}
        geometry={parts.geometry.unit}
        material={parts.materials.blue}
      />
      <instancedMesh
        ref={records}
        args={[
          parts.geometry.record,
          parts.materials.document,
          RECORD_COUNT * 3,
        ]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={recordMarks}
        args={[
          parts.geometry.unit,
          parts.materials.darkEtching,
          RECORD_COUNT * 4,
        ]}
        frustumCulled={false}
      />
      {LEDGER_X.map((x, index) => (
        <mesh
          key={index}
          position={[x, 0.205, -1.33]}
          geometry={parts.geometry.ledgerFoot}
          material={parts.materials.underside}
        />
      ))}
      {(["revenue", "costs", "margin"] as const).map((name, index) => (
        <mesh
          key={name}
          ref={(node) => {
            ledgerLabels.current[index] = node;
          }}
          scale={[1.36, 0.255, 1]}
          geometry={parts.geometry.label}
          material={parts.labels[name].material}
        />
      ))}
      <mesh
        ref={sourceLabel}
        position={[-3.3, 0.81, -2.22]}
        scale={[1.35, 0.253, 1]}
        geometry={parts.geometry.label}
        material={parts.labels.sources.material}
      />
      <instancedMesh
        ref={ledger}
        args={[parts.geometry.ledger, parts.materials.ledger, 24]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={ledgerMarks}
        args={[parts.geometry.unit, parts.materials.etching, 15]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={columns}
        args={[parts.geometry.column, parts.materials.column, 10]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={caps}
        args={[parts.geometry.cap, parts.materials.caps, 9]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={bands}
        args={[parts.geometry.unit, parts.materials.etching, 30]}
        frustumCulled={false}
      />
      <mesh
        ref={riskCap}
        geometry={parts.geometry.cap}
        material={parts.materials.amber}
      />
      <mesh
        ref={riskDelta}
        geometry={parts.geometry.unit}
        material={parts.materials.amber}
      />
      <group ref={riskMarker} position={[RISK_X, 1.25, 0.39]}>
        <mesh
          position={[0.02, 0, 0.36]}
          scale={[0.86, 0.02, 0.025]}
          geometry={parts.geometry.unit}
          material={parts.materials.target}
        />
        <mesh
          position={[-0.4, 0, 0.28]}
          scale={[0.02, 0.02, 0.18]}
          geometry={parts.geometry.unit}
          material={parts.materials.target}
        />
        <mesh
          position={[0.44, 0, 0.28]}
          scale={[0.02, 0.02, 0.18]}
          geometry={parts.geometry.unit}
          material={parts.materials.target}
        />
      </group>
      {parts.financialFlows.map((geometry, index) => (
        <mesh
          key={`finance-${index}`}
          geometry={geometry}
          material={parts.materials.flow}
        />
      ))}
      {parts.evidenceFlows.map((geometry, index) => (
        <mesh
          key={`evidence-flow-${index}`}
          geometry={geometry}
          material={parts.materials.sourceFlow}
        />
      ))}
      {Array.from({ length: 4 }, (_, index) => (
        <group
          key={index}
          ref={(node) => {
            evidence.current[index] = node;
          }}
        >
          <EvidenceLeaf
            parts={parts}
            index={index}
            labelRef={(node) => {
              evidenceLabels.current[index] = node;
            }}
          />
        </group>
      ))}
      <group ref={briefing}>
        <BriefingFolio parts={parts} />
      </group>
    </group>
  );
}

function yBase(layer: number) {
  return 0.215 + layer * 0.059;
}

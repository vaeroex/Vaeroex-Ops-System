export const ASSEMBLY_STAGES = [
  "Gather",
  "Organize",
  "See through",
  "Reframe",
  "Build",
] as const;
export const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
export type AssemblyPose = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};
/** Pure scroll-space choreography. No wall-clock drift: the same progress always gives the same pose. */
export function assemblyPose(
  index: number,
  count: number,
  progress: number,
): AssemblyPose {
  const family = index % 6,
    row = Math.floor(index / 6),
    rows = count / 6;
  const a = index * 2.399963,
    ring = row / Math.max(1, rows - 1);
  const theta = (family * Math.PI) / 3;
  const poses: AssemblyPose[] = [
    {
      position: [
        Math.cos(a) * (3.2 + ring * 2),
        (ring - 0.5) * 10,
        Math.sin(a) * 3.8,
      ],
      rotation: [Math.sin(a) * 0.6, Math.sin(a) * 1.2, Math.cos(a) * 0.35],
      scale: 0.88,
    },
    {
      position: [
        (family - 2.5) * 1.55,
        (row - (rows - 1) / 2) * 1.25,
        Math.sin(family) * 0.7,
      ],
      rotation: [0, -0.18, 0],
      scale: 0.78,
    },
    {
      position: [
        Math.cos(theta) * (3.2 + ring * 1.3),
        (ring - 0.5) * 9,
        Math.sin(theta) * (3.2 + ring * 1.3),
      ],
      rotation: [0.14, -theta + Math.PI / 2, 0.06],
      scale: 0.9,
    },
    {
      position: [
        Math.cos(a + family * 0.3) * (2.1 + family * 0.38),
        (family - 2.5) * 1.35,
        Math.sin(a + family * 0.3) * (2.1 + family * 0.38),
      ],
      rotation: [Math.PI / 2, 0, Math.sin(a + family * 0.3)],
      scale: 0.85,
    },
    {
      position: [
        Math.cos(theta + ring * 0.55) * 2.1,
        (ring - 0.5) * 6.6,
        Math.sin(theta + ring * 0.55) * 2.1,
      ],
      rotation: [0, -theta - ring * 0.55 + Math.PI / 2, 0],
      scale: 0.53,
    },
  ];
  const phase = clamp(progress) * 4,
    stage = Math.min(3, Math.floor(phase));
  const t = smooth(clamp((phase - stage - family * 0.012) / 0.94));
  const from = poses[stage],
    to = poses[stage + 1];
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    position: from.position.map((v, i) =>
      mix(v, to.position[i]),
    ) as AssemblyPose["position"],
    rotation: from.rotation.map((v, i) =>
      mix(v, to.rotation[i]),
    ) as AssemblyPose["rotation"],
    scale: mix(from.scale, to.scale),
  };
}
export function assemblyCamera(progress: number): [number, number, number] {
  const keys = [
    [11, 6, 19],
    [2, 2, 21],
    [12, 7, 16],
    [-10, 12, 17],
    [8, 5, 13],
  ];
  const p = clamp(progress) * 4,
    i = Math.min(3, Math.floor(p)),
    t = smooth(p - i);
  return keys[i].map((v, j) => v + (keys[i + 1][j] - v) * t) as [
    number,
    number,
    number,
  ];
}

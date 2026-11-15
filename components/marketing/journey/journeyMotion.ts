export type JourneyPoint = [
  number,
  number,
  number
];
export type JourneyPose = {
  position: JourneyPoint;
  rotation: JourneyPoint;
  scale: number;
};
export const journeyClamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
  const t = journeyClamp(value);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const vectorMix = (a: JourneyPoint, b: JourneyPoint, t: number): JourneyPoint => a.map((v, i) => mix(v, b[i], t)) as JourneyPoint;
/** Scroll is the only clock. Forward and reverse visits share identical geometry. */
export function journeyPanel(index: number, count: number, progress: number): JourneyPose {
  const p = journeyClamp(progress);
  const bank = index % 3, row = Math.floor(index / 3), rows = count / 3;
  const a = index * 2.399963;
  const scatter: JourneyPoint = [Math.cos(a) * (5 + row * .4), Math.sin(a * 1.7) * 4, -row * 2.2 + Math.cos(a) * 3];
  const corridor: JourneyPoint = [index % 2 ? 3.5 : -3.5, (bank - 1) * 1.45, -2 - row * 2.6];
  const ordered: JourneyPoint = [(bank - 1) * 7.8 + (row % 2 ? 1.35 : -1.35), -1.2 + Math.floor(row / 2) * .9, -9 - (row % 2) * 1.8];
  const gathered = smooth(p / .24), resolved = smooth((p - .6) / .4);
  return {
    position: vectorMix(vectorMix(scatter, corridor, gathered), ordered, resolved),
    rotation: vectorMix([Math.sin(a) * .55 * (1 - gathered), mix(Math.sin(a) * .8, index % 2 ? -.82 : .82, gathered), Math.cos(a) * .4 * (1 - gathered)], [-.18, 0, 0], resolved),
    scale: mix(.8, rows > 6 ? .68 : .84, resolved),
  };
}
export function journeyFrame(index: number, progress: number): JourneyPoint {
  const t = smooth((progress - .6) / .4);
  return vectorMix([0, 0, -2 - index * 2.8], [(index % 3 - 1) * 7.8, 0, -10 - Math.floor(index / 3) * 2], t);
}
export function journeyCamera(progress: number, compact = false): {
  position: JourneyPoint;
  target: JourneyPoint;
} {
  const stages = [0, .24, .5, .72, 1];
  // The middle viewpoint is inside the architecture, beyond its first three gates.
  const positions: JourneyPoint[] = [[6, 2.8, 3], [.8, .6, 4], [.25, .25, -10], [8, 4, 3], [6, 4, 1]];
  const targets: JourneyPoint[] = [[0, 0, -7], [0, 0, -14], [0, 0, -27], [0, 0, -12], [0, -.2, -11]];
  const p = journeyClamp(progress);
  const i = Math.min(3, stages.findIndex((end, j) => j > 0 && p <= end) - 1);
  const stage = Math.max(0, i);
  const t = smooth((p - stages[stage]) / (stages[stage + 1] - stages[stage]));
  const position = vectorMix(positions[stage], positions[stage + 1], t);
  const target = vectorMix(targets[stage], targets[stage + 1], t);
  // Keep the architectural travel on mobile; only the overview framing widens.
  if (compact) {
    const overview = 1 - smooth(p / .24) + smooth((p - .6) / .4);
    position[2] += overview * 3;
    position[1] += overview * .5;
  }
  return { position, target };
}

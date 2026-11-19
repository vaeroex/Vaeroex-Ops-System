import type { ReactNode } from "react";
import type { Display } from "./view";
import type { Structure } from "./structures";

export const atomColors: Record<string, string> = { C: "#dce8df", N: "#719bff", O: "#fb817b", S: "#f3c85e", ZN: "#c698f8" };
export const initialView = { yaw: 0.72, pitch: -0.37, zoom: 1 };
export type View = typeof initialView;
type Point = { x: number; y: number; depth: number };
type Layer = { depth: number; node: ReactNode };

export default function SiteGraphic({ site, label, view = initialView, display, frame }: {
  site: Structure; label: string; view?: View; display?: Display; frame?: { center: number[]; radius: number };
}) {
  const { yaw, pitch, zoom } = display?.view ?? view;
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const scale = (frame ? 173 / frame.radius : 22) * zoom;
  const size = frame ? scale / 22 : zoom;
  const center = frame?.center ?? site.center;
  const compoundOnly = display?.mode === "ligand";
  const metalVisible = !compoundOnly && (display?.zinc ?? true);
  const opacity = display?.opacity ?? 1;
  const project = ([x, y, z]: number[]): Point => {
    x -= center[0]; y -= center[1]; z -= center[2];
    const side = x * cy + z * sy, depth = z * cy - x * sy;
    return { x: 260 + side * scale, y: 173 - (y * cp - depth * sp) * scale, depth: depth * cp + y * sp };
  };
  const points = site.atoms.map(a => project(a.xyz));
  const layers: Layer[] = [];
  const edges = (a: Point, b: Point) => ({ x1:a.x, y1:a.y, x2:b.x, y2:b.y });
  const metal = site.atoms.findIndex(a => a.element === "ZN");
  for (const [a,b] of site.contacts) {
    if (!metalVisible || (site.atoms[b].residue === "HIS" && !opacity)) continue;
    layers.push({depth: (points[a].depth+points[b].depth)/2, node: <line key={`link-${a}-${b}`} {...edges(points[a],points[b])} stroke="#cab5d8" strokeDasharray={`${3*size} ${4*size}`} strokeWidth={1.9*size} />});
  }
  for (const [a,b] of site.bonds) {
    const start=points[a], end=points[b];
    const middle={ x:(start.x+end.x)/2, y:(start.y+end.y)/2, depth:(start.depth+end.depth)/2 };
    const protein = site.atoms[a].residue === "HIS";
    if (protein && (compoundOnly || !opacity)) continue;
    for (const i of [a,b]) {
      const atom = site.atoms[i];
      const color = protein ? (atom.element === "N" ? "#7088aa" : "#526c81") : atomColors[atom.element];
      layers.push({depth:(points[i].depth+middle.depth)/2, node:<line key={`bond-${a}-${b}-${i}`} {...edges(points[i],middle)} stroke={color} opacity={protein && display ? opacity : undefined} strokeWidth={(protein ? 3.4 : 6)*size} strokeLinecap="round" />});
    }
  }
  site.atoms.forEach((atom,i) => {
    const p=points[i], protein=atom.residue === "HIS";
    if ((protein && (compoundOnly || !opacity)) || (atom.element === "ZN" && !metalVisible)) return;
    const r=(protein ? 3.1 : atom.element === "ZN" ? 9 : atom.element === "S" ? 6.8 : 5.1)*size;
    layers.push({depth:p.depth + 0.03, node:<circle key={atom.number+"-"+atom.name} cx={p.x} cy={p.y} r={r}
      fill={protein ? (atom.element === "N" ? "#7088aa" : "#526c81") : `url(#atom-${atom.element})`}
      stroke={protein ? "none" : "#142332"} opacity={protein && display ? opacity : undefined} strokeWidth={.7*size}><title>{`${atom.residue} A ${atom.number} · ${atom.name}`}</title></circle>});
  });
  const trace = display?.mode === "protein" ? site.chain.flatMap((residue,i) => {
    const last = site.chain[i-1];
    return last && Math.hypot(...residue.xyz.map((n,j)=>n-last.xyz[j])) < 4.2 ? [[last.xyz,residue.xyz]] : [];
  }) : site.trace;
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 346" role="img" aria-label={label}>
    <title>{label}</title>
    <defs>{Object.entries(atomColors).map(([element,color]) => <radialGradient key={element} id={`atom-${element}`} cx="34%" cy="26%" r="80%">
      <stop offset="0" stopColor="#fff" /><stop offset=".36" stopColor={color} /><stop offset=".78" stopColor={color} /><stop offset="1" stopColor="#4a5364" />
    </radialGradient>)}</defs>
    {!compoundOnly && <g stroke="#526a80" strokeWidth={display?.mode === "protein" ? 5*size : 2.5*size} strokeLinecap="round" opacity={display ? opacity : ".46"}>
      {trace.map(([a,b],i) => <line key={i} {...edges(project(a),project(b))} />)}
    </g>}
    {layers.sort((a,b)=>a.depth-b.depth).map(layer=>layer.node)}
    {metalVisible && <text x={points[metal].x + 12 * size} y={points[metal].y + 6 * size} fontFamily="Arial,sans-serif" fontSize="13" fill="#ebd9ff" stroke="#101e2a" strokeWidth="3" paintOrder="stroke">Zn</text>}
    {!compoundOnly && display?.labels && site.atoms.map((a,i)=>a.residue === "HIS" && a.name === "CA" ?
      <text key={a.number} x={points[i].x+6} y={points[i].y-8} fill="#f2f8f5" stroke="#101e2a" strokeWidth="3" paintOrder="stroke" fontSize="13">His {a.number}</text> : null)}
  </svg>;
}

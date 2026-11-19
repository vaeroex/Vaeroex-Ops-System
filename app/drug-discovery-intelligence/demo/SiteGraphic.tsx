import type { ReactNode } from "react";
import type { Structure } from "./structures";

export const atomColors: Record<string, string> = { C: "#dce8df", N: "#719bff", O: "#fb817b", S: "#f3c85e", ZN: "#c698f8" };
export const initialView = { yaw: 0.72, pitch: -0.37, zoom: 1 };
export type View = typeof initialView;
type Point = { x: number; y: number; depth: number };
type Layer = { depth: number; node: ReactNode };

export default function SiteGraphic({ site, label, view = initialView }: { site: Structure; label: string; view?: View }) {
  const { yaw, pitch, zoom } = view;
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const scale = 22 * zoom;
  const project = ([x, y, z]: number[]): Point => {
    x -= site.center[0]; y -= site.center[1]; z -= site.center[2];
    const side = x * cy + z * sy, depth = z * cy - x * sy;
    return { x: 260 + side * scale, y: 173 - (y * cp - depth * sp) * scale, depth: depth * cp + y * sp };
  };
  const points = site.atoms.map(a => project(a.xyz));
  const layers: Layer[] = [];
  const edges = (a: Point, b: Point) => ({ x1:a.x, y1:a.y, x2:b.x, y2:b.y });
  const metal = site.atoms.findIndex(a => a.element === "ZN");
  for (const [a,b] of site.contacts) {
    layers.push({depth: (points[a].depth+points[b].depth)/2, node: <line key={`link-${a}-${b}`} {...edges(points[a],points[b])} stroke="#cab5d8" strokeDasharray={`${3*zoom} ${4*zoom}`} strokeWidth={1.9*zoom} />});
  }
  for (const [a,b] of site.bonds) {
    const start=points[a], end=points[b];
    const middle={ x:(start.x+end.x)/2, y:(start.y+end.y)/2, depth:(start.depth+end.depth)/2 };
    const protein = site.atoms[a].residue === "HIS";
    for (const i of [a,b]) {
      const atom = site.atoms[i];
      const color = protein ? (atom.element === "N" ? "#7088aa" : "#526c81") : atomColors[atom.element];
      layers.push({depth:(points[i].depth+middle.depth)/2, node:<line key={`bond-${a}-${b}-${i}`} {...edges(points[i],middle)} stroke={color} strokeWidth={(protein ? 3.4 : 6)*zoom} strokeLinecap="round" />});
    }
  }
  site.atoms.forEach((atom,i) => {
    const p=points[i], protein=atom.residue === "HIS";
    const r=(protein ? 3.1 : atom.element === "ZN" ? 9 : atom.element === "S" ? 6.8 : 5.1)*zoom;
    layers.push({depth:p.depth + 0.03, node:<circle key={atom.number+"-"+atom.name} cx={p.x} cy={p.y} r={r}
      fill={protein ? (atom.element === "N" ? "#7088aa" : "#526c81") : `url(#atom-${atom.element})`}
      stroke={protein ? "none" : "#142332"} strokeWidth={.7*zoom}><title>{`${atom.residue} A ${atom.number} · ${atom.name}`}</title></circle>});
  });
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 346" role="img" aria-label={label}>
    <title>{label}</title>
    <defs>{Object.entries(atomColors).map(([element,color]) => <radialGradient key={element} id={`atom-${element}`} cx="34%" cy="26%" r="80%">
      <stop offset="0" stopColor="#fff" /><stop offset=".36" stopColor={color} /><stop offset=".78" stopColor={color} /><stop offset="1" stopColor="#4a5364" />
    </radialGradient>)}</defs>
    <g stroke="#526a80" strokeWidth={2.5*zoom} strokeLinecap="round" opacity=".46">
      {site.trace.map(([a,b],i) => <line key={i} {...edges(project(a),project(b))} />)}
    </g>
    {layers.sort((a,b)=>a.depth-b.depth).map(layer=>layer.node)}
    <text x={points[metal].x + 12 * zoom} y={points[metal].y + 6 * zoom} fontFamily="Arial,sans-serif" fontSize="13" fill="#ebd9ff" stroke="#101e2a" strokeWidth="3" paintOrder="stroke">Zn</text>
  </svg>;
}

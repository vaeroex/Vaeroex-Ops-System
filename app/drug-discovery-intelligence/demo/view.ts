import type { Structure } from "./structures";

export type DisplayMode = "site" | "protein" | "ligand";
export const defaultView = { yaw: .72, pitch: -.37, zoom: 1 };
export type View = typeof defaultView;
export type Display = {
  mode: DisplayMode;
  opacity: number;
  zinc: boolean;
  labels: boolean;
  view: View;
};
export const defaults: Display = { mode: "site", opacity: .5, zinc: true, labels: false, view: defaultView };

export const modeNames = { site: "Binding site", protein: "Whole protein", ligand: "Compound only" } as const;
export function frameFor(site: Structure, mode: DisplayMode) {
  if (mode === "site") return { center: site.center, radius: 10.2 };
  const points = mode === "protein" ? site.chain.map(r => r.xyz) :
    site.atoms.filter(a => a.residue !== "HIS" && a.element !== "ZN").map(a => a.xyz);
  const center = [0,1,2].map(i => (Math.min(...points.map(p => p[i])) + Math.max(...points.map(p => p[i]))) / 2);
  const extent = Math.max(...points.map(p => Math.hypot(...p.map((v,i) => v - center[i]))));
  return { center, radius: extent * (mode === "protein" ? 1.08 : 1.48) };
}

/** Locally derived CC0 structural illustration data; no simulated binding results. */
export type ScienceVector = [number, number, number];
export type ScienceAtom = {
  id: string;
  element: string;
  position: ScienceVector;
  radius: number;
};
export type ScienceBond = {
  a: number;
  b: number;
  order: number;
  aromatic: boolean;
};
export type ScienceLigand = {
  ccdId: string;
  name: string;
  atoms: ScienceAtom[];
  bonds: ScienceBond[];
  sourceUrl: string;
  coordinates: "observed-bound" | "CCD-ideal";
};
export type ProteinBackbonePoint = {
  residue: number;
  residueName: string;
  chain: string;
  position: ScienceVector;
  oxygen?: ScienceVector;
  secondary: "helix" | "sheet" | "coil";
};
export type ScienceSurface = {
  positions: number[];
  normals: number[];
  indices: number[];
  resolution: number;
  representation: "approximate-Gaussian-envelope";
};
export type ScientificProteinData = {
  schemaVersion: 1;
  pdbId: "1AZM";
  name: "Human carbonic anhydrase I";
  source: {
    url: string;
    downloadUrl: string;
    doi: string;
    citationDoi: string;
    authors: string[];
    method: string;
    resolutionAngstrom: number;
    license: "CC0-1.0";
    licenseUrl: string;
    sourceSha256: string;
  };
  transform: {
    originAngstrom: ScienceVector;
    axes: [ScienceVector, ScienceVector, ScienceVector];
    scale: number;
  };
  backbone: ProteinBackbonePoint[];
  secondaryRanges: Array<{
    type: "helix" | "sheet";
    chain: string;
    start: number;
    end: number;
  }>;
  atoms: ScienceAtom[];
  ligand: ScienceLigand;
  zinc: {
    position: ScienceVector;
    ligandAtomId: string;
    distanceAngstrom: number;
  };
  pocket: {
    center: ScienceVector;
    radius: number;
    outward: ScienceVector;
    interpretation: string;
  };
  surface: ScienceSurface;
  compactSurface: ScienceSurface;
  candidates: ScienceLigand[];
  notice: string;
};
export type SerializedScienceSurface = {
  encoding: "quantized-le-v1";
  positionData: string;
  normalData: string;
  indexData: string;
  resolution: number;
  representation: "approximate-Gaussian-envelope";
};
export type SerializedScientificProteinData = Omit<
  ScientificProteinData,
  "surface" | "compactSurface"
> & {
  surface: SerializedScienceSurface;
  compactSurface: SerializedScienceSurface;
};

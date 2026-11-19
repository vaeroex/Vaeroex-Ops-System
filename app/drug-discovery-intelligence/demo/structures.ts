import sites from "./sites.json";

export const assaySource = "https://pmc.ncbi.nlm.nih.gov/articles/PMC7011996/#t0001";
export const compounds = [
  { id: "acetazolamide", name: "Acetazolamide", pdb: "3HS4", revision: "1.3", ligand: "AZM", residue: 701, nitrogen: "N1", pubchem: "1986", resolution: "1.10", distance: "1.94", ki: 12, structure: sites["3HS4"] },
  { id: "dorzolamide", name: "Dorzolamide", pdb: "4M2U", revision: "1.2", ligand: "ETS", residue: 302, nitrogen: "N13", pubchem: "5284549", resolution: "2.00", distance: "2.04", ki: 9, structure: sites["4M2U"] }
] as const;

export type Compound = typeof compounds[number];
export type CompoundId = Compound["id"];
export type Structure = Compound["structure"];
export const pdbUrl = (pdb: string) => `https://www.rcsb.org/structure/${pdb}`;

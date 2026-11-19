import { assaySource, pdbUrl, type Compound } from "./structures";

export type ApprovedRow = {
  compound_id: string; compound_name: string; researcher_reason: string; evidence_type: string;
  target: string; pdb_id: string; author_chain: string; ligand_residue: string; pdb_revision: string; pdb_sha256: string;
  structure_source: string; published_Ki_nM: number; assay_source: string; zinc_N_distance_angstrom: string;
};
export function approveRow(compound: Compound, reason: string): ApprovedRow {
  return {
    compound_id: "PubChem:"+compound.pubchem, compound_name: compound.name, researcher_reason: reason.trim(),
    evidence_type: "Experimental structure", target: "Human carbonic anhydrase II", pdb_id: compound.pdb,
    author_chain: "A", ligand_residue: compound.ligand+" "+compound.residue, pdb_revision: compound.revision, pdb_sha256: compound.structure.sha256,
    structure_source: pdbUrl(compound.pdb), published_Ki_nM: compound.ki, assay_source: assaySource,
    zinc_N_distance_angstrom: compound.distance
  };
}
export function approvedCsv(rows: ApprovedRow[], approvedAt: string) {
  // Keep leading spreadsheet formula markers in the reviewer's note inert.
  const field = (value: string | number) => '"' + String(value).replaceAll('"','""') + '"';
  const row = (values: (string | number)[]) => values.map(field).join(",");
  const keys = Object.keys(rows[0]) as (keyof ApprovedRow)[];
  return [row([...keys, "approved_at"]), ...rows.map(item => row([...keys.map(key => {
    const v = item[key];
    return key === "researcher_reason" && /^\s*[=+@-]/u.test(String(v)) ? "'"+v : v;
  }), approvedAt]))].join("\r\n")+"\r\n";
}

// Rebuild the public binding-site views from the bundled, unmodified PDB files.
// Use --check to compare every displayed coordinate and connection with the source.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const assets = new URL("../public/brand/compound-demo/", import.meta.url);
const output = new URL("../app/drug-discovery-intelligence/demo/sites.json", import.meta.url);
const entries = [
  { id: "3HS4", ligand: "AZM", residue: 701, nitrogen: "N1", distance: 1.94, count: 13, sha: "318c38f8cac9a06b3a42f9f9b1017421668f895621300b8d20abb3cdb254b6bb" },
  { id: "4M2U", ligand: "ETS", residue: 302, nitrogen: "N13", distance: 2.04, count: 19, sha: "41a9fc4a43c7bc8d3e41fe3cf23dc9dba39618ffa08d104592d074f9b6a63ee9" }
];
const histidineEdges = [["CA","CB"],["CB","CG"],["CG","ND1"],["ND1","CE1"],["CE1","NE2"],["NE2","CD2"],["CD2","CG"]];
const histidineNames = new Set(histidineEdges.flat());
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

function bindingSite(entry) {
  const bytes = readFileSync(new URL(entry.id + ".pdb", assets));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha);
  const lines = bytes.toString("ascii").split(/\r?\n/);
  const atoms = lines.filter(l => /^(ATOM  |HETATM)/.test(l) && l[21] === "A" && [" ", "A"].includes(l[16])).map(l => ({
    serial: Number(l.slice(6,11)), name: l.slice(12,16).trim(), residue: l.slice(17,20).trim(),
    number: Number(l.slice(22,26)), element: l.slice(76,78).trim(),
    xyz: [Number(l.slice(30,38)),Number(l.slice(38,46)),Number(l.slice(46,54))]
  }));
  const ligand = atoms.filter(a => a.residue === entry.ligand && a.number === entry.residue && !["H","D"].includes(a.element));
  assert.equal(ligand.length,entry.count);
  const zinc = atoms.find(a => a.number === 301 && a.element === "ZN");
  const nitrogen = ligand.find(a => a.name === entry.nitrogen);
  assert(zinc && nitrogen);
  assert.equal(Number(distance(zinc.xyz,nitrogen.xyz).toFixed(2)),entry.distance);
  const histidines = atoms.filter(a => a.residue === "HIS" && [94,96,119].includes(a.number) && histidineNames.has(a.name));
  const siteAtoms = [...ligand,zinc,...histidines];
  const indexOf = serial => siteAtoms.findIndex(a => a.serial === serial);
  const bonds = [];
  // Use the deposited ligand connectivity. Draw metal coordination separately.
  for (const line of lines.filter(l => l.startsWith("CONECT"))) {
    const [from,...others] = line.slice(6).match(/.{1,5}/g).map(Number);
    const a = indexOf(from);
    if (a < 0 || a >= ligand.length) continue;
    for (const to of new Set(others)) {
      const b = indexOf(to);
      if (b > a && b < ligand.length) bonds.push([a,b]);
    }
  }
  assert(bonds.length >= ligand.length - 1);
  for (const number of [94,96,119]) {
    for (const [left,right] of histidineEdges) {
      const ends = [left,right].map(name => siteAtoms.findIndex(a => a.number === number && a.name === name));
      assert(ends.every(i => i >= 0));
      bonds.push(ends);
    }
  }
  const contacts = [nitrogen, ...[94,96,119].map(i => histidines.find(a => a.number === i && a.name === (i === 119 ? "ND1" : "NE2")))]
    .map(a => {
      assert(a && distance(zinc.xyz,a.xyz) < 2.2);
      assert(lines.some(l => l.startsWith("LINK") && l.includes("ZN A 301") && l.includes(a.name.padEnd(3) + " " + a.residue.padStart(3) + " A" + String(a.number).padStart(4))));
      return [indexOf(zinc.serial),indexOf(a.serial)];
    });
  const center = [0,1,2].map(i => (zinc.xyz[i] + ligand.reduce((n,a) => n+a.xyz[i],0) / ligand.length) / 2);
  const ranges = lines.filter(l => l.startsWith("HELIX ") || l.startsWith("SHEET ")).flatMap(line => {
    const helix = line.startsWith("HELIX");
    const chain = helix ? line[19] : line[21];
    if (chain !== "A") return [];
    return [{ start: Number(line.slice(helix ? 21 : 22, helix ? 25 : 26)),
      end: Number(line.slice(33, 37)), shape: helix ? "helix" : "sheet" }];
  });
  const backbone = atoms.filter(a => a.name === "CA" && a.element === "C");
  const chain = backbone.map(a => {
    const oxygen = atoms.find(b => b.number === a.number && b.name === "O" && b.residue === a.residue);
    const shape = ranges.find(r => a.number >= r.start && a.number <= r.end)?.shape || "loop";
    return { number: a.number, xyz: a.xyz, oxygen: oxygen?.xyz ?? null, shape };
  });
  assert(chain.length > 245 && chain.some(r => r.shape === "sheet") && chain.some(r => r.shape === "helix"));
  const trace = [];
  for (let i=1; i<backbone.length; i++) {
    const prev=backbone[i-1], next=backbone[i];
    if (next.number-prev.number !== 1 || distance(prev.xyz,next.xyz) > 4.2) continue;
    if (Math.max(distance(prev.xyz,center),distance(next.xyz,center)) > 14) continue;
    trace.push([prev.xyz,next.xyz]);
  }
  return { atoms: siteAtoms.map(a => ({ name: a.name, element: a.element, xyz: a.xyz, residue: a.residue, number: a.number })),
    bonds, contacts, trace, chain, center, sha256: entry.sha };
}
const json = JSON.stringify(Object.fromEntries(entries.map(e => [e.id,bindingSite(e)]))) + "\n";
if (process.argv.includes("--check")) assert.equal(readFileSync(output,"utf8"),json);
else writeFileSync(output,json);
console.log("Verified the chain A zinc-bound ligand, deposited coordinates and source checksums for 3HS4 and 4M2U.");

/* Verify public scientific illustrations against their archived structural sources. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { gzipSync } = require("node:zlib");
const { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } = require("three");
const vm = require("node:vm");
const ts = require("typescript");
const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function loadTs(file, globals = {}) {
  const module = { exports: {} };
  const math = Object.create(Math);
  math.random = () => { throw new Error("Scientific choreography must be deterministic"); };
  const code = ts.transpileModule(read(file), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Math: math, atob, Uint8Array, DataView, ...globals }, { filename: file });
  return module.exports;
}
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const numbers = (value) => typeof value === "number" ? [value] : Array.isArray(value) ? value.flatMap(numbers) : value && typeof value === "object" ? Object.values(value).flatMap(numbers) : [];
function delta(a, b) {
  const clean = ({ progress, stage, act, ...values }) => { void progress; void stage; void act; return numbers(values); };
  const left = clean(a), right = clean(b);
  assert.equal(left.length, right.length);
  return Math.max(...left.map((v, i) => Math.abs(v - right[i])));
}
function inspectMesh(surface) {
  const { positions, normals, indices } = surface;
  assert.equal(surface.representation, "approximate-Gaussian-envelope");
  assert.equal(positions.length % 3, 0);
  assert.equal(normals.length, positions.length);
  assert.equal(indices.length % 3, 0);
  assert.ok(positions.every(Number.isFinite) && normals.every(Number.isFinite));
  const count = positions.length / 3;
  assert.ok(count > 2000 && count < 65536);
  assert.ok(indices.every((i) => Number.isInteger(i) && i >= 0 && i < count));
  const point = (i) => positions.slice(i * 3, i * 3 + 3);
  for (let i = 0; i < count; i++) {
    assert.ok(Math.abs(Math.hypot(...normals.slice(i * 3, i * 3 + 3)) - 1) < 0.015, "Quantized surface normals must remain approximately unit length");
  }
  let totalArea = 0, opposingNormalArea = 0;
  const edges = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const face = indices.slice(i, i + 3);
    const [a, b, c] = face.map(point);
    const normal = cross(sub(b, a), sub(c, a));
    const area = Math.hypot(...normal);
    assert.ok(area > 1e-8, "Quantization must not ship collapsed triangles");
    totalArea += area;
    const average = [0, 1, 2].map((axis) => face.reduce((sum, vertex) => sum + normals[vertex * 3 + axis], 0));
    if (dot(normal, average) < 0) opposingNormalArea += area;
    for (let side = 0; side < 3; side++) {
      const a = face[side], b = face[(side + 1) % 3];
      const key = `${Math.min(a, b)},${Math.max(a, b)}`;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push(a < b ? 1 : -1);
    }
  }
  assert.ok(opposingNormalArea / totalArea < 0.001, "Surface lighting normals must agree with displayed facets over more than 99.9% of surface area");
  for (const directions of edges.values()) {
    assert.ok(directions.length <= 2, "Surface edges must not be nonmanifold");
    if (directions.length === 2) assert.notEqual(directions[0], directions[1], "Adjacent facets must retain consistent winding");
  }
}
function inspectLigand(ligand) {
  assert.ok(["AZM", "MZM", "EZL"].includes(ligand.ccdId));
  assert.ok(ligand.sourceUrl.endsWith(`/ligand/${ligand.ccdId}`));
  const ids = new Set(ligand.atoms.map((a) => a.id));
  assert.equal(ids.size, ligand.atoms.length, "Chemical atom identifiers must be unique");
  for (const atom of ligand.atoms) {
    assert.ok(["C", "N", "O", "S"].includes(atom.element));
    assert.ok(atom.position.length === 3 && atom.position.every(Number.isFinite));
    assert.ok(atom.radius > 0);
  }
  const adjacent = ligand.atoms.map(() => []);
  for (const bond of ligand.bonds) {
    assert.ok(Number.isInteger(bond.a) && Number.isInteger(bond.b));
    assert.ok(bond.a >= 0 && bond.a < ligand.atoms.length && bond.b >= 0 && bond.b < ligand.atoms.length && bond.a !== bond.b);
    assert.ok([1, 1.5, 2, 3].includes(bond.order));
    const angstrom = distance(ligand.atoms[bond.a].position, ligand.atoms[bond.b].position) / 0.14;
    assert.ok(angstrom > 0.9 && angstrom < 2.2, `CCD bond length must be chemically plausible: ${ligand.ccdId} ${angstrom}`);
    adjacent[bond.a].push(bond.b); adjacent[bond.b].push(bond.a);
  }
  const seen = new Set([0]), queue = [0];
  while (queue.length) for (const next of adjacent[queue.shift()]) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  assert.equal(seen.size, ligand.atoms.length, "Each reference molecule must remain one connected molecular graph");
}
async function main() {
  const raw = read("public/brand/science/carbonic-anhydrase-1azm.json");
  assert.ok(Buffer.byteLength(raw) < 2000000, "Scientific structure and both static meshes must fit in a bounded 2 MB local asset");
  assert.ok(gzipSync(raw).length < 1000000, "The compressed molecular asset must remain below 1 MB");
  const serialized = JSON.parse(raw);
  const loader = loadTs("components/marketing/science/dataLoader.ts");
  const data = loader.decodeScientificProteinData(serialized);
  assert.equal(data.name, "Human carbonic anhydrase I", "1AZM must never be mislabeled as isoform II");
  assert.equal(data.pdbId, "1AZM");
  assert.equal(data.source.license, "CC0-1.0");
  assert.equal(data.source.resolutionAngstrom, 2);
  assert.equal(data.source.method, "X-RAY DIFFRACTION");
  assert.equal(data.source.url, "https://www.rcsb.org/structure/1AZM");
  assert.equal(data.source.sourceSha256, crypto.createHash("sha256").update(read("scripts/science-sources/1AZM.pdb")).digest("hex"));
  assert.match(data.notice, /not docking, dynamics, affinity, or efficacy predictions/);
  assert.equal(data.backbone.length, 258);
  assert.equal(data.atoms.length, 2019);
  assert.equal(data.transform.scale, 0.14);
  for (const axis of data.transform.axes) assert.ok(Math.abs(Math.hypot(...axis) - 1) < 1e-7);
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) assert.ok(Math.abs(dot(data.transform.axes[a], data.transform.axes[b])) < 1e-7);
  assert.ok(dot(cross(data.transform.axes[0], data.transform.axes[1]), data.transform.axes[2]) > 0.999999, "View transform must preserve molecular chirality");

  const pdb = read("scripts/science-sources/1AZM.pdb").split(/\r?\n/);
  const observed = pdb.filter((line) => /^(ATOM  |HETATM)/.test(line)).map((line) => ({ record: line.slice(0, 6).trim(), id: line.slice(12, 16).trim(), residueName: line.slice(17, 20).trim(), residue: Number(line.slice(22, 26)), position: [Number(line.slice(30, 38)), Number(line.slice(38, 46)), Number(line.slice(46, 54))] }));
  const transform = (point) => data.transform.axes.map((axis) => dot(sub(point, data.transform.originAngstrom), axis) * data.transform.scale);
  const observedProtein = observed.filter((atom) => atom.record === "ATOM");
  assert.equal(observedProtein.length, data.atoms.length);
  for (let index = 0; index < data.atoms.length; index++) {
    assert.equal(data.atoms[index].id, observedProtein[index].id);
    assert.ok(distance(data.atoms[index].position, transform(observedProtein[index].position)) < 0.0001, "Every protein atom must retain its deposited coordinate independently of illustrative surface smoothing");
  }
  for (const point of data.backbone) {
    const source = observed.find((atom) => atom.record === "ATOM" && atom.id === "CA" && atom.residue === point.residue);
    assert.ok(source);
    assert.ok(distance(point.position, transform(source.position)) < 0.0001, "Backbone must retain experimental coordinates under one rigid transform");
    assert.ok(point.oxygen?.every(Number.isFinite));
    assert.ok(["helix", "sheet", "coil"].includes(point.secondary));
  }
  assert.ok(data.backbone.some((p) => p.secondary === "sheet") && data.backbone.some((p) => p.secondary === "helix"));
  for (const atom of data.ligand.atoms) {
    const source = observed.find((entry) => entry.residueName === "AZM" && entry.id === atom.id);
    assert.ok(source);
    assert.ok(distance(atom.position, transform(source.position)) < 0.0001, "Bound ligand must share the protein coordinate frame");
  }
  assert.equal(data.ligand.coordinates, "observed-bound");
  const coordinated = data.ligand.atoms.find((atom) => atom.id === data.zinc.ligandAtomId);
  assert.equal(data.zinc.ligandAtomId, "N1");
  assert.ok(Math.abs(distance(coordinated.position, data.zinc.position) / data.transform.scale - data.zinc.distanceAngstrom) < 0.002);
  assert.ok(Math.abs(data.zinc.distanceAngstrom - 2.012) < 0.001);
  const ligandCenter = [0, 1, 2].map((i) => data.ligand.atoms.reduce((sum, atom) => sum + atom.position[i], 0) / data.ligand.atoms.length);
  assert.ok(Math.hypot(...ligandCenter) < 0.0001);
  inspectLigand(data.ligand);
  assert.deepEqual(Array.from(data.candidates, (ligand) => ligand.ccdId), ["AZM", "MZM", "EZL"]);
  for (const ligand of data.candidates) { assert.equal(ligand.coordinates, "CCD-ideal"); inspectLigand(ligand); }
  inspectMesh(data.surface); inspectMesh(data.compactSurface);
  assert.ok(data.surface.indices.length / 3 <= 100000, "The detailed static envelope must remain within its 100,000-triangle budget");
  assert.ok(data.compactSurface.indices.length / 3 <= 25000, "Compact surface geometry must retain a 25,000-triangle ceiling");
  assert.ok(data.compactSurface.indices.length < data.surface.indices.length / 2, "Compact devices must use the independently generated lower-resolution mesh");
  assert.throws(() => loader.decodeScientificProteinData({ ...serialized, schemaVersion: 2 }), /Unexpected scientific structure/);
  assert.throws(() => loader.decodeScientificProteinData({ ...serialized, surface: { ...serialized.surface, positionData: "AA==" } }), /Malformed scientific surface/);
  let fetches = 0;
  const successLoader = loadTs("components/marketing/science/dataLoader.ts", { fetch: async (url) => { fetches++; assert.equal(url, "/brand/science/carbonic-anhydrase-1azm.json"); return { ok: true, json: async () => serialized }; } });
  const first = successLoader.loadScientificProteinData();
  assert.equal(first, successLoader.loadScientificProteinData(), "Suspense consumers must share one stable in-flight promise");
  await first; assert.equal(fetches, 1);
  let failedCalls = 0;
  const retryLoader = loadTs("components/marketing/science/dataLoader.ts", { fetch: async () => ({ ok: ++failedCalls > 1, json: async () => serialized }) });
  await assert.rejects(retryLoader.loadScientificProteinData(), /unavailable/);
  await retryLoader.loadScientificProteinData(); assert.equal(failedCalls, 2, "Rejected data requests must not poison the cache permanently");

  const drug = loadTs("components/marketing/science/drugMotion.ts");
  const biology = loadTs("components/marketing/science/biologyMotion.ts");
  for (const [name, evaluate, stages] of [["drug", drug.evaluateDrugMotion, drug.DRUG_STAGES], ["biology", biology.evaluateBiologyMotion, biology.BIOLOGY_ACTS]]) {
    assert.deepEqual(Array.from(stages), [0, 0.25, 0.5, 0.75, 1]);
    for (const compact of [false, true]) {
      for (const [input, expected] of [[NaN, 0], [-Infinity, 0], [Infinity, 1], [-1, 0], [2, 1]]) assert.deepEqual(evaluate(input, compact), evaluate(expected, compact));
      const states = Array.from({ length: 401 }, (_, i) => evaluate(i / 400, compact));
      for (let i = 0; i < states.length; i++) {
        const state = states[i];
        assert.ok(numbers(state).every(Number.isFinite), `${name} transforms must remain finite`);
        assert.ok(state.fov >= 20 && state.fov <= 80);
        assert.ok(distance(state.camera, state.target) > 1);
        for (const [key, value] of Object.entries(state)) if (/opacity/i.test(key)) assert.ok(value >= 0 && value <= 1, `${name} opacity ${key}`);
        if (i > 0) assert.ok(delta(states[i - 1], state) < 0.7, `${name} must not jump between scroll samples`);
      }
      for (let i = 400; i >= 0; i--) assert.deepEqual(evaluate(i / 400, compact), states[i], `${name} reverse scroll must return to the same poses`);
      for (let i = 0; i < stages.length; i++) {
        const state = evaluate(stages[i], compact);
        assert.equal(state.stage ?? state.act, i);
        if (i > 0) assert.ok(distance(state.camera, evaluate(stages[i - 1], compact).camera) > 0.5, `${name} must travel between every narrative stage`);
        for (const offset of [-1e-5, 1e-5]) {
          const near = evaluate(stages[i] + offset, compact);
          assert.ok(distance(state.camera, near.camera) / 1e-5 < 0.15, `${name} camera must ease through chapter joins`);
        }
      }
    }
  }
  // Project actual atom bounds through the authored camera at intermediate poses,
  // so a smooth numerical trajectory cannot silently clip the comparison molecules.
  const graphBounds = [data.ligand, data.candidates[1], data.candidates[2]].map((graph) => graph.atoms.flatMap((atom) => {
    const radius = atom.radius * 0.36; // Same illustrative sphere radius as DrugMolecule.
    return [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => new Vector3(atom.position[0] + radius * x, atom.position[1] + radius * y, atom.position[2] + radius * z))));
  }));
  for (const aspect of [NaN, 0, -1, Infinity]) assert.equal(drug.drugCameraFov(42, aspect), drug.drugCameraFov(42, 1.3));
  const camera = new PerspectiveCamera(43, 1.3, 0.05, 160);
  const matrix = new Matrix4(), rotation = new Quaternion(), projected = new Vector3();
  const position = new Vector3(), scale = new Vector3(), euler = new Euler();
  for (const compact of [false, true]) for (const aspect of [0.9, 1.1, 1.3, 1.5]) {
    for (let sample = 0; sample <= 800; sample++) {
      const state = drug.evaluateDrugMotion(sample / 800, compact);
      camera.aspect = aspect;
      camera.fov = drug.drugCameraFov(state.fov, aspect);
      camera.position.set(...state.camera);
      camera.lookAt(...state.target);
      camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      [state.ligand, ...state.candidates].forEach((pose, molecule) => {
        if (pose.opacity <= 0.005) return;
        matrix.compose(position.set(...pose.position), rotation.setFromEuler(euler.set(...pose.rotation)), scale.setScalar(pose.scale));
        for (const corner of graphBounds[molecule]) {
          projected.copy(corner).applyMatrix4(matrix).project(camera);
          assert.ok(Math.abs(projected.x) < 0.96 && Math.abs(projected.y) < 0.96 && Math.abs(projected.z) < 1, `Visible molecular bounds must retain a viewport margin: compact=${compact}, aspect=${aspect}, progress=${state.progress}, molecule=${molecule}`);
        }
      });
    }
  }
  for (const compact of [false, true]) {
    const observedPose = drug.evaluateDrugMotion(0.75, compact);
    for (const pose of [observedPose.protein, observedPose.ligand]) {
      assert.deepEqual(Array.from(pose.position), [0, 0, 0]);
      assert.deepEqual(Array.from(pose.rotation), [0, 0, 0]);
      assert.equal(pose.scale, 1, "The observed binding stage must preserve experimental relative coordinates");
    }
    const comparison = drug.evaluateDrugMotion(1, compact);
    for (const pose of comparison.candidates) assert.ok(pose.opacity > 0.9);
    assert.ok(distance(comparison.candidates[0].position, comparison.candidates[1].position) > 1, "Reference comparisons must remain visibly separate");
    assert.ok(biology.evaluateBiologyMotion(0.5, compact).cutaway > biology.evaluateBiologyMotion(0, compact).cutaway + 1, "The cell interior must open with actual cutaway geometry");
    assert.ok(biology.evaluateBiologyMotion(1, compact).tissueReveal > 0.9);
    assert.ok(distance(biology.evaluateBiologyMotion(0, compact).transportPosition, biology.evaluateBiologyMotion(0.75, compact).transportPosition) > 0.5, "The transport stage must have a distinct spatial trajectory");
  }
  process.stdout.write("Scientific provenance, observed coordinates, CCD molecular graphs, static mesh integrity, loader recovery, molecular camera framing, and five-stage motion regressions passed.\n");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

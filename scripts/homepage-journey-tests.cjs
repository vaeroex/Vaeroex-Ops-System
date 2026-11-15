/* eslint-disable @typescript-eslint/no-require-imports -- Offline geometry and camera-path regression runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');
const { Box3, Euler, PerspectiveCamera, Quaternion, Vector3 } = require('three');

// Run the same authored transforms and generated geometry as the renderer, without WebGL.
const modules = new Map();
function loadTypeScript(filename) {
  const resolved = path.resolve(filename);
  if (modules.has(resolved)) return modules.get(resolved).exports;
  const result = { exports: {} };
  modules.set(resolved, result);
  const localRequire = createRequire(resolved);
  const requireSource = specifier => {
    const sibling = path.resolve(path.dirname(resolved), specifier + '.ts');
    return specifier.startsWith('.') && fs.existsSync(sibling) ? loadTypeScript(sibling) : localRequire(specifier);
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports: result.exports, module: result, require: requireSource }, { filename: resolved });
  return result.exports;
}
const {
  journeyCamera, journeyPart, journeyAssembly, createJourneyWorld, sculptureShapes, sculptureEnvelope,
  sculpturePassages, enhancementSocket, journeyLens,
} = loadTypeScript('components/marketing/journey/journeyMotion.ts');
const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const difference = (a, b) => a.map((value, axis) => value - b[axis]);
const unit = vector => vector.map(value => value / Math.hypot(...vector));
const directionAngle = (a, b) => Math.acos(Math.min(1, Math.max(-1,
  a.reduce((sum, value, axis) => sum + value * b[axis], 0))));
const degrees = angle => angle * 180 / Math.PI;
const finitePoint = point => point.length === 3 && point.every(Number.isFinite);
const rotation = new Euler(), inverse = new Quaternion(), pointInBox = new Vector3();

// Distance to a conservative, fully solid OBB. Passage frames must consist of
// separate bars: treating their empty apertures as solid would reject valid travel.
function clearance(point, pose) {
  rotation.set(...pose.rotation, 'XYZ');
  inverse.setFromEuler(rotation).invert();
  pointInBox.fromArray(difference(point, pose.position)).applyQuaternion(inverse);
  return Math.hypot(...pointInBox.toArray().map((value, axis) =>
    Math.max(0, Math.abs(value) - pose.size[axis] / 2)));
}
function corners(pose) {
  const quaternion = new Quaternion().setFromEuler(new Euler(...pose.rotation, 'XYZ'));
  const points = [];
  for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
    points.push(new Vector3(x * pose.size[0], y * pose.size[1], z * pose.size[2])
      .applyQuaternion(quaternion).add(new Vector3(...pose.position)).toArray());
  }
  return points;
}
function contained(point, bounds, tolerance = 0) {
  return point.every((value, axis) => value >= bounds.min[axis] - tolerance && value <= bounds.max[axis] + tolerance);
}
function derivativeJump(sample, p) {
  const epsilon = 1e-6, at = sample(p);
  const left = difference(at, sample(p - epsilon)).map(value => value / epsilon);
  const right = difference(sample(p + epsilon), at).map(value => value / epsilon);
  return distance(left, right);
}
function poseSnapshot(world, p) { return world.parts.map(part => journeyPart(part, p)); }

const viewports = [
  { width: 1440, height: 900, compact: false, label: 'desktop' },
  { width: 390, height: 844, compact: true, label: 'portrait' },
  { width: 844, height: 390, compact: false, label: 'landscape-full' },
  { width: 844, height: 390, compact: true, label: 'landscape-compact' },
];
const sampleCount = 2000;
const results = [];
for (const { width: viewportWidth, height: viewportHeight, compact, label } of viewports) {
  const aspect = viewportWidth / viewportHeight;
  const world = createJourneyWorld(compact);
  const originalWorld = JSON.stringify(world);
  const ids = world.parts.map(part => part.id);
  assert.equal(new Set(ids).size, ids.length, 'Each persistent sculpture component has a unique identity');
  assert.ok(world.parts.length > 20 && world.parts.length < 180, 'The sculpture uses a bounded set of intentional components');
  for (const role of ['shell', 'layer', 'module', 'enhancement', 'surface', 'joint', 'seam']) {
    assert.ok(world.parts.some(part => part.role === role), 'Both quality modes retain ' + role + ' components');
  }
  for (const part of world.parts) {
    assert.ok(sculptureShapes[part.geometry], 'Every part uses an actual generated solid: ' + part.id);
    assert.ok(Number.isInteger(part.material) && part.material >= 0);
  }
  const samples = [];
  let pathLength = 0, closest = Infinity, maxTurn = 0, maxCameraStep = 0, maxPartStep = 0;
  let closestSample;
  for (let step = 0; step <= sampleCount; step++) {
    const p = step / sampleCount, view = journeyCamera(p, compact, aspect), poses = poseSnapshot(world, p);
    const assembly = journeyAssembly(p);
    assert.ok(finitePoint(view.position) && finitePoint(view.target), 'Every camera sample is finite');
    assert.ok(view.position.every(value => Math.abs(value) < 250), 'The camera stays within the authored scene scale');
    const viewLength = distance(view.position, view.target);
    assert.ok(Math.abs(viewLength - 30) < 1e-10, 'A constant aim distance prevents target crossings');
    const direction = unit(difference(view.target, view.position));
    assert.ok(Math.abs(direction[1]) < .94, 'The camera never approaches a vertical look-at singularity');
    assert.ok(Object.values(assembly).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    if (step) {
      const previous = samples[step - 1];
      const travel = distance(view.position, previous.position);
      pathLength += travel;
      maxCameraStep = Math.max(maxCameraStep, travel);
      assert.ok(travel < .4, 'A small scroll increment cannot teleport the camera: ' + p);
      const turn = degrees(directionAngle(direction, previous.direction));
      maxTurn = Math.max(maxTurn, turn);
      assert.ok(turn < .65, 'Camera turns remain gradual: ' + p + ', ' + turn + ' degrees');
    }
    for (let index = 0; index < poses.length; index++) {
      const pose = poses[index], part = world.parts[index];
      assert.ok(finitePoint(pose.position) && finitePoint(pose.rotation) && finitePoint(pose.size));
      assert.ok(pose.position.every(value => Math.abs(value) < 120), 'No component escapes the sculpture: ' + part.id);
      assert.ok(pose.size.every(value => value > 0 && value < 80));
      assert.deepEqual(pose.size, sculptureShapes[part.geometry].size, 'Motion does not resize or pop solids into existence');
      if (step) {
        const previous = samples[step - 1].poses[index];
        const travel = distance(pose.position, previous.position);
        maxPartStep = Math.max(maxPartStep, travel);
        assert.ok(travel < .25, 'Assembly parts cannot teleport: ' + JSON.stringify({ p, id: part.id, travel }));
        assert.ok(distance(pose.rotation, previous.rotation) < .025,
          'Mechanical rotation stays continuous: ' + JSON.stringify({ p, id: part.id }));
      }
      // Crucially, use the moving solid and camera at the SAME progress. A static
      // finished model cannot catch the camera crossing a closing/opening shell.
      const gap = clearance(view.position, pose);
      if (gap < closest) { closest = gap; closestSample = { p, id: part.id }; }
      assert.ok(gap > .45, 'Camera needs a .45-unit margin around all moving solids: ' +
        JSON.stringify({ p, position: view.position, id: part.id, pose, gap }));
    }
    samples.push({ ...view, direction, poses, assembly });
  }

  // These checks concern the actual camera positions relative to the sculpture,
  // not progress labels or the names of the content sections.
  const depth = sculptureEnvelope.max[2] - sculptureEnvelope.min[2];
  const width = sculptureEnvelope.max[0] - sculptureEnvelope.min[0];
  assert.ok(pathLength > depth * 2, 'The camera makes a substantial physical journey through and around the sculpture');
  const range = axis => Math.max(...samples.map(view => view.position[axis])) - Math.min(...samples.map(view => view.position[axis]));
  assert.ok(range(0) > width * .6, 'The camera travels laterally around components');
  assert.ok(range(2) > depth, 'The camera crosses the depth of the sculptural world');
  assert.ok(samples[0].position[2] > sculptureEnvelope.max[2] + 10, 'The opening establishes the object from outside');
  assert.ok(samples[sampleCount].position[2] > sculptureEnvelope.max[2] + 10, 'The finish returns to an exterior wide view of the same object');
  for (const progress of [.30, .43, .50, .60]) {
    assert.ok(contained(journeyCamera(progress, compact, aspect).position, sculptureEnvelope),
      'The offering journey physically occupies the sculpture interior: ' + progress);
  }
  const entry = samples.findIndex(view => view.position[2] < sculptureEnvelope.max[2]);
  assert.ok(entry > sampleCount * .12 && entry < sampleCount * .34, 'The camera enters during the opening sequence');
  assert.ok(samples.some(view => view.position[2] < sculpturePassages.exit.center[2] - 3),
    'The camera crosses the actual rear aperture before pulling back');
  for (const passage of Object.values(sculpturePassages)) {
    const side = point => difference(point, passage.center).reduce((sum, value, axis) => sum + value * passage.normal[axis], 0);
    const crossing = samples.findIndex((view, index) => index > 0 && side(samples[index - 1].position) >= 0 && side(view.position) < 0);
    assert.ok(crossing > 0, 'The route physically crosses each aperture plane');
    assert.ok(distance(samples[crossing].position, passage.center) < 4,
      'The camera crosses near the aperture opening: ' + JSON.stringify({ label, passage: passage.center, position: samples[crossing].position }));
  }

  // Shared derivatives prevent velocity jumps at authored path and assembly joins.
  for (let step = 1; step < 100; step++) {
    const p = step / 100;
    for (const field of ['position', 'target']) {
      assert.ok(derivativeJump(progress => journeyCamera(progress, compact, aspect)[field], p) < .15,
        'Camera and aim stay C1 continuous at progress ' + p);
    }
    for (const part of world.parts) {
      for (const field of ['position', 'rotation']) {
        assert.ok(derivativeJump(progress => journeyPart(part, progress)[field], p) < .15,
          'Assembly velocity stays continuous: ' + part.id + ' at ' + p);
      }
    }
  }
  for (let step = sampleCount; step >= 0; step--) {
    const p = step / sampleCount, reverse = journeyCamera(p, compact, aspect);
    assert.deepEqual(reverse.position, samples[step].position, 'Reverse scrolling restores the exact camera position');
    assert.deepEqual(reverse.target, samples[step].target, 'Reverse scrolling restores the exact camera heading');
    assert.deepEqual(poseSnapshot(world, p), samples[step].poses, 'Reverse scrolling restores every component transform');
    assert.deepEqual(journeyAssembly(p), samples[step].assembly, 'Assembly state has no accumulated time or direction dependency');
  }
  for (const [input, endpoint] of [[-1, 0], [-Infinity, 0], [NaN, 0], [2, 1], [Infinity, 1]]) {
    assert.deepEqual(journeyCamera(input, compact, aspect), journeyCamera(endpoint, compact, aspect));
    assert.deepEqual(poseSnapshot(world, input), poseSnapshot(world, endpoint));
  }
  assert.equal(JSON.stringify(world), originalWorld, 'Sampling cannot mutate component definitions');
  assert.equal(JSON.stringify(createJourneyWorld(compact)), originalWorld, 'Geometry placement is deterministic');
  results.push({ compact, aspect, label, world, pathLength, closest, closestSample, maxTurn, maxCameraStep, maxPartStep });
}

// Largest separating-axis gap between two OBBs. Positive values prove distinct
// solids; a near-zero gap identifies a mechanical contact without relying on IDs.
function separatingGap(a, b) {
  const axes = pose => {
    const quaternion = new Quaternion().setFromEuler(new Euler(...pose.rotation, 'XYZ'));
    return [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
      .map(axis => axis.applyQuaternion(quaternion));
  };
  const aAxes = axes(a), bAxes = axes(b), delta = new Vector3(...difference(b.position, a.position));
  const tests = [...aAxes, ...bAxes];
  for (const aAxis of aAxes) for (const bAxis of bAxes) {
    const cross = new Vector3().crossVectors(aAxis, bAxis);
    if (cross.lengthSq() > 1e-12) tests.push(cross.normalize());
  }
  return Math.max(...tests.map(axis => Math.abs(delta.dot(axis)) -
    aAxes.reduce((sum, basis, index) => sum + a.size[index] / 2 * Math.abs(axis.dot(basis)), 0) -
    bAxes.reduce((sum, basis, index) => sum + b.size[index] / 2 * Math.abs(axis.dot(basis)), 0)));
}

for (const { world } of results) {
  const shell = world.parts.filter(part => part.role === 'shell');
  const openingMovers = shell.filter(part => distance(journeyPart(part, 0).position, journeyPart(part, .30).position) > 1);
  assert.ok(openingMovers.length >= 4, 'The exterior layers actually separate to open the sculpture');
  for (const part of shell) {
    assert.deepEqual(journeyPart(part, 0), journeyPart(part, 1), 'The final reveal restores the same exterior silhouette');
  }
  const layers = world.parts.filter(part => part.role === 'layer');
  assert.ok(layers.length >= 3);
  for (const part of layers) {
    const scattered = journeyPart(part, .24), aligned = journeyPart(part, .43);
    assert.ok(distance(scattered.position, aligned.position) > 1, 'Intelligence layers visibly align, rather than only changing a state label');
    assert.ok(distance(scattered.rotation, aligned.rotation) > .1, 'Layer orientation also resolves into an ordered passage');
    assert.deepEqual(journeyPart(part, .43), journeyPart(part, .80), 'Aligned layers remain part of the connected sculpture');
  }
  const enhancement = world.parts.filter(part => part.role === 'enhancement');
  assert.equal(enhancement.length, 1, 'There is one clear incoming enhancement');
  const incoming = enhancement[0], detached = journeyPart(incoming, .43), installed = journeyPart(incoming, .62);
  assert.ok(distance(detached.position, installed.position) > 8, 'The incoming component is visibly detached before docking');
  assert.ok(distance(installed.position, enhancementSocket) < 1e-10, 'The enhancement reaches its physical socket');
  const modules = world.parts.filter(part => part.role === 'module');
  assert.ok(modules.length >= 2, 'An existing assembly is present before the enhancement arrives');
  assert.ok(Math.min(...modules.map(part => separatingGap(detached, journeyPart(part, .43)))) > 2,
    'The incoming component begins physically separated from the existing assembly');
  const installedGaps = modules.map(part => separatingGap(installed, journeyPart(part, .62)));
  assert.ok(installedGaps.every(gap => gap >= -.01) && Math.min(...installedGaps) < .4,
    'The installed enhancement joins the existing assembly with a precise gap and no solid overlap');
  for (const part of modules) {
    assert.deepEqual(journeyPart(part, .43), journeyPart(part, .62), 'The existing assembly remains in place as the enhancement joins');
  }
  let previousDistance = Infinity;
  for (let step = 0; step <= 100; step++) {
    const pose = journeyPart(incoming, .43 + .19 * step / 100), remaining = distance(pose.position, enhancementSocket);
    assert.ok(remaining <= previousDistance + 1e-10, 'Docking closes the socket gap continuously');
    previousDistance = remaining;
  }
  assert.deepEqual(journeyPart(incoming, .62), journeyPart(incoming, 1), 'The enhancement stays installed during the final reveal');
  const folded = world.parts.filter(part => part.role === 'surface' && part.motion === 'unfold');
  assert.ok(folded.length >= 2, 'The digital-design passage contains articulated physical surfaces');
  for (const part of folded) {
    const before = journeyPart(part, .57), opened = journeyPart(part, .72);
    assert.ok(distance(before.rotation, opened.rotation) > 1, 'The surfaces visibly unfold into dimensional compositions');
    assert.ok(distance(before.position, opened.position) > 1, 'The surfaces pivot around hinges rather than spinning in place');
    assert.deepEqual(journeyPart(part, .72), journeyPart(part, .80), 'The unfolded composition stays open while the camera passes');
  }
  for (const part of world.parts) {
    assert.ok(corners(journeyPart(part, 1)).every(point => contained(point, sculptureEnvelope, .01)),
      'Every final component belongs to the same spatial sculpture: ' + part.id);
  }
}

// Projection checks complement clearance: a safe route can still point away from
// the sculpture or crop its silhouette entirely out of a portrait viewport.
function projectScene(point, progress, compact, aspect) {
  const view = journeyCamera(progress, compact, aspect);
  const lens = journeyLens(compact);
  const camera = new PerspectiveCamera(lens.fov, aspect, lens.near, lens.far);
  camera.position.set(...view.position);
  camera.lookAt(...view.target);
  camera.updateMatrixWorld();
  return new Vector3(...point).project(camera).toArray();
}
for (const { width, height, compact, label } of viewports) {
  const world = createJourneyWorld(compact), aspect = width / height;
  for (const progress of [0, 1]) {
    const shell = world.parts.filter(part => part.role === 'shell').flatMap(part => corners(journeyPart(part, progress)));
    const center = new Box3().setFromPoints(shell.map(point => new Vector3(...point))).getCenter(new Vector3()).toArray();
    const focal = projectScene(center, progress, compact, aspect);
    assert.ok(focal[2] > -1 && focal[2] < 1 && Math.abs(focal[0]) < .8 && Math.abs(focal[1]) < .8,
      'Opening/final camera must look toward the sculpture: ' + JSON.stringify({ label, progress, focal }));
    for (const point of shell) {
      const projected = projectScene(point, progress, compact, aspect);
      assert.ok(projected[2] > -1 && projected[2] < 1 && Math.abs(projected[0]) <= .96 && Math.abs(projected[1]) <= .96,
        'Opening/final silhouette fits the viewport with breathing room: ' + JSON.stringify({ label, progress, point, projected }));
    }
  }
  const dockingProgress = [.15, .50, .90].map(fraction => {
    for (let step = 0; step <= sampleCount; step++) {
      const p = step / sampleCount;
      if (journeyAssembly(p).docking >= fraction) return p;
    }
    assert.fail('The enhancement must complete its joining movement');
  });
  // Check the whole physical components at meaningful early/middle/late assembly
  // phases and the HTML offering milestone, not merely a possibly cropped center.
  for (const progress of new Set([...dockingProgress, .50])) {
    for (const part of world.parts.filter(part => part.role === 'module' || part.role === 'enhancement')) {
      for (const point of corners(journeyPart(part, progress))) {
        const projected = projectScene(point, progress, compact, aspect);
        assert.ok(projected[2] > -1 && projected[2] < 1 && Math.abs(projected[0]) <= .96 && Math.abs(projected[1]) <= .96,
          'The joining phase frames the whole existing assembly and incoming component: ' +
          JSON.stringify({ label, progress, id: part.id, point, projected }));
      }
    }
  }
}

const { createSculptureGeometries, createSculptureFinish } = loadTypeScript('components/marketing/journey/SculptureGeometry.ts');
for (const result of results) {
  const geometries = createSculptureGeometries(result.compact);
  const triangles = {};
  for (const [key, geometry] of Object.entries(geometries)) {
    assert.ok(sculptureShapes[key], 'The factory generates only declared component geometry');
    const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
    assert.ok(position && position.count > 0 && normal && normal.count === position.count);
    assert.ok(Array.from(position.array).every(Number.isFinite) && Array.from(normal.array).every(Number.isFinite));
    geometry.computeBoundingBox();
    const box = geometry.boundingBox, size = sculptureShapes[key].size;
    // Float32 buffers need a tiny tolerance, far below the camera's safety margin.
    assert.ok(box.min.toArray().every((value, axis) => value >= -size[axis] / 2 - 1e-5) &&
      box.max.toArray().every((value, axis) => value <= size[axis] / 2 + 1e-5),
    'Generated vertices fit the conservative moving-solid bound: ' + key);
    assert.ok(box.getSize(new Vector3()).toArray().every((value, axis) => value > size[axis] * .9),
      'A declared solid cannot silently become empty or arbitrarily small: ' + key);
    triangles[key] = (geometry.index?.count ?? position.count) / 3;
    assert.ok(Number.isInteger(triangles[key]) && triangles[key] >= 12);
  }
  assert.ok(result.world.parts.every(part => geometries[part.geometry]), 'Every rendered component has a real geometry resource');
  result.triangles = result.world.parts.reduce((sum, part) => sum + triangles[part.geometry], 0) + 2; // Ground plane.
  result.batches = new Set(result.world.parts.map(part => part.geometry + ':' + part.material)).size + 1;
  assert.ok(result.triangles < (result.compact ? 15000 : 22000), 'Actual assembled geometry stays within the quality budget');
  assert.ok(result.batches <= 40, 'Geometry/material batching keeps the main scene draw budget bounded');
  Object.values(geometries).forEach(geometry => geometry.dispose());
}
assert.ok(results[1].triangles < results[0].triangles * .8, 'Compact rendering meaningfully reduces real triangle work');
assert.ok(results[1].world.parts.length < results[0].world.parts.length, 'Compact mode omits secondary detail');
const finishA = createSculptureFinish(), finishB = createSculptureFinish();
assert.equal(finishA.image.data.byteLength, 64 * 64 * 4, 'Material detail remains a small, local procedural texture');
assert.deepEqual(finishA.image.data, finishB.image.data, 'Material detail is reproducible and needs no external image request');
finishA.dispose(); finishB.dispose();
for (const result of results) {
  console.log('Sculpture ' + result.label + ': ' + result.pathLength.toFixed(1) +
    ' units of camera travel; ' + result.closest.toFixed(3) + ' minimum moving-solid clearance ' +
    JSON.stringify(result.closestSample) + '; ' + result.maxTurn.toFixed(3) + '° maximum turn per .0005 progress; ' +
    result.world.parts.length + ' parts; ' + result.triangles + ' triangles; ' + result.batches + ' main-scene batches.');
}
console.log('Homepage sculpture: moving-solid bounds, physical entry/interior/exit, camera/assembly continuity, exact reversal, physical docking/unfolding, viewport framing and actual geometry budgets passed. Offline checks only; no browser/WebGL, occlusion/HTML-overlap, measured frame-rate or visual-quality claim.');

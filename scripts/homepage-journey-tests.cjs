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
const { journeyCamera, journeyPart, journeyAssembly, createJourneyWorld, sculptureShapes, sculpturePassages, journeyLens } =
  loadTypeScript('components/marketing/journey/journeyMotion.ts');
const { createSculptureGeometries, createSculptureFinish } = loadTypeScript('components/marketing/journey/SculptureGeometry.ts');
const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const difference = (a, b) => a.map((value, axis) => value - b[axis]);
const unit = vector => vector.map(value => value / Math.hypot(...vector));
const degrees = angle => angle * 180 / Math.PI;
const angle = (a, b) => Math.acos(Math.min(1, Math.max(-1, a.reduce((sum, value, axis) => sum + value * b[axis], 0))));
const finitePoint = point => point.length === 3 && point.every(Number.isFinite);
const poseSnapshot = (world, p) => world.parts.map(part => journeyPart(part, p));
function inPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] <
      (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function edgeDistance(point, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}
function outlineDistance(point, outline) {
  return inPolygon(point, outline) ? 0 : Math.min(...outline.map((a, i) => edgeDistance(point, a, outline[(i + 1) % outline.length])));
}
function transform(point, pose) {
  return new Vector3(...point).applyQuaternion(new Quaternion().setFromEuler(new Euler(...pose.rotation, 'XYZ')))
    .add(new Vector3(...pose.position)).toArray();
}
function prismVertices(part, p) {
  const shape = sculptureShapes[part.geometry], pose = journeyPart(part, p);
  return shape.outline.flatMap(point => [-1, 1].map(side => transform([...point, side * shape.size[2] / 2], pose)));
}
// Concave polygon-prism distance preserves the logo's empty cutouts. OBBs would
// incorrectly fill those gaps. The geometry checks below prove the rendered
// vertices stay inside each conservative prism, with only Float32 tolerance.
function clearance(point, part, p) {
  const pose = journeyPart(part, p), shape = sculptureShapes[part.geometry];
  const local = new Vector3(...difference(point, pose.position))
    .applyQuaternion(new Quaternion().setFromEuler(new Euler(...pose.rotation, 'XYZ')).invert()).toArray();
  return Math.hypot(outlineDistance(local, shape.outline), Math.max(0, Math.abs(local[2]) - pose.size[2] / 2));
}
function derivativeJump(sample, p) {
  const epsilon = 1e-6, at = sample(p);
  return distance(difference(at, sample(p - epsilon)).map(value => value / epsilon),
    difference(sample(p + epsilon), at).map(value => value / epsilon));
}
const viewports = [
  { width: 1440, height: 900, compact: false, label: 'desktop' },
  { width: 390, height: 844, compact: true, label: 'portrait' },
  { width: 844, height: 390, compact: false, label: 'landscape-full' },
  { width: 844, height: 390, compact: true, label: 'landscape-compact' },
];
const sampleCount = 2000, results = [], geometryByQuality = new Map();
for (const compact of [false, true]) {
  const geometries = createSculptureGeometries(compact);
  for (const [key, geometry] of Object.entries(geometries)) {
    const shape = sculptureShapes[key], vertices = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    assert.ok(shape && vertices && normals && vertices.count === normals.count);
    assert.ok(Array.from(vertices.array).every(Number.isFinite) && Array.from(normals.array).every(Number.isFinite));
    for (let index = 0; index < vertices.count; index++) {
      const point = [vertices.getX(index), vertices.getY(index), vertices.getZ(index)];
      assert.ok(outlineDistance(point, shape.outline) < 2e-5 && Math.abs(point[2]) <= shape.size[2] / 2 + 2e-5,
        'Rendered geometry must fit the concave clearance prism: ' + key + ' ' + JSON.stringify(point));
    }
    geometry.computeBoundingBox();
    assert.ok(geometry.boundingBox.getSize(new Vector3()).toArray().every((size, axis) => size >= shape.size[axis] * .97),
      'A component cannot become an empty or undersized stand-in: ' + key);
  }
  geometryByQuality.set(compact, geometries);
}
for (const { width, height, compact, label } of viewports) {
  const aspect = width / height, world = createJourneyWorld(compact), original = JSON.stringify(world);
  assert.ok(world.parts.length >= 5 && world.parts.length <= 7, 'Only a small set of actual logo components forms the world');
  assert.equal(new Set(world.parts.map(part => part.id)).size, world.parts.length);
  assert.equal(world.parts.length, Object.keys(sculptureShapes).length, 'No extra decorative solid belongs to the environment');
  const samples = [];
  let pathLength = 0, closest = Infinity, maxTurn = 0, maxCameraStep = 0;
  let closestSample;
  for (let step = 0; step <= sampleCount; step++) {
    const p = step / sampleCount, view = journeyCamera(p, compact, aspect), poses = poseSnapshot(world, p), assembly = journeyAssembly(p);
    assert.ok(finitePoint(view.position) && finitePoint(view.target) && view.offset.length === 2 && view.offset.every(Number.isFinite));
    assert.ok(view.position.every(value => Math.abs(value) < 250));
    assert.ok(Math.abs(distance(view.position, view.target) - 30) < 1e-10);
    assert.ok(Object.values(assembly).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    const direction = unit(difference(view.target, view.position));
    assert.ok(Math.abs(direction[1]) < .94, 'The camera does not approach a vertical look-at singularity');
    if (step) {
      const previous = samples[step - 1], travel = distance(view.position, previous.view.position), turn = degrees(angle(direction, previous.direction));
      pathLength += travel; maxCameraStep = Math.max(maxCameraStep, travel); maxTurn = Math.max(maxTurn, turn);
      assert.ok(travel < .4, 'Camera speed stays bounded: ' + JSON.stringify({ label, p, travel }));
      assert.ok(turn < .65, 'Camera rotation stays gradual: ' + JSON.stringify({ label, p, turn }));
    }
    for (let index = 0; index < world.parts.length; index++) {
      const part = world.parts[index], pose = poses[index], shape = sculptureShapes[part.geometry];
      assert.ok(shape && Number.isInteger(part.material) && part.material >= 0);
      assert.ok(finitePoint(pose.position) && finitePoint(pose.rotation) && finitePoint(pose.size));
      assert.ok(pose.position.every(value => Math.abs(value) < 120));
      assert.deepEqual(pose.size, shape.size, 'Logo parts keep their physical size throughout the journey');
      if (step) {
        assert.ok(distance(pose.position, samples[step - 1].poses[index].position) < .25, 'A logo component cannot teleport: ' + JSON.stringify({ label, p, id: part.id }));
        assert.ok(distance(pose.rotation, samples[step - 1].poses[index].rotation) < .025, 'Component rotation stays gradual');
      }
      const gap = clearance(view.position, part, p);
      if (gap < closest) { closest = gap; closestSample = { p, id: part.id }; }
      assert.ok(gap > .45, 'Camera clearance from simultaneous moving logo solids: ' + JSON.stringify({ label, p, id: part.id, gap, camera: view.position, pose }));
    }
    samples.push({ view, poses, direction, assembly });
  }
  const range = axis => Math.max(...samples.map(s => s.view.position[axis])) - Math.min(...samples.map(s => s.view.position[axis]));
  assert.ok(pathLength > 140 && range(0) > 24 && range(2) > 70, 'The camera physically enters, moves laterally, and exits the expanded logo');
  for (const p of [.30, .40, .50]) {
    const bounds = new Box3().setFromPoints(world.parts.flatMap(part => prismVertices(part, p)).map(point => new Vector3(...point)));
    assert.ok(bounds.containsPoint(new Vector3(...journeyCamera(p, compact, aspect).position)), 'The interior journey occupies the expanded component world: ' + p);
  }
  for (const passage of Object.values(sculpturePassages)) {
    const side = point => difference(point, passage.center).reduce((sum, value, axis) => sum + value * passage.normal[axis], 0);
    const crossing = samples.findIndex((sample, index) => index && side(samples[index - 1].view.position) >= 0 && side(sample.view.position) < 0);
    assert.ok(crossing > 0 && distance(samples[crossing].view.position, passage.center) < 8, 'The camera crosses the actual passage region');
  }
  for (let step = 1; step < 100; step++) {
    const p = step / 100;
    for (const field of ['position', 'target', 'offset']) assert.ok(derivativeJump(value => journeyCamera(value, compact, aspect)[field], p) < .15, 'Camera/framing C1 continuity at ' + p);
    for (const part of world.parts) for (const field of ['position', 'rotation']) assert.ok(derivativeJump(value => journeyPart(part, value)[field], p) < .15, 'Part C1 continuity: ' + part.id + ' at ' + p);
  }
  for (let step = sampleCount; step >= 0; step--) {
    const p = step / sampleCount;
    assert.deepEqual(journeyCamera(p, compact, aspect), samples[step].view, 'Reverse scrolling restores camera and off-axis framing');
    assert.deepEqual(poseSnapshot(world, p), samples[step].poses, 'Reverse scrolling restores every component');
    assert.deepEqual(journeyAssembly(p), samples[step].assembly);
  }
  for (const part of world.parts) {
    const rest = { position: part.position, rotation: part.rotation, size: sculptureShapes[part.geometry].size };
    for (const field of ['position', 'rotation', 'size']) {
      assert.deepEqual(journeyPart(part, 0)[field], rest[field], 'The opening is the completed recognizable logo');
      assert.deepEqual(journeyPart(part, .94)[field], rest[field], 'Every component is exactly seated before the final CTA');
    }
    assert.ok(distance(journeyPart(part, .40).position, rest.position) > 3, 'Each component participates in the physical expansion');
  }
  for (let step = 1880; step <= sampleCount; step++) {
    const p = step / sampleCount;
    assert.deepEqual(journeyCamera(p, compact, aspect), journeyCamera(.94, compact, aspect), 'Camera and framing hold exactly from .94 through1');
    assert.deepEqual(poseSnapshot(world, p), poseSnapshot(world, .94), 'The completed logo remains fully seated');
    assert.deepEqual(journeyAssembly(p), journeyAssembly(.94), 'Lighting/assembly control values remain settled');
  }
  for (const [input, endpoint] of [[-1, 0], [-Infinity, 0], [NaN, 0], [2, 1], [Infinity, 1]]) {
    assert.deepEqual(journeyCamera(input, compact, aspect), journeyCamera(endpoint, compact, aspect));
    assert.deepEqual(poseSnapshot(world, input), poseSnapshot(world, endpoint));
  }
  assert.equal(JSON.stringify(world), original); assert.equal(JSON.stringify(createJourneyWorld(compact)), original);
  const geometries = geometryByQuality.get(compact), triangles = world.parts.reduce((sum, part) => {
    const geometry = geometries[part.geometry]; return sum + (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
  }, 0);
  const batches = new Set(world.parts.map(part => part.geometry + ':' + part.material)).size;
  assert.ok(triangles <= (compact ? 2000 : 3000) && batches <= 7, 'Actual six-piece geometry has a small rendering budget');
  results.push({ compact, aspect, label, world, pathLength, closest, closestSample, maxTurn, maxCameraStep, triangles, batches });
}
assert.ok(results[1].triangles < results[0].triangles, 'Compact bevel detail reduces actual triangle work without dropping logo pieces');
assert.deepEqual(createJourneyWorld(false).parts, createJourneyWorld(true).parts, 'Every quality preserves the complete source silhouette');

// A fitted original cut, not an arbitrary new block, supplies the joining moment.
const fullWorld = createJourneyWorld(false);
let fittedJoint = false;
for (let a = 0; a < fullWorld.parts.length; a++) for (let b = a + 1; b < fullWorld.parts.length; b++) {
  const left = fullWorld.parts[a], right = fullWorld.parts[b];
  const leftVertices = sculptureShapes[left.geometry].outline.map(point => [...point, 0]);
  const rightVertices = sculptureShapes[right.geometry].outline.map(point => [...point, 0]);
  const shared = leftVertices.flatMap(l => rightVertices.filter(r => distance(transform(l, journeyPart(left, 0)), transform(r, journeyPart(right, 0))) < 1e-8).map(r => [l, r]));
  if (shared.length < 2) continue;
  const gap = p => Math.max(...shared.map(([l, r]) => distance(transform(l, journeyPart(left, p)), transform(r, journeyPart(right, p)))));
  if (gap(.43) > 5 && gap(.60) < 1e-8) fittedJoint = true;
}
assert.ok(fittedJoint, 'An initially detached logo component physically joins its matching cut during the software stage');

function projectScene(point, progress, compact, width, height, finalShift = 0) {
  const view = journeyCamera(progress, compact, width / height), lens = journeyLens(compact);
  const camera = new PerspectiveCamera(lens.fov, width / height, lens.near, lens.far);
  camera.position.set(...view.position); camera.lookAt(...view.target);
  camera.setViewOffset(width, height, view.offset[0] * width, (view.offset[1] - finalShift) * height, width, height);
  camera.updateMatrixWorld(); return new Vector3(...point).project(camera).toArray();
}
for (const { width, height, compact, label } of viewports) {
  const world = createJourneyWorld(compact), portrait = compact && width / height < 1.15;
  for (const p of [0, .94, 1]) for (const part of world.parts) {
    const geometry = geometryByQuality.get(compact)[part.geometry], vertices = geometry.getAttribute('position');
    for (let index = 0; index < vertices.count; index++) {
      const point = transform([vertices.getX(index), vertices.getY(index), vertices.getZ(index)], journeyPart(part, p));
      const [x, y, z] = projectScene(point, p, compact, width, height);
      assert.ok(z > -1 && z < 1 && (portrait ? x >= -.88 && x <= .88 && y >= .11 && y <= .73 : x >= .06 && x <= .92 && Math.abs(y) < .9),
        'The complete logo stays in the HTML-safe composition zone: ' + JSON.stringify({ label, p, point, projected: [x, y, z] }));
    }
  }
}

// Compare the rendered triangles against the alpha channel of the supplied VX artwork.
function readPng(filename) {
  const bytes = fs.readFileSync(filename), chunks = [];
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  let offset = 8, width, height, channels;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.equal(data[8], 8); assert.ok(data[9] === 2 || data[9] === 6); assert.equal(data[12], 0);
      channels = data[9] === 6 ? 4 : 3;
    }
    if (type === 'IDAT') chunks.push(data);
    offset += length + 12;
  }
  const raw = require('node:zlib').inflateSync(Buffer.concat(chunks)), pixels = new Uint8Array(width * height * channels), stride = width * channels;
  const paeth = (a, b, c) => { const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c); return da <= db && da <= dc ? a : db <= dc ? b : c; };
  offset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[offset++]; assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, left = x >= channels ? pixels[i - channels] : 0, up = y ? pixels[i - stride] : 0, corner = y && x >= channels ? pixels[i - stride - channels] : 0;
      pixels[i] = (raw[offset++] + [0, left, up, Math.floor((left + up) / 2), paeth(left, up, corner)][filter]) & 255;
    }
  }
  assert.equal(offset, raw.length); return { width, height, channels, pixels };
}
const supplied = fs.readFileSync('assets/brand/originals/VX-Miami-Blue.png');
assert.equal(require('node:crypto').createHash('sha256').update(supplied).digest('hex'),
  'd926e88e89b25438b0412d909919dc423a374d83727a41445325d1657d994901', 'The approved VX source is preserved.');
const reference = readPng('public/brand/official/symbol.png'), mask = new Uint8Array(reference.width * reference.height);
assert.equal(reference.channels, 4, 'The official mark has a transparent background');
let minX = reference.width, minY = reference.height, maxX = 0, maxY = 0;
for (let y = 0; y < reference.height; y++) for (let x = 0; x < reference.width; x++) {
  const index = y * reference.width + x;
  const offset = index * 4;
  if (reference.pixels[offset + 3] > 0) {
    assert.ok(reference.pixels[offset] === 0 && reference.pixels[offset + 1] === 168 && reference.pixels[offset + 2] === 214,
      'Every visible source pixel uses the approved Miami Blue');
  }
  if (reference.pixels[offset + 3] >= 128) {
    mask[index] = 1;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
}
const triangleArea = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const renderedTriangles = [], seenTriangles = new Set();
for (const part of fullWorld.parts) {
  const geometry = geometryByQuality.get(false)[part.geometry], vertices = geometry.getAttribute('position'), count = geometry.index?.count ?? vertices.count;
  for (let index = 0; index < count; index += 3) {
    const points = [0, 1, 2].map(corner => {
      const at = geometry.index ? geometry.index.getX(index + corner) : index + corner;
      return transform([vertices.getX(at), vertices.getY(at), vertices.getZ(at)], journeyPart(part, .94));
    });
    if (Math.abs(triangleArea(...points)) < 1e-8) continue;
    const key = points.map(p => p.slice(0, 2).map(value => value.toFixed(6)).join(',')).sort().join('|');
    if (seenTriangles.has(key)) continue; seenTriangles.add(key);
    renderedTriangles.push({ points, minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])), minY: Math.min(...points.map(p => p[1])), maxY: Math.max(...points.map(p => p[1])) });
  }
}
function renderedAt(point) {
  return renderedTriangles.some(triangle => {
    if (point[0] < triangle.minX || point[0] > triangle.maxX || point[1] < triangle.minY || point[1] > triangle.maxY) return false;
    const [a, b, c] = triangle.points, signs = [triangleArea(a, b, point), triangleArea(b, c, point), triangleArea(c, a, point)];
    return signs.every(sign => sign >= -1e-8) || signs.every(sign => sign <= 1e-8);
  });
}
// Fractional coordinates are relative to the independent artwork’s tight pixel bounds.
// Include the central counter and both open channels as well as the outer bars and crossing.
const referenceWidth = maxX - minX + 1, referenceHeight = maxY - minY + 1;
// The 577px cap-to-base span is preferable for registration: diagonal top corners
// taper below 50% opacity before reaching their geometric horizontal extent.
const worldHeight = 48 * 577 / 850.77;
const sourcePoint = (x, y) => [(x - .5) * worldHeight * referenceWidth / referenceHeight, (.5 - y) * worldHeight];
for (const [x, y] of [[.12, .05], [.88, .05], [.5, .54], [.5, .96]]) {
  assert.ok(renderedAt(sourcePoint(x, y)), 'The capped arms, crossing and base remain present');
}
for (const [x, y] of [[.5, .74], [.27, .26], [.73, .26], [.5, .08]]) {
  assert.equal(renderedAt(sourcePoint(x, y)), false, 'The diamond and open channels retain their negative space');
}
let union = 0, intersection = 0, actualCount = 0;
for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
  const actual = Boolean(mask[y * reference.width + x]);
  const rendered = renderedAt(sourcePoint((x + .5 - minX) / referenceWidth, (y + .5 - minY) / referenceHeight));
  if (actual || rendered) union++; if (actual && rendered) intersection++;
  if (actual) actualCount++;
}
assert.ok(actualCount > referenceWidth * referenceHeight * .3 && actualCount < referenceWidth * referenceHeight * .4);
assert.ok(intersection / union > .99, 'Seated mesh must reproduce the official VX: ' + (intersection / union));
console.log('Official VX pixel comparison: ' + (100 * intersection / union).toFixed(2) + '% intersection-over-union; central diamond and open channels retained.');
const finishA = createSculptureFinish(), finishB = createSculptureFinish();
assert.equal(finishA.image.data.byteLength, 64 * 64 * 4);
assert.deepEqual(finishA.image.data, finishB.image.data);
finishA.dispose(); finishB.dispose();
// R3F keeps its default camera mounted across responsive changes. Execute the
// actual World hooks with that same real Three camera; only scheduling/WebGL is
// mocked, so a changed Canvas camera prop alone cannot satisfy this regression.
function rendererLensFixture(source) {
  const slots = [], effects = [], probes = [];
  let cursor = 0, frame, scene, scheduled = false, invalidations = 0, projectionUpdates = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const memo = (create, deps) => {
    const index = cursor++;
    if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: create() };
    return slots[index].value;
  };
  const effect = (callback, deps) => {
    const index = cursor++;
    if (!same(slots[index]?.deps, deps)) {
      const previous = slots[index];
      slots[index] = { deps };
      effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = callback(); });
    }
  };
  const react = {
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect: effect, useLayoutEffect: effect,
  };
  const lens = journeyLens(false), camera = new PerspectiveCamera(lens.fov, 1440 / 900, lens.near, lens.far);
  const update = camera.updateProjectionMatrix.bind(camera);
  camera.updateProjectionMatrix = () => { projectionUpdates++; update(); };
  const state = {
    camera, scene: {}, size: { width: 1440, height: 900 },
    gl: { domElement: { dataset: {} }, info: { render: { triangles: 0, calls: 0 } } },
    invalidate() { scheduled = true; invalidations++; },
  };
  const jsx = (type, props) => ({ type, props });
  const mocks = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, three: require('three'),
    '@react-three/fiber': { Canvas: 'fixture-canvas', useThree: () => ({ ...state }), useFrame(callback) { frame = callback; } },
    '@/components/spatial/PublicSpatialCanvasGuard': { PublicSpatialContextGuard: () => null },
    '@/components/spatial/CanvasPixelProbe': { probeRenderedCanvas({ camera, gl, scene }) {
      const probe = { camera, gl, scene, cleaned: false };
      probes.push(probe);
      return () => { probe.cleaned = true; };
    } },
    '@/components/spatial/SpatialResizeObserver': { SpatialResizeObserver: class {} },
    '../clarity/ClarityEngineWorld': { StudioEnvironment: () => null },
    './SculptureGeometry': loadTypeScript('components/marketing/journey/SculptureGeometry.ts'),
    './journeyMotion': loadTypeScript('components/marketing/journey/journeyMotion.ts'),
    './probeJourneyOverview': loadTypeScript('components/marketing/journey/probeJourneyOverview.ts'),
  };
  const result = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, {
    fileName: 'JourneyCanvas.tsx',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: result.exports, module: result, require(name) {
    assert.ok(Object.hasOwn(mocks, name), 'Renderer fixture has no unexpected dependency: ' + name);
    return mocks[name];
  } });
  const props = { progress: .5, finalShift: 0, active: true, compact: false, onReady() {}, onFailure() {} };
  return {
    camera, state, probes, get scene() { return scene; },
    get invalidations() { return invalidations; }, get projectionUpdates() { return projectionUpdates; },
    render(changes = {}, width = state.size.width, height = state.size.height) {
      Object.assign(props, changes);
      if (width !== state.size.width || height !== state.size.height) {
        Object.assign(state.size, { width, height });
        camera.aspect = width / height;
        camera.updateProjectionMatrix(); // R3F updates aspect, retaining the old lens until World corrects it.
      }
      cursor = 0;
      const canvas = result.exports.default(props);
      const world = canvas.props.children.find(child => child?.props?.progress !== undefined);
      assert.ok(world && typeof world.type === 'function');
      scene = world.type(world.props);
      while (effects.length) effects.shift()();
    },
    settle() {
      let count = 0;
      while (scheduled) {
        scheduled = false; frame(state, 1 / 60);
        assert.ok(++count < 150, 'The actual World demand loop must settle');
      }
      return count;
    },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}
const rendererSource = fs.readFileSync('components/marketing/journey/JourneyCanvas.tsx', 'utf8');
const renderer = rendererLensFixture(rendererSource), mountedCamera = renderer.camera;
try {
  for (const { compact, width, height } of [viewports[0], viewports[1], viewports[2]]) {
    renderer.render({ compact }, width, height);
    const renderedMeshes = [];
    const walk = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (['mesh', 'instancedMesh', 'points', 'line', 'lineSegments'].includes(node.type)) renderedMeshes.push(node);
      walk(node.props?.children);
    };
    walk(renderer.scene);
    assert.ok(renderedMeshes.every(node => node.type === 'instancedMesh') &&
      renderedMeshes.reduce((sum, node) => sum + node.props.args[2], 0) === 6,
    'The actual renderer contains only the six logo components, with no floor or unrelated geometry');
    const lens = journeyLens(compact), expected = new PerspectiveCamera(lens.fov, width / height, lens.near, lens.far);
    assert.equal(renderer.camera, mountedCamera, 'Responsive changes retain the mounted R3F camera');
    assert.equal(renderer.camera.fov, lens.fov, 'The mounted camera changes full → compact → full lens');
    if (renderer.camera.view?.enabled) {
      const view = renderer.camera.view;
      expected.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
      expected.aspect = width / height; expected.updateProjectionMatrix();
    }
    assert.ok(renderer.camera.projectionMatrix.elements.every((value, index) => Math.abs(value - expected.projectionMatrix.elements[index]) < 1e-12),
      'The actual mounted camera projection is rebuilt before the next frame');
    assert.equal(renderer.state.gl.domElement.dataset.journeyFov, String(lens.fov));
    assert.equal(renderer.settle(), 1, 'A settled quality/size transition requests one coalesced demand frame');
    const before = { invalidations: renderer.invalidations, projectionUpdates: renderer.projectionUpdates };
    for (let repeat = 0; repeat < 5; repeat++) renderer.render({ compact });
    assert.equal(renderer.invalidations, before.invalidations, 'Identical rerenders do not perpetually invalidate');
    assert.equal(renderer.projectionUpdates, before.projectionUpdates, 'Identical rerenders do not rebuild the projection');
    assert.equal(renderer.settle(), 0);
  }
  renderer.render({ progress: .6 });
  assert.ok(renderer.settle() > 1, 'Real progress interpolation schedules a finite series of demand frames');
  assert.equal(renderer.camera.fov, journeyLens(false).fov, 'Scroll framing does not change the responsive lens');
  assert.equal(renderer.settle(), 0, 'No background frame remains after interpolation settles');
  const checkProjection = (compact, width, height, progress, shift) => {
    const lens = journeyLens(compact), expected = new PerspectiveCamera(lens.fov, width / height, lens.near, lens.far);
    const view = journeyCamera(progress, compact, width / height);
    expected.setViewOffset(width, height, view.offset[0] * width, (view.offset[1] - shift) * height, width, height);
    assert.deepEqual(renderer.camera.projectionMatrix.elements, expected.projectionMatrix.elements,
      'Actual World applies responsive composition and final CTA following to the mounted projection');
  };
  for (const { compact, width, height } of [viewports[1], viewports[2], viewports[1]]) {
    renderer.render({ progress: .94, compact, finalShift: 0 }, width, height); renderer.settle();
    checkProjection(compact, width, height, .94, 0);
    assert.equal(renderer.camera, mountedCamera);
  }
  const heldPosition = renderer.camera.position.toArray(), heldProjection = renderer.projectionUpdates;
  renderer.render({ progress: 1 }); renderer.settle();
  assert.deepEqual(renderer.camera.position.toArray(), heldPosition, 'The real mounted camera holds through the final CTA');
  assert.equal(renderer.projectionUpdates, heldProjection, 'Held framing does not repeatedly rebuild the projection');
  renderer.render({ finalShift: -.12 });
  assert.equal(renderer.settle(), 1, 'CTA following coalesces into one demand frame');
  checkProjection(true, 390, 844, 1, -.12);
  assert.deepEqual(renderer.camera.position.toArray(), heldPosition, 'CTA following changes composition, not the held camera path');
  renderer.render({ finalShift: 0 }); renderer.settle(); checkProjection(true, 390, 844, 1, 0);
  const settledUpdates = renderer.projectionUpdates, settledInvalidations = renderer.invalidations;
  renderer.render({ finalShift: 0 }); assert.equal(renderer.settle(), 0);
  assert.equal(renderer.projectionUpdates, settledUpdates); assert.equal(renderer.invalidations, settledInvalidations);
  renderer.render({ progress: .5376 }); renderer.settle();
  assert.equal(renderer.probes.length, 1, 'Scrolling and resizing a ready canvas must never restart its pixel probe');
  assert.equal(renderer.probes[0].cleaned, false);
  renderer.state.scene = {};
  renderer.render();
  assert.equal(renderer.probes.length, 2, 'Replacing the scene requests a fresh readiness check');
  assert.equal(renderer.probes[0].cleaned, true);
  assert.equal(renderer.probes[1].scene, renderer.state.scene);
} finally { renderer.unmount(); }
assert.equal(renderer.probes.at(-1).cleaned, true, 'Unmount cancels the active readiness check');
console.log('Actual World hook fixture: same-camera 47° → 57° → 47° resize, rebuilt projection, responsive offsets/final CTA following, coalesced demand frames and no idle invalidation passed. React/R3F scheduling is mocked; no WebGL claim.');
for (const result of results) console.log('Logo journey ' + result.label + ': ' + result.pathLength.toFixed(1) + ' camera units; ' + result.closest.toFixed(3) + ' minimum prism clearance ' + JSON.stringify(result.closestSample) + '; max step ' + result.maxCameraStep.toFixed(3) + ', max turn ' + result.maxTurn.toFixed(3) + '°; ' + result.world.parts.length + ' components / ' + result.triangles + ' triangles / ' + result.batches + ' batches.');
for (const geometries of geometryByQuality.values()) Object.values(geometries).forEach(geometry => geometry.dispose());
console.log('Logo journey geometry, independent source silhouette, moving-solid clearance, exact assembly/hold, reversible continuous motion and composition checks passed. Offline checks and mocked scheduling; no browser, occlusion, FPS or visual-quality claim.');

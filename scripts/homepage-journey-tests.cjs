/* eslint-disable @typescript-eslint/no-require-imports -- Offline geometry and camera-path regression runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const moduleResult = { exports: {} };
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync('components/marketing/journey/journeyMotion.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, { exports: moduleResult.exports, module: moduleResult });
const { journeyCamera, createJourneyWorld } = moduleResult.exports;
const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const difference = (a, b) => a.map((value, axis) => value - b[axis]);
const unit = vector => vector.map(value => value / Math.hypot(...vector));

function clearance(point, block) {
  const [dx, dy, dz] = difference(point, block.position);
  const c = Math.cos(block.rotation), s = Math.sin(block.rotation);
  const local = [c * dx - s * dz, dy, s * dx + c * dz];
  return Math.hypot(...local.map((value, axis) => Math.max(0, Math.abs(value) - block.size[axis] / 2)));
}

for (const compact of [false, true]) {
  const world = createJourneyWorld(compact);
  const originalWorld = JSON.stringify(world);
  assert.ok(world.blocks.length < 350, 'Architecture remains bounded for mobile rendering');
  assert.ok(world.blocks.every(block => [...block.position, ...block.size, block.rotation].every(Number.isFinite)));
  assert.ok(world.blocks.every(block => block.size.every(value => value > 0)));
  const solids = [...world.blocks, ...world.panels.map(panel => ({
    position: panel.position,
    size: [(panel.family === 0 ? 1.35 : 1.05) * panel.scale, 1.35 * panel.scale, .25 * panel.scale],
    rotation: panel.rotation[1],
  }))];
  const samples = [];
  let pathLength = 0, closest = Infinity, maxTurn = 0;
  for (let step = 0; step <= 2000; step++) {
    const p = step / 2000, view = journeyCamera(p, compact);
    assert.ok([...view.position, ...view.target].every(Number.isFinite), 'Every camera sample is finite');
    assert.ok(Math.abs(distance(view.position, view.target) - 30) < 1e-10,
      'The view direction has constant length, preventing aim-point crossings');
    assert.ok(view.position[1] > 2, 'Camera stays above the ground and routing surfaces');
    const direction = unit(difference(view.target, view.position));
    if (step) {
      const previous = samples[step - 1];
      const travel = distance(view.position, previous.position);
      assert.ok(travel < .3, 'Small scroll increments cannot teleport the camera');
      pathLength += travel;
      const angle = Math.acos(Math.min(1, Math.max(-1, direction.reduce((sum, value, axis) =>
        sum + value * previous.direction[axis], 0)))) * 180 / Math.PI;
      maxTurn = Math.max(maxTurn, angle);
      assert.ok(angle < .65, 'View rotation remains gradual throughout district transitions');
    }
    for (const block of solids) {
      const gap = clearance(view.position, block);
      closest = Math.min(closest, gap);
      assert.ok(gap > .45, 'Camera clearance exceeds the near plane, including panels and portal posts: ' +
        JSON.stringify({ p, position: view.position, block, gap }));
    }
    samples.push({ ...view, direction });
  }
  assert.ok(pathLength > 150, 'The journey traverses the world rather than orbiting a single object');
  assert.ok(Math.max(...samples.map(view => view.position[0])) -
    Math.min(...samples.map(view => view.position[0])) > 45, 'Camera travels laterally between separated districts');
  assert.ok(samples[0].position[2] - samples[1400].position[2] > 90, 'The offering sequence crosses more than ninety units of depth');
  assert.ok(samples[2000].position[1] - samples[1400].position[1] > 30, 'The finish emerges into an elevated overview');

  // At the entry and each offering, the route passes the architectural district itself.
  for (const [progress, center, radius] of [
    [.22, [0, 3, -3], 9], [.30, [8, 3, -18], 15],
    [.50, [-11, 3, -45], 15], [.70, [14, 4, -72], 17],
  ]) assert.ok(distance(journeyCamera(progress, compact).position, center) < radius);

  // Shared derivatives prevent perceptible velocity jumps at the content milestones.
  for (const p of [.14, .20, .30, .40, .50, .60, .70, .76, .84]) {
    const epsilon = 1e-6;
    for (const field of ['position', 'target']) {
      const at = journeyCamera(p, compact)[field];
      const left = difference(at, journeyCamera(p - epsilon, compact)[field]).map(value => value / epsilon);
      const right = difference(journeyCamera(p + epsilon, compact)[field], at).map(value => value / epsilon);
      assert.ok(distance(left, right) < .08, 'Camera and aim are C1 continuous across every join');
    }
  }
  for (let step = 2000; step >= 0; step--) {
    const reverse = journeyCamera(step / 2000, compact);
    assert.deepEqual(reverse.position, samples[step].position, 'Reverse scrolling restores the exact camera position');
    assert.deepEqual(reverse.target, samples[step].target, 'Reverse scrolling restores the exact view direction');
  }
  assert.deepEqual(journeyCamera(-1, compact), journeyCamera(0, compact));
  assert.deepEqual(journeyCamera(2, compact), journeyCamera(1, compact));
  assert.equal(JSON.stringify(world), originalWorld, 'Camera sampling never mutates the fixed architecture');
  assert.equal(JSON.stringify(createJourneyWorld(compact)), originalWorld, 'World generation is deterministic');
  console.log('Journey ' + (compact ? 'compact' : 'desktop') + ': ' + pathLength.toFixed(1) +
    ' units of camera travel, ' + closest.toFixed(2) + ' minimum solid clearance, ' +
    maxTurn.toFixed(2) + '° maximum turn per 0.0005 progress, ' + world.blocks.length + ' fixed blocks.');
}
const full = createJourneyWorld(false), mobile = createJourneyWorld(true);
for (const [progress, retreat] of [[0, 20], [1, 25]]) {
  const desktop = journeyCamera(progress), compact = journeyCamera(progress, true);
  const direction = unit(difference(compact.target, compact.position));
  const raised = desktop.position.map((value, axis) => value + (axis === 1 ? 1 : 0));
  const displacement = difference(raised, compact.position);
  assert.ok(distance(displacement, direction.map(value => value * retreat)) < 1e-10,
    'Portrait overview retreats along the view ray without changing its heading');
}
for (const progress of [.2, .3, .5, .7, .84]) {
  const desktop = journeyCamera(progress), compact = journeyCamera(progress, true);
  assert.ok(distance(compact.position, desktop.position.map((value, axis) => value + (axis === 1 ? 1 : 0))) < 1e-10,
    'Portrait overview framing leaves the middle traversal unchanged');
}
assert.ok(mobile.blocks.length < full.blocks.length && mobile.panels.length < full.panels.length,
  'Compact mode reduces detail while preserving all three districts');
for (const family of [0, 1, 2]) {
  const points = full.panels.filter(panel => panel.family === family).map(panel => panel.position);
  assert.ok(points.length >= 3, 'Every offering has a substantial fixed district');
  const other = full.panels.filter(panel => panel.family !== family);
  assert.ok(points.every(point => other.every(panel => distance(point, panel.position) > 10)),
    'Offering districts occupy distinct world-space regions');
}
console.log('Homepage journey: stable world, real district traversal, solid clearance, C1 camera/aim, bounded rotation, reverse determinism and compact detail passed. No browser/WebGL claim.');

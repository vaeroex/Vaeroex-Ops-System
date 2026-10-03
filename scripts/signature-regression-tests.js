/* Behavioral contracts for the landing/business signature scenes and evidence example. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function loadTs(file) {
  const module = { exports: {} };
  const math = Object.create(Math);
  math.random = () => {
    throw new Error("Scroll choreography must not depend on randomness");
  };
  const code = ts.transpileModule(read(file), {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const scopedRequire = (request) => {
    if (request.endsWith(".module.css"))
      return { default: new Proxy({}, { get: (_, name) => String(name) }) };
    if (request.startsWith("."))
      return loadTs(
        path.join(
          path.dirname(file),
          request.endsWith(".ts") ? request : `${request}.ts`,
        ),
      );
    return require(request);
  };
  vm.runInNewContext(
    code,
    { module, exports: module.exports, require: scopedRequire, Math: math },
    { filename: file },
  );
  return module.exports;
}
const distance = (a, b) =>
  Math.hypot(...a.map((value, axis) => value - b[axis]));
const numeric = (value) =>
  typeof value === "number"
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(numeric)
      : value && typeof value === "object"
        ? Object.values(value).flatMap(numeric)
        : [];
function channels(state) {
  const { progress, act, stage, ...continuous } = state;
  void progress;
  void act;
  void stage;
  return numeric(continuous);
}
function verifyMotion(name, evaluate, acts) {
  assert.equal(typeof evaluate, "function");
  assert.deepEqual(
    Array.from(acts),
    [0, 0.25, 0.5, 0.75, 1],
    `${name} must support all five story chapters`,
  );
  for (const compact of [false, true]) {
    for (const [input, expected] of [
      [NaN, 0],
      [-Infinity, 0],
      [Infinity, 1],
      [-0.2, 0],
      [1.2, 1],
    ]) {
      assert.deepEqual(
        evaluate(input, compact),
        evaluate(expected, compact),
        `${name} input clamping`,
      );
    }
    const states = Array.from({ length: 801 }, (_, index) =>
      evaluate(index / 800, compact),
    );
    const samples = states.map(channels);
    const count = samples[0].length;
    assert.ok(count > 10);
    for (const state of states) {
      assert.ok(
        numeric(state).every(Number.isFinite),
        `${name} poses must remain finite`,
      );
      assert.ok(
        state.fov >= 20 && state.fov <= 90,
        `${name} usable field of view`,
      );
      assert.ok(
        distance(state.camera, state.target) > 0.25,
        `${name} camera must not cross its look-at target`,
      );
      assert.equal(channels(state).length, count, `${name} stable pose schema`);
      for (const [key, value] of Object.entries(state)) {
        if (
          typeof value === "number" &&
          /(?:opacity|reveal|emphasis)$/i.test(key)
        ) {
          assert.ok(
            value >= 0 && value <= 1,
            `${name} ${key} must remain normalized`,
          );
        }
      }
    }
    // Normalize each channel by its own range to catch teleports without coupling
    // the test to one artist's units or individual keyframe coordinates.
    for (let channel = 0; channel < count; channel++) {
      const values = samples.map((sample) => sample[channel]);
      const range = Math.max(...values) - Math.min(...values);
      for (let index = 1; index < values.length; index++) {
        assert.ok(
          Math.abs(values[index] - values[index - 1]) <= range * 0.025 + 1e-7,
          `${name} channel ${channel} jumps at progress ${index / 800}`,
        );
      }
    }
    for (let index = 800; index >= 0; index--) {
      assert.deepEqual(
        evaluate(index / 800, compact),
        states[index],
        `${name} reverse scroll must restore the same complete pose`,
      );
    }
    for (let index = 0; index < acts.length; index++) {
      const state = evaluate(acts[index], compact);
      assert.equal(state.act ?? state.stage, index);
      if (index) {
        const previous = evaluate(acts[index - 1], compact);
        assert.ok(
          distance(state.camera, previous.camera) +
            distance(state.target, previous.target) >
            0.5,
          `${name} each chapter must have a distinct camera composition`,
        );
      }
      for (const offset of [-1e-5, 1e-5]) {
        const near = evaluate(acts[index] + offset, compact);
        assert.ok(
          distance(state.camera, near.camera) / 1e-5 < 0.2,
          `${name} camera must ease through chapter boundaries`,
        );
        const left = channels(state),
          right = channels(near);
        assert.ok(
          left.every(
            (value, channel) => Math.abs(value - right[channel]) < 0.001,
          ),
          `${name} all transforms must be continuous across chapter joins`,
        );
      }
    }
  }
}

const executive = loadTs("components/marketing/signature/ExecutiveMotion.ts");
const landing = loadTs("components/marketing/signature/LandingMotion.ts");
verifyMotion(
  "Executive",
  executive.evaluateExecutiveMotion,
  executive.EXECUTIVE_ACTS,
);
verifyMotion("Landing", landing.evaluateLandingMotion, landing.LANDING_STAGES);
for (const compact of [false, true]) {
  const stages = executive.EXECUTIVE_ACTS.map((progress) =>
    executive.evaluateExecutiveMotion(progress, compact),
  );
  assert.ok(
    stages[2].riskEmphasis > stages[1].riskEmphasis &&
      stages[2].riskHeight > stages[1].riskHeight,
    "Business risk must become spatially distinct in its chapter",
  );
  assert.ok(
    stages[3].evidenceReveal > stages[2].evidenceReveal,
    "The evidence chapter must expose its supporting layers",
  );
  assert.equal(stages[3].evidence.length, 4);
  assert.ok(
    distance(stages[3].evidence[0].position, stages[3].evidence[3].position) >
      1,
    "Evidence layers must separate visibly",
  );
  assert.ok(
    stages[4].briefingReveal > 0.95 &&
      stages[4].recordSpread < stages[0].recordSpread,
    "The final business chapter must assemble its briefing",
  );
  const separation = executive.EXECUTIVE_ACTS.reduce(
    (sum, progress) =>
      sum +
      distance(
        executive.evaluateExecutiveMotion(progress, compact).camera,
        landing.evaluateLandingMotion(progress, compact).camera,
      ),
    0,
  );
  assert.ok(
    separation > 5,
    "Landing and business scenes must retain distinct camera journeys",
  );
}

// Compact mode removes work while preserving a connected information graph.
const fullTiles = landing.evaluateLandingMotion(0.5, false).tiles.length;
const compactTiles = landing.evaluateLandingMotion(0.5, true).tiles.length;
assert.equal(fullTiles, landing.LANDING_TILE_COUNT);
assert.equal(compactTiles, landing.LANDING_COMPACT_TILE_COUNT);
assert.ok(fullTiles <= 48 && compactTiles <= 28 && compactTiles < fullTiles);
const graphSizes = [];
for (const compact of [false, true]) {
  const count = compact ? compactTiles : fullTiles;
  const links = landing.createLandingLinks(compact);
  const adjacent = Array.from({ length: count }, () => []),
    unique = new Set();
  for (const [from, to] of links) {
    assert.ok(
      Number.isInteger(from) &&
        Number.isInteger(to) &&
        from >= 0 &&
        to >= 0 &&
        from < count &&
        to < count &&
        from !== to,
    );
    const key = [from, to].sort((a, b) => a - b).join(",");
    assert.ok(
      !unique.has(key),
      "Landing connections must not duplicate GPU work",
    );
    unique.add(key);
    adjacent[from].push(to);
    adjacent[to].push(from);
  }
  const visited = new Set([0]),
    queue = [0];
  while (queue.length)
    for (const next of adjacent[queue.shift()])
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
  assert.equal(
    visited.size,
    count,
    "Both quality levels must preserve one connected atlas",
  );
  assert.ok(
    links.length < count * 3,
    "The atlas graph must remain sparse rather than growing quadratically",
  );
  graphSizes.push(links.length);
}
assert.ok(
  graphSizes[1] < graphSizes[0],
  "Compact devices must render fewer connections",
);
const landingGeometry = loadTs(
  "components/marketing/signature/LandingGeometry.ts",
);
const triangleCount = (geometry) =>
  (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
const geometryBudgets = [];
for (const compact of [false, true]) {
  const geometry = landingGeometry.makeLandingGeometry(compact);
  const all = Object.values(geometry).flat();
  for (const item of all) {
    const position = item.getAttribute("position"),
      normal = item.getAttribute("normal");
    assert.ok(
      position.count > 0 && Array.from(position.array).every(Number.isFinite),
      "Generated signature geometry must contain finite vertices",
    );
    assert.ok(
      normal && Array.from(normal.array).every(Number.isFinite),
      "Generated signature lighting normals must remain finite",
    );
    if (item.index)
      assert.ok(
        Array.from(item.index.array).every(
          (index) => index >= 0 && index < position.count,
        ),
      );
  }
  const count = compact ? compactTiles : fullTiles;
  const instancedDocuments =
    count *
    [
      geometry.body,
      geometry.face,
      geometry.trim,
      geometry.accent,
      geometry.rivets,
    ].reduce((sum, item) => sum + triangleCount(item), 0);
  const etchings =
    (count / 3) *
    geometry.etchings.reduce((sum, item) => sum + triangleCount(item), 0);
  const core = [geometry.core, geometry.foundation, geometry.rails].reduce(
    (sum, item) => sum + triangleCount(item),
    0,
  );
  const triangles = instancedDocuments + etchings + core;
  assert.ok(
    triangles < (compact ? 50000 : 100000),
    "Instanced document and core geometry must retain its quality budget",
  );
  geometryBudgets.push(triangles);
  all.forEach((item) => item.dispose());
}
assert.ok(
  geometryBudgets[1] < geometryBudgets[0] * 0.8,
  "Compact document geometry must materially reduce work",
);

// Curved Executive links may move, but scrolling must not replace their GPU buffers.
const executiveGeometry = loadTs(
  "components/marketing/signature/ExecutiveGeometry.ts",
);
const flow = executiveGeometry.executiveFlow();
const positionAttribute = flow.getAttribute("position"),
  normalAttribute = flow.getAttribute("normal"),
  indexAttribute = flow.index;
const start = [-1.6, 0.5, 0.4],
  end = [1.6, 1.6, -0.4];
executiveGeometry.updateExecutiveFlow(flow, start, end, 0.8);
const initialPositions = Array.from(positionAttribute.array);
executiveGeometry.updateExecutiveFlow(flow, start, [1.8, 2.5, 0.8], 1.1);
assert.equal(flow.getAttribute("position"), positionAttribute);
assert.equal(flow.getAttribute("normal"), normalAttribute);
assert.equal(flow.index, indexAttribute);
assert.notDeepEqual(Array.from(positionAttribute.array), initialPositions);
assert.ok(Array.from(positionAttribute.array).every(Number.isFinite));
for (let index = 0; index < normalAttribute.count; index++)
  assert.ok(
    Math.abs(
      Math.hypot(
        normalAttribute.getX(index),
        normalAttribute.getY(index),
        normalAttribute.getZ(index),
      ) - 1,
    ) < 1e-5,
  );
executiveGeometry.updateExecutiveFlow(flow, start, end, 0.8);
assert.deepEqual(
  Array.from(positionAttribute.array),
  initialPositions,
  "Curved links must reverse to their exact original geometry",
);
flow.dispose();

const { EvidenceVisualization } = loadTs(
  "components/marketing/EvidenceVisualization.tsx",
);
const html = renderToStaticMarkup(React.createElement(EvidenceVisualization));
assert.match(html, /SYNTHETIC DATA/);
assert.match(html, /undated/);
assert.match(html, /Other expenses are unknown/);
assert.match(html, /No “as of” date/);
const rows = [
  ...html.matchAll(
    /<tr><th scope="row">([^<]+) <span>\+(\d+)%<\/span><\/th><td>\$([\d,]+)<\/td><td>\$([\d,]+)<\/td><\/tr>/g,
  ),
];
assert.equal(
  rows.length,
  2,
  "The evidence example must expose both input rows as an accessible table",
);
const values = rows.map((row) => {
  const before = Number(row[3].replaceAll(",", "")),
    after = Number(row[4].replaceAll(",", ""));
  assert.equal(
    ((after - before) * 100) / before,
    Number(row[2]),
    `${row[1]} percent change must match the displayed figures`,
  );
  return { before, after };
});
const marginA =
  ((values[0].before - values[1].before) * 100) / values[0].before;
const marginB = ((values[0].after - values[1].after) * 100) / values[0].after;
assert.match(html, new RegExp(`>${marginA.toFixed(2)}%<`));
assert.match(html, new RegExp(`>${marginB.toFixed(2)}%<`));
const claimedDelta = html.match(/<strong>([−-]?[\d.]+)<span>pp<\/span>/);
assert.ok(
  claimedDelta,
  "The derived difference must be labeled in percentage points",
);
assert.equal(
  Number(claimedDelta[1].replace("−", "-")),
  marginB - marginA,
  "The interpretation must follow the visible input arithmetic exactly",
);
process.stdout.write(
  "Signature finite poses, five-stage camera travel, continuity, reversal, distinct journeys, compact geometry budgets, stable link buffers, and rendered evidence arithmetic passed.\n",
);

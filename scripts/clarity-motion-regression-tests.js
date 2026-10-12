/* Scroll choreography contracts: evaluate real poses without a browser, GPU, or timer. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const file = "components/marketing/clarity/clarityMotion.ts";
const moduleUnderTest = { exports: {} };
const code = ts.transpileModule(
  fs.readFileSync(path.join(process.cwd(), file), "utf8"),
  {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;
const deterministicMath = Object.create(Math);
deterministicMath.random = () => {
  throw new Error("Scroll poses must not depend on random values");
};
vm.runInNewContext(
  code,
  {
    module: moduleUnderTest,
    exports: moduleUnderTest.exports,
    Math: deterministicMath,
    Date: class {
      constructor() {
        throw new Error("Scroll poses must not depend on wall-clock time");
      }
    },
  },
  { filename: file },
);
const {
  evaluateClarityMotion,
  normalizeClarityProgress,
  CLARITY_STAGES,
  CLARITY_LAYER_COUNT,
} = moduleUnderTest.exports;

function numbers(value) {
  if (typeof value === "number") return [value];
  if (Array.isArray(value)) return value.flatMap(numbers);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(numbers);
  return [];
}
function poseNumbers(state) {
  const { progress, stage, ...pose } = state;
  void progress;
  void stage;
  return numbers(pose);
}
function maxPoseDelta(a, b) {
  const left = poseNumbers(a);
  const right = poseNumbers(b);
  assert.equal(
    left.length,
    right.length,
    "Geometry count cannot jump between chapters",
  );
  return Math.max(
    ...left.map((value, index) => Math.abs(value - right[index])),
  );
}
function distance(a, b) {
  return Math.hypot(...a.map((value, index) => value - b[index]));
}
function assertSafe(state, compact) {
  assert.ok(
    numbers(state).every(Number.isFinite),
    "Every transform must be finite",
  );
  assert.ok(state.progress >= 0 && state.progress <= 1);
  assert.ok(
    Number.isInteger(state.stage) && state.stage >= 0 && state.stage <= 3,
  );
  assert.ok(
    state.fov >= 20 && state.fov <= 90,
    "Perspective must stay within a usable viewing angle",
  );
  assert.ok(
    distance(state.camera, state.target) > 1,
    "Camera and look target must not collapse",
  );
  assert.ok(state.core.reveal >= 0 && state.core.reveal <= 1);
  assert.equal(
    state.layers.length,
    compact ? CLARITY_LAYER_COUNT.compact : CLARITY_LAYER_COUNT.full,
  );
  assert.ok(
    state.layers.length > 1 && state.layers.length <= 8,
    "Layer count must stay within the public scene budget",
  );
  assert.ok(
    state.fragments.length <= (compact ? 3 : 6),
    "Fragment budget must respect compact quality",
  );
  assert.ok(
    state.signals.length <= (compact ? 3 : 6),
    "Signal budget must respect compact quality",
  );
  for (const pose of [
    state.structure,
    state.front,
    state.back,
    state.core,
    ...state.layers,
    ...state.fragments,
    ...state.signals,
  ]) {
    assert.ok(
      pose.scale > 0,
      "Morphing cannot invert or zero-scale visible geometry",
    );
    assert.equal(pose.position.length, 3);
    assert.equal(pose.rotation.length, 3);
  }
}

assert.deepEqual(
  Array.from(CLARITY_STAGES),
  [0, 1 / 3, 2 / 3, 1],
  "Four acts must span the complete normalized journey",
);
assert.ok(
  CLARITY_LAYER_COUNT.compact < CLARITY_LAYER_COUNT.full,
  "Compact devices must get a cheaper real scene",
);
for (const [input, expected] of [
  [-10, 0],
  [0, 0],
  [0.42, 0.42],
  [1, 1],
  [100, 1],
  [NaN, 0],
  [-Infinity, 0],
  [Infinity, 1],
]) {
  assert.equal(
    normalizeClarityProgress(input),
    expected,
    `Safe normalization for ${input}`,
  );
  assert.deepEqual(
    evaluateClarityMotion(input),
    evaluateClarityMotion(expected),
    "Out-of-range values must resolve to a complete safe pose",
  );
}

const variants = ["home", "executive", "systems", "research"];
for (const variant of variants) {
  for (const compact of [false, true]) {
    const label = `${variant}/${compact ? "compact" : "full"}`;
    const keyframes = Array.from(CLARITY_STAGES, (progress, stage) => {
      const state = evaluateClarityMotion(progress, variant, compact);
      assertSafe(state, compact);
      assert.equal(
        state.stage,
        stage,
        `${label} chapter boundary must identify the correct act`,
      );
      return state;
    });
    for (let index = 1; index < keyframes.length; index++) {
      assert.ok(
        distance(keyframes[index - 1].camera, keyframes[index].camera) > 0.8,
        `${label} must travel between every pair of acts`,
      );
      assert.ok(
        maxPoseDelta(keyframes[index - 1], keyframes[index]) > 0.5,
        `${label} must visibly change between acts`,
      );
    }
    const opening = keyframes[0];
    const ending = keyframes[3];
    assert.ok(
      ending.core.reveal > opening.core.reveal + 0.5,
      `${label} must reveal a decision core`,
    );
    assert.equal(
      ending.core.reveal,
      1,
      `${label} must complete its reveal at the end`,
    );
    assert.ok(
      distance(opening.front.position, opening.back.position) >
        distance(ending.front.position, ending.back.position) * 2,
      `${label} must converge its separated shell`,
    );
    for (let index = 0; index < ending.layers.length; index++) {
      const layer = ending.layers[index];
      assert.ok(
        Math.abs(layer.position[0]) < 0.001 &&
          Math.abs(layer.position[1]) < 0.001,
        `${label} must end with aligned layers`,
      );
      assert.ok(
        layer.rotation.every((value) => Math.abs(value) < 0.001),
        `${label} must resolve scattered layer rotations`,
      );
      if (index > 0)
        assert.ok(
          layer.position[2] < ending.layers[index - 1].position[2],
          `${label} ordered layers must retain distinct depth`,
        );
    }
    for (let index = 0; index < ending.fragments.length; index++) {
      assert.ok(
        ending.fragments[index].scale < opening.fragments[index].scale / 4,
        `${label} must quiet the fragments as clarity emerges`,
      );
    }

    // Sampling through and backward across all acts catches discontinuities and
    // hidden accumulators that make reverse scrolling behave unlike forward scrolling.
    const samples = Array.from({ length: 301 }, (_, index) => index / 300);
    const forward = samples.map((progress) =>
      evaluateClarityMotion(progress, variant, compact),
    );
    for (let index = 0; index < forward.length; index++) {
      assertSafe(forward[index], compact);
      if (index > 0) {
        assert.ok(
          forward[index].core.reveal >= forward[index - 1].core.reveal,
          `${label} core reveal must not reverse during forward travel`,
        );
        assert.ok(
          maxPoseDelta(forward[index - 1], forward[index]) < 0.5,
          `${label} adjacent scroll samples must not jump`,
        );
      }
    }
    for (let index = samples.length - 1; index >= 0; index--) {
      assert.deepEqual(
        evaluateClarityMotion(samples[index], variant, compact),
        forward[index],
        `${label} poses must be independent of scroll direction/history`,
      );
    }
    const epsilon = 1e-5;
    for (const boundary of CLARITY_STAGES) {
      const at = evaluateClarityMotion(boundary, variant, compact);
      for (const offset of [-epsilon, epsilon]) {
        const near = evaluateClarityMotion(boundary + offset, variant, compact);
        assert.ok(
          maxPoseDelta(at, near) / epsilon < 0.1,
          `${label} chapter joins must settle smoothly without a position or velocity jump`,
        );
      }
    }
  }

  const full = evaluateClarityMotion(0.42, variant, false);
  const compact = evaluateClarityMotion(0.42, variant, true);
  assert.equal(compact.progress, full.progress);
  assert.equal(compact.stage, full.stage);
  assert.equal(
    compact.core.reveal,
    full.core.reveal,
    "Compact quality must preserve the same narrative timing",
  );
  assert.ok(
    distance(compact.camera, full.camera) < 1,
    "Compact framing must preserve the same camera story",
  );
  assert.ok(
    compact.layers.length < full.layers.length &&
      compact.fragments.length < full.fragments.length &&
      compact.signals.length < full.signals.length,
    "Compact quality must reduce each geometry family",
  );
}
for (let left = 0; left < variants.length; left++) {
  for (let right = left + 1; right < variants.length; right++) {
    const a = evaluateClarityMotion(0, variants[left]);
    const b = evaluateClarityMotion(0, variants[right]);
    assert.notDeepEqual(
      a.camera,
      b.camera,
      "Each page variant must have an intentional camera composition",
    );
    assert.notDeepEqual(
      a.layers,
      b.layers,
      "Each page variant must have its own opening structure",
    );
  }
}

process.stdout.write(
  "Clarity motion bounds, continuity, reversibility, narrative convergence, and compact geometry regressions passed.\n",
);

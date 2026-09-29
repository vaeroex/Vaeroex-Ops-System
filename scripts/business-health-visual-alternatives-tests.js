const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const file = path.join(__dirname, "../components/intelligence/BusinessHealthInstrument.tsx");
const source = fs.readFileSync(file, "utf8");
const loaded = { exports: {} };
Function("require", "module", "exports", ts.transpileModule(source, {
  fileName: file,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText)(require, loaded, loaded.exports);
const render = (variant, score, status) => renderToStaticMarkup(React.createElement(loaded.exports.BusinessHealthInstrument, { variant, score, status }));

for (const variant of ["scorecard", "arc"]) {
  test(`${variant}: preserves supplied values and status at all existing boundaries`, () => {
    for (const [score, status] of [[0, "At Risk"], [49, "At Risk"], [50, "Watch"], [76, "Watch"], [79, "Watch"], [80, "Strong"], [100, "Strong"]]) {
      const html = render(variant, score, status);
      assert.ok(html.includes(`aria-label="Business Health score ${score} out of 100. ${status}."`));
      assert.ok(html.includes(`workspace-health-instrument__score">${score}</span>`));
      assert.match(html, /data-available="true"/);
      assert.doesNotMatch(html, /Insufficient data|vs|percentile|forecast/i);
    }
    assert.match(render(variant, 76, "Supplied status"), /Supplied status/, "display never reclassifies a score");
  });
  test(`${variant}: null is unavailable, not a zero measurement`, () => {
    const html = render(variant, null, "Insufficient Data");
    assert.match(html, /Business Health unavailable\. Insufficient Data\./);
    assert.match(html, /data-available="false"/);
    assert.doesNotMatch(html, /workspace-health-instrument__score"/);
    assert.doesNotMatch(html, /class="workspace-health-instrument__fill"/);
    if (variant === "scorecard") assert.equal((html.match(/--health-segment-fill:0%/g) || []).length, 10);
  });
  test(`${variant}: keeps display clamping and fractional fill without rounding score`, () => {
    assert.match(render(variant, -5, "At Risk"), /score 0 out of 100/);
    assert.match(render(variant, 105, "Strong"), /score 100 out of 100/);
    const html = render(variant, 76.5, "Watch");
    assert.match(html, /score 76.5 out of 100/);
    assert.match(html, variant === "arc" ? /stroke-dasharray="65 100"/ : /--health-segment-fill:65%/);
  });
}
test("ten equal scale segments do not add thresholds, calculations, state or interactions", () => {
  assert.equal((render("arc", 76, "Watch").match(/class="workspace-health-instrument__track"/g) || []).length, 10);
  assert.equal((render("arc", 76, "Watch").match(/class="workspace-health-instrument__fill"/g) || []).length, 8);
  assert.equal((render("scorecard", 76, "Watch").match(/--health-segment-fill:/g) || []).length, 10);
  assert.doesNotMatch(source, /useEffect|useState|fetch\(|onClick|status\s*===|calculateBusinessHealth/);
});

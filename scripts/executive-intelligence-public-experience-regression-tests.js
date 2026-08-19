const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const page = read("app/executive-intelligence/page.tsx");
const styles = read("app/executive-intelligence/executive-intelligence.module.css");
const backdrop = read("components/marketing/executive-intelligence/ExecutiveIntelligenceSpatialBackdrop.tsx");
const canvas = read("components/marketing/executive-intelligence/ExecutiveIntelligenceSpatialCanvas.tsx");
const world = read("components/marketing/executive-intelligence/ExecutiveIntelligenceWorld.tsx");

assert.match(page, /data-executive-intelligence-journey/, "Executive Intelligence must own one coherent page-specific journey");
assert.match(page, /ExecutiveIntelligenceSpatialBackdrop/, "semantic product content must mount the visual environment separately");
for (const stage of ["business-complexity", "command-surface", "performance-landscape", "executive-focus", "evidence-depth", "leadership-control", "historical-context", "executive-clarity"]) {
  assert.match(page, new RegExp(`data-ei-stage="${stage}"`), `the Executive journey must retain ${stage}`);
}

assert.equal((page.match(/<OperationsIntelligenceEngineDemo/g) || []).length, 1, "the page must retain one focused interactive product demo");
for (const approvedCopy of [
  "See what&apos;s changing in your business—and what deserves your attention.",
  "Your business information can be messy. Your understanding of it doesn&apos;t have to be.",
  "From scattered paperwork to a clearer business picture.",
  "Your numbers stay your numbers.",
  "An ongoing second set of eyes on your business.",
  "Start building a clearer intelligence picture of your business."
]) {
  assert.match(page, new RegExp(approvedCopy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `approved product copy must remain: ${approvedCopy}`);
}
for (const capability of ["Business Health", "KPIs", "Intelligence", "Explain Finding", "Evidence", "Saved Analyses"]) {
  assert.match(page, new RegExp(capability), `Executive Intelligence must retain ${capability}`);
}
for (const practicalInput of ["spreadsheets", "PDFs", "screenshots", "paper records", "handwritten notes"]) {
  assert.match(page, new RegExp(practicalInput, "i"), `Executive Intelligence must explain support for ${practicalInput}`);
}
assert.match(page, /handwritten business information with high accuracy/i, "handwritten-note copy must promise credible high accuracy, not perfection");
assert.doesNotMatch(page, /100% accuracy|perfect handwriting|flawless OCR/i, "handwritten-note copy must not promise infallible extraction");
assert.match(page, /Weekly Intelligence Briefing for the rolling last 7 days/, "the page must advertise the supported Weekly briefing period");
assert.match(page, /Monthly Intelligence Briefing for the rolling last 30 days/, "the page must advertise the supported Monthly briefing period");
assert.match(page, /generated on demand; an upload does not automatically create one/, "the page must not imply scheduled or upload-triggered briefings");
assert.doesNotMatch(page, /daily briefing|scheduled briefing|automatic briefing/i, "the page must not advertise unsupported briefing behavior");
for (const disclosure of [
  "What can I give Vaeroex?",
  "Still working with paper records or handwritten notes?",
  "What can Executive Intelligence help reveal?",
  "How are KPIs created and tracked?",
  "What are generated intelligence briefings?"
]) {
  assert.match(page, new RegExp(disclosure.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `progressive disclosure must retain: ${disclosure}`);
}
assert.equal((page.match(/<details key=/g) || []).length, 1, "secondary product explanations must render through one reusable native disclosure path");
assert.match(styles, /\.disclosure summary:focus-visible/, "native disclosures must expose a visible keyboard focus state");
assert.match(styles, /@media \(max-width: 767px\), \(pointer: coarse\)[\s\S]*\.disclosure summary/, "disclosures must retain a bounded mobile layout");

assert.match(backdrop, /dynamic\([\s\S]*ExecutiveIntelligenceSpatialCanvas[\s\S]*ssr: false/, "Executive WebGL must load progressively on the client");
for (const contract of ["useSpatialCapability", "SpatialResizeObserver", "probeRenderedCanvas", "frameloop=\"demand\"", "data-executive-intelligence-canvas", "data-spatial-webgl"]) {
  assert.match(canvas, new RegExp(contract), `the Executive canvas must retain ${contract}`);
}
assert.match(canvas, /JOURNEY[\s\S]*progress: 0[\s\S]*progress: 1/, "camera choreography must use one directed beginning-to-end journey");
assert.match(canvas, /position: \[5\.8, 3\.1, 15\][\s\S]*position: \[-4\.8, 1\.3, -15\][\s\S]*position: \[3\.8, -1\.4, -107\][\s\S]*position: \[0, 3\.6, -201\]/, "camera travel must vary laterally, vertically, and in depth before settling");
assert.match(canvas, /quality === "full" \? 34 : quality === "constrained" \? 62 : 150/, "ambient rendering must remain bounded by capability tier");

for (const scene of ["BusinessComplexityScene", "CommandSurfaceScene", "PerformanceLandscape", "ExecutiveFocusScene", "EvidenceDepthScene", "LeadershipControlScene", "HistoricalContextScene", "FinalCommandScene"]) {
  assert.match(world, new RegExp(`function ${scene}`), `${scene} must remain a distinct art-directed chapter`);
}
assert.match(world, /BusinessHealthInstrument[\s\S]*torusGeometry[\s\S]*Array\.from\(\{ length: 20 \}/, "Business Health must use a calibrated dimensional instrument rather than a generic gauge");
assert.match(world, /PerformanceLandscape[\s\S]*CalibratedGrid[\s\S]*performanceTraces/, "performance must use layered calibrated planes and bounded traces");
assert.match(world, /ExecutiveFocusScene[\s\S]*secondary\.current[\s\S]*primary\.current/, "priority focus must explicitly recede secondary structures and advance the primary plane");
assert.match(world, /EvidenceDepthScene[\s\S]*Array\.from\(\{ length: 6 \}[\s\S]*StructuralBeam/, "Evidence must remain an inspectable deeper spatial layer");
assert.match(world, /HistoricalContextScene[\s\S]*Array\.from\(\{ length: 7 \}/, "historical intelligence must use stable preserved surfaces");
assert.match(world, /quality === "full" \? 34[\s\S]*instancedMesh/, "repeated opening structures must use bounded tier-aware instancing");
assert.match(world, /meshPhysicalMaterial[\s\S]*transmission[\s\S]*meshStandardMaterial[\s\S]*metalness/, "the scene must preserve differentiated Vaeroex material responses");
assert.match(world, /ambientLight[\s\S]*hemisphereLight[\s\S]*directionalLight[\s\S]*spotLight[\s\S]*pointLight/, "the scene must use art-directed lighting");
assert.doesNotMatch(world, /OrbitControls|FlyControls|MapControls|sphereGeometry|<points(?:\s|>)|<pointsMaterial(?:\s|>)/i, "the Executive scene must avoid free flight and generic tutorial geometry");

assert.match(styles, /\.spatialCanvas,[\s\S]*position: fixed[\s\S]*height: 100svh/, "the Executive canvas must persist through the scroll journey");
assert.match(styles, /\.hero[\s\S]*min-height: calc\(100svh - 4\.5rem\)/, "the hero must retain a complete first viewport and next chapter cue");
assert.match(styles, /@media \(max-width: 767px\), \(pointer: coarse\)[\s\S]*\.spatialCanvas[\s\S]*display: none[\s\S]*\.chapter,/, "mobile must use the image-backed semantic fallback rather than desktop camera travel");
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/, "reduced motion must disable decorative transitions");

const publicExecutiveSources = [page, backdrop, canvas, world].join("\n");
assert.doesNotMatch(publicExecutiveSources, /\b(?:Luna|Terra|Sol)\b|IntelligenceSnapshotV1|Business Health Formula V2|Intelligence Readiness|Evidence Engine|Trust Layer|retrieval|reranking|ingestion architecture|model routing|database topology|provider fallback|Business Memory architecture/i, "the public Executive metaphor must not disclose private Vaeroex architecture");
assert.doesNotMatch(world, />\s*\d+(?:\.\d+)?%?\s*</, "WebGL must not fabricate customer business values");

process.stdout.write("Executive Intelligence public experience regressions passed.\n");

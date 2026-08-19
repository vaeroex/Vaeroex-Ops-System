const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { classifySpatialCapability } = require("../components/spatial/spatialCapability.ts");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const capabilityHook = read("components/spatial/useSpatialCapability.ts");
const capabilityClassifier = read("components/spatial/spatialCapability.ts");
const framing = read("components/spatial/spatialCameraFraming.ts");
const guard = read("components/spatial/PublicSpatialCanvasGuard.tsx");
const authenticatedLayout = read("app/app/layout.tsx");
const authenticatedPage = read("app/app/page.tsx");

const publicCanvases = [
  "components/marketing/spatial/PublicSpatialCanvas.tsx",
  "components/marketing/intelligence-systems/IntelligenceSystemsSpatialCanvas.tsx",
  "components/marketing/executive-intelligence/ExecutiveIntelligenceSpatialCanvas.tsx",
  "components/marketing/drug-discovery/DrugDiscoverySpatialCanvas.tsx",
  "components/marketing/biological/BiologicalSpatialCanvas.tsx"
];

const publicStyles = [
  "app/globals.css",
  "app/intelligence-systems/intelligence-systems.module.css",
  "app/executive-intelligence/executive-intelligence.module.css",
  "app/drug-discovery-intelligence/drug-discovery.module.css",
  "app/biological-intelligence/biological-intelligence.module.css"
];

const capable = {
  coarsePointer: false,
  reducedMotion: false,
  hardwareConcurrency: 8,
  deviceMemory: 8,
  maxTextureSize: 8192,
  webglAvailable: true
};

assert.deepEqual(
  classifySpatialCapability({ ...capable, width: 1440, height: 900 }),
  { ready: true, available: true, specializedAvailable: true, quality: "full", profile: "wide", reason: null },
  "capable desktop must retain the approved full spatial experience"
);
assert.equal(classifySpatialCapability({ ...capable, coarsePointer: true, width: 1024, height: 768 }).quality, "full", "capable tablet landscape may retain full spatial quality");
assert.equal(classifySpatialCapability({ ...capable, coarsePointer: true, width: 820, height: 1180 }).profile, "tablet_portrait", "tablet portrait must receive its own composition profile");
assert.equal(classifySpatialCapability({ ...capable, coarsePointer: true, width: 390, height: 844 }).quality, "balanced", "a capable phone must receive genuine balanced WebGL");
assert.equal(classifySpatialCapability({ ...capable, coarsePointer: true, width: 844, height: 390 }).profile, "phone", "phone orientation changes must preserve the phone composition class");
assert.equal(classifySpatialCapability({ ...capable, hardwareConcurrency: 4, width: 390, height: 844 }).quality, "light", "constrained hardware must retain genuine light WebGL");
assert.equal(classifySpatialCapability({ ...capable, reducedMotion: true, width: 390, height: 844 }).quality, "reduced_motion", "reduced motion must retain a dimensional WebGL tier");
assert.deepEqual(
  classifySpatialCapability({ ...capable, webglAvailable: false, width: 390, height: 844 }),
  { ready: true, available: false, specializedAvailable: false, quality: null, profile: "phone", reason: "webgl_unavailable" },
  "only genuine WebGL unavailability should select the DOM fallback"
);

assert.match(capabilityClassifier, /SpatialQualityTier = "full" \| "balanced" \| "light" \| "reduced_motion"/, "all adaptive quality tiers must remain explicit");
assert.doesNotMatch(capabilityClassifier, /userAgent|iPhone|Android|iPad/, "quality must not depend on user-agent labels");
assert.doesNotMatch(capabilityHook, /allowMobile|reason: "mobile"/, "mobile and touch input must not be WebGL vetoes");
assert.match(capabilityHook, /MAX_TEXTURE_SIZE[\s\S]*hardwareConcurrency[\s\S]*deviceMemory/, "the runtime must probe rendering and hardware capabilities");
assert.match(capabilityHook, /window\.addEventListener\("resize", evaluateAfterResize/, "orientation and dynamic viewport changes must re-evaluate composition");
assert.match(framing, /tablet_landscape[\s\S]*tablet_portrait[\s\S]*phone/, "camera framing must explicitly support tablet and phone compositions");
assert.match(framing, /if \(profile === "wide"\) return fov/, "wide desktop framing must remain unchanged");
assert.match(guard, /getDerivedStateFromError[\s\S]*webglcontextlost/, "render failures and context loss must both fail over");

for (const file of publicCanvases) {
  const source = read(file);
  assert.match(source, /useSpatialCapability\(\)/, `${file} must use the shared adaptive capability path`);
  assert.match(source, /data-spatial-quality[\s\S]*data-spatial-profile/, `${file} must expose quality and responsive profile for verification`);
  assert.match(source, /applySpatialCameraFraming/, `${file} must use responsive camera framing`);
  assert.match(source, /PublicSpatialErrorBoundary[\s\S]*PublicSpatialContextGuard/, `${file} must recover to its semantic fallback`);
  assert.match(source, /frameloop="demand"/, `${file} must retain bounded on-demand rendering`);
  assert.match(source, /document\.visibilityState !== "hidden"/, `${file} must pause ambient invalidation in hidden tabs`);
  assert.doesNotMatch(source, /OrbitControls|FlyControls|MapControls/, `${file} must preserve guided scroll-first navigation`);
}

for (const file of publicStyles) {
  const source = read(file);
  assert.doesNotMatch(source, /(?:vaeroex-public-spatial-canvas|\.spatialCanvas)\s*\{[^}]*display:\s*none/is, `${file} must not hide public WebGL on mobile or touch input`);
}

assert.doesNotMatch([authenticatedLayout, authenticatedPage].join("\n"), /@react-three|three\/|<Canvas|SpatialCanvas|WebGL/, "the authenticated workspace must remain DOM-only");

process.stdout.write("Public spatial responsive regressions passed.\n");

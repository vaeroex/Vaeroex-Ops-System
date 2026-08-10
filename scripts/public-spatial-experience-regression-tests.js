const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const homepage = read("app/page.tsx");
const canvas = read("components/marketing/spatial/PublicSpatialCanvas.tsx");
const backdrop = read("components/marketing/spatial/PublicSpatialBackdrop.tsx");
const styles = read("app/globals.css");
const systems = read("lib/marketing/public-systems.ts");
const primitives = read("components/marketing/PublicPagePrimitives.tsx");
const header = read("components/legal/PublicSiteHeader.tsx");

assert.match(homepage, /data-public-spatial-journey/, "the homepage must own one coherent scroll journey");
assert.match(homepage, /vaeroex-public-hero-brand[\s\S]*<h1>VAEROEX<\/h1>[\s\S]*vaeroex-public-hero-category">Intelligence Systems/, "the hero must present Vaeroex as the primary identity and Intelligence Systems as its category");
assert.doesNotMatch(homepage, /<h1>Intelligence(?:<br\s*\/?>|\s)+Systems/, "Intelligence Systems must not displace Vaeroex as the hero identity");
for (const chapter of ["vaeroex", "intelligence-systems", "executive-intelligence", "trust-and-evidence", "explore"]) {
  assert.match(homepage, new RegExp(`id="${chapter}"`), `the spatial journey must expose the ${chapter} chapter`);
}
assert.match(homepage, /Homepage chapters[\s\S]*#vaeroex[\s\S]*#intelligence-systems[\s\S]*#executive-intelligence[\s\S]*#trust-and-evidence[\s\S]*#explore/, "major spatial chapters must remain directly navigable");
assert.match(homepage, /ExecutiveInstrument[\s\S]*Business Health[\s\S]*Prioritized Intelligence/, "the product destination must use a readable DOM product surface");
assert.match(homepage, /Facts remain facts\. Interpretation remains visible as interpretation/, "the trust chapter must preserve the public fact/interpretation boundary");
assert.match(systems, /PublicSystemDefinition[\s\S]*visual[\s\S]*capabilities/, "future approved systems must extend one registry rather than rewrite the global environment");

assert.match(backdrop, /ssr: false/, "WebGL must load progressively without taking ownership of marketing semantics");
assert.match(canvas, /useSpatialCapability/, "public WebGL must use the existing capability tiers");
assert.match(canvas, /SpatialResizeObserver/, "public WebGL must receive a reliable initial measurement");
assert.match(canvas, /probeRenderedCanvas/, "public WebGL must retain a bounded nonblank framebuffer check");
assert.match(canvas, /frameloop="demand"/, "the public environment must use bounded on-demand rendering");
assert.match(canvas, /FrameScheduler[\s\S]*quality === "full" \? 34 : 58/, "ambient rendering must be tier-aware and bounded");
assert.match(canvas, /JOURNEY[\s\S]*progress: 0[\s\S]*progress: 1/, "camera choreography must use an explicit directed journey");
assert.match(canvas, /HeroArchitecture[\s\S]*IntelligenceSystemsChamber[\s\S]*ConvergenceArchitecture[\s\S]*ExecutiveIntelligenceDock[\s\S]*DecisionCorridor[\s\S]*EvidenceArchitecture[\s\S]*ClosingArchitecture/, "the world must use distinct art-directed chapter architecture");
for (const system of ["ComputationalBank", "RecessedChannelDeck", "ArchitecturalBridge", "SuspendedPlaneArray", "SignalCorridor"]) {
  assert.match(canvas, new RegExp(`${system}[\\s\\S]*function ${system}|function ${system}[\\s\\S]*<${system}`), `${system} must remain part of the composed architectural vocabulary`);
}
assert.match(canvas, /SignalBundle[\s\S]*CatmullRomCurve3[\s\S]*boxGeometry/, "the Vaeroex signal motif must use engineered multi-filament paths and non-spherical pulses");
assert.match(canvas, /meshPhysicalMaterial[\s\S]*transmission[\s\S]*meshStandardMaterial[\s\S]*roughness[\s\S]*metalness/, "the public environment must use differentiated material responses");
assert.match(canvas, /ambientLight[\s\S]*directionalLight[\s\S]*spotLight[\s\S]*pointLight/, "the public environment must use art-directed lighting");
assert.match(canvas, /fog attach="fog"[\s\S]*pointLight position=\{\[0, 1, -113\]\}/, "atmospheric depth and localized chapter lighting must extend through the final destination");
assert.doesNotMatch(canvas, /OrbitControls|FlyControls|MapControls|sphereGeometry|dodecahedronGeometry|octahedronGeometry|<points(?:\s|>)|<pointsMaterial(?:\s|>)/i, "the public world must avoid free flight and generic tutorial vocabulary");

assert.match(styles, /\.vaeroex-public-spatial-canvas[\s\S]*position: fixed[\s\S]*height: 100svh/, "the public canvas must persist through the journey");
assert.match(styles, /\.vaeroex-public-chapter--hero[\s\S]*min-height: calc\(100svh - 6\.5rem\)/, "the first viewport must retain space for the next chapter");
assert.match(homepage, /vaeroex-next-chapter-label[\s\S]*02 \/ Intelligence Systems/, "the first viewport must reveal a meaningful next-chapter cue");
assert.match(styles, /\.vaeroex-public-product-layout[\s\S]*grid-template-columns/, "the product destination must use a stable dimensional layout");
assert.match(styles, /@media \(max-width: 767px\), \(pointer: coarse\)[\s\S]*\.vaeroex-public-spatial-canvas[\s\S]*display: none/, "mobile and coarse-pointer visitors must receive the image-backed DOM experience");
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/, "reduced motion must disable decorative movement");
assert.match(primitives, /vaeroex-intelligence-environment\.png|vaeroex-public-hero__veil/, "secondary public-page heroes must share the authored visual environment");
assert.match(header, /Intelligence Systems/, "global public navigation must expose the company category");
assert.equal(fs.existsSync(path.join(root, "public/brand/vaeroex-intelligence-environment.png")), true, "the authored fallback environment must exist");

process.stdout.write("Public spatial experience regressions passed.\n");

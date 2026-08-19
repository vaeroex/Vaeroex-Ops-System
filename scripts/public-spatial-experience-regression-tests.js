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
const intelligenceSystemsPage = read("app/intelligence-systems/page.tsx");
const intelligenceSystemsStyles = read("app/intelligence-systems/intelligence-systems.module.css");
const intelligenceSystemsBackdrop = read("components/marketing/intelligence-systems/IntelligenceSystemsSpatialBackdrop.tsx");
const intelligenceSystemsCanvas = read("components/marketing/intelligence-systems/IntelligenceSystemsSpatialCanvas.tsx");
const intelligenceSystemsWorld = read("components/marketing/intelligence-systems/IntelligenceSystemsWorld.tsx");
const capability = `${read("components/spatial/useSpatialCapability.ts")}\n${read("components/spatial/spatialCapability.ts")}`;
const framing = read("components/spatial/spatialCameraFraming.ts");
const guard = read("components/spatial/PublicSpatialCanvasGuard.tsx");

assert.match(homepage, /data-public-spatial-journey/, "the homepage must own one coherent scroll journey");
assert.match(homepage, /vaeroex-public-hero-brand[\s\S]*<h1>VAEROEX<\/h1>[\s\S]*vaeroex-public-hero-category">Intelligence Systems/, "the hero must present Vaeroex as the overarching Intelligence Systems identity");
assert.doesNotMatch(homepage, /<h1>Intelligence(?:<br\s*\/?>|\s)+Systems?/, "the category must not displace Vaeroex as the hero identity");
for (const chapter of ["vaeroex", "intelligence-systems", "from-information-to-intelligence", "trust-and-evidence", "explore"]) {
  assert.match(homepage, new RegExp(`id="${chapter}"`), `the spatial journey must expose the ${chapter} chapter`);
}
assert.match(homepage, /Homepage chapters[\s\S]*#vaeroex[\s\S]*#intelligence-systems[\s\S]*#from-information-to-intelligence[\s\S]*#trust-and-evidence[\s\S]*#explore/, "major spatial chapters must remain directly navigable");
assert.match(homepage, /label="From information to intelligence"[\s\S]*Visibility\. Awareness\. Prediction\. Action\./, "chapter three must retain a readable company-level intelligence surface");
assert.doesNotMatch(homepage, /ExecutiveInstrument|Illustrative Executive Intelligence product view|label="System arrival"/, "the spatial journey must not repeat the Executive product destination");
assert.match(homepage, /Facts remain facts\. Interpretation remains visible as interpretation/, "the trust chapter must preserve the public fact/interpretation boundary");
assert.match(systems, /PublicSystemDefinition[\s\S]*visual[\s\S]*capabilities/, "future approved systems must extend one registry rather than rewrite the global environment");

assert.match(backdrop, /ssr: false/, "WebGL must load progressively without taking ownership of marketing semantics");
assert.match(canvas, /useSpatialCapability/, "public WebGL must use the existing capability tiers");
assert.match(canvas, /SpatialResizeObserver/, "public WebGL must receive a reliable initial measurement");
assert.match(canvas, /probeRenderedCanvas/, "public WebGL must retain a bounded nonblank framebuffer check");
assert.match(canvas, /frameloop="demand"/, "the public environment must use bounded on-demand rendering");
assert.match(canvas, /quality === "full" \? 34 : quality === "balanced" \? 58 : quality === "light" \? 90 : 180/, "ambient rendering must be bounded across every adaptive quality tier");
assert.match(canvas, /data-spatial-quality[\s\S]*data-spatial-profile/, "the homepage canvas must expose its selected quality and composition profile");
assert.match(canvas, /PublicSpatialErrorBoundary[\s\S]*PublicSpatialContextGuard/, "the homepage must fail over cleanly after initialization or context loss");
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
assert.match(homepage, /vaeroex-next-chapter-label[\s\S]*02 \/ Intelligence/, "the first viewport must reveal a meaningful next-chapter cue");
assert.match(styles, /\.vaeroex-method-list[\s\S]*grid-template-columns/, "the company intelligence path must use a stable dimensional layout");
assert.doesNotMatch(styles, /@media \(max-width: 767px\)[\s\S]{0,300}\.vaeroex-public-spatial-canvas\s*\{[^}]*display:\s*none/, "capable mobile visitors must not lose the public WebGL canvas by stylesheet rule");
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/, "reduced motion must disable decorative movement");
assert.match(primitives, /vaeroex-intelligence-environment\.png|vaeroex-public-hero__veil/, "secondary public-page heroes must share the authored visual environment");
assert.match(header, /Intelligence Systems/, "global public navigation must expose the company category");
assert.equal(fs.existsSync(path.join(root, "public/brand/vaeroex-intelligence-environment.png")), true, "the authored fallback environment must exist");

assert.match(intelligenceSystemsPage, /data-intelligence-systems-journey/, "the Intelligence Systems route must own one coherent page-specific journey");
assert.match(intelligenceSystemsPage, /IntelligenceSystemsSpatialBackdrop/, "semantic page content must mount the page-specific visual environment separately");
assert.match(intelligenceSystemsPage, /<h1>INTELLIGENCE SYSTEMS<\/h1>[\s\S]*Information is everywhere\. Intelligence is not\./, "the dedicated hero must preserve the approved category and thesis hierarchy");
for (const stage of ["raw-complexity", "visibility", "awareness", "prediction", "action", "intelligence-reveal", "specialization", "executive-destination", "drug-discovery-destination", "biological-destination", "vaeroex-closing"]) {
  assert.match(intelligenceSystemsPage, new RegExp(`data-is-stage="${stage}"`), `the cinematic route must retain its ${stage} chapter`);
}
assert.match(intelligenceSystemsPage, /role="status"><Check[\s\S]*Available/, "Executive Intelligence must remain visibly available");
assert.equal((intelligenceSystemsPage.match(/<DevelopmentStatus \/>/g) || []).length, 2, "both development destinations must remain visibly in development");
assert.doesNotMatch(intelligenceSystemsPage, /StartWithVaeroexMenu|api\/stripe\/checkout/, "the conceptual route must not expose a hidden direct checkout path");

assert.match(intelligenceSystemsBackdrop, /dynamic\([\s\S]*IntelligenceSystemsSpatialCanvas[\s\S]*ssr: false/, "the page-specific WebGL world must remain progressively client-loaded");
for (const contract of ["useSpatialCapability", "SpatialResizeObserver", "probeRenderedCanvas", "frameloop=\"demand\"", "data-intelligence-systems-canvas", "data-spatial-webgl"]) {
  assert.match(intelligenceSystemsCanvas, new RegExp(contract), `the Intelligence Systems canvas must retain ${contract}`);
}
assert.match(intelligenceSystemsCanvas, /JOURNEY[\s\S]*progress: 0[\s\S]*progress: 1/, "the page must use an explicit beginning-to-end camera journey");
assert.match(intelligenceSystemsCanvas, /position: \[4\.5, 3, 14\][\s\S]*position: \[-5\.2, 1\.2, -17\][\s\S]*position: \[0, 5, -110\][\s\S]*position: \[0, 4, -241\]/, "camera choreography must vary laterally, vertically, and in depth before settling");
assert.match(intelligenceSystemsCanvas, /quality === "full" \? 34 : quality === "balanced" \? 62 : quality === "light" \? 94 : 180/, "ambient rendering must remain bounded across all capability tiers");
assert.match(intelligenceSystemsCanvas, /ACESFilmicToneMapping[\s\S]*SRGBColorSpace/, "the page-specific world must use a controlled production color pipeline");

for (const scene of ["RawComplexityScene", "VisibilityScene", "AwarenessScene", "PredictionScene", "ActionScene", "IntelligenceRevealScene", "SpecializationScene", "ExecutiveDestination", "DrugDiscoveryDestination", "BiologicalDestination", "ClosingScene"]) {
  assert.match(intelligenceSystemsWorld, new RegExp(`function ${scene}`), `${scene} must remain a distinct art-directed world chapter`);
}
assert.match(intelligenceSystemsWorld, /VisibilityScene[\s\S]*smoothRange\(progress\.current, 0\.055, 0\.17\)[\s\S]*leftPanel[\s\S]*rightPanel/, "Visibility must reveal hidden architecture through a bounded scene transition");
assert.match(intelligenceSystemsWorld, /PredictionScene[\s\S]*const paths:/, "Prediction must retain multiple spatial trajectories rather than one deterministic outcome");
assert.match(intelligenceSystemsWorld, /IntelligenceRevealScene[\s\S]*frameCount[\s\S]*TechnicalFrame[\s\S]*ArchitecturalSlab/, "the major Intelligence reveal must use large ordered architecture rather than a generic core");
assert.match(intelligenceSystemsWorld, /MoleculeModel[\s\S]*ProteinTarget[\s\S]*ComputationalHelix[\s\S]*icosahedronGeometry/, "specialized destinations must use distinct executive, molecular, protein, and multiscale biological geometry");
assert.match(intelligenceSystemsWorld, /meshPhysicalMaterial[\s\S]*transmission[\s\S]*meshStandardMaterial[\s\S]*roughness[\s\S]*metalness/, "the page-specific world must preserve differentiated Vaeroex materials");
assert.match(intelligenceSystemsWorld, /ambientLight[\s\S]*hemisphereLight[\s\S]*directionalLight[\s\S]*spotLight[\s\S]*pointLight/, "the Intelligence Systems world must use chapter-localized art-directed lighting");
assert.doesNotMatch(intelligenceSystemsWorld, /OrbitControls|FlyControls|MapControls|<points(?:\s|>)|<pointsMaterial(?:\s|>)|Luna|Terra|Sol|SnapshotV1|Formula V2|Evidence Engine|model routing|provider/i, "the public conceptual world must avoid free flight, random point fields, and private architecture disclosure");

assert.match(intelligenceSystemsStyles, /\.spatialCanvas,[\s\S]*position: fixed[\s\S]*height: 100svh/, "the page-specific canvas must persist across its directed scroll journey");
assert.match(intelligenceSystemsStyles, /\.hero[\s\S]*min-height: calc\(100svh - 4\.5rem\)/, "the hero must preserve a complete first viewport with a next-chapter cue");
assert.match(intelligenceSystemsStyles, /@media \(max-width: 767px\)[\s\S]*background-attachment: scroll[\s\S]*\.chapter,[\s\S]*min-height: auto/, "mobile visitors must retain the readable semantic journey over adaptive WebGL");
assert.match(intelligenceSystemsStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/, "reduced-motion visitors must retain the full narrative without decorative transitions");

assert.match(capability, /SpatialQualityTier = "full" \| "balanced" \| "light" \| "reduced_motion"/, "the shared public capability system must expose full, balanced, light, and reduced-motion tiers");
assert.match(capability, /MAX_TEXTURE_SIZE[\s\S]*hardwareConcurrency[\s\S]*deviceMemory/, "quality selection must use rendering and hardware capability signals");
assert.match(capability, /coarsePointer[\s\S]*adaptiveViewport/, "touch input may inform quality without disabling WebGL");
assert.doesNotMatch(capability, /reason: "mobile"|allowMobile|userAgent/i, "device labels must never be fallback reasons or quality authorities");
assert.match(capability, /window\.addEventListener\("resize", evaluateAfterResize/, "orientation and browser viewport changes must recompute the spatial profile");
for (const profile of ["wide", "tablet_landscape", "tablet_portrait", "phone"]) {
  assert.match(framing, new RegExp(`${profile}:`), `responsive camera framing must define ${profile}`);
}
assert.match(framing, /if \(profile === "wide"\) return fov/, "the approved wide desktop camera must remain unchanged");
assert.match(guard, /getDerivedStateFromError[\s\S]*webglcontextlost[\s\S]*onFailure/, "render errors and WebGL context loss must both reach the premium fallback");

process.stdout.write("Public spatial experience regressions passed.\n");

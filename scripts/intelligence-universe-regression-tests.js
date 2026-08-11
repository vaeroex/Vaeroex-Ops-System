const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

const stateModel = require("../lib/marketing/intelligence-universe.ts");
const model = read("lib/marketing/intelligence-universe.ts");
const provider = read("components/marketing/intelligence-universe/IntelligenceUniverseProvider.tsx");
const context = read("components/marketing/intelligence-universe/IntelligenceUniverseContext.tsx");
const shell = read("components/marketing/intelligence-universe/IntelligenceUniverseShell.tsx");
const link = read("components/marketing/intelligence-universe/UniverseNavigationLink.tsx");
const backdrop = read("components/marketing/intelligence-universe/IntelligenceUniverseBackdrop.tsx");
const canvas = read("components/marketing/intelligence-universe/IntelligenceUniverseCanvas.tsx");
const world = read("components/marketing/intelligence-universe/IntelligenceUniverseWorld.tsx");
const styles = read("components/marketing/intelligence-universe/intelligence-universe.module.css");
const globals = read("app/globals.css");
const layout = read("app/layout.tsx");
const header = read("components/legal/PublicSiteHeader.tsx");

assert.deepEqual(stateModel.INTELLIGENCE_UNIVERSE_ROUTES, {
  vaeroex: "/",
  "intelligence-systems": "/intelligence-systems",
  "executive-intelligence": "/executive-intelligence",
  "drug-discovery-intelligence": "/drug-discovery-intelligence",
  "biological-intelligence": "/biological-intelligence",
  trust: "/trust",
  pricing: "/pricing",
  company: "/about",
  network: "/networking",
  careers: "/careers",
  contact: "/contact"
}, "the guided universe must preserve every canonical public route");

const directDrug = stateModel.initialUniverseState("/drug-discovery-intelligence");
assert.equal(directDrug.current, "drug-discovery-intelligence", "a direct deep link must initialize at its destination");
assert.equal(directDrug.selectedSystem, "drug-discovery-intelligence", "direct product links must prepare the matching system");
assert.equal(directDrug.phase, "arriving", "a direct product link may use only a bounded arrival state");
assert.equal(directDrug.assetReadiness["drug-discovery-intelligence"], "approach", "only the destination approach LOD should be prepared initially");
const directPricing = stateModel.initialUniverseState("/pricing");
assert.equal(directPricing.current, "pricing", "every major public route must initialize at its visual destination");
assert.equal(directPricing.level, "region", "non-product destinations must resolve as regions");

const homeStart = stateModel.sampleGuidedUniverseJourney("vaeroex", 0);
const homeSystems = stateModel.sampleGuidedUniverseJourney("vaeroex", 0.36);
const homeTrust = stateModel.sampleGuidedUniverseJourney("vaeroex", 0.69);
const homeCompany = stateModel.sampleGuidedUniverseJourney("vaeroex", 0.87);
assert.equal(homeStart.focus, "vaeroex", "the homepage path must begin in the Vaeroex environment");
assert.equal(homeSystems.focus, "intelligence-systems", "homepage scroll must reveal Intelligence Systems intentionally");
assert.equal(homeTrust.focus, "trust", "homepage scroll must include the Trust region");
assert.equal(homeCompany.focus, "company", "homepage scroll must include the company region");

assert.equal(
  stateModel.sampleGuidedUniverseJourney("intelligence-systems", 0.68).focus,
  "executive-intelligence",
  "the systems journey must reveal Executive Intelligence"
);
assert.equal(
  stateModel.sampleGuidedUniverseJourney("intelligence-systems", 0.8).focus,
  "drug-discovery-intelligence",
  "the systems journey must reveal Drug Discovery Intelligence"
);
assert.equal(
  stateModel.sampleGuidedUniverseJourney("intelligence-systems", 0.92).focus,
  "biological-intelligence",
  "the systems journey must reveal Biological Intelligence"
);
assert.equal(
  stateModel.sampleGuidedUniverseJourney("pricing", 0.7).focus,
  "pricing",
  "ordinary routes must retain a bounded route-specific visual frame"
);

const initialMotion = stateModel.createUniverseMotion("pricing");
assert.equal(initialMotion.mode, "idle", "guided motion must initialize without synthetic travel");
assert.equal(initialMotion.scrollProgress, 0, "guided motion must initialize at the top of the page journey");
assert.equal(initialMotion.scrollTarget, 0, "guided motion must not invent page progress");

for (const field of ["current", "target", "selectedDestination", "selectedSystem", "proximity", "route", "level", "phase", "inputLocked", "reducedMotion", "quality", "assetReadiness"]) {
  assert.match(model, new RegExp(`${field}:`), `central state must own ${field}`);
}
for (const field of ["position", "targetPosition", "approachProgress", "approachTarget", "scrollProgress", "scrollTarget", "mode", "travelStage"]) {
  assert.match(model, new RegExp(`${field}:`), `central guided motion must own ${field}`);
}
assert.doesNotMatch(model, /\bvelocity\s*:|\bdragging\s*:|dragOrigin|dragLast|suppressClickUntil|moveUniversePosition|nearestUniverseDestination|adjacentUniverseDestination/, "the model must not retain free-roam control state or navigation");
assert.doesNotMatch(model + provider + shell + canvas + world, /railProgress|railTarget|settleRail|activeIndex/, "the guided experience must not regress to a carousel-authoritative model");

assert.match(context, /createContext<IntelligenceUniverseContextValue>/, "one focused context must own the public spatial visual contract");
assert.match(context, /travel: \(destination: IntelligenceUniverseDestination\)/, "semantic links must be able to request route fast travel");
assert.doesNotMatch(context, /beginExploration|updateExploration|endExploration|nudgeExploration|selectAdjacent|enterSelected/, "the context must expose no alternate 3D navigation scheme");

assert.match(provider, /usePathname\(\)[\s\S]*route_sync[\s\S]*router\.push\(nextRoute\)/, "route state must remain authoritative through Next navigation");
assert.match(provider, /journeySelector[\s\S]*data-public-spatial-journey[\s\S]*data-intelligence-systems-journey/, "approved long-form pages must drive their own art-directed paths");
assert.match(provider, /getBoundingClientRect\(\)[\s\S]*scrollTarget = progress/, "natural document scroll must feed normalized guided progress");
assert.match(provider, /addEventListener\("scroll", update, \{ passive: true \}\)/, "scroll observation must stay passive");
assert.match(provider, /sampleGuidedUniverseJourney\(destination, currentMotion\.scrollProgress\)/, "camera motion must sample the route-specific guided path");
assert.match(provider, /travelStage === "pullback"[\s\S]*travelStage === "crossing"[\s\S]*travelStage = "approach"/, "route fast travel must pull back, cross, and approach within the same universe");
assert.match(provider, /setTimeout\(\(\) => router\.push\(nextRoute\), 1120\)/, "spatial route travel must remain within the approved 0.8–1.5 second range");
assert.match(provider, /setTimeout\(\(\) => router\.push\(nextRoute\), 140\)/, "reduced motion must use a short route fade path");
assert.match(provider, /persistentJourney = destination === "vaeroex" \|\| destination === "intelligence-systems"/, "the universe must persist behind the two approved guided journeys");
assert.match(provider, /controlsVisible[\s\S]*nearTop/, "navigation chrome must recede while page content remains in control");
assert.match(provider, /sessionStorage[\s\S]*classic[\s\S]*spatial/, "the stable Classic/Spatial preference must remain locally reversible");
assert.doesNotMatch(provider + shell, /addEventListener\("(?:pointer|wheel)|preventDefault\(\)|integrateFreeMotion|boundaryBand|destination gravity|beginExploration|nudgeExploration/, "the spatial layer must not capture gestures, wheel input, or integrate free movement");
assert.doesNotMatch(provider + shell, /history\.(?:pushState|replaceState)/, "guided motion must not create synthetic browser history entries");

assert.match(link, /event\.button !== 0[\s\S]*event\.metaKey[\s\S]*event\.ctrlKey[\s\S]*event\.shiftKey[\s\S]*event\.altKey/, "fast travel must preserve normal browser link affordances");
assert.match(shell, /data-universe-guided[\s\S]*Scroll to move through Vaeroex/, "the visual shell must communicate guided scrolling rather than controls");
assert.match(shell, /INTELLIGENCE_UNIVERSE_PRIMARY_REGIONS\.map[\s\S]*INTELLIGENCE_UNIVERSE_SYSTEMS\.map[\s\S]*Explore \{selectedDefinition\.name\}/, "every region and system must remain reachable through semantic links");
assert.match(shell, /data-visible=\{universe\.controlsVisible\}/, "guided navigation chrome must follow the bounded controller state");
assert.doesNotMatch(shell, /onPointer|onWheel|onKeyDown|tabIndex|role="group"|Move3d|Drag to roam|pinch|event\.key === "Arrow/, "the shell must not teach or implement a 3D control scheme");

assert.match(styles, /\.visual canvas[\s\S]*pointer-events: none[\s\S]*touch-action: auto/, "the WebGL canvas must remain a non-interactive visual layer");
assert.match(styles, /\.visual\[data-active="true"\][\s\S]*pointer-events: none/, "an active universe must not intercept normal page interaction");
assert.match(styles, /\.interaction\[data-visible="true"\][\s\S]*visibility: visible/, "guided controls must have a bounded visible state");
assert.match(styles, /\.interaction\[data-visible="true"\] \.navigationPanel[\s\S]*pointer-events: auto/, "only semantic navigation controls may receive pointer input");
assert.doesNotMatch(styles, /touch-action: none|cursor: grab|cursor: grabbing/, "the visual shell must not claim touch or pointer gestures");
assert.match(globals, /html\[data-intelligence-universe="active"\] \.vaeroex-public-site[\s\S]*pointer-events: auto[\s\S]*touch-action: pan-y/, "the public document must preserve ordinary interaction and vertical scrolling");
assert.match(styles, /:focus-visible/, "semantic spatial controls must retain visible keyboard focus treatment");

assert.match(backdrop, /dynamic\([\s\S]*IntelligenceUniverseCanvas[\s\S]*ssr: false/, "the universe renderer must load progressively on the client");
assert.match(backdrop, /useSpatialCapability\(\{ allowMobile: true \}\)/, "the shell must use the shared capability tier contract");
assert.match(backdrop, /SpatialErrorBoundary[\s\S]*UniverseFallback/, "a WebGL exception must fail into a bounded visual fallback");
for (const contract of ["probeRenderedCanvas", "SpatialResizeObserver", "ACESFilmicToneMapping", "SRGBColorSpace", "frameloop={active ? \"demand\" : \"never\"}"]) {
  assert.match(canvas, new RegExp(contract.replace(/[{}?]/g, "\\$&")), `the shell canvas must retain ${contract}`);
}
assert.match(canvas, /currentMotion\.position\.x[\s\S]*currentMotion\.position\.y[\s\S]*currentMotion\.position\.z/, "camera position must follow the guided world coordinates");
assert.match(canvas, /INTELLIGENCE_UNIVERSE_ENTRY_POSITIONS[\s\S]*selectedDestination[\s\S]*approachProgress[\s\S]*lerp/, "route approach must converge on the selected destination");
assert.match(canvas, /currentMotion\.scrollTarget - currentMotion\.scrollProgress[\s\S]*requestAnimationFrame\(renderMotion\)/, "scroll movement must receive responsive rendering without raising idle cost");
assert.match(canvas, /document\.visibilityState === "visible"/, "hidden pages must not continue ambient rendering");
assert.match(canvas, /state\.reducedMotion \|\| state\.quality === "reduced_motion"[\s\S]*camera\.position\.copy/, "reduced motion must replace travel interpolation with immediate framing");
assert.doesNotMatch(canvas, /velocity|dragging|OrbitControls|FlyControls|MapControls/, "the camera must contain no manual or inertial control path");

for (const structure of ["ExecutiveStructure", "DrugStructure", "BiologicalStructure"]) {
  assert.match(world, new RegExp(`function ${structure}`), `${structure} must preserve its distinct bounded overview LOD`);
}
for (const structure of ["CoreStructure", "SystemsHubStructure", "TrustStructure", "PricingStructure", "CompanyStructure", "NetworkStructure", "CareersStructure", "ContactStructure"]) {
  assert.match(world, new RegExp(`function ${structure}`), `${structure} must preserve its distinct public-region architecture`);
}
assert.match(world, /DRUG_ATOMS[\s\S]*DRUG_BONDS[\s\S]*sphereGeometry/, "Drug Discovery must preserve a coherent molecular topology");
assert.match(world, /BiologicalStructure[\s\S]*strandA[\s\S]*strandB[\s\S]*icosahedronGeometry/, "Biological Intelligence must preserve its multiscale representation");
assert.match(world, /ExecutiveStructure[\s\S]*boxGeometry[\s\S]*EXECUTIVE_NODES/, "Executive Intelligence must preserve its analytical architecture");
assert.match(world, /CORRIDORS[\s\S]*EnvironmentalArchitecture[\s\S]*DistantArchitecture[\s\S]*SignalField/, "the universe must retain layered architecture, depth, and signals");
assert.match(world, /SUPPORTING_SIGNALS[\s\S]*Visibility[\s\S]*Awareness[\s\S]*Prediction[\s\S]*Action/, "company principles must remain subordinate visual signals");
assert.match(world, /distance < 31[\s\S]*distance < 72[\s\S]*"distant"/, "destination detail must continue resolving progressively from camera distance");
assert.match(world, /currentMotion\.scrollProgress[\s\S]*Math\.sin\(currentMotion\.scrollProgress/, "environmental motion must respond subtly to guided page progress");
assert.doesNotMatch(world, /useCursor|onPointerOver|onPointerOut|onClick=|onEnterDestination|currentMotion\.velocity|currentMotion\.dragging/, "3D structures must not create a parallel click or steering model");
assert.doesNotMatch(world + canvas, /Math\.random|IntelligenceSnapshotV1|Business Health Formula V2|Evidence Engine|provider routing|database topology/i, "the public visual layer must avoid nondeterminism and private architecture disclosure");

assert.match(layout, /IntelligenceUniverseProvider[\s\S]*<PwaServiceWorker \/>[\s\S]*\{children\}/, "the lightweight visual controller must persist above compatible routes");
assert.match(header, /UniverseNavigationLink[\s\S]*universeRoutes/, "the existing header must provide guided travel through normal links");
assert.match(header, /INTELLIGENCE_UNIVERSE_ROUTES[\s\S]*secondaryNavLinks\.map[\s\S]*UniverseNavigationLink[\s\S]*companyLinks\.map[\s\S]*UniverseNavigationLink/, "major public navigation must retain the shared route-aware fast-travel enhancement");

const detailBackdrops = [
  ["vaeroex", "components/marketing/spatial/PublicSpatialBackdrop.tsx", "PublicSpatialCanvas"],
  ["intelligence-systems", "components/marketing/intelligence-systems/IntelligenceSystemsSpatialBackdrop.tsx", "IntelligenceSystemsSpatialCanvas"],
  ["executive-intelligence", "components/marketing/executive-intelligence/ExecutiveIntelligenceSpatialBackdrop.tsx", "ExecutiveIntelligenceSpatialCanvas"],
  ["drug-discovery-intelligence", "components/marketing/drug-discovery/DrugDiscoverySpatialBackdrop.tsx", "DrugDiscoverySpatialCanvas"],
  ["biological-intelligence", "components/marketing/biological/BiologicalSpatialBackdrop.tsx", "BiologicalSpatialCanvas"]
];
for (const [destination, file, renderer] of detailBackdrops) {
  const source = read(file);
  assert.match(source, new RegExp(`suppressBackdrop\\(${JSON.stringify(destination)}\\)`), `${destination} must defer only its own approved detailed renderer during guided approach`);
  assert.match(source, new RegExp(`dynamic\\([\\s\\S]*${renderer}[\\s\\S]*ssr: false`), `${destination} must preserve its approved detailed renderer as LOD 3`);
}

for (const page of [
  "app/page.tsx",
  "app/intelligence-systems/page.tsx",
  "app/executive-intelligence/page.tsx",
  "app/drug-discovery-intelligence/page.tsx",
  "app/biological-intelligence/page.tsx",
  "app/about/page.tsx",
  "app/pricing/page.tsx",
  "app/networking/page.tsx",
  "app/careers/page.tsx",
  "app/contact/page.tsx"
]) {
  const source = read(page);
  assert.match(source, /export const metadata: Metadata/, `${page} must retain route-specific metadata`);
  assert.match(source, /PublicSiteHeader/, `${page} must retain normal semantic navigation`);
}
assert.match(read("app/trust/page.tsx"), /export const metadata: Metadata/, "the Trust route must retain route-specific metadata");
assert.match(read("components/legal/TrustCenterPage.tsx"), /PublicSiteHeader/, "the Trust route must retain normal semantic navigation");
assert.match(read("app/page.tsx"), /data-public-spatial-journey/, "the homepage must retain its scroll-driven journey contract");
assert.match(read("app/intelligence-systems/page.tsx"), /data-intelligence-systems-journey/, "Intelligence Systems must retain its scroll-driven journey contract");

assert.doesNotMatch(provider + context + shell + canvas + world, /api\/stripe\/checkout|Supabase|workspace_id|customer/i, "the public visual prototype must not alter commerce, tenant, or customer behavior");

process.stdout.write("Intelligence Universe guided-navigation regressions passed.\n");

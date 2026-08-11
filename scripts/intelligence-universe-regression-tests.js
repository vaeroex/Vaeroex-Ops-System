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
const provider = read("components/marketing/intelligence-universe/IntelligenceUniverseProvider.tsx");
const context = read("components/marketing/intelligence-universe/IntelligenceUniverseContext.tsx");
const shell = read("components/marketing/intelligence-universe/IntelligenceUniverseShell.tsx");
const link = read("components/marketing/intelligence-universe/UniverseNavigationLink.tsx");
const backdrop = read("components/marketing/intelligence-universe/IntelligenceUniverseBackdrop.tsx");
const canvas = read("components/marketing/intelligence-universe/IntelligenceUniverseCanvas.tsx");
const world = read("components/marketing/intelligence-universe/IntelligenceUniverseWorld.tsx");
const styles = read("components/marketing/intelligence-universe/intelligence-universe.module.css");
const layout = read("app/layout.tsx");
const header = read("components/legal/PublicSiteHeader.tsx");

assert.deepEqual(stateModel.INTELLIGENCE_UNIVERSE_ROUTES, {
  vaeroex: "/",
  "intelligence-systems": "/intelligence-systems",
  "executive-intelligence": "/executive-intelligence",
  "drug-discovery-intelligence": "/drug-discovery-intelligence",
  "biological-intelligence": "/biological-intelligence"
}, "the prototype must preserve every canonical public route");

const directDrug = stateModel.initialUniverseState("/drug-discovery-intelligence");
assert.equal(directDrug.current, "drug-discovery-intelligence", "a direct deep link must initialize at its destination");
assert.equal(directDrug.selectedSystem, "drug-discovery-intelligence", "direct deep-link selection must match the destination");
assert.equal(directDrug.phase, "arriving", "a direct deep link may use only the short destination arrival state");
assert.equal(directDrug.assetReadiness["drug-discovery-intelligence"], "approach", "only the destination approach LOD should be prepared initially");
assert.equal(stateModel.initialUniverseState("/pricing").current, "vaeroex", "non-universe routes must not invent spatial destinations");
assert.equal(stateModel.adjacentUniverseSystem("executive-intelligence", -1), "biological-intelligence", "bounded system navigation must wrap safely");
assert.equal(stateModel.nearestUniverseSystem(-0.82), "executive-intelligence", "spatial position must resolve the nearest system");
assert.equal(stateModel.nearestUniverseSystem(0.18), "drug-discovery-intelligence", "selection must derive from continuous rail position");
assert.equal(stateModel.nearestUniverseSystem(0.74), "biological-intelligence", "the right spatial anchor must resolve naturally");
assert.equal(stateModel.clampUniverseRailProgress(-4), -1.14, "the continuous rail must remain bounded");

const initialMotion = stateModel.createUniverseMotion("drug-discovery-intelligence");
assert.equal(initialMotion.railProgress, 0, "motion must initialize at the selected system's physical anchor");
assert.equal(initialMotion.mode, "idle", "motion must initialize without synthetic travel");

for (const field of ["current", "target", "selectedSystem", "route", "level", "phase", "inputLocked", "reducedMotion", "quality", "assetReadiness"]) {
  assert.match(read("lib/marketing/intelligence-universe.ts"), new RegExp(`${field}:`), `central state must own ${field}`);
}
for (const field of ["railProgress", "railTarget", "velocity", "approachProgress", "approachTarget", "dragging", "dragOriginX", "dragLastX", "dragLastAt", "mode", "travelStage", "suppressClickUntil"]) {
  assert.match(read("lib/marketing/intelligence-universe.ts"), new RegExp(`${field}:`), `central motion must own ${field}`);
}
assert.match(context, /createContext<IntelligenceUniverseContextValue>/, "one focused context must own the public spatial controller contract");
assert.match(provider, /usePathname\(\)[\s\S]*route_sync[\s\S]*router\.push\(nextRoute\)/, "route state and spatial state must stay synchronized through Next navigation");
assert.match(provider, /phase === "transitioning"[\s\S]*phase === "arriving"/, "route travel must have explicit deterministic transition states");
assert.match(provider, /isUniverseSystemDestination\(destination\)[\s\S]*1650/, "direct product routes must settle through a bounded visible arrival");
assert.match(provider, /window\.scrollY < window\.innerHeight \* 0\.72/, "overview WebGL must release normal deep-page scrolling");
assert.match(provider, /sessionStorage[\s\S]*classic[\s\S]*spatial/, "the experiment must remain locally reversible");
assert.doesNotMatch(provider + shell, /history\.(?:pushState|replaceState)/, "continuous movement must not spam browser history");
assert.match(shell, /\{universe\.shellVisible \? \([\s\S]*IntelligenceUniverseBackdrop/, "the overview renderer must unload when an approved LOD-3 product renderer takes ownership");
assert.match(provider, /function springRail[\s\S]*requestAnimationFrame\(tick\)/, "continuous motion must integrate inertia on animation frames");
assert.match(provider, /railProgress[\s\S]*nearestUniverseSystem\(motion\.current\.railProgress\)/, "selection must derive from physical position");
assert.match(provider, /travelStage === "pullback"[\s\S]*travelStage === "crossing"[\s\S]*travelStage = "approach"/, "fast travel must visibly pull back, cross the universe, and approach");
assert.match(provider, /updateRailDrag[\s\S]*railProgress[\s\S]*instantVelocity/, "pointer movement must update normalized rail position and velocity before release");

assert.match(link, /event\.button !== 0[\s\S]*event\.metaKey[\s\S]*event\.ctrlKey[\s\S]*event\.shiftKey[\s\S]*event\.altKey/, "fast travel must preserve normal browser link affordances");
assert.match(shell, /onPointerMove[\s\S]*updateRailDrag\(event\.clientX/, "the primary viewport must update the world continuously during pointer movement");
assert.match(shell, /Math\.abs\(event\.deltaX\)[\s\S]*moveRailBy/, "horizontal trackpad gestures must move along the same bounded rail");
assert.match(shell, /INTERACTIVE_SELECTOR[\s\S]*closest\(INTERACTIVE_SELECTOR\)/, "viewport gestures must preserve native links and controls");
assert.match(shell, /event\.target !== event\.currentTarget/, "group keyboard shortcuts must not override focused semantic links or buttons");
for (const key of ["ArrowLeft", "ArrowRight", "Enter", " ", "Escape"]) {
  assert.match(shell, new RegExp(`event\\.key === ${JSON.stringify(key)}`), `keyboard navigation must support ${JSON.stringify(key)}`);
}
assert.match(shell, /UniverseNavigationLink[\s\S]*PUBLIC_SYSTEMS\.map[\s\S]*Enter \{selectedSystem\.name\}/, "every system must remain reachable through semantic links without gestures");
assert.match(styles, /touch-action: pan-y/, "the overview gesture surface must preserve vertical page scrolling");
assert.match(styles, /:focus-visible/, "spatial controls must retain a visible keyboard focus treatment");
assert.match(styles, /\.visual\[data-active="true"\][\s\S]*pointer-events: auto/, "the actual WebGL viewport must remain an interactive surface");

assert.match(backdrop, /dynamic\([\s\S]*IntelligenceUniverseCanvas[\s\S]*ssr: false/, "the experimental renderer must load progressively on the client");
assert.match(backdrop, /useSpatialCapability\(\{ allowMobile: true \}\)/, "the shell must use the shared capability tier contract");
assert.match(backdrop, /SpatialErrorBoundary[\s\S]*UniverseFallback/, "a WebGL exception must fail into a bounded visual fallback");
for (const contract of ["probeRenderedCanvas", "SpatialResizeObserver", "ACESFilmicToneMapping", "SRGBColorSpace", "frameloop={active ? \"demand\" : \"never\"}"]) {
  assert.match(canvas, new RegExp(contract.replace(/[{}?]/g, "\\$&")), `the shell canvas must retain ${contract}`);
}
assert.match(canvas, /railProgress \* 12[\s\S]*approachProgress[\s\S]*lookAhead/, "camera position, depth, and yaw must follow continuous motion directly");
assert.match(canvas, /quality === "full"[\s\S]*42[\s\S]*quality === "constrained"[\s\S]*72[\s\S]*180/, "ambient frames must scale down by device tier");
assert.match(canvas, /currentMotion\.dragging[\s\S]*requestAnimationFrame\(renderMotion\)/, "active manipulation must receive frame-rate rendering without raising idle cost");
assert.match(canvas, /document\.visibilityState === "visible"/, "hidden pages must not continue ambient rendering");
assert.match(canvas, /state\.reducedMotion \|\| state\.quality === "reduced_motion"[\s\S]*camera\.position\.copy/, "reduced motion must replace travel with immediate anchored framing");

for (const structure of ["ExecutiveStructure", "DrugStructure", "BiologicalStructure"]) {
  assert.match(world, new RegExp(`function ${structure}`), `${structure} must provide a distinct bounded overview LOD`);
}
assert.match(world, /DRUG_ATOMS[\s\S]*DRUG_BONDS[\s\S]*sphereGeometry/, "Drug Discovery must use a coherent molecular topology rather than decorative biology");
assert.match(world, /BiologicalStructure[\s\S]*strandA[\s\S]*strandB[\s\S]*icosahedronGeometry/, "Biological Intelligence must use a multiscale biological representation");
assert.match(world, /ExecutiveStructure[\s\S]*data planes|ExecutiveStructure[\s\S]*boxGeometry[\s\S]*EXECUTIVE_NODES/, "Executive Intelligence must use structured analytical architecture");
assert.match(world, /SYSTEM_POSITIONS[\s\S]*-12[\s\S]*-18[\s\S]*13\.5/, "all three systems must coexist at distinct positions and depths");
assert.match(world, /onPointerOver[\s\S]*onClick[\s\S]*onEnterSystem\(id\)/, "the actual spatial structures must be clickable rather than represented only by DOM controls");
assert.match(world, /railProgress - anchor[\s\S]*approachProgress[\s\S]*targetScale/, "system focus and progressive detail must follow physical distance and approach depth");
assert.doesNotMatch(world + canvas, /OrbitControls|FlyControls|MapControls|Math\.random|IntelligenceSnapshotV1|Business Health Formula V2|Evidence Engine|provider routing|database topology/i, "the public shell must avoid free flight, nondeterminism, and private architecture disclosure");

assert.match(layout, /IntelligenceUniverseProvider[\s\S]*<PwaServiceWorker \/>[\s\S]*\{children\}/, "the lightweight controller must persist above compatible routes");
assert.match(header, /UniverseNavigationLink[\s\S]*universeRoutes/, "the existing header must provide fast travel only for spatial destinations");
assert.match(header, /<Link href="\/pricing"|secondaryNavLinks\.map[\s\S]*<Link/, "ordinary public destinations must retain normal Next links");

const detailBackdrops = [
  ["vaeroex", "components/marketing/spatial/PublicSpatialBackdrop.tsx", "PublicSpatialCanvas"],
  ["intelligence-systems", "components/marketing/intelligence-systems/IntelligenceSystemsSpatialBackdrop.tsx", "IntelligenceSystemsSpatialCanvas"],
  ["executive-intelligence", "components/marketing/executive-intelligence/ExecutiveIntelligenceSpatialBackdrop.tsx", "ExecutiveIntelligenceSpatialCanvas"],
  ["drug-discovery-intelligence", "components/marketing/drug-discovery/DrugDiscoverySpatialBackdrop.tsx", "DrugDiscoverySpatialCanvas"],
  ["biological-intelligence", "components/marketing/biological/BiologicalSpatialBackdrop.tsx", "BiologicalSpatialCanvas"]
];
for (const [destination, file, renderer] of detailBackdrops) {
  const source = read(file);
  assert.match(source, new RegExp(`suppressBackdrop\\(${JSON.stringify(destination)}\\)`), `${destination} must defer only its own approved detailed renderer during approach`);
  assert.match(source, new RegExp(`dynamic\\([\\s\\S]*${renderer}[\\s\\S]*ssr: false`), `${destination} must preserve its existing detailed renderer as LOD 3`);
}

for (const page of [
  "app/page.tsx",
  "app/intelligence-systems/page.tsx",
  "app/executive-intelligence/page.tsx",
  "app/drug-discovery-intelligence/page.tsx",
  "app/biological-intelligence/page.tsx"
]) {
  const source = read(page);
  assert.match(source, /export const metadata: Metadata/, `${page} must retain route-specific metadata`);
  assert.match(source, /PublicSiteHeader/, `${page} must retain the reliable navigation layer`);
}

assert.doesNotMatch(provider + context + shell + canvas + world, /api\/stripe\/checkout|Supabase|workspace_id|customer/i, "the public prototype must not alter commerce, tenant, or customer behavior");

process.stdout.write("Intelligence Universe regressions passed.\n");

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
assert.equal(stateModel.adjacentUniverseSystem("executive-intelligence", -1), "biological-intelligence", "deterministic keyboard navigation must wrap safely");

const executivePosition = stateModel.INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS["executive-intelligence"];
const drugPosition = stateModel.INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS["drug-discovery-intelligence"];
const biologicalPosition = stateModel.INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS["biological-intelligence"];
assert.equal(stateModel.nearestUniverseSystem(executivePosition), "executive-intelligence", "3D proximity must resolve Executive");
assert.equal(stateModel.nearestUniverseSystem(drugPosition), "drug-discovery-intelligence", "3D proximity must resolve Drug Discovery");
assert.equal(stateModel.nearestUniverseSystem(biologicalPosition), "biological-intelligence", "3D proximity must resolve Biological");
assert.notEqual(executivePosition.y, drugPosition.y, "systems must not share a horizontal carousel plane");
assert.notEqual(drugPosition.z, biologicalPosition.z, "systems must occupy distinct depth regions");

const bounded = stateModel.moveUniversePosition({ x: -47, y: 29, z: -45 }, { x: -100, y: 100, z: -100 });
assert.ok(bounded.x >= stateModel.INTELLIGENCE_UNIVERSE_BOUNDS.x[0], "soft exploration resistance must retain the hard X safety bound");
assert.ok(bounded.y <= stateModel.INTELLIGENCE_UNIVERSE_BOUNDS.y[1], "soft exploration resistance must retain the hard Y safety bound");
assert.ok(bounded.z >= stateModel.INTELLIGENCE_UNIVERSE_BOUNDS.z[0], "soft exploration resistance must retain the hard Z safety bound");
assert.equal(stateModel.universeProximityForDistance(80), "open_field", "users must be allowed to remain between destinations");

const initialMotion = stateModel.createUniverseMotion("drug-discovery-intelligence");
assert.deepEqual(initialMotion.position, stateModel.INTELLIGENCE_UNIVERSE_START_POSITION, "overview motion must begin in open shared space");
assert.equal(initialMotion.mode, "idle", "motion must initialize without synthetic travel");

for (const field of ["current", "target", "selectedSystem", "proximity", "route", "level", "phase", "inputLocked", "reducedMotion", "quality", "assetReadiness"]) {
  assert.match(model, new RegExp(`${field}:`), `central state must own ${field}`);
}
for (const field of ["position", "targetPosition", "velocity", "approachProgress", "approachTarget", "dragging", "dragOriginX", "dragOriginY", "dragLastX", "dragLastY", "dragLastAt", "mode", "travelStage", "suppressClickUntil"]) {
  assert.match(model, new RegExp(`${field}:`), `central motion must own ${field}`);
}
assert.doesNotMatch(model + provider + shell + canvas + world, /railProgress|railTarget|settleRail|activeIndex/, "the primary experience must not retain carousel-authoritative state");

assert.match(context, /createContext<IntelligenceUniverseContextValue>/, "one focused context must own the public spatial controller contract");
assert.match(provider, /usePathname\(\)[\s\S]*route_sync[\s\S]*router\.push\(nextRoute\)/, "route state and spatial state must stay synchronized through Next navigation");
assert.match(provider, /phase === "transitioning"[\s\S]*phase === "arriving"/, "route travel must have explicit deterministic transition states");
assert.match(provider, /isUniverseSystemDestination\(destination\)[\s\S]*1180/, "direct product routes must settle through a bounded visible arrival");
assert.match(provider, /window\.scrollY < window\.innerHeight \* 0\.72/, "overview WebGL must still release when the user leaves the hero region");
assert.match(provider, /sessionStorage[\s\S]*classic[\s\S]*spatial/, "the experiment must remain locally reversible");
assert.doesNotMatch(provider + shell, /history\.(?:pushState|replaceState)/, "continuous movement must not spam browser history");
assert.match(shell, /\{universe\.shellVisible \? \([\s\S]*IntelligenceUniverseBackdrop/, "the overview renderer must unload when an approved LOD-3 product renderer takes ownership");

assert.match(provider, /function integrateFreeMotion[\s\S]*requestAnimationFrame\(tick\)/, "continuous XYZ inertia must integrate on animation frames");
assert.match(provider, /INTELLIGENCE_UNIVERSE_BOUNDS[\s\S]*boundaryBand[\s\S]*velocity\[axis\]/, "the camera must receive soft boundary forces before hard safety clamping");
assert.match(provider, /headingToward > 0\.08[\s\S]*attraction/, "destination gravity may assist only motion already heading toward a nearby system");
assert.match(provider, /endExplorationDrag[\s\S]*targetPosition[\s\S]*position[\s\S]*"coasting"/, "release must preserve free position and inertia without forced destination snapping");
assert.match(provider, /travelStage === "pullback"[\s\S]*travelStage === "crossing"[\s\S]*travelStage = "approach"/, "fast travel must visibly pull back, cross the same universe, and approach");
assert.match(provider, /updateExplorationDrag[\s\S]*clientX[\s\S]*clientY[\s\S]*viewportWidth[\s\S]*viewportHeight/, "pointer movement must update two spatial axes continuously");
assert.match(provider, /nudgeExploration[\s\S]*delta: IntelligenceUniverseVector3/, "wheel and pinch input must share the bounded XYZ movement path");

assert.match(link, /event\.button !== 0[\s\S]*event\.metaKey[\s\S]*event\.ctrlKey[\s\S]*event\.shiftKey[\s\S]*event\.altKey/, "fast travel must preserve normal browser link affordances");
assert.match(shell, /activePointers[\s\S]*pointerDistance[\s\S]*pinchDistance/, "mobile must support one-finger panning and two-finger depth");
assert.match(shell, /updateExplorationDrag\([\s\S]*event\.clientX[\s\S]*event\.clientY/, "the primary viewport must update X and Y during pointer movement");
assert.match(shell, /deltaX[\s\S]*deltaY[\s\S]*nudgeExploration\(\{ x, y: 0, z \}\)/, "trackpad input must provide lateral and actual depth motion");
assert.match(shell, /INTERACTIVE_SELECTOR[\s\S]*closest\(INTERACTIVE_SELECTOR\)/, "viewport gestures must preserve native links and controls");
assert.match(shell, /event\.target !== event\.currentTarget/, "group keyboard shortcuts must not override focused semantic links or buttons");
for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " ", "Escape"]) {
  assert.match(shell, new RegExp(`event\\.key === ${JSON.stringify(key)}`), `keyboard navigation must support ${JSON.stringify(key)}`);
}
assert.match(shell, /orientationAid[\s\S]*orientationPosition[\s\S]*destinationIndex/, "a restrained position aid and direct destination index must remain available");
assert.match(shell, /UniverseNavigationLink[\s\S]*PUBLIC_SYSTEMS\.map[\s\S]*Approach \{selectedSystem\.name\}/, "every system must remain reachable through semantic links without gestures");
assert.match(styles, /touch-action: none/, "the spatial viewport must accept diagonal mobile movement");
assert.match(styles, /:focus-visible/, "spatial controls must retain a visible keyboard focus treatment");
assert.match(styles, /\.visual\[data-active="true"\][\s\S]*pointer-events: auto/, "the actual WebGL viewport must remain an interactive surface");

assert.match(backdrop, /dynamic\([\s\S]*IntelligenceUniverseCanvas[\s\S]*ssr: false/, "the experimental renderer must load progressively on the client");
assert.match(backdrop, /useSpatialCapability\(\{ allowMobile: true \}\)/, "the shell must use the shared capability tier contract");
assert.match(backdrop, /SpatialErrorBoundary[\s\S]*UniverseFallback/, "a WebGL exception must fail into a bounded visual fallback");
for (const contract of ["probeRenderedCanvas", "SpatialResizeObserver", "ACESFilmicToneMapping", "SRGBColorSpace", "frameloop={active ? \"demand\" : \"never\"}"]) {
  assert.match(canvas, new RegExp(contract.replace(/[{}?]/g, "\\$&")), `the shell canvas must retain ${contract}`);
}
assert.match(canvas, /currentMotion\.position\.x[\s\S]*currentMotion\.position\.y[\s\S]*currentMotion\.position\.z/, "camera position must follow continuous world coordinates directly");
assert.match(canvas, /INTELLIGENCE_UNIVERSE_ENTRY_POSITIONS[\s\S]*approachProgress[\s\S]*lerp/, "assisted approach must physically converge on the selected world-space structure");
assert.match(canvas, /quality === "full"[\s\S]*42[\s\S]*quality === "constrained"[\s\S]*72[\s\S]*180/, "ambient frames must scale down by device tier");
assert.match(canvas, /currentMotion\.dragging[\s\S]*requestAnimationFrame\(renderMotion\)/, "active manipulation must receive frame-rate rendering without raising idle cost");
assert.match(canvas, /document\.visibilityState === "visible"/, "hidden pages must not continue ambient rendering");
assert.match(canvas, /state\.reducedMotion \|\| state\.quality === "reduced_motion"[\s\S]*camera\.position\.copy/, "reduced motion must replace travel with immediate framing");

for (const structure of ["ExecutiveStructure", "DrugStructure", "BiologicalStructure"]) {
  assert.match(world, new RegExp(`function ${structure}`), `${structure} must provide a distinct bounded overview LOD`);
}
assert.match(world, /DRUG_ATOMS[\s\S]*DRUG_BONDS[\s\S]*sphereGeometry/, "Drug Discovery must use a coherent molecular topology rather than decorative biology");
assert.match(world, /BiologicalStructure[\s\S]*strandA[\s\S]*strandB[\s\S]*icosahedronGeometry/, "Biological Intelligence must use a multiscale biological representation");
assert.match(world, /ExecutiveStructure[\s\S]*boxGeometry[\s\S]*EXECUTIVE_NODES/, "Executive Intelligence must use structured analytical architecture");
assert.match(world, /INTELLIGENCE_UNIVERSE_SYSTEM_POSITIONS[\s\S]*SYSTEM_POSITIONS/, "all three overview LODs must use the shared authoritative 3D coordinates");
assert.match(world, /DISTANT_FORMATIONS[\s\S]*SignalField[\s\S]*farCount/, "the shared universe must extend materially beyond its three current destinations");
assert.match(world, /distance < 29[\s\S]*distance < 57[\s\S]*"distant"/, "system detail and labels must resolve progressively from actual 3D distance");
assert.match(world, /onPointerOver[\s\S]*onClick[\s\S]*onEnterSystem\(id\)/, "the actual spatial structures must be clickable rather than represented only by DOM controls");
assert.doesNotMatch(world + canvas, /OrbitControls|FlyControls|MapControls|Math\.random|IntelligenceSnapshotV1|Business Health Formula V2|Evidence Engine|provider routing|database topology/i, "the public shell must avoid free flight, nondeterminism, and private architecture disclosure");

assert.match(layout, /IntelligenceUniverseProvider[\s\S]*<PwaServiceWorker \/>[\s\S]*\{children\}/, "the lightweight controller must persist above compatible routes");
assert.match(header, /UniverseNavigationLink[\s\S]*universeRoutes/, "the existing header must provide assisted travel only for spatial destinations");
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

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

function readSourceTree(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return "";

  return fs.readdirSync(absolutePath, { withFileTypes: true })
    .flatMap((entry) => {
      const childPath = path.join(relativePath, entry.name);
      if (entry.isDirectory()) return [readSourceTree(childPath)];
      if (!/\.(?:ts|tsx)$/.test(entry.name)) return [];
      return [read(childPath)];
    })
    .join("\n");
}

const packageJson = JSON.parse(read("package.json"));
const styles = read("app/globals.css");
const shell = read("components/app/AppShell.tsx");
const navigation = read("components/app/AppNavigation.tsx");
const settingsPage = read("app/app/settings/page.tsx");
const themeControls = read("components/app/ThemeControls.tsx");
const surface = read("components/spatial/SpatialSurface.tsx");
const intelligencePage = read("app/app/intelligence/page.tsx");
const kpiPage = read("app/app/kpis/page.tsx");
const instrument = read("components/intelligence/BusinessHealthInstrument.tsx");
const authenticatedSource = [
  readSourceTree("app/app"),
  readSourceTree("components/app"),
  readSourceTree("components/intelligence"),
  readSourceTree("components/operations"),
  readSourceTree("lib/presentation")
].join("\n");
const publicSpatialSource = [
  readSourceTree("components/marketing/spatial"),
  readSourceTree("components/marketing/executive-intelligence"),
  readSourceTree("components/marketing/intelligence-systems"),
  readSourceTree("components/marketing/drug-discovery"),
  readSourceTree("components/marketing/biological")
].join("\n");

const retiredWorkspacePaths = [
  "components/app/ExperienceControls.tsx",
  "components/app/WorkspaceExperienceProvider.tsx",
  "lib/presentation/workspace-experience.ts",
  "components/spatial/BoundedSpatialCamera.tsx",
  "components/spatial/GuidedWorkspaceCamera.tsx",
  "components/spatial/README.md",
  "components/spatial/SpatialEnvironmentAssets.tsx",
  "components/spatial/SpatialErrorBoundary.tsx",
  "components/spatial/SpatialRoutePlane.tsx",
  "components/spatial/SpatialWorkspaceCanvas.tsx",
  "components/spatial/SpatialWorkspaceShell.tsx",
  "components/spatial/spatial-destinations.ts",
  "components/spatial/useSpatialVisibility.ts",
  "components/spatial/SpatialIntelligenceWorkspace.tsx",
  "components/spatial/SpatialIntelligenceCanvas.tsx",
  "components/spatial/KpiVisualizationSwitcher.tsx",
  "components/spatial/KpiSpatialCanvas.tsx",
  "lib/presentation/spatial-intelligence.ts",
  "lib/presentation/spatial-kpi.ts"
];

for (const retiredPath of retiredWorkspacePaths) {
  assert.equal(exists(retiredPath), false, retiredPath + " must not remain in the authenticated workspace runtime");
}

assert.match(shell, /<ComplianceNotice compact \/>[\s\S]*\{children\}[\s\S]*<footer/, "the authenticated shell must render routed DOM content directly");
assert.doesNotMatch(shell, /ExperienceControls|WorkspaceExperienceProvider|SpatialWorkspaceShell|vaeroex-spatial-shell|vaeroex-spatial-scene/, "the authenticated shell must not mount an experience selector or spatial runtime");
assert.match(navigation, /<Link[\s\S]*href=\{item\.href as Route\}/, "authenticated navigation must use normal Next links");
assert.doesNotMatch(navigation, /preventDefault|setTimeout|useRouter|SPATIAL_NAVIGATION_INTENT_EVENT|data-spatial-destination|spatialTravelPlan/, "authenticated navigation must not delay routing for a camera handoff");
assert.doesNotMatch(authenticatedSource, /Intel 3D|vaeroex-workspace-experience|WorkspaceExperience|SpatialWorkspaceCanvas|GuidedWorkspaceCamera/, "authenticated source must not retain the retired experience preference or runtime");
assert.doesNotMatch(authenticatedSource, /@react-three\/(?:fiber|drei)|from ["']three["']|<Canvas\b/, "authenticated routes and components must not import WebGL rendering");
assert.doesNotMatch(styles, /vaeroex-workspace-shell|vaeroex-workspace-canvas|vaeroex-route-plane|vaeroex-route-content|vaeroex-route-frame|data-spatial-workspace|data-spatial-motion/, "workspace-only canvas and transition CSS must be removed");

assert.match(settingsPage, /<ThemeControls \/>/, "normal color appearance controls must remain available in Settings");
assert.match(themeControls, /VAEROEX_THEME_STORAGE_KEY[\s\S]*ThemePreference/, "color theme persistence must remain independent and intact");
assert.match(surface, /SpatialDepth = "subtle" \| "raised" \| "focus"/, "the existing DOM-only executive surface hierarchy must remain intact");
assert.match(instrument, /Business Health score \$\{displayScore\} out of 100/, "the readable Business Health instrument must remain intact");
assert.doesNotMatch(instrument, /fetch\(|canvas|requestAnimationFrame|WebGL|three/i, "Business Health must remain a DOM-only instrument");

assert.match(intelligencePage, /<IntelligenceSignalInbox[\s\S]*currentCards=\{lifecycleCards\.current\}[\s\S]*historyCards=\{lifecycleCards\.history\}/, "authoritative Intelligence cards must continue to render directly");
assert.doesNotMatch(intelligencePage, /SpatialIntelligenceWorkspace|Cards[\s\S]*Spatial/, "the retired Intelligence-only spatial mode must remain absent");
assert.match(kpiPage, /<TrendChart rows=\{selectedMetricRows\.slice\(-12\)\} metricName=\{primaryMetric\} settings=\{kpiSettings\} \/>/, "KPI detail must retain the authoritative 2D trend chart");
assert.match(kpiPage, /resolveKpiTargetReference\(semantics, row\.target\)/, "KPI targets must remain intact");
assert.match(kpiPage, /const chartColor = kpiColor\(metricName, settings\)/, "persisted KPI colors must remain intact");
assert.doesNotMatch(kpiPage, /KpiVisualizationSwitcher|KpiSpatialCanvas|spatial-kpi|2D\s*\/\s*3D/, "KPI Performance must not regain a 3D mode");

assert.equal(packageJson.dependencies.three, "0.185.1", "Three.js must remain available to the public cinematic website");
assert.equal(packageJson.dependencies["@react-three/fiber"], "9.7.0", "R3F must remain available to the public cinematic website");
assert.equal(packageJson.dependencies["@react-three/drei"], "10.7.7", "Drei must remain available to the public cinematic website");
assert.match(publicSpatialSource, /@react-three\/fiber/, "public marketing experiences must retain R3F rendering");
assert.match(publicSpatialSource, /<Canvas\b/, "public marketing experiences must retain their WebGL canvases");
assert.match(publicSpatialSource, /useSpatialCapability/, "public marketing experiences must retain capability-tier fallbacks");
for (const sharedPublicUtility of [
  "components/spatial/CanvasPixelProbe.tsx",
  "components/spatial/SpatialResizeObserver.ts",
  "components/spatial/useSpatialCapability.ts"
]) {
  assert.equal(exists(sharedPublicUtility), true, sharedPublicUtility + " must remain for public WebGL");
}

console.log("Authenticated classic-workspace and public spatial boundary regressions passed.");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const layout = read("app/layout.tsx");
const globals = read("app/globals.css");
const header = read("components/legal/PublicSiteHeader.tsx");
const homepage = read("app/page.tsx");
const intelligenceSystemsPage = read("app/intelligence-systems/page.tsx");
const executivePage = read("app/executive-intelligence/page.tsx");
const drugPage = read("app/drug-discovery-intelligence/page.tsx");
const biologicalPage = read("app/biological-intelligence/page.tsx");
const pricingPage = read("app/pricing/page.tsx");

const retiredGlobalUniverseFiles = [
  "lib/marketing/intelligence-universe.ts",
  "components/marketing/intelligence-universe/IntelligenceUniverseProvider.tsx",
  "components/marketing/intelligence-universe/IntelligenceUniverseContext.tsx",
  "components/marketing/intelligence-universe/IntelligenceUniverseShell.tsx",
  "components/marketing/intelligence-universe/IntelligenceUniverseBackdrop.tsx",
  "components/marketing/intelligence-universe/IntelligenceUniverseCanvas.tsx",
  "components/marketing/intelligence-universe/IntelligenceUniverseWorld.tsx",
  "components/marketing/intelligence-universe/UniverseNavigationLink.tsx",
  "components/marketing/intelligence-universe/intelligence-universe.module.css"
];

for (const file of retiredGlobalUniverseFiles) {
  assert.equal(exists(file), false, `${file} must not restore the retired site-wide spatial navigation model`);
}

assert.doesNotMatch(layout, /IntelligenceUniverseProvider|IntelligenceUniverseShell/, "the root layout must not persist a site-wide spatial world");
assert.match(layout, /<ActivityProvider>[\s\S]*<PwaServiceWorker \/>[\s\S]*\{children\}[\s\S]*<\/ActivityProvider>/, "the root layout must render canonical route content directly");
assert.doesNotMatch(globals, /data-intelligence-universe|data-universe-control|--intelligence-universe-map/, "global CSS must not reserve interaction or composition for a universe map");

assert.match(header, /import Link from "next\/link"/, "the authoritative public header must use canonical Next links");
assert.doesNotMatch(header, /UniverseNavigationLink|INTELLIGENCE_UNIVERSE|preventDefault|router\.push|setTimeout/, "public navigation must not be intercepted by spatial travel logic");
for (const route of ["/", "/pricing", "/trust", "/about", "/contact", "/networking", "/careers"]) {
  assert.match(header, new RegExp(route.replace("/", "\\/")), `the conventional header must retain ${route}`);
}
assert.match(header, /PUBLIC_SYSTEMS\.map[\s\S]*<Link key=\{link\.href\} href=\{link\.href\}/, "specialized intelligence destinations must remain ordinary semantic links");

assert.match(homepage, /<h1>VAEROEX<\/h1>[\s\S]*Intelligence Systems/, "Home must remain the high-level Vaeroex Intelligence Systems entry point");
assert.match(homepage, /Transforming information into visibility, awareness, prediction, and action/, "Home must retain the approved intelligence thesis");
assert.match(homepage, /Why intelligence matters[\s\S]*From information to intelligence[\s\S]*Visibility\. Awareness\. Prediction\. Action\./, "Home must explain the broader intelligence narrative");
assert.match(homepage, /<PublicSystemsPortfolio \/>/, "Home may preview the three specialized intelligence areas through the shared portfolio");
assert.doesNotMatch(homepage, /api\/stripe\/checkout|current_period_end|Refund Policy|Founder, Vaeroex/, "Home must not duplicate checkout, policy, or the complete About experience");

assert.match(intelligenceSystemsPage, /<h1>INTELLIGENCE SYSTEMS<\/h1>/, "Intelligence Systems must remain a dedicated route");
for (const system of ["EXECUTIVE_INTELLIGENCE_SYSTEM", "DRUG_DISCOVERY_INTELLIGENCE_SYSTEM", "BIOLOGICAL_INTELLIGENCE_SYSTEM"]) {
  assert.match(intelligenceSystemsPage, new RegExp(system), `the dedicated systems route must introduce ${system}`);
}
assert.match(intelligenceSystemsPage, /role="status"><Check[\s\S]*Available/, "Executive Intelligence must remain visibly available");
assert.equal((intelligenceSystemsPage.match(/<DevelopmentStatus \/>/g) || []).length, 2, "both development-stage systems must remain visibly in development");
assert.match(executivePage, /Business Health[\s\S]*KPIs[\s\S]*Evidence[\s\S]*Saved Analyses/, "Executive Intelligence must retain its detailed product experience");
assert.match(drugPage, /UNDER DEVELOPMENT|IN DEVELOPMENT|In Development|Under Development/, "Drug Discovery must remain explicitly in development");
assert.match(biologicalPage, /UNDER DEVELOPMENT|IN DEVELOPMENT|In Development|Under Development/, "Biological Intelligence must remain explicitly in development");
assert.doesNotMatch(drugPage + biologicalPage, /api\/stripe\/checkout|StartWithVaeroexMenu/, "development-stage intelligence routes must expose no checkout action");
assert.match(pricingPage, /Executive Intelligence[\s\S]*Drug Discovery Intelligence[\s\S]*Biological Intelligence/, "Pricing must remain the independent three-offering page");

const pageBackdrops = [
  ["components/marketing/spatial/PublicSpatialBackdrop.tsx", "PublicSpatialCanvas"],
  ["components/marketing/intelligence-systems/IntelligenceSystemsSpatialBackdrop.tsx", "IntelligenceSystemsSpatialCanvas"],
  ["components/marketing/executive-intelligence/ExecutiveIntelligenceSpatialBackdrop.tsx", "ExecutiveIntelligenceSpatialCanvas"],
  ["components/marketing/drug-discovery/DrugDiscoverySpatialBackdrop.tsx", "DrugDiscoverySpatialCanvas"],
  ["components/marketing/biological/BiologicalSpatialBackdrop.tsx", "BiologicalSpatialCanvas"]
];

for (const [file, renderer] of pageBackdrops) {
  const source = read(file);
  assert.match(source, new RegExp(`dynamic\\([\\s\\S]*${renderer}[\\s\\S]*ssr: false`), `${renderer} must remain progressively client-loaded`);
  assert.match(source, new RegExp(`return <${renderer} \\/>`), `${renderer} must mount directly as its page-owned environment`);
  assert.doesNotMatch(source, /useIntelligenceUniverse|suppressBackdrop|data-universe-detail-deferred/, `${renderer} must not defer to a global world`);
}

const pageCanvases = [
  "components/marketing/spatial/PublicSpatialCanvas.tsx",
  "components/marketing/intelligence-systems/IntelligenceSystemsSpatialCanvas.tsx",
  "components/marketing/executive-intelligence/ExecutiveIntelligenceSpatialCanvas.tsx",
  "components/marketing/drug-discovery/DrugDiscoverySpatialCanvas.tsx",
  "components/marketing/biological/BiologicalSpatialCanvas.tsx"
].map(read);

for (const source of pageCanvases) {
  assert.match(source, /useSpatialCapability/, "every page-owned WebGL environment must retain shared capability tiers");
  assert.match(source, /SpatialResizeObserver/, "every page-owned WebGL environment must retain bounded resize handling");
  assert.match(source, /probeRenderedCanvas/, "every page-owned WebGL environment must retain its nonblank framebuffer probe");
  assert.match(source, /frameloop="demand"/, "every page-owned WebGL environment must remain demand-rendered");
  assert.doesNotMatch(source, /OrbitControls|FlyControls|MapControls|IntelligenceSnapshotV1|Business Health Formula V2|provider routing|database topology/i, "public renderers must expose neither free flight nor private architecture");
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
  assert.match(source, /PublicSiteHeader/, `${page} must retain conventional shared navigation`);
}

assert.match(read("app/trust/page.tsx"), /export const metadata: Metadata/, "Trust must retain route-specific metadata");
assert.match(read("components/legal/TrustCenterPage.tsx"), /PublicSiteHeader/, "Trust must retain conventional shared navigation");
assert.match(homepage, /data-public-spatial-journey[\s\S]*<PublicSpatialBackdrop \/>/, "Home must retain its own scroll-driven spatial composition");
assert.match(intelligenceSystemsPage, /data-intelligence-systems-journey[\s\S]*<IntelligenceSystemsSpatialBackdrop \/>/, "Intelligence Systems must retain its own scroll-driven spatial composition");

const publicNavigationSources = [layout, globals, header, homepage, intelligenceSystemsPage].join("\n");
assert.doesNotMatch(publicNavigationSources, /VAEROEX \/ UNIVERSE|One guided public environment|Scroll to move through Vaeroex|intelligenceUniverseMap|destination gravity|fast_travel/, "the public site must not restore site-wide universe navigation chrome or travel state");

process.stdout.write("Conventional public navigation and page-level spatial regressions passed.\n");

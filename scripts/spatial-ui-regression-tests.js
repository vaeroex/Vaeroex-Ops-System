const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const packageJson = JSON.parse(read("package.json"));
const styles = read("app/globals.css");
const shell = read("components/app/AppShell.tsx");
const navigation = read("components/app/AppNavigation.tsx");
const experienceControls = read("components/app/ExperienceControls.tsx");
const experienceProvider = read("components/app/WorkspaceExperienceProvider.tsx");
const experiencePreferences = read("lib/presentation/workspace-experience.ts");
const themeControls = read("components/app/ThemeControls.tsx");
const settingsPage = read("app/app/settings/page.tsx");
const workspaceShell = read("components/spatial/SpatialWorkspaceShell.tsx");
const workspaceCanvas = read("components/spatial/SpatialWorkspaceCanvas.tsx");
const environmentAssets = read("components/spatial/SpatialEnvironmentAssets.tsx");
const guidedCamera = read("components/spatial/GuidedWorkspaceCamera.tsx");
const boundedCamera = read("components/spatial/BoundedSpatialCamera.tsx");
const destinations = read("components/spatial/spatial-destinations.ts");
const routePlane = read("components/spatial/SpatialRoutePlane.tsx");
const surface = read("components/spatial/SpatialSurface.tsx");
const capability = read("components/spatial/useSpatialCapability.ts");
const pixelProbe = read("components/spatial/CanvasPixelProbe.tsx");
const resizeObserver = read("components/spatial/SpatialResizeObserver.ts");
const visibility = read("components/spatial/useSpatialVisibility.ts");
const spatialDocs = read("components/spatial/README.md");
const instrument = read("components/intelligence/BusinessHealthInstrument.tsx");
const homepage = read("components/intelligence/ExecutiveHomepage.tsx");
const intelligenceInbox = read("components/intelligence/IntelligenceSignalInbox.tsx");
const intelligencePage = read("app/app/intelligence/page.tsx");
const kpiPage = read("app/app/kpis/page.tsx");
const managedRecords = read("components/operations/ManagedRecordList.tsx");
const evidenceWorkspace = read("app/app/sources/SourcesPage.tsx");

assert.equal(packageJson.dependencies.three, "0.185.1", "Three.js must be pinned for repeatable spatial rendering");
assert.equal(packageJson.dependencies["@react-three/fiber"], "9.6.1", "R3F must be pinned for repeatable spatial rendering");
assert.equal(packageJson.dependencies["@react-three/drei"], "10.7.7", "Drei must be pinned for bounded camera controls");

assert.match(shell, /<SpatialWorkspaceShell>\{children\}<\/SpatialWorkspaceShell>/, "the application shell must host one persistent spatial workspace below navigation");
assert.match(shell, /<WorkspaceExperienceProvider>[\s\S]*<ExperienceControls \/>[\s\S]*<SpatialWorkspaceShell>\{children\}<\/SpatialWorkspaceShell>[\s\S]*<\/WorkspaceExperienceProvider>/, "the header and workspace shell must share one presentation-only experience preference");
assert.doesNotMatch(shell, /ThemeControls/, "the prominent authenticated header control must select workspace experience rather than color theme");
assert.match(settingsPage, /<ThemeControls \/>/, "color appearance controls must remain available in Settings");
assert.match(themeControls, /VAEROEX_THEME_STORAGE_KEY[\s\S]*ThemePreference/, "color theme persistence must remain independent from workspace experience");
assert.match(experiencePreferences, /WorkspaceExperience = "intel3d" \| "simple"[\s\S]*VAEROEX_WORKSPACE_EXPERIENCE_STORAGE_KEY[\s\S]*DEFAULT_WORKSPACE_EXPERIENCE: WorkspaceExperience = "intel3d"/, "workspace experience must use its own typed browser-local preference and default to Intel 3D");
assert.doesNotMatch(experiencePreferences, /theme|supabase|fetch\(|\.from\(/i, "workspace experience identity must not repurpose theme or introduce a data path");
assert.match(experienceProvider, /window\.localStorage\.getItem\(VAEROEX_WORKSPACE_EXPERIENCE_STORAGE_KEY\)[\s\S]*window\.localStorage\.setItem\(VAEROEX_WORKSPACE_EXPERIENCE_STORAGE_KEY/, "the shared experience provider must persist the presentation preference locally");
assert.match(experienceProvider, /document\.documentElement\.dataset\.workspaceExperience = experience/, "the shared experience provider must expose the presentation state on the document root");
assert.doesNotMatch(experienceProvider, /supabase|fetch\(|router\.|location\.reload|window\.location/, "switching experience must not access data or reload navigation state");
assert.match(experienceControls, /label: "Intel 3D"[\s\S]*label: "Simple"/, "the authenticated header must expose the two requested experience modes");
assert.match(experienceControls, /aria-label="Workspace experience"/, "the experience control must remain explicitly labelled");
assert.match(workspaceShell, /dynamic\(\(\) => import\("@\/components\/spatial\/SpatialWorkspaceCanvas"\)/, "the persistent workspace canvas must remain lazy loaded");
assert.match(workspaceShell, /experienceReady[\s\S]*experience === "intel3d"[\s\S]*capability\.available/, "the global canvas must mount only for a ready Intel 3D preference on a capable device");
assert.match(workspaceShell, /data-workspace-experience=\{experienceReady \? experience : "checking"\}/, "the shell must expose its presentation mode without changing route or business state");
assert.match(workspaceShell, /environmentReady[\s\S]*data-spatial-ready=[\s\S]*onReady=\{markEnvironmentReady\}/, "the DOM workspace must remain available until a verified nonblank environment is ready");
assert.match(workspaceShell, /onError=\{\(\) => setEnvironmentReady\(false\)\}/, "a spatial runtime failure must return the shell to its normal DOM composition");
assert.match(destinations, /SPATIAL_DESTINATIONS[\s\S]*id: "overview"[\s\S]*id: "intelligence"[\s\S]*id: "kpis"[\s\S]*id: "sources"[\s\S]*id: "analyses"/, "major authenticated routes must map through one extensible destination registry");
assert.match(destinations, /region:[\s\S]*camera:[\s\S]*position:[\s\S]*target:[\s\S]*fov:[\s\S]*arcHeight:[\s\S]*lateralBias:[\s\S]*surface:[\s\S]*arrival:[\s\S]*environment:/, "each destination must own presentation-only camera, surface, and transition metadata");
assert.match(destinations, /function spatialTravelPlan[\s\S]*Math\.hypot[\s\S]*distance - 14[\s\S]*650, 1200[\s\S]*departureMs/, "route travel timing must be centralized, distance aware, and bounded to the cinematic comfort range");
for (const route of ["overview", "intelligence", "kpis", "sources", "analyses"]) {
  assert.match(workspaceCanvas, new RegExp(`\\b${route}\\b`), `the workspace environment must contain the ${route} destination`);
}
assert.doesNotMatch(workspaceCanvas, /useRouter|router\.push|OrbitControls|BoundedSpatialCamera|SpatialCameraControls/, "the persistent environment must respond to canonical routing without exposing global 3D controls");
assert.match(workspaceCanvas, /<GuidedWorkspaceCamera destination=\{destination\} quality=\{quality\} transitionMs=\{transitionMs\}/, "the persistent environment must use the shared tier-aware guided route camera");
assert.match(guidedCamera, /const fromPosition = camera\.position\.clone\(\)[\s\S]*startedAt: performance\.now\(\)/, "route transitions must begin from the live interrupted camera state");
assert.match(guidedCamera, /smootherStep[\s\S]*quadraticBezier\(nextPosition\.current[\s\S]*travelWidening[\s\S]*camera\.lookAt/, "guided camera travel must use a curved eased position, target, and FOV path");
assert.match(guidedCamera, /WorkspaceTravelState[\s\S]*travelState\.current = \{ active: true[\s\S]*camera\.rotateZ[\s\S]*intensity: current\.active \? Math\.sin/, "guided travel must expose bounded live intensity and subtle banking to the shared environment");
assert.match(guidedCamera, /quality === "reduced_motion"[\s\S]*camera\.position\.set[\s\S]*transition\.current = null/, "reduced motion must retain dimensional destinations without cinematic camera travel");
assert.doesNotMatch(guidedCamera, /OrbitControls|FlyControls|MapControls/, "the application camera must not expose free flight or global orbit");
assert.match(workspaceCanvas, /function SignalTrace[\s\S]*useFrame[\s\S]*function TechnicalSubstrate/, "the shared environment must provide coherent structural depth and restrained signal movement");
assert.match(workspaceCanvas, /<DestinationArchitecture[\s\S]*function SpatialDepthArchitecture/, "distant destinations and near-to-far architecture must remain lightweight while producing real parallax");
assert.match(workspaceCanvas, /function ComputationalFinBank[\s\S]*function LayeredComputeStack[\s\S]*function DataBusPortal[\s\S]*function ForegroundPassByStructures/, "the near field must use reusable computational structures rather than generic decorative shapes");
assert.match(environmentAssets, /VAEROEX_MATERIAL_LIBRARY[\s\S]*anodizedMetal[\s\S]*satinGraphite[\s\S]*ceramic[\s\S]*polishedSilicon[\s\S]*smokedGlass[\s\S]*kind === "conductive"/, "the environment must use one restrained premium material library");
for (const asset of ["ComputationalWall", "SignalCorridor", "SiliconArray", "DataConduit", "ArchitecturalFrame", "MemoryStructure", "PrecisionAperture", "SubstrateLayer", "DestinationDock"]) {
  assert.match(environmentAssets, new RegExp(`export function ${asset}`), `the architectural library must expose ${asset}`);
}
assert.match(environmentAssets, /function SiliconArray[\s\S]*InstancedMesh[\s\S]*setMatrixAt/, "repeated silicon structures must remain instanced");
assert.match(environmentAssets, /function DestinationArchitecture[\s\S]*destination === "overview"[\s\S]*destination === "intelligence"[\s\S]*destination === "kpis"[\s\S]*destination === "sources"[\s\S]*destination === "analyses"/, "each destination must own a distinct hero architecture");
assert.match(environmentAssets, /function CinematicWorldArchitecture[\s\S]*SignalCorridor[\s\S]*ComputationalWall[\s\S]*SiliconArray[\s\S]*PrecisionAperture/, "the global environment must provide a large-scale foreground-to-deep architectural stack");
assert.match(workspaceCanvas, /function TravelRimLight[\s\S]*travel\.intensity[\s\S]*function TechnicalSubstrate/, "travel lighting must respond to real camera movement and settle without camera drift");
assert.match(workspaceCanvas, /rectAreaLight[\s\S]*spotLight[\s\S]*TravelRimLight/, "the world must use art-directed area, focus, and travel lighting without bloom");
assert.match(workspaceCanvas, /filamentPaths[\s\S]*secondarySignalRef/, "signal paths must use recessed multi-filament conduits and bounded pulses");
assert.match(workspaceCanvas, /function OverviewAssembly[\s\S]*function IntelligenceAssembly[\s\S]*function PerformanceAssembly[\s\S]*function EvidenceAssembly[\s\S]*function AnalysisAssembly/, "destinations must use intentional product-specific assemblies instead of one repeated primitive node");
assert.doesNotMatch(workspaceCanvas, /sphereGeometry|dodecahedronGeometry|octahedronGeometry|gridHelper/, "the persistent environment must not use the prototype node-graph or tutorial-grid vocabulary");
assert.match(boundedCamera, /minDistance=\{bounds\.minDistance\}/, "orbit and dolly must enforce a minimum distance");
assert.match(boundedCamera, /maxDistance=\{bounds\.maxDistance\}/, "orbit and dolly must enforce a maximum distance");
assert.match(boundedCamera, /minPolarAngle=\{bounds\.minPolarAngle\}/, "the camera must enforce a lower polar bound");
assert.match(boundedCamera, /maxPolarAngle=\{bounds\.maxPolarAngle\}/, "the camera must enforce an upper polar bound");
assert.match(boundedCamera, /MathUtils\.clamp\(controls\.target\.x[\s\S]*MathUtils\.clamp\(controls\.target\.y/, "camera pan must remain inside the scene bounds");
assert.match(boundedCamera, /onStart=\{\(\) => \{[\s\S]*moving\.current = false/, "the first direct pointer gesture must interrupt guided interpolation immediately");
assert.doesNotMatch(boundedCamera, /controlsRef\.current\.enabled = false|controls\.enabled = !moving\.current/, "guided interpolation must not leave direct controls disabled in an on-demand frame loop");
assert.match(boundedCamera, /title="Zoom in"[\s\S]*title="Zoom out"[\s\S]*title="Reset view"/, "discoverable icon controls must expose zoom and reset commands");
assert.match(workspaceCanvas, /const dpr: \[number, number\][\s\S]*\[1, 1\.35\][\s\S]*\[1, 1\.1\][\s\S]*\[1, 1\.15\]/, "each capability tier must use a bounded DPR budget");
assert.match(workspaceCanvas, /frameloop=\{visible \? "demand" : "never"\}/, "the persistent workspace must stop fully when out of view and render only on demand while visible");
assert.match(workspaceCanvas, /function SpatialFrameScheduler[\s\S]*window\.setInterval[\s\S]*quality === "full" \? 34 : 66[\s\S]*window\.clearInterval/, "settled ambient motion must use a bounded tier-aware scheduler with teardown");
assert.match(workspaceCanvas, /quality === "full" \? signalPaths\.length : quality === "constrained" \? 4 : 3/, "constrained and reduced-motion tiers must reduce ambient signal complexity");
assert.match(workspaceCanvas, /travel\.active \? 0\.3 \+ travel\.intensity \* 0\.12[\s\S]*destinationConvergence/, "signal travel must accelerate only during guided route movement and converge on the destination ahead");
assert.match(workspaceCanvas, /const opacity = active \? 0\.98 : 0[\s\S]*active && definition\.id === "overview"[\s\S]*active && definition\.id === "analyses"/, "only the approached destination may expand into its full assembly");
assert.match(styles, /--vaeroex-workspace-height: clamp\(38rem, calc\(100svh - 8\.5rem\), 56rem\)/, "the environment must occupy the primary desktop workspace region");
assert.match(styles, /\.vaeroex-workspace-canvas,[\s\S]*height: var\(--vaeroex-workspace-height\)/, "the shared canvas must fill its allocated workspace region");
assert.match(routePlane, /usePathname\(\)/, "route depth must preserve normal Next routing semantics");
assert.match(routePlane, /if \(enhanced && destination !== "flat"\) window\.scrollTo\(0, 0\)/, "major Intel 3D route changes must reveal the new camera destination instead of inheriting a deep-page scroll offset");
assert.match(routePlane, /enhanced && destination !== "flat"[\s\S]*vaeroex-route-frame[\s\S]*vaeroex-route-content/, "only Intel 3D may mount authoritative DOM content into a spatial foreground frame");
assert.match(routePlane, /data-spatial-motion=\{enhanced && destination !== "flat" \? motion : "settled"\}/, "Simple mode must retain a settled classic route plane without spatial transitions");
assert.match(navigation, /SPATIAL_NAVIGATION_INTENT_EVENT[\s\S]*event\.preventDefault\(\)[\s\S]*travel\.departureMs/, "desktop navigation must provide a bounded departure handoff before canonical routing");
assert.match(styles, /data-spatial-motion="departing"[\s\S]*opacity: 0\.34[\s\S]*translate3d\(var\(--vaeroex-depart-x[\s\S]*-160px[\s\S]*rotateY[\s\S]*scale\(0\.94\)/, "departing DOM surfaces must modestly clear the view while the WebGL environment carries the transition");
assert.match(styles, /@keyframes vaeroex-route-plane-arrive[\s\S]*var\(--vaeroex-arrive-z[\s\S]*var\(--vaeroex-arrive-rotate-y[\s\S]*scale\(1\)/, "arriving DOM surfaces must approach from their destination-specific spatial pose");
assert.match(styles, /\.vaeroex-workspace-shell--enabled \.vaeroex-workspace-canvas[\s\S]*opacity: 0[\s\S]*\.vaeroex-workspace-shell--active \.vaeroex-workspace-canvas[\s\S]*opacity: 1/, "the spatial enhancement must reveal progressively only after the DOM workspace is already available");
assert.match(styles, /\.vaeroex-workspace-shell--active > \.vaeroex-route-plane[\s\S]*padding-top: clamp\(3\.75rem/, "the real workspace must remain readable in the first viewport instead of sitting below an isolated 3D scene");
assert.match(styles, /container-type: inline-size[\s\S]*@container \(max-width: 48rem\)[\s\S]*width: calc\(100% - 4rem\)/, "narrow desktop shells must preserve readable route width without using viewport-only framing");
assert.match(styles, /\.vaeroex-route-content::before,[\s\S]*\.vaeroex-route-content::after[\s\S]*border-block:[\s\S]*@media \(max-width: 767px\), \(pointer: coarse\)[\s\S]*\.vaeroex-route-content::before,[\s\S]*display: none/, "desktop route surfaces must mount into the environment while mobile retains the flat fallback");
assert.match(styles, /pointer-events: none;[\s\S]*\.vaeroex-route-content/, "the global WebGL environment must not intercept normal DOM interaction");
assert.match(surface, /SpatialDepth = "subtle" \| "raised" \| "focus"/, "DOM depth must use the bounded three-level presentation scale");
assert.match(surface, /interactive \? "vaeroex-spatial-surface--interactive"/, "interactive DOM depth must remain explicit rather than global");

assert.match(homepage, /BusinessHealthInstrument/, "Business Health must retain its readable DOM instrument");
assert.match(instrument, /Business Health score \$\{displayScore\} out of 100/, "the DOM instrument must preserve its readable score contract");
assert.doesNotMatch(instrument, /fetch\(|canvas|requestAnimationFrame|WebGL|three/i, "the default Business Health instrument must not load WebGL");

assert.match(intelligencePage, /<IntelligenceSignalInbox[\s\S]*currentCards=\{lifecycleCards\.current\}[\s\S]*historyCards=\{lifecycleCards\.history\}/, "the authoritative Intelligence cards must render directly inside the global workspace");
assert.doesNotMatch(intelligencePage, /SpatialIntelligenceWorkspace|Cards[\s\S]*Spatial/, "the redundant Intelligence-only visualization toggle must be absent");

assert.match(kpiPage, /<TrendChart rows=\{selectedMetricRows\.slice\(-12\)\} metricName=\{primaryMetric\} settings=\{kpiSettings\} \/>/, "KPI detail must render the authoritative 2D trend chart directly");
assert.match(kpiPage, /resolveKpiTargetReference\(semantics, row\.target\)/, "the KPI trend chart must retain authoritative target references");
assert.match(kpiPage, /const chartColor = kpiColor\(metricName, settings\)/, "the KPI trend chart must retain persisted KPI colors");
assert.match(kpiPage, /<circle key=\{row\.id\}[\s\S]*row\.actual_value/, "the KPI trend chart must retain historical observations");
assert.match(kpiPage, /formatShortDate\(firstDate\)[\s\S]*formatShortDate\(lastDate\)/, "the KPI trend chart must retain its date range labels");
assert.doesNotMatch(kpiPage, /KpiVisualizationSwitcher|KpiSpatialCanvas|selectedKpiSnapshot|spatial-kpi|2D\s*\/\s*3D/, "KPI detail must not retain a KPI-specific 3D mode or mode selector");
assert.match(pixelProbe, /sampleSize = Math\.min\(64[\s\S]*\[0\.1, 0\.3, 0\.5, 0\.7, 0\.9\][\s\S]*readPixels/, "the one-time framebuffer check must stay bounded to a 25-sample grid");
assert.match(resizeObserver, /new window\.ResizeObserver\(callback\)/, "the canvas observer must preserve native resize delivery");
assert.match(resizeObserver, /requestAnimationFrame\(\(\) => \{[\s\S]*this\.callback\(\[\], this\)/, "the canvas observer must guarantee one asynchronous initial measurement");
assert.match(visibility, /new IntersectionObserver\(measure/, "IntersectionObserver must trigger the authoritative bounded visibility measurement");
assert.match(visibility, /getBoundingClientRect\(\)[\s\S]*addEventListener\("scroll", measure/, "a spatial canvas scrolled into view must resume through a bounded viewport measurement");
assert.match(visibility, /document\.visibilityState !== "hidden"[\s\S]*addEventListener\("visibilitychange", measure\)[\s\S]*removeEventListener\("visibilitychange", measure\)/, "spatial rendering must pause with the browser tab and remove its listener on teardown");

assert.match(capability, /SpatialQualityTier = "full" \| "constrained" \| "reduced_motion"/, "the shared workspace must define explicit full, constrained, and reduced-motion tiers");
assert.match(capability, /quality: "reduced_motion"[\s\S]*reason: "reduced_motion"/, "reduced-motion desktops must retain the static dimensional environment");
assert.match(capability, /quality: "constrained"[\s\S]*reason: "low_power"/, "lower-power desktops must receive the simplified spatial environment");
assert.match(capability, /pointer: coarse/, "coarse-pointer devices must stay on the DOM fallback");
assert.match(capability, /failIfMajorPerformanceCaveat: true/, "WebGL must fail safely on major performance caveats");
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.vaeroex-route-plane[\s\S]*animation: none/, "reduced motion must disable route-plane animation");
assert.match(styles, /@media \(pointer: coarse\)[\s\S]*\.vaeroex-health-instrument[\s\S]*transform: none/, "coarse-pointer devices must receive static DOM presentation");
assert.match(spatialDocs, /Register its canonical route[\s\S]*Keep readable information[\s\S]*global camera and DOM route plane read only the destination registry/, "future destinations must have a documented presentation-only extension contract");
for (const obsoletePath of [
  "components/spatial/SpatialIntelligenceWorkspace.tsx",
  "components/spatial/SpatialIntelligenceCanvas.tsx",
  "lib/presentation/spatial-intelligence.ts",
  "components/spatial/KpiVisualizationSwitcher.tsx",
  "components/spatial/KpiSpatialCanvas.tsx",
  "lib/presentation/spatial-kpi.ts",
  "components/spatial/KpiSpatialCanvas 2.tsx",
  "components/spatial/SpatialIntelligenceCanvas 2.tsx",
  "scripts/spatial-ui-regression-tests 2.js"
]) {
  assert.equal(fs.existsSync(path.join(root, obsoletePath)), false, `${obsoletePath} must not retain a superseded prototype beside its verified replacement`);
}

assert.match(intelligenceInbox, /depth: selected \? "raised" : "subtle"/, "the existing 2D Intelligence selection treatment must remain intact");
assert.doesNotMatch(managedRecords, /vaeroex-spatial-surface|spatialSurfaceClassName|Canvas/, "dense record management must remain on the flat operational plane");
assert.doesNotMatch(evidenceWorkspace, /vaeroex-spatial-surface|spatialSurfaceClassName|Canvas/, "evidence and file-management workflows must remain on the flat operational plane");
assert.doesNotMatch(evidenceWorkspace, /action=\{uploadFileAction\}[^>]*encType=/, "React must own multipart encoding for the upload server action");

console.log("Spatial UI regressions passed.");

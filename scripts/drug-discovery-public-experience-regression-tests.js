const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const page = read("app/drug-discovery-intelligence/page.tsx");
const styles = read("app/drug-discovery-intelligence/drug-discovery.module.css");
const canvas = read("components/marketing/drug-discovery/DrugDiscoverySpatialCanvas.tsx");
const backdrop = read("components/marketing/drug-discovery/DrugDiscoverySpatialBackdrop.tsx");
const molecular = read("components/marketing/drug-discovery/MolecularVisualization.tsx");
const protein = read("components/marketing/drug-discovery/ProteinVisualization.tsx");
const systems = read("lib/marketing/public-systems.ts");
const portfolio = read("components/marketing/PublicSystemsPortfolio.tsx");
const homepage = read("app/page.tsx");
const header = read("components/legal/PublicSiteHeader.tsx");
const footer = read("components/legal/PublicFooter.tsx");
const sitemap = read("app/sitemap.ts");
const capability = read("components/spatial/useSpatialCapability.ts");
const packageJson = read("package.json");
const productCopySources = `${page}\n${systems}`;

assert.match(page, /path: "\/drug-discovery-intelligence"/, "Drug Discovery metadata must use the canonical route");
assert.match(page, /VAEROEX INTELLIGENCE SYSTEMS[\s\S]*<h1>\{system\.name\}<\/h1>/, "the product hero must preserve Vaeroex company hierarchy");
for (const copy of [
  "Turn computational discovery into traceable research intelligence.",
  "Vaeroex Drug Discovery Intelligence brings biological targets, molecular candidates, computational experiments, research evidence, and scientific decisions into one intelligence system.",
  "Researchers can explore targets, generate and evaluate candidate molecules, compare computational results, preserve evidence across experiments, and prioritize the most promising directions for further investigation.",
  "Specialized scientific intelligence. One environment.",
  "Built for active experimentation.",
  "Models produce results. Vaeroex builds intelligence.",
  "Built for computational discovery teams.",
  "From possibility to evidence.",
  "A unified intelligence system for computational drug discovery."
]) {
  assert.match(productCopySources, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Drug Discovery page must retain approved copy: ${copy}`);
}

for (const capabilityName of ["PROTEIN STRUCTURE", "MOLECULAR GENERATION", "MOLECULAR DOCKING", "PROTEIN & BINDER DESIGN", "CANDIDATE INTELLIGENCE"]) {
  assert.match(page, new RegExp(capabilityName.replace(/[&]/g, "&")), `scientific capability must include ${capabilityName}`);
}

for (const step of ["TARGET", "STRUCTURE", "GENERATE", "DOCK", "FILTER", "COMPARE", "PRIORITIZE", "LABORATORY EVALUATION"]) {
  assert.match(page, new RegExp(`"${step}"`), `the discovery pipeline must include ${step}`);
}

for (const pillar of ["EVIDENCE LINEAGE", "CANDIDATE COMPARISON", "DETERMINISTIC FILTERING", "EXPERIMENT HISTORY", "CONFLICTING EVIDENCE", "BOUNDED RESEARCH REASONING"]) {
  assert.match(page, new RegExp(pillar), `the Vaeroex intelligence layer must include ${pillar}`);
}

for (const record of ["Candidate", "Generation Run", "Structural Prediction", "Docking Result", "Filter Outcome", "Researcher Review", "Laboratory Result", "Updated Evidence State"]) {
  assert.match(page, new RegExp(`"${record}"`), `research traceability must preserve ${record}`);
}

for (const audience of ["BIOTECHNOLOGY COMPANIES", "PHARMACEUTICAL R&D TEAMS", "CONTRACT RESEARCH ORGANIZATIONS", "ACADEMIC RESEARCH LABORATORIES"]) {
  assert.match(page, new RegExp(audience.replace(/[&]/g, "&")), `approved audience must include ${audience}`);
}

assert.match(page, /RESEARCH USE[\s\S]*Computational predictions require appropriate experimental validation and do not independently establish the safety, efficacy, clinical suitability, or therapeutic value of a candidate/, "the computational research boundary must remain explicit");
assert.match(page, /UNDER DEVELOPMENT/, "the approved availability status must remain exact");
assert.equal((page.match(/<AvailabilityStatus \/>/g) || []).length, 2, "hero and closing must render the exact approved availability status");
assert.doesNotMatch(page, /<Link|StartWithVaeroexMenu|href=\{?["']\/(?:pricing|checkout|login|signup)|purchase|start trial|waitlist|request access|coming soon|\bbeta\b/i, "the under-development product must not expose a conversion or fake availability route");

assert.match(systems, /Drug Discovery Intelligence[\s\S]*availability: "under_development"[\s\S]*route: "\/drug-discovery-intelligence"/, "the system registry must bind exact status and route");
assert.match(systems, /Explore biological targets, run advanced computational discovery workflows, evaluate molecular candidates, preserve experimental evidence, and prioritize promising directions for further research/, "the product registry must retain the approved card copy");
assert.match(portfolio, /data-availability=\{system\.availability\}[\s\S]*availabilityLabel\[system\.availability\][\s\S]*href=\{system\.route\}/, "the product card must separate status from normal navigation");
assert.match(homepage, /PublicSystemsPortfolio/, "the homepage must present the Vaeroex Intelligence Systems portfolio");
assert.match(header, /\/drug-discovery-intelligence[\s\S]*Drug Discovery Intelligence/, "desktop and mobile product navigation must include Drug Discovery Intelligence");
assert.match(footer, /Drug Discovery Intelligence[\s\S]*\/drug-discovery-intelligence/, "the product footer must include Drug Discovery Intelligence");
assert.match(sitemap, /"\/drug-discovery-intelligence"/, "the canonical product route must be discoverable");

assert.match(backdrop, /dynamic\([\s\S]*DrugDiscoverySpatialCanvas[\s\S]*ssr: false/, "Drug Discovery WebGL must load progressively on the client");
assert.match(page, /data-drug-discovery-journey/, "the page must own one continuous scroll-normalized scientific journey");
for (const stage of ["biological-target", "interaction-region", "molecular-possibility", "computational-experimentation", "docking-filtering", "candidate-comparison-evidence", "experiment-history", "candidate-convergence", "laboratory-boundary", "evidence-close"]) {
  assert.match(page, new RegExp(`data-ddi-stage="${stage}"`), `the semantic journey must expose ${stage}`);
}
assert.match(canvas, /JOURNEY[\s\S]*progress: 0[\s\S]*progress: 1/, "camera choreography must use one explicit directed journey");
assert.match(canvas, /FoldedTarget[\s\S]*CandidateField[\s\S]*DockingField[\s\S]*ComparisonField[\s\S]*EvidenceNetwork[\s\S]*ExperimentLineage[\s\S]*LaboratoryBoundary/, "the rendered world must evolve through the complete discovery narrative");
assert.match(protein, /AlphaHelix[\s\S]*BetaSheet[\s\S]*ProteinLoop[\s\S]*MolecularSurface[\s\S]*PocketResidues/, "protein rendering must combine recognizable secondary structures, irregular surfaces, and residue-scale pocket detail");
assert.match(protein, /IcosahedronGeometry[\s\S]*pocketAlignment[\s\S]*computeVertexNormals/, "molecular surfaces must be procedurally deformed around an explicit cavity rather than rendered as generic spheres");
assert.ok((protein.match(/<AlphaHelix/g) || []).length >= 4, "the folded target must contain multiple irregularly placed alpha helices");
assert.ok((protein.match(/<BetaSheet/g) || []).length >= 3, "the folded target must contain flattened directional beta sheets");
assert.match(molecular, /MolecularElement = "C" \| "N" \| "O" \| "S" \| "F" \| "Cl"/, "molecular rendering must distinguish conventional heavy-atom types");
assert.match(molecular, /validateMolecularGraph[\s\S]*valence[\s\S]*MOLECULE_LIBRARY\.every/, "fictional candidates must pass bounded connectivity and valence checks before rendering");
assert.ok((molecular.match(/id: "(?:linked-aromatic-amide|fused-heterobicycle|polar-heterocycle|flexible-aryl-heterocycle|sulfonyl-polar-analog)"/g) || []).length === 5, "candidate comparison must use five distinct medicinal-chemistry-style topologies");
assert.match(molecular, /bond\.order === 2[\s\S]*BondSegment/, "double bonds must remain visually distinguishable");
assert.match(molecular, /flexibleGroup[\s\S]*graph\.bonds\.find\(\(bond\) => bond\.rotatable\)[\s\S]*rotation\.set/, "subtle conformational motion must occur around an explicitly declared rotatable bond");
assert.match(canvas, /const count = quality === "full" \? 84 : quality === "constrained" \? 42 : 18/, "candidate possibility must use a bounded tier-aware population");
assert.ok((canvas.match(/<instancedMesh/g) || []).length >= 2, "candidate possibility must use GPU instancing for repeated fragments");
assert.match(canvas, /pointCount = quality === "full" \? 220[\s\S]*Float32Array/, "distant possibility must be implied with one bounded point field");
assert.match(canvas, /clusterCenters[\s\S]*cluster === 1[\s\S]*cluster === 3/, "chemical space must be spatially clustered and filtered by related analog families");
assert.match(canvas, /MOLECULE_LIBRARY\.slice\(0, 4\)[\s\S]*analogPositions/, "molecular generation must branch one scaffold into a visible family of related analogs");
assert.match(canvas, /BindingPocket[\s\S]*orientationSearch[\s\S]*conformationalAdjustment[\s\S]*MoleculeModel/, "docking must combine a physical pocket, orientation search, subtle conformational adjustment, and a chemically structured ligand");
assert.ok((canvas.match(/dashed dashScale=\{5\}/g) || []).length >= 3, "the predicted pose must expose multiple restrained interaction indicators");
assert.match(canvas, /MOLECULE_LIBRARY\[index\][\s\S]*representation="ball-and-stick"/, "candidate comparison must keep actual molecular structures central");
assert.match(canvas, /featureAnchors\[index % featureAnchors\.length\]/, "evidence paths must originate from molecular feature regions rather than a generic center node");
assert.match(canvas, /frameloop="demand"[\s\S]*FrameScheduler/, "rendering must stay bounded and on demand");
assert.match(canvas, /document\.visibilityState !== "hidden"/, "ambient rendering must pause while the document is hidden");
assert.match(canvas, /probeRenderedCanvas[\s\S]*SpatialResizeObserver/, "the WebGL surface must retain nonblank and initial-measurement safeguards");
assert.match(canvas, /useSpatialCapability\(\{ allowMobile: true \}\)/, "capable mobile devices must receive the optimized interactive scene");
assert.match(capability, /allowMobile[\s\S]*mobile[\s\S]*quality: "constrained"|mobile[\s\S]*constrained/, "the shared capability system must opt mobile into constrained quality only when explicitly requested");
assert.match(canvas, /ReducedScientificWorld/, "reduced motion must preserve a fixed scientific composition");
assert.match(canvas, /ScientificFallback[\s\S]*data-drug-discovery-fallback/, "genuine WebGL failure must retain a scientific visual fallback");
assert.doesNotMatch(canvas, /OrbitControls|FlyControls|MapControls|EffectComposer|UnrealBloomPass/, "the page must avoid free-flight controls and expensive postprocessing");
assert.doesNotMatch(styles, /\.spatialCanvas\s*\{[^}]*display:\s*none/s, "mobile must not disable the optimized Drug Discovery canvas by default");
assert.match(styles, /@media \(max-width: 767px\), \(pointer: coarse\)[\s\S]*\.chapter[\s\S]*background: rgba\(2, 8, 11, 0\.87\)/, "mobile copy must use a deliberate readable composition over reduced WebGL");
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/, "CSS motion must respect reduced-motion preferences");

const publicDrugDiscoverySources = [page, canvas, backdrop, molecular, protein, systems, portfolio].join("\n");
assert.doesNotMatch(publicDrugDiscoverySources, /NVIDIA|BioNeMo|foundation model|model provider|GPU provider|Supabase|Google Document AI|OpenAI|Anthropic|Vertex AI|private orchestration|provider fallback/i, "Drug Discovery public sources must not disclose vendors, models, or private architecture");
assert.doesNotMatch(publicDrugDiscoverySources, /discovered (?:a )?drug|replaces? scientists?|replaces? laborator|proves? (?:therapeutic )?efficacy|clinical approval|FDA approval|guaranteed successful/i, "Drug Discovery must not make unsupported scientific or regulatory claims");
assert.doesNotMatch(page, /AI Drug Discovery Companies/, "direct discovery competitors must not be presented as the target market");
assert.match(packageJson, /"@react-three\/drei"[\s\S]*"@react-three\/fiber"[\s\S]*"three"/, "the scientific rendering must reuse the installed Three.js stack");

process.stdout.write("Drug Discovery public experience regressions passed.\n");

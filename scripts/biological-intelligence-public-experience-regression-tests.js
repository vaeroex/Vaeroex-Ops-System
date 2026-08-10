const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const page = read("app/biological-intelligence/page.tsx");
const styles = read("app/biological-intelligence/biological-intelligence.module.css");
const canvas = read("components/marketing/biological/BiologicalSpatialCanvas.tsx");
const backdrop = read("components/marketing/biological/BiologicalSpatialBackdrop.tsx");
const structures = read("components/marketing/biological/BiologicalStructures.tsx");
const protein = read("components/marketing/drug-discovery/ProteinVisualization.tsx");
const systems = read("lib/marketing/public-systems.ts");
const portfolio = read("components/marketing/PublicSystemsPortfolio.tsx");
const header = read("components/legal/PublicSiteHeader.tsx");
const footer = read("components/legal/PublicFooter.tsx");
const sitemap = read("app/sitemap.ts");
const capability = read("components/spatial/useSpatialCapability.ts");
const packageJson = read("package.json");
const publicBiologicalSources = [page, canvas, backdrop, structures, systems, portfolio].join("\n");

assert.match(page, /path: "\/biological-intelligence"/, "Biological Intelligence metadata must use the canonical route");
assert.match(page, /<p className=\{styles\.eyebrow\}>VAEROEX<\/p>[\s\S]*<h1>\{system\.name\}<\/h1>/, "the hero must preserve the Vaeroex company-first hierarchy");
for (const copy of [
  "Understand the system behind the signal.",
  "Research intelligence for complex biological systems.",
  "Sequence → Variation → Biological consequence",
  "Evidence → Relationships → Mechanism → Hypothesis",
  "Built for evidence, not confident guessing",
  "Human researchers remain responsible for scientific interpretation, experimental validation, and consequential decisions."
]) {
  assert.match(page, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Biological Intelligence must retain approved copy: ${copy}`);
}

for (const capabilityName of [
  "BIOLOGICAL EVIDENCE SYNTHESIS",
  "MECHANISM DISCOVERY",
  "HYPOTHESIS INTELLIGENCE",
  "GENOMIC INTELLIGENCE",
  "PROTEIN INTELLIGENCE",
  "PATHWAY INTELLIGENCE",
  "EXPERIMENT INTELLIGENCE",
  "KNOWLEDGE GAP DETECTION",
  "RESEARCH PRIORITIZATION"
]) {
  assert.match(page, new RegExp(capabilityName), `product capabilities must include ${capabilityName}`);
}

for (const application of [
  "UNDERSTAND COMPLEX BIOLOGICAL PHENOTYPES",
  "INVESTIGATE GENETIC VARIATION",
  "PRIORITIZE RESEARCH HYPOTHESES",
  "CONNECT EXPERIMENTS OVER TIME",
  "IDENTIFY KNOWLEDGE GAPS",
  "PLAN HIGH-VALUE FOLLOW-UP RESEARCH"
]) {
  assert.match(page, new RegExp(application), `research applications must include ${application}`);
}

assert.match(page, /BIOLOGICAL SYSTEM ANALYSIS[\s\S]*Pathway disruption identified[\s\S]*ILLUSTRATIVE/, "the example analysis must clearly remain illustrative");
assert.match(page, /Supporting genes[\s\S]*23[\s\S]*Relevant proteins[\s\S]*8[\s\S]*Supporting experiments[\s\S]*4[\s\S]*Contradictory findings[\s\S]*2/, "the illustrative analysis must retain the approved bounded evidence summary");
assert.match(page, /KEY UNCERTAINTY[\s\S]*Protein B activity has not yet been directly measured/, "the example must keep its central uncertainty visible");
assert.match(page, /PRIORITY INVESTIGATION[\s\S]*Measure Protein B activity/, "the example must distinguish a suggested investigation from a result");

assert.match(page, /scientific research and research decision-support[\s\S]*not intended to provide medical diagnosis, patient-specific treatment recommendations, or autonomous clinical decision-making/, "the research-only boundary must remain explicit");
assert.equal((page.match(/<AvailabilityStatus \/>/g) || []).length, 2, "hero and closing must use the exact approved availability status");
assert.doesNotMatch(page, /<Link|StartWithVaeroexMenu|href=\{?["']\/(?:pricing|checkout|login|signup)|\bBuy\b|Purchase|Start Free Trial|Get Started|join waitlist|request access/i, "the under-development product must expose no conversion or purchase path");
assert.match(page, /href="#biological-sequence"[\s\S]*Explore Biological Intelligence/, "the secondary CTA may only move deeper into the product experience");

assert.match(systems, /Biological Intelligence[\s\S]*availability: "under_development"[\s\S]*route: "\/biological-intelligence"/, "the registry must bind exact status and route");
assert.match(systems, /environment: "biological_systems"/, "the product must have a distinct visual environment identity");
assert.match(portfolio, /PUBLIC_SYSTEMS\.map/, "the product family must continue to render from the shared registry");
assert.match(header, /PUBLIC_SYSTEMS\.map/, "desktop and mobile product navigation must derive Biological Intelligence from the shared registry");
assert.match(footer, /Biological Intelligence[\s\S]*\/biological-intelligence/, "the product footer must include Biological Intelligence");
assert.match(sitemap, /"\/biological-intelligence"/, "the canonical product route must be discoverable");

assert.match(backdrop, /dynamic\([\s\S]*BiologicalSpatialCanvas[\s\S]*ssr: false/, "Biological WebGL must load progressively on the client");
assert.match(page, /data-biological-journey/, "the page must own one continuous scroll-normalized biological journey");
for (const stage of [
  "genomic-scale",
  "sequence-variation",
  "gene-regulatory",
  "protein-scale",
  "cellular-scale",
  "system-scale",
  "intelligence-layer",
  "capability-field",
  "analysis-experience",
  "research-priorities",
  "evidence-rigor",
  "research-boundary",
  "evidence-close"
]) {
  assert.match(page, new RegExp(`data-bi-stage="${stage}"`), `the semantic journey must expose ${stage}`);
}

assert.match(canvas, /JOURNEY[\s\S]*progress: 0[\s\S]*progress: 1/, "camera choreography must use one explicit directed journey");
assert.match(canvas, /data-bi-stage="intelligence-layer"[\s\S]*intelligenceBounds\.bottom - bounds\.top/, "camera progress must align the biological scale journey to the final intelligence stage rather than the entire marketing page");
assert.match(canvas, /GenomicStage[\s\S]*RegulatoryLandscape[\s\S]*SequenceToProteinBridge[\s\S]*ProteinStage[\s\S]*CellularEnvironment[\s\S]*PathwaySystem[\s\S]*BiologicalScaleContinuity[\s\S]*IntelligenceConvergence/, "the world must continuously progress from genomic evidence through protein and cellular scales into intelligence");
assert.match(structures, /index \/ 10\.5[\s\S]*Math\.PI \* 2/, "the DNA helix must use recognizable B-DNA base-pairs-per-turn geometry");
assert.match(structures, /BASE_SEQUENCE[\s\S]*curveA[\s\S]*curveB[\s\S]*data-sugar-phosphate-backbone/, "the DNA must preserve two backbones and an explicit sugar-phosphate layer");
assert.match(structures, /NucleobaseModel[\s\S]*purine[\s\S]*data-nucleobase/, "close-range DNA must distinguish purine and pyrimidine nucleotide geometry");
assert.match(structures, /major\/minor grooves[\s\S]*angleB = angleA \+ Math\.PI \+ 0\.27/, "the DNA must retain asymmetric major/minor groove geometry");
assert.match(structures, /hydrogenBondCount[\s\S]*\? 3 : 2[\s\S]*dashSize/, "base pairs must distinguish two- and three-hydrogen-bond relationships");
assert.match(structures, /SelectedVariant[\s\S]*reveal[\s\S]*position\.x/, "a selected sequence variation must separate meaningfully during the journey");
assert.match(structures, /RegulatoryLandscape[\s\S]*regulatory[\s\S]*coding[\s\S]*variant[\s\S]*expression/, "the genomic scale must distinguish regulatory, coding, variant, and expression evidence");
assert.match(structures, /SequenceToProteinBridge[\s\S]*transcript[\s\S]*peptide[\s\S]*data-ribosome-complex/, "sequence evidence must transition spatially through transcript and translation into protein scale");
assert.match(structures, /data-scale-transition="sequence-to-protein"/, "the molecular bridge must explicitly preserve the sequence-to-protein scale transition");
assert.match(canvas, /ProteinTarget/, "the page must reuse the established scientifically recognizable protein renderer");
assert.match(protein, /AlphaHelix[\s\S]*BetaSheet[\s\S]*ProteinLoop[\s\S]*MolecularSurface/, "the reused protein renderer must retain recognizable secondary structures and surface context");
assert.match(structures, /CellularEnvironment[\s\S]*innerMembrane[\s\S]*chromatinCurves[\s\S]*MolecularCrowding[\s\S]*vesicles[\s\S]*DirectionalSignaling/, "the cellular scene must contain a bilayer-like boundary, nuclear chromatin, molecular crowding, vesicles, and directional signaling");
assert.match(structures, /MolecularCrowding[\s\S]*InstancedMesh[\s\S]*quality === "full" \? 76/, "cellular density must use quality-tiered instancing rather than unbounded particles");
for (const entity of ["gene", "regulatory", "protein", "cellular_process", "pathway", "phenotype", "finding"]) {
  assert.match(structures, new RegExp(`data-biological-entity=\\{node\\.kind\\}[\\s\\S]*${entity}|${entity}[\\s\\S]*data-biological-entity=\\{node\\.kind\\}`), `pathway systems must preserve the ${entity} biological entity type`);
}
for (const relationship of ["expression", "regulation", "interaction", "activation", "inhibition", "association", "experimental_support"]) {
  assert.match(structures, new RegExp(`relationship: "${relationship}"`), `pathway systems must preserve typed ${relationship} relationships`);
}
assert.match(structures, /BiologicalScaleContinuity[\s\S]*data-scale-continuity="cell-to-system-to-intelligence"/, "cellular, systems, and evidence scales must remain spatially connected");
assert.match(structures, /IntelligenceConvergence[\s\S]*data-intelligence-derived-from-evidence[\s\S]*supporting[\s\S]*conflicting[\s\S]*evidence-gap[\s\S]*next-investigation/, "intelligence must emerge from supporting, conflicting, and missing biological evidence");

assert.match(canvas, /frameloop="demand"[\s\S]*FrameScheduler/, "rendering must remain bounded and on demand");
assert.match(canvas, /document\.visibilityState !== "hidden"/, "ambient rendering must pause while the document is hidden");
assert.match(canvas, /ACESFilmicToneMapping[\s\S]*toneMappingExposure = 0\.9/, "the biological scene must use restrained filmic output");
assert.match(canvas, /shadows=\{quality === "full" \? "percentage" : false\}/, "supported percentage-closer shadows must remain limited to the full quality tier");
assert.match(canvas, /probeRenderedCanvas[\s\S]*SpatialResizeObserver/, "the WebGL surface must retain nonblank and initial-measurement safeguards");
assert.match(canvas, /useSpatialCapability\(\{ allowMobile: true \}\)/, "capable mobile devices must receive the constrained biological scene");
assert.match(capability, /allowMobile[\s\S]*mobile[\s\S]*quality: "constrained"|mobile[\s\S]*constrained/, "the shared capability system must preserve explicit mobile constraints");
assert.match(canvas, /ReducedBiologicalWorld/, "reduced motion must preserve a fixed biological composition");
assert.match(canvas, /ScientificFallback[\s\S]*data-biological-fallback/, "genuine WebGL failure must retain a biological visual fallback");
assert.doesNotMatch(canvas, /OrbitControls|FlyControls|MapControls|EffectComposer|UnrealBloomPass/, "the page must avoid free-flight controls and expensive postprocessing");
assert.doesNotMatch(styles, /\.spatialCanvas\s*\{[^}]*display:\s*none/s, "mobile must not disable the optimized biological canvas by default");
assert.match(styles, /@media \(max-width: 767px\), \(pointer: coarse\)[\s\S]*\.content[\s\S]*background: rgba\(2, 7, 10, 0\.88\)/, "mobile content must retain a readable composition over reduced WebGL");
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/, "CSS motion must respect reduced-motion preferences");

assert.doesNotMatch(publicBiologicalSources, /NVIDIA|BioNeMo|foundation model|model provider|GPU provider|Supabase|Google Document AI|OpenAI|Anthropic|Vertex AI|private orchestration|provider fallback/i, "public Biological Intelligence sources must not disclose vendors, models, or private architecture");
assert.doesNotMatch(publicBiologicalSources, /Revolutionize biology with AI|Unlock the power of AI|Next-generation AI|AI-powered innovation|Change the future of healthcare/i, "Biological Intelligence must avoid generic AI marketing language");
assert.doesNotMatch(page, /Drug Discovery Intelligence|\/drug-discovery-intelligence/, "Biological Intelligence must stand independently without a forced Drug Discovery workflow");
assert.match(packageJson, /"@react-three\/drei"[\s\S]*"@react-three\/fiber"[\s\S]*"three"/, "the biological rendering must reuse the installed Three.js stack");

process.stdout.write("Biological Intelligence public experience regressions passed.\n");

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");

const homepage = read("app/page.tsx");
const intelligenceSystems = read("app/intelligence-systems/page.tsx");
const operations = read("app/executive-intelligence/page.tsx");
const drugDiscovery = read("app/drug-discovery-intelligence/page.tsx");
const biologicalIntelligence = read("app/biological-intelligence/page.tsx");
const pricing = read("app/pricing/page.tsx");
const about = read("app/about/page.tsx");
const contact = read("app/contact/page.tsx");
const network = read("app/networking/page.tsx");
const careers = read("app/careers/page.tsx");
const help = read("app/help/page.tsx");
const futureDomains = read("app/future-domains/page.tsx");
const header = read("components/legal/PublicSiteHeader.tsx");
const footer = read("components/legal/PublicFooter.tsx");
const trust = read("components/legal/TrustCenterPage.tsx");
const trustContent = read("lib/legal/content.ts");
const seo = read("lib/seo/public-seo.ts");
const layout = read("app/layout.tsx");
const logo = read("components/brand/VaeroexLogo.tsx");
const globals = read("app/globals.css");
const plans = read("lib/billing/plans.ts");
const redirects = read("next.config.mjs");
const demo = read("app/demo/page.tsx");
const savedAnalysisList = read("components/reports/SavedAnalysisList.tsx");
const savedAnalysisPresentation = read("lib/reports/saved-analysis.ts");
const publicSystems = read("lib/marketing/public-systems.ts");
const systemsPortfolio = read("components/marketing/PublicSystemsPortfolio.tsx");
const publicSpatialBackdrop = read("components/marketing/spatial/PublicSpatialBackdrop.tsx");

assert.match(homepage, /VAEROEX/, "homepage must identify the parent company before the product");
assert.match(homepage, /vaeroex-public-hero-brand[\s\S]*<h1>VAEROEX<\/h1>[\s\S]*vaeroex-public-hero-category">Intelligence Systems/, "homepage hero must establish Vaeroex Intelligence Systems");
assert.match(homepage, /Transforming information into visibility, awareness, prediction, and action/, "homepage must communicate the approved Vaeroex mission");
assert.match(homepage, /Explore Executive Intelligence/, "homepage must use the approved flagship product action");
assert.match(homepage, /id="from-information-to-intelligence"[\s\S]*Visibility\. Awareness\. Prediction\. Action\./, "homepage must replace the duplicate product arrival with company-level intelligence content");
assert.doesNotMatch(homepage, /ExecutiveInstrument|vaeroex-public-chapter--product|label="System arrival"/, "homepage must not repeat the Executive Intelligence product presentation after the systems portfolio");
assert.match(publicSystems, /relationship: "A specialized Vaeroex intelligence environment"/, "the public system registry must preserve the approved parent-to-specialized-environment relationship");
for (const step of ["Information", "Visibility", "Awareness", "Prediction", "Action"]) {
  assert.match(homepage, new RegExp(step), `homepage How It Works must include ${step}`);
  assert.match(intelligenceSystems, new RegExp(step), `the Intelligence Systems page must include ${step}`);
}
assert.match(intelligenceSystems, /Information is everywhere\. Intelligence is not\./, "the Intelligence Systems page must explain the authoritative company thesis");
assert.match(intelligenceSystems, /not a diagram of Vaeroex&[a-z]+;s private technical architecture/, "the public intelligence journey must remain an abstract conceptual model");
assert.match(homepage, /PublicSpatialBackdrop/, "homepage must mount the public spatial environment separately from readable DOM content");
assert.doesNotMatch(homepage, /CapabilityIntelligenceDemo|IntelligenceFlowDemo|IntelligenceLoopShowcase|SignalProductionDemo/, "homepage must not restore overlapping feature catalogs and lifecycle demos");
assert.match(publicSystems, /PUBLIC_SYSTEMS[\s\S]*Executive Intelligence[\s\S]*availability: "available"/, "the public product architecture must use an extensible registry with the approved available system");
assert.equal((publicSystems.match(/\n    availability: "available"/g) || []).length, 1, "the registry must keep Executive Intelligence as the only currently available system");
assert.equal((publicSystems.match(/\n    availability: "under_development"/g) || []).length, 2, "the registry must contain exactly two approved under-development systems");
assert.equal((publicSystems.match(/\n      behavior: "status"/g) || []).length, 2, "each under-development system must use non-commercial status behavior");
assert.equal((publicSystems.match(/\n      checkoutRoute: null/g) || []).length, 2, "each under-development system must explicitly have no checkout route");
assert.match(publicSystems, /Drug Discovery Intelligence[\s\S]*under_development[\s\S]*\/drug-discovery-intelligence/, "the approved Drug Discovery system must use its exact status and product route");
assert.match(publicSystems, /Biological Intelligence[\s\S]*under_development[\s\S]*\/biological-intelligence/, "the approved Biological Intelligence system must use its exact status and product route");
assert.match(systemsPortfolio, /PUBLIC_SYSTEMS\.map/, "the homepage product family must render from the shared registry");
assert.match(publicSpatialBackdrop, /dynamic\(\(\) => import\("@\/components\/marketing\/spatial\/PublicSpatialCanvas"\)[\s\S]*ssr: false/, "the public canvas must stay client-only while DOM marketing content remains server-rendered");

assert.equal((operations.match(/<OperationsIntelligenceEngineDemo/g) || []).length, 1, "Executive Intelligence must render one interactive demo");
assert.doesNotMatch(operations, /OperationsIntelligenceProductExperience/, "Executive Intelligence must not restore the overlapping second product demo");
assert.match(operations, /flagship Executive Intelligence platform/, "Executive Intelligence must identify the product category");
for (const capability of ["Business Health", "Intelligence", "Explain Finding", "Evidence", "Saved Analyses"]) {
  assert.match(operations, new RegExp(capability), `Executive Intelligence must accurately include ${capability}`);
}
assert.doesNotMatch(operations, /Generated Outputs|Optional Outputs|Files & Imports|generic forecast/i, "Executive Intelligence must not expose retired product language");

assert.match(plans, /VAEROEX_PLAN_PRICE_LABEL = "\$500\/month"/, "public subscription price must remain $500/month");
assert.match(pricing, /VAEROEX_PLAN_PRICE_LABEL/, "pricing page must use the authoritative plan price constant");
assert.match(pricing, /PUBLIC_SYSTEMS\.map[\s\S]*data-pricing-system/, "pricing must render one primary card per registered intelligence offering");
assert.equal((pricing.match(/<StartWithVaeroexMenu/g) || []).length, 1, "pricing must expose one purchase action for Executive Intelligence");
assert.match(pricing, /What&apos;s included[\s\S]*executiveInclusions\.map/, "the Executive card must contain its concise included capabilities");
assert.doesNotMatch(pricing, /setupSteps|How setup works|PublicCtaBand|Executive Intelligence by Vaeroex/, "pricing must not repeat a lower Executive capabilities or purchase section");
assert.doesNotMatch(pricing, /10 Users Included|1 Workspace Included/, "pricing must not return to seat-limit positioning");

for (const label of ["Home", "Intelligence", "Intelligence Areas", "Pricing", "Trust", "Company"]) {
  assert.match(header, new RegExp(label), `public navigation must include ${label}`);
}
for (const label of ["Executive Intelligence", "Drug Discovery Intelligence", "Biological Intelligence"]) {
  assert.match(publicSystems, new RegExp(label), `the registry driving public navigation must include ${label}`);
}
assert.match(header, /PUBLIC_SYSTEMS\.map/, "public product navigation must be derived from the shared registry");
assert.match(header, /Open navigation menu/, "public header must provide one concise mobile menu control");
assert.match(header, /\/about|\/contact|\/networking|\/careers/, "Company navigation must retain the authoritative secondary pages");

assert.match(footer, /VAEROEX_COMPANY_ADDRESS_LINES/, "footer must retain the complete official business address");
assert.match(footer, /Vaeroex Intelligence Systems transforms/, "footer must use the authoritative company positioning");
assert.match(footer, /Vaeroex LLC/, "footer must preserve the legal company name");

assert.match(about, /Information is everywhere\. Understanding is not\./, "About must explain the information-versus-intelligence problem");
assert.match(about, /The world doesn&[a-z]+;t have an information problem[\s\S]*That&[a-z]+;s what Vaeroex is being built to solve/, "About must preserve the approved founder philosophy");
assert.doesNotMatch(about, /consulting agency|operations consulting/, "About must not restore consulting-era positioning");
assert.match(careers, /not currently listing open positions/i, "Careers must honestly state that no positions are currently listed");
assert.match(contact, /Contact Vaeroex about Intelligence Systems/, "Contact must use the company identity");
assert.match(network, /evidence-backed intelligence/, "Network must describe the broader company direction rather than a consulting service");

for (const category of ["Getting started", "Account and workspace", "Sources and evidence", "Business Health", "Business Memory", "Billing", "Privacy and trust", "Contact support"]) {
  assert.match(help, new RegExp(category), `Help must include the ${category} category`);
}
for (const category of ["Intelligence and Explain Finding", "Saved Analyses"]) {
  assert.match(help, new RegExp(category), `Help must include the ${category} category`);
}

for (const boundary of ["Infrastructure & Security", "does not currently claim malware scanning", "human review"]) {
  assert.match(trust, new RegExp(boundary, "i"), `Trust must preserve the boundary: ${boundary}`);
}
for (const boundary of ["Workspace Isolation", "Infrastructure & Security", "Secure Data Handling", "Evidence-Backed Intelligence", "Deterministic Business Intelligence", "Explainable Executive Reasoning", "Leadership Control"]) {
  assert.match(trustContent, new RegExp(boundary), `Trust content must include ${boundary}`);
}
assert.match(trustContent, /infrastructure providers[\s\S]+SOC 2 Type II and ISO 27001 certifications and attestations/, "Trust content must attribute SOC 2 Type II and ISO 27001 to infrastructure providers");
assert.doesNotMatch([trust, trustContent].join("\n"), /does not currently claim HIPAA compliance|GDPR certification|GDPR certified|enterprise compliance certification for Vaeroex itself/i, "Trust content must not restore the removed negative compliance disclaimer");

assert.match(seo, /name: "Vaeroex"/, "public SEO must use Vaeroex as the organization identity");
assert.match(layout, /Vaeroex \| Intelligence Systems/, "global metadata must retain the authoritative company-level title");
assert.match(logo, /\/brand\/vaeroex-logo-white-wordmark\.png/, "shared logo component must use the canonical white-wordmark PNG");
assert.match(logo, /variant === "symbol" \? "\/icon-192\.png"/, "compact logo variants must preserve the approved symbol-only asset");
assert.match(logo, /alt="Vaeroex"/, "shared logo must preserve concise accessible alt text");
assert.equal(fs.existsSync(path.join(root, "public/brand/vaeroex-logo-white-wordmark.png")), true, "canonical Vaeroex white-wordmark logo must exist");
assert.equal(sha256("public/brand/vaeroex-logo-white-wordmark.png"), "03f57e14ec55969a00d67face54d72d7774c3a0f1d0b84c8cd11fc79f51a13fa", "canonical Vaeroex logo must remain byte-for-byte identical to the supplied asset");
assert.equal(fs.existsSync(path.join(root, "public/brand/vaeroex-logo.png")), false, "legacy blue-EX logo asset must be removed");
assert.match(futureDomains, /permanentRedirect\("\/about"\)/, "legacy future-domain categories must redirect to the broad company story");
assert.doesNotMatch(futureDomains, /Governance|Industrial Intelligence|Infrastructure Intelligence|Security Intelligence|Organizational Intelligence/, "unreleased product categories must not remain public");
assert.match(globals, /prefers-reduced-motion: reduce/, "motion must honor reduced-motion preferences");
assert.match(redirects, /source: "\/network"[^\n]+destination: "\/networking"/, "legacy /network route must resolve to the authoritative Network page");
assert.match(redirects, /source: "\/operations-intelligence"[^\n]+destination: "\/executive-intelligence"[^\n]+statusCode: 301/, "the previous product URL must permanently redirect to Executive Intelligence");

const publicSources = [homepage, intelligenceSystems, operations, drugDiscovery, biologicalIntelligence, pricing, about, contact, network, careers, help, demo, header, footer, trust, trustContent, seo, plans, savedAnalysisList, savedAnalysisPresentation].join("\n");
assert.doesNotMatch(publicSources, /Hourly Consulting|Full Support Retainer|operations consulting agency/i, "current public experience must not expose legacy consulting offers");
assert.doesNotMatch(publicSources, /Vaeroex Governance|Generated Outputs|Optional Outputs|workspace reset|automatic permanent purge/i, "current public experience must not expose unreleased or retired product concepts");
assert.doesNotMatch(publicSources, /Executive Brief|Ask Vaeroex|Business Signals?|Notifications?|KPI Alerts?|Board Report|Improvement Plan|Investigation Summary/i, "current customer messaging must not expose retired features");

const customerMessaging = [homepage, intelligenceSystems, operations, pricing, about, demo, footer, trust, trustContent, seo].join("\n");
assert.doesNotMatch(customerMessaging, /GPT-5|OpenAI model|\bRAG\b|vector search|embeddings?|pgvector|prompt engineering|evidence retrieval|Supabase Row Level Security|private workspace file bucket/i, "customer messaging must not expose proprietary implementation details");
assert.doesNotMatch(homepage, /\b(?:Luna|Terra|Sol)\b|IntelligenceSnapshotV1|Business Health Formula V2|model routing|provider fallback|retrieval|reranking|validation gate/i, "the fictional public environment must not expose internal architecture");

process.stdout.write("Public experience regressions passed.\n");

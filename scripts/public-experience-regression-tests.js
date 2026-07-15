const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const homepage = read("app/page.tsx");
const operations = read("app/operations-intelligence/page.tsx");
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

assert.match(homepage, /Vaeroex Intelligence Systems/, "homepage must identify the parent company");
assert.match(homepage, /Systems that turn information into intelligence/, "homepage must open with the company-level intelligence systems position");
assert.match(homepage, /Flagship product/, "homepage must identify Operations Intelligence as the current flagship product");
assert.match(homepage, /Operations Intelligence by Vaeroex/, "homepage must separate the current product from the company identity");
assert.match(homepage, /MarketingDashboardPreview/, "homepage must retain one believable illustrative product preview");
assert.doesNotMatch(homepage, /CapabilityIntelligenceDemo|IntelligenceFlowDemo|IntelligenceLoopShowcase|SignalProductionDemo/, "homepage must not restore overlapping feature catalogs and lifecycle demos");

assert.equal((operations.match(/<OperationsIntelligenceEngineDemo/g) || []).length, 1, "Operations Intelligence must render one interactive demo");
assert.doesNotMatch(operations, /OperationsIntelligenceProductExperience/, "Operations Intelligence must not restore the overlapping second product demo");
for (const capability of ["Needs Attention", "Positive Signal", "Intelligence Readiness", "What Changed", "Executive Brief", "Board Report", "Improvement Plan", "Investigation Summary", "Multi-worksheet workbooks", "Profit Leakage foundation"]) {
  assert.match(operations, new RegExp(capability), `Operations Intelligence must accurately include ${capability}`);
}
assert.doesNotMatch(operations, /Generated Outputs|Optional Outputs|Files & Imports|generic forecast/i, "Operations Intelligence must not expose retired product language");

assert.match(plans, /VAEROEX_PLAN_PRICE_LABEL = "\$500\/month"/, "public subscription price must remain $500/month");
assert.match(pricing, /VAEROEX_PLAN_PRICE_LABEL/, "pricing page must use the authoritative plan price constant");
assert.doesNotMatch(pricing, /10 Users Included|1 Workspace Included/, "pricing must not return to seat-limit positioning");

for (const label of ["Home", "Operations Intelligence", "Pricing", "Trust", "Company"]) {
  assert.match(header, new RegExp(label), `public navigation must include ${label}`);
}
assert.match(header, /Open navigation menu/, "public header must provide one concise mobile menu control");
assert.match(header, /\/about|\/contact|\/networking|\/careers/, "Company navigation must retain the authoritative secondary pages");

assert.match(footer, /VAEROEX_COMPANY_ADDRESS_LINES/, "footer must retain the complete official business address");
assert.match(footer, /Vaeroex Intelligence Systems/, "footer must use company positioning");
assert.match(footer, /Vaeroex LLC/, "footer must preserve the legal company name");

assert.match(about, /Vaeroex Intelligence Systems/, "About must remain focused on the company");
assert.match(about, /Operations Intelligence is the flagship Vaeroex product available today/, "About must identify the current product without naming unreleased products");
assert.doesNotMatch(about, /consulting agency|operations consulting/, "About must not restore consulting-era positioning");
assert.match(careers, /not currently listing open positions/i, "Careers must honestly state that no positions are currently listed");
assert.match(contact, /Vaeroex Intelligence Systems/, "Contact must use the company identity");
assert.match(network, /evidence-backed intelligence/, "Network must describe the broader company direction rather than a consulting service");

for (const category of ["Getting started", "Account and workspace", "Sources and evidence", "Business Health", "Business Memory", "Billing", "Privacy and trust", "Contact support"]) {
  assert.match(help, new RegExp(category), `Help must include the ${category} category`);
}

for (const boundary of ["does not currently claim HIPAA compliance", "does not currently claim malware scanning", "human review"]) {
  assert.match(trust, new RegExp(boundary, "i"), `Trust must preserve the boundary: ${boundary}`);
}
for (const boundary of ["Evidence Lineage", "Original Evidence and Derived Analysis", "Archive, Restore, and Soft-Delete", "Business Memory Retrieval"]) {
  assert.match(trustContent, new RegExp(boundary), `Trust content must include ${boundary}`);
}

assert.match(seo, /Vaeroex Intelligence Systems/, "public SEO must use the company identity");
assert.match(layout, /Evidence-Backed Intelligence Software/, "global public metadata must use the company-level title");
assert.match(logo, /\/brand\/vaeroex-logo\.png/, "shared logo component must use the canonical PNG");
assert.equal(fs.existsSync(path.join(root, "public/brand/vaeroex-logo.png")), true, "canonical Vaeroex logo must exist");
assert.match(futureDomains, /permanentRedirect\("\/about"\)/, "legacy future-domain categories must redirect to the broad company story");
assert.doesNotMatch(futureDomains, /Governance|Industrial Intelligence|Infrastructure Intelligence|Security Intelligence|Organizational Intelligence/, "unreleased product categories must not remain public");
assert.match(globals, /prefers-reduced-motion: reduce/, "motion must honor reduced-motion preferences");
assert.match(redirects, /source: "\/network"[^\n]+destination: "\/networking"/, "legacy /network route must resolve to the authoritative Network page");

const publicSources = [homepage, operations, pricing, about, contact, network, careers, help, header, footer, trust, seo].join("\n");
assert.doesNotMatch(publicSources, /Hourly Consulting|Full Support Retainer|operations consulting agency/i, "current public experience must not expose legacy consulting offers");
assert.doesNotMatch(publicSources, /Vaeroex Governance|Generated Outputs|Optional Outputs|workspace reset|automatic permanent purge/i, "current public experience must not expose unreleased or retired product concepts");

process.stdout.write("Public experience regressions passed.\n");

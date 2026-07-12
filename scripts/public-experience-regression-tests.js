const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const homepage = read("app/page.tsx");
const operations = read("app/operations-intelligence/page.tsx");
const pricing = read("app/pricing/page.tsx");
const about = read("app/about/page.tsx");
const careers = read("app/careers/page.tsx");
const help = read("app/help/page.tsx");
const header = read("components/legal/PublicSiteHeader.tsx");
const footer = read("components/legal/PublicFooter.tsx");
const trust = read("components/legal/TrustCenterPage.tsx");
const globals = read("app/globals.css");
const plans = read("lib/billing/plans.ts");
const redirects = read("next.config.mjs");

assert.match(homepage, /See what is happening—and what leadership should review next/, "homepage must open with a direct Operations Intelligence outcome");
assert.match(homepage, /MarketingDashboardPreview/, "homepage must retain one believable illustrative product preview");
assert.doesNotMatch(homepage, /CapabilityIntelligenceDemo|IntelligenceFlowDemo|IntelligenceLoopShowcase|SignalProductionDemo/, "homepage must not restore overlapping feature catalogs and lifecycle demos");

assert.equal((operations.match(/<OperationsIntelligenceEngineDemo/g) || []).length, 1, "Operations Intelligence must render one interactive demo");
assert.doesNotMatch(operations, /OperationsIntelligenceProductExperience/, "Operations Intelligence must not restore the overlapping second product demo");

assert.match(plans, /VAEROEX_PLAN_PRICE_LABEL = "\$500\/month"/, "public subscription price must remain $500/month");
assert.match(pricing, /VAEROEX_PLAN_PRICE_LABEL/, "pricing page must use the authoritative plan price constant");
assert.doesNotMatch(pricing, /10 Users Included|1 Workspace Included/, "pricing must not return to seat-limit positioning");

for (const label of ["Platform", "Operations Intelligence", "Pricing", "Trust", "Company"]) {
  assert.match(header, new RegExp(label), `public navigation must include ${label}`);
}
assert.match(header, /Open navigation menu/, "public header must provide one concise mobile menu control");
assert.match(header, /\/about|\/contact|\/networking|\/careers/, "Company navigation must retain the authoritative secondary pages");

assert.match(footer, /VAEROEX_COMPANY_ADDRESS_LINES/, "footer must retain the complete official business address");
assert.match(footer, /Operations Intelligence/, "footer must retain current product positioning");

assert.match(about, /intelligence company/, "About must remain focused on Vaeroex as an intelligence company");
assert.doesNotMatch(about, /consulting agency|operations consulting/, "About must not restore consulting-era positioning");
assert.match(careers, /not currently listing open positions/i, "Careers must honestly state that no positions are currently listed");

for (const category of ["Getting started", "Account and workspace", "Sources and evidence", "Business Health", "Business Memory", "Billing", "Privacy and trust", "Contact support"]) {
  assert.match(help, new RegExp(category), `Help must include the ${category} category`);
}

for (const boundary of ["does not currently claim HIPAA compliance", "does not currently claim malware scanning", "human review"]) {
  assert.match(trust, new RegExp(boundary, "i"), `Trust must preserve the boundary: ${boundary}`);
}
assert.match(globals, /prefers-reduced-motion: reduce/, "motion must honor reduced-motion preferences");
assert.match(redirects, /source: "\/network"[^\n]+destination: "\/networking"/, "legacy /network route must resolve to the authoritative Network page");

const publicSources = [homepage, operations, pricing, about, careers, help, header, footer, trust].join("\n");
assert.doesNotMatch(publicSources, /Hourly Consulting|Full Support Retainer|operations consulting agency/i, "current public experience must not expose legacy consulting offers");

process.stdout.write("Public experience regressions passed.\n");

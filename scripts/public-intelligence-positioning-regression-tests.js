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

const { PUBLIC_SYSTEMS } = require("../lib/marketing/public-systems.ts");
const homepage = read("app/page.tsx");
const intelligencePage = read("app/intelligence-systems/page.tsx");
const about = read("app/about/page.tsx");
const pricing = read("app/pricing/page.tsx");
const header = read("components/legal/PublicSiteHeader.tsx");
const footer = read("components/legal/PublicFooter.tsx");
const layout = read("app/layout.tsx");
const seo = read("lib/seo/public-seo.ts");

assert.equal(PUBLIC_SYSTEMS.length, 3, "only the three approved public intelligence areas may be registered");
const available = PUBLIC_SYSTEMS.filter((system) => system.availability === "available");
const development = PUBLIC_SYSTEMS.filter((system) => system.availability === "under_development");
assert.deepEqual(available.map((system) => system.id), ["executive-intelligence"], "Executive Intelligence must remain the only available area");
assert.deepEqual(development.map((system) => system.id), ["drug-discovery-intelligence", "biological-intelligence"], "only the two approved research areas may be in development");

assert.equal(available[0].pricing.behavior, "checkout", "the available Executive environment must retain explicit checkout behavior");
assert.equal(available[0].pricing.checkoutRoute, "/checkout/legal", "Executive Intelligence must route customers through pre-checkout legal acceptance");
for (const system of development) {
  assert.equal(system.statusLabel, "In Development", `${system.name} must disclose its exact development status`);
  assert.equal(system.pricing.display, "Pricing not yet announced", `${system.name} must not invent pricing`);
  assert.equal(system.pricing.ctaLabel, "Under Development", `${system.name} must use a status presentation instead of a purchase CTA`);
  assert.equal(system.pricing.behavior, "status", `${system.name} must fail closed commercially`);
  assert.equal(system.pricing.checkoutRoute, null, `${system.name} must have no checkout route`);
}

assert.match(homepage, /<h1>VAEROEX<\/h1>[\s\S]*Intelligence Systems[\s\S]*Transforming information into visibility, awareness, prediction, and action/, "the homepage hierarchy must establish Vaeroex Intelligence Systems");
assert.match(homepage, /Information is everywhere\. Intelligence is not\./, "the homepage must state the company thesis");
assert.match(intelligencePage, /Vaeroex Intelligence Systems transforms/, "the dedicated explanation must define Vaeroex as the overarching Intelligence Systems identity");
for (const stage of ["raw-complexity", "visibility", "awareness", "prediction", "action", "intelligence-reveal", "specialization", "executive-destination", "drug-discovery-destination", "biological-destination", "vaeroex-closing"]) {
  assert.match(intelligencePage, new RegExp(`data-is-stage="${stage}"`), `the Intelligence Systems page must preserve the ${stage} stage`);
}
assert.match(intelligencePage, /specialized intelligence environments for distinct domains/, "the dedicated explanation must establish specialized domains beneath Vaeroex");
assert.match(intelligencePage, /not a diagram of Vaeroex&[a-z]+;s private technical architecture/, "the public journey must remain an abstract metaphor");
assert.match(intelligencePage, /EXECUTIVE_INTELLIGENCE_SYSTEM[\s\S]*DRUG_DISCOVERY_INTELLIGENCE_SYSTEM[\s\S]*BIOLOGICAL_INTELLIGENCE_SYSTEM/, "the page must source every specialized destination from the authoritative public registry");
assert.equal((intelligencePage.match(/<DevelopmentStatus \/>/g) || []).length, 2, "the two development destinations must share one non-commercial status treatment");
assert.doesNotMatch(intelligencePage, /StartWithVaeroexMenu|api\/stripe\/checkout|checkoutRoute|pricing\.ctaLabel/, "the conceptual Intelligence Systems journey must not create a commerce path for development systems");

assert.match(about, /The world doesn&[a-z]+;t have an information problem\. It has an intelligence problem\./, "About must preserve the approved founder philosophy");
assert.match(about, /Isaac Vizcarra[\s\S]*Founder &amp; CEO/, "About must use the approved founder attribution");
assert.match(pricing, /PUBLIC_SYSTEMS\.map/, "pricing must render availability from the shared registry");
assert.match(pricing, /system\.availability === "available"/, "pricing must branch explicitly on availability before rendering an action");
assert.match(pricing, /aria-disabled="true"[\s\S]*system\.pricing\.ctaLabel/, "in-development pricing actions must be non-interactive status presentation");
assert.equal((pricing.match(/<StartWithVaeroexMenu/g) || []).length, 1, "pricing may expose exactly one checkout action for Executive Intelligence");
assert.equal((pricing.match(/data-pricing-system=/g) || []).length, 1, "pricing must derive all three primary cards from the bounded registry map");
assert.doesNotMatch(pricing, /setupSteps|How setup works|PublicCtaBand|Executive Intelligence by Vaeroex/, "pricing must not repeat Executive capabilities below the three primary cards");
assert.match(homepage, /id="from-information-to-intelligence"[\s\S]*Visibility\. Awareness\. Prediction\. Action\./, "the late journey must use company-level intelligence content");
assert.doesNotMatch(homepage, /ExecutiveInstrument|label="System arrival"/, "the homepage must not repeat Executive Intelligence after the portfolio");

assert.match(header, /PUBLIC_SYSTEMS\.map/, "global product navigation must render from the shared registry");
assert.match(header, /Start Executive Intelligence/, "the global commerce action must identify the only purchasable intelligence area");
assert.match(footer, /Vaeroex Intelligence Systems transforms/, "the footer must retain the overarching Vaeroex identity");
assert.match(layout, /Vaeroex \| Intelligence Systems/, "global metadata must use the approved hierarchy");
assert.doesNotMatch([homepage, intelligencePage, footer, layout].join("\n"), /Vaeroex is an Intelligence System\b|>Intelligence System</, "umbrella positioning must not regress to the singular category label");
assert.match(seo, /name: "Vaeroex"/, "structured organization identity must remain Vaeroex");

const approvedMembershipStart = homepage.indexOf("function NvidiaInceptionSection");
const approvedMembershipEnd = homepage.indexOf("export default function HomePage");
assert.ok(approvedMembershipStart >= 0 && approvedMembershipEnd > approvedMembershipStart, "the approved NVIDIA Inception membership block must remain bounded");
const approvedMembership = homepage.slice(approvedMembershipStart, approvedMembershipEnd);
assert.match(approvedMembership, /NVIDIA Inception Program[\s\S]*member of the NVIDIA Inception program/, "the bounded public NVIDIA reference must remain membership-only");
const homepageOutsideMembershipBlock = homepage.slice(0, approvedMembershipStart) + homepage.slice(approvedMembershipEnd);
assert.equal((homepageOutsideMembershipBlock.match(/NvidiaInceptionSection/g) || []).length, 1, "the approved membership block may be mounted exactly once");
const homepageWithoutApprovedMembership = homepageOutsideMembershipBlock.replace("NvidiaInceptionSection", "");
const companyMessaging = [homepageWithoutApprovedMembership, intelligencePage, about, pricing, footer, layout, seo].join("\n");
assert.doesNotMatch(companyMessaging, /Vaeroex is (?:a company that develops|a developer of|a portfolio of)/i, "Vaeroex must not be positioned as a holding company or generic developer");
assert.doesNotMatch(companyMessaging, /NVIDIA|BioNeMo|OpenAI|Anthropic|Vertex AI|Supabase|provider fallback|model routing|private orchestration/i, "company-level public copy must not expose private implementation architecture");

process.stdout.write("Public intelligence positioning regressions passed.\n");

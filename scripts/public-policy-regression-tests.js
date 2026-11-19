const crypto = require("node:crypto");
/* Policy and product contracts retained from the superseded public art-direction suites. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const pages = [
  "app/page.tsx",
  "app/intelligence-systems/page.tsx",
  "app/executive-intelligence/page.tsx",
  "app/drug-discovery-intelligence/page.tsx",
  "app/biological-intelligence/page.tsx",
  "app/pricing/page.tsx",
  "app/about/page.tsx",
  "app/contact/page.tsx",
  "app/networking/page.tsx",
  "app/careers/page.tsx",
  "app/help/page.tsx",
  "app/demo/page.tsx",
];
const homepage = read("app/page.tsx");
const footer = read("components/legal/PublicFooter.tsx");
const trust = read("components/legal/TrustCenterPage.tsx");
const legal = read("lib/legal/content.ts");
const redirects = read("next.config.mjs");
const sitemap = read("app/sitemap.ts");
const layout = read("app/layout.tsx");
const seo = read("lib/seo/public-seo.ts");
const logo = read("components/brand/VaeroexLogo.tsx");
const navigation =
  read("components/legal/PublicSiteHeader.tsx") +
  read("components/marketing/PublicNavigation.tsx");

assert.match(
  footer,
  /VAEROEX_COMPANY_ADDRESS_LINES/,
  "Public company address must remain complete and authoritative",
);
assert.match(
  footer,
  /Vaeroex LLC/,
  "Footer must preserve the legal company identity",
);
assert.match(seo, /name: "Vaeroex"/);
assert.match(seo, /legalName: "Vaeroex LLC"/);
assert.match(seo, /Drug Discovery Intelligence/);
assert.doesNotMatch(seo, /Executive Intelligence|website development|custom software/i);
for (const file of ["app/terms/page.tsx", "app/refund-policy/page.tsx", "app/subscription-billing-terms/page.tsx"]) {
  assert.doesNotMatch(read(file), /Executive Intelligence|website project|commissioned project/i, "Policy metadata should describe the policy without promoting products");
}
assert.match(
  read("app/careers/page.tsx"),
  /no open positions/i,
  "Careers must not fabricate hiring availability",
);
assert.doesNotMatch(
  read("app/about/page.tsx"),
  /consulting agency|operations consulting/,
);
const publicHelp = read("app/help/page.tsx");
for (const topic of ["Account and workspace questions", "Billing questions", "Contact support"]) {
  assert.ok(publicHelp.includes(topic), `Customer help must retain ${topic}`);
}
assert.doesNotMatch(publicHelp, /Executive Intelligence|href="\/pricing"|website projects|commissioned systems/i);
const workspaceHelp = read("app/app/help/page.tsx");
assert.match(workspaceHelp, /@\/lib\/help\/content/);
assert.match(workspaceHelp, /href="\/app\/support"/);
const privateArticles = read("lib/help/content.ts");
for (const topic of ["Getting Started", "Business Health", "Business Memory", "Explain Finding", "Saved Analyses"]) {
  assert.ok(privateArticles.includes(topic), `Signed-in customer guides must retain ${topic}`);
}
for (const boundary of [
  "Infrastructure & Security",
  "does not currently claim malware scanning",
  "human review",
]) {
  assert.match(
    trust,
    new RegExp(boundary, "i"),
    `Trust must preserve: ${boundary}`,
  );
}
for (const control of [
  "Workspace Isolation",
  "Infrastructure & Security",
  "Secure Data Handling",
  "Evidence-Backed Intelligence",
  "Deterministic Business Intelligence",
  "Explainable Executive Reasoning",
  "Leadership Control",
]) {
  assert.ok(legal.includes(control), `Trust policy must preserve ${control}`);
}
assert.match(
  legal,
  /infrastructure providers[\s\S]+SOC 2 Type II and ISO 27001 certifications and attestations/,
  "Infrastructure attestations must not become claims of Vaeroex certification",
);
assert.doesNotMatch(
  trust + legal,
  /GDPR certification|GDPR certified|enterprise compliance certification for Vaeroex itself/i,
);

const approvedBrand = [
  ["wordmark", "VAEROEX-Wordmark-Miami-Blue.png", "ac99d24276efdb9da173aa0198ba507cd94e8c6067b30aaeb238e54883422e9b", "ff166e64289b855ced471860a756fc6a55b9d8acd0b87a53e27cc315ca6da1d6"],
  ["symbol", "VX-Miami-Blue.png", "d926e88e89b25438b0412d909919dc423a374d83727a41445325d1657d994901", "f77d082e029899f044e95ea4e665edea3f5e299be4ac7453b994e400c3dcd109"],
  ["stacked", "Vaeroex-Combined-Miami-Blue.png", "61d87317513de5f4d048182d24ea4eb6ae3646e69dd9259a443886cce18c79f4", "375cf48a901b98209e906b528163059eccde9b69dc7a63c088ea2cffc390c84a"],
];
for (const [variant, source, sourceDigest, displayDigest] of approvedBrand) {
  const original = fs.readFileSync(path.join(root, "assets/brand/originals", source));
  assert.equal(crypto.createHash("sha256").update(original).digest("hex"), sourceDigest);
  const asset = `/brand/official/${variant}.png`;
  assert.ok(logo.includes(asset), `the shared identity must use the official ${variant}`);
  const png = fs.readFileSync(path.join(root, "public", asset));
  assert.equal(crypto.createHash("sha256").update(png).digest("hex"), displayDigest);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png[25], 6, `official ${variant} must retain its transparent RGBA channel`);
}
assert.equal(
  fs.existsSync(path.join(root, "public/brand/vaeroex-logo.png")),
  false,
);
assert.equal(
  fs.existsSync(path.join(root, "app/operations-intelligence/page.tsx")),
  false,
);
assert.match(
  read("app/future-domains/page.tsx"),
  /permanentRedirect\("\/about"\)/,
);
assert.match(redirects, /source: "\/network"[^\n]+destination: "\/networking"/);
assert.match(
  redirects,
  /source: "\/operations-intelligence"[^\n]+destination: "\/executive-intelligence"[^\n]+statusCode: 301/,
);
for (const route of [
  "/drug-discovery-intelligence",
  "/contact",
])
  assert.ok(sitemap.includes(`"${route}"`));
for (const route of ["/executive-intelligence", "/pricing", "/release-notes", "/help"]) {
  assert.ok(!sitemap.includes(`"${route}"`), `Unlisted customer marketing or help route in sitemap: ${route}`);
  assert.match(read(`app${route}/page.tsx`), /robots: utilityRobots/);
}
assert.match(seo, /utilityRobots = \{ index: false, follow: false \}/);
for (const retired of ["/operations-intelligence", "/intelligence-systems", "/website-development", "/custom-business-systems"]) {
  assert.ok(!sitemap.includes(`"${retired}"`), `Retired sales route in sitemap: ${retired}`);
}
assert.doesNotMatch(sitemap, /biological-intelligence/);
assert.match(footer, /drug-discovery-intelligence/);
assert.doesNotMatch(
  layout + navigation,
  /IntelligenceUniverseProvider|IntelligenceUniverseShell|UniverseNavigationLink|fast_travel|destination gravity/,
  "Conventional navigation must not be replaced by spatial travel",
);
assert.doesNotMatch(
  navigation,
  /preventDefault|router\.push|setTimeout/,
  "Navigation must use normal links without artificial travel delays",
);

// Identify the bounded membership section semantically, not by class or position.
const homeAst = ts.createSourceFile(
  "app/page.tsx",
  homepage,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const membershipNodes = [];
function visit(node) {
  if (
    ts.isJsxElement(node) &&
    node.openingElement.tagName.getText(homeAst) === "section"
  ) {
    const label = node.openingElement.attributes.properties.find(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(homeAst) === "aria-label",
    );
    if (
      label &&
      label.initializer &&
      /NVIDIA Inception membership/i.test(label.initializer.getText(homeAst))
    )
      membershipNodes.push(node);
  }
  ts.forEachChild(node, visit);
}
visit(homeAst);
assert.equal(
  membershipNodes.length,
  1,
  "The approved NVIDIA membership must appear once with a clear section label",
);
const membership = membershipNodes[0].getText(homeAst);
assert.match(membership, /member of the[\s\S]*NVIDIA Inception program/);
assert.match(membership, /trademarks/);
const companyHome = homepage.replace(membership, "");
const publicSources = [
  companyHome,
  ...pages.slice(1).map(read),
  footer,
  trust,
  legal,
  seo,
  read("lib/marketing/public-systems.ts"),
].join("\n");
assert.doesNotMatch(
  publicSources,
  /Hourly Consulting|Full Support Retainer|operations consulting agency|Vaeroex Governance|Generated Outputs|Optional Outputs|workspace reset|automatic permanent purge/i,
  "Retired offers and unreleased product claims must stay absent",
);
assert.doesNotMatch(
  publicSources,
  /Executive Brief|Ask Vaeroex|Business Signals?|Notifications?|KPI Alerts?|Board Report|Improvement Plan|Investigation Summary/i,
  "Retired customer-facing features must not reappear",
);
assert.doesNotMatch(
  publicSources,
  /GPT-5|OpenAI model|\bRAG\b|vector search|embeddings?|pgvector|prompt engineering|evidence retrieval|Supabase Row Level Security|private workspace file bucket|IntelligenceSnapshotV1|Business Health Formula V2|model routing|provider fallback|reranking/i,
  "Public copy must not expose private platform architecture",
);
const companySources = [
  companyHome,
  read("app/intelligence-systems/page.tsx"),
  read("app/about/page.tsx"),
  read("app/pricing/page.tsx"),
  footer,
  seo,
].join("\n");
assert.doesNotMatch(
  companySources,
  /BioNeMo|Anthropic|Vertex AI|Supabase|private orchestration|endorsed by (?:OpenAI|NVIDIA)|(?:OpenAI|NVIDIA) partnership/i,
  "Technology references may name implemented providers without inventing partnerships or exposing private infrastructure",
);
for (const file of ["app/page.tsx", "app/about/page.tsx", "app/drug-discovery-intelligence/page.tsx"]) {
  assert.doesNotMatch(read(file), /train(?:s|ing)? (?:our own|foundation) models|guarantee.*(?:accuracy|hallucination)/i);
}
const researchSources =
  read("app/drug-discovery-intelligence/page.tsx") +
  read("app/drug-discovery-intelligence/demo/CompoundDemo.tsx") +
  read("app/biological-intelligence/_archived-page.tsx");
assert.doesNotMatch(
  researchSources,
  /discovered (?:a )?drug|replaces? scientists?|replaces? laborator|proves? (?:therapeutic )?efficacy|clinical approval|FDA approval|guaranteed successful/i,
  "Research pages must not claim unverified scientific or regulatory results",
);
process.stdout.write(
  "Public company, policy, claims, and canonical-route regressions passed.\n",
);

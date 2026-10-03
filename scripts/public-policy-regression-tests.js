/* Policy and product contracts retained from the superseded public art-direction suites. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
assert.match(seo, /name: "Executive Intelligence"/);
assert.match(
  read("app/careers/page.tsx"),
  /not currently listing open positions/i,
  "Careers must not fabricate hiring availability",
);
assert.doesNotMatch(
  read("app/about/page.tsx"),
  /consulting agency|operations consulting/,
);
for (const topic of [
  "Getting started",
  "Account and workspace",
  "Sources and evidence",
  "Business Health",
  "Business Memory",
  "Billing",
  "Privacy and trust",
  "Contact support",
  "Intelligence and Explain Finding",
  "Saved Analyses",
]) {
  assert.ok(
    read("app/help/page.tsx").includes(topic),
    `Help must retain the ${topic} topic`,
  );
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

assert.match(logo, /\/brand\/vaeroex-logo-white-wordmark\.png/);
assert.match(logo, /variant === "symbol" \? "\/icon-192\.png"/);
const logoHash = crypto
  .createHash("sha256")
  .update(
    fs.readFileSync(
      path.join(root, "public/brand/vaeroex-logo-white-wordmark.png"),
    ),
  )
  .digest("hex");
assert.equal(
  logoHash,
  "03f57e14ec55969a00d67face54d72d7774c3a0f1d0b84c8cd11fc79f51a13fa",
  "Canonical supplied logo asset must remain unchanged",
);
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
  "/executive-intelligence",
  "/drug-discovery-intelligence",
  "/biological-intelligence",
  "/pricing",
  "/contact",
])
  assert.ok(sitemap.includes(`"${route}"`));
assert.doesNotMatch(sitemap, /"\/operations-intelligence"/);
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
  /NVIDIA|BioNeMo|OpenAI|Anthropic|Vertex AI|Supabase|private orchestration/i,
  "The membership attribution must not expand into infrastructure or vendor claims",
);
const researchSources =
  read("app/drug-discovery-intelligence/page.tsx") +
  read("app/biological-intelligence/page.tsx");
assert.doesNotMatch(
  researchSources,
  /discovered (?:a )?drug|replaces? scientists?|replaces? laborator|proves? (?:therapeutic )?efficacy|clinical approval|FDA approval|guaranteed successful/i,
  "Research pages must not claim unverified scientific or regulatory results",
);
process.stdout.write(
  "Public company, policy, claims, and canonical-route regressions passed.\n",
);

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const canonicalPage = read("app/executive-intelligence/page.tsx");
const redirects = read("next.config.mjs");
const sitemap = read("app/sitemap.ts");
const seo = read("lib/seo/public-seo.ts");

assert.equal(fs.existsSync(path.join(root, "app/operations-intelligence/page.tsx")), false, "the former product page must not remain as duplicate content");
assert.match(canonicalPage, /title: "Executive Intelligence \| Vaeroex"/, "the canonical product page must use the approved browser title");
assert.match(canonicalPage, /path: "\/executive-intelligence"/, "the canonical product metadata must use the new URL");
assert.match(redirects, /source: "\/operations-intelligence"[^\n]+destination: "\/executive-intelligence"[^\n]+statusCode: 301/, "the former product URL must permanently redirect");
assert.match(sitemap, /"\/executive-intelligence"/, "the sitemap must include the canonical product URL");
assert.doesNotMatch(sitemap, /"\/operations-intelligence"/, "the sitemap must not advertise the former product URL");
assert.match(seo, /name: "Executive Intelligence"/, "structured data must use the approved product name");
assert.match(seo, /\/executive-intelligence/, "structured data must use the canonical product URL");

const customerFacingFiles = [
  "app/page.tsx",
  "app/executive-intelligence/page.tsx",
  "app/pricing/page.tsx",
  "app/about/page.tsx",
  "app/contact/page.tsx",
  "app/demo/page.tsx",
  "app/help/page.tsx",
  "app/checkout/success/page.tsx",
  "app/(auth)/signup/page.tsx",
  "app/app/page.tsx",
  "app/app/help/page.tsx",
  "components/app/AppShell.tsx",
  "components/auth/AuthShell.tsx",
  "components/legal/LegalAcceptanceGate.tsx",
  "components/legal/PublicFooter.tsx",
  "components/legal/PublicSiteHeader.tsx",
  "components/motion/MarketingDashboardPreview.tsx",
  "components/motion/ScrollStory.tsx",
  "lib/billing/plans.ts",
  "lib/demo/workspace-demo.ts",
  "lib/email/welcome.ts",
  "lib/help/content.ts",
  "lib/legal/content.ts",
  "lib/seo/public-seo.ts"
];

for (const file of customerFacingFiles) {
  const source = read(file);
  assert.doesNotMatch(source, /Operations Intelligence/, `${file} must not expose the former product name`);
  assert.doesNotMatch(source, /\/operations-intelligence/, `${file} must not link to the former product route`);
}

assert.match(read("components/motion/OperationsIntelligenceEngineDemo.tsx"), /operations-intelligence-demo-tab/, "internal component identifiers must remain stable");
assert.match(read(".env.example"), /STRIPE_PRICE_OPERATIONS_INTELLIGENCE_MONTHLY/, "existing environment-variable names must remain stable");
assert.match(read("supabase/migrations/202607070001_update_vaeroex_price_to_500.sql"), /Operations Intelligence/, "historical migrations must remain unchanged");

process.stdout.write("Executive Intelligence branding regressions passed.\n");

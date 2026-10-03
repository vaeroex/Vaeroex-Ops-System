/* Public rendering contracts, deliberately independent of art direction and section order. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const modules = new Map();
const link = ({ href, children, ...props }) =>
  React.createElement("a", { href, ...props }, children);
const image = ({ src, alt, sizes, ...props }) => {
  delete props.fill;
  delete props.priority;
  delete props.unoptimized;
  return React.createElement("img", { src, alt, sizes, ...props });
};
const styles = new Proxy({}, { get: (_, name) => String(name) });

// Authenticated infrastructure is outside this public-only rendering suite. Real route
// bodies, shared product definitions, commerce link, and illustrative demo are rendered.
function loadTs(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const code = ts.transpileModule(read(file), {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  function resolve(specifier) {
    if (specifier.endsWith(".css"))
      return { __esModule: true, default: styles };
    if (specifier === "next/link") return { __esModule: true, default: link };
    if (specifier === "next/image") return { __esModule: true, default: image };
    if (specifier === "next/dynamic")
      return { __esModule: true, default: () => () => null };
    if (specifier === "next/navigation") return { usePathname: () => "/" };
    if (specifier === "@/components/legal/PublicSiteHeader")
      return { PublicSiteHeader: () => React.createElement("header", null) };
    if (specifier === "@/components/legal/PublicFooter")
      return { PublicFooter: () => React.createElement("footer", null) };
    if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const base = specifier.startsWith("@/")
        ? specifier.slice(2)
        : path.join(path.dirname(file), specifier);
      const resolved = [base, `${base}.tsx`, `${base}.ts`].find((candidate) =>
        fs.existsSync(path.join(root, candidate)),
      );
      assert.ok(
        resolved,
        `Local import must resolve: ${specifier} from ${file}`,
      );
      return loadTs(resolved);
    }
    return require(specifier);
  }
  vm.runInNewContext(
    code,
    { module, exports: module.exports, require: resolve, console },
    { filename: file },
  );
  return module.exports;
}

async function renderPage(file, props = {}) {
  const page = loadTs(file);
  return renderToStaticMarkup(await page.default(props));
}

async function main() {
  const systems = loadTs("lib/marketing/public-systems.ts").PUBLIC_SYSTEMS;
  assert.equal(
    systems.length,
    3,
    "The existing public product catalog must remain complete",
  );
  const available = systems.filter(
    (system) => system.availability === "available",
  );
  assert.equal(available.length, 1, "Exactly one product is available");
  assert.equal(available[0].id, "executive-intelligence");
  assert.equal(
    available[0].pricing.checkoutRoute,
    "/checkout/legal",
    "Commerce must preserve legal acceptance before checkout",
  );
  for (const system of systems.filter(
    (entry) => entry.availability === "under_development",
  )) {
    assert.equal(system.pricing.checkoutRoute, null);
    assert.equal(system.pricing.behavior, "status");
    assert.equal(system.pricing.display, "Pricing not yet announced");
  }
  assert.equal(
    loadTs("lib/billing/plans.ts").VAEROEX_PLAN_PRICE_LABEL,
    "$500/month",
  );

  const routes = [
    "/",
    "/pricing",
    "/executive-intelligence",
    "/intelligence-systems",
    "/drug-discovery-intelligence",
    "/biological-intelligence",
  ];
  const htmlByRoute = new Map();
  for (const route of routes) {
    const file = route === "/" ? "app/page.tsx" : `app${route}/page.tsx`;
    const page = loadTs(file);
    const html = await renderPage(file);
    htmlByRoute.set(route, html);
    assert.equal(
      (html.match(/<h1(?:\s|>)/g) || []).length,
      1,
      `${route} must have one readable server-rendered primary heading`,
    );
    assert.ok(
      html.includes("<main") &&
        html.includes("<header") &&
        html.includes("<footer"),
      `${route} must preserve the public document structure`,
    );
    assert.equal(
      page.metadata.alternates.canonical,
      `https://www.vaeroex.com${route === "/" ? "" : route}`,
    );
    assert.doesNotMatch(
      read(file),
      /^\s*["']use client["']/m,
      `${route} marketing semantics must remain server-rendered`,
    );
    assert.doesNotMatch(
      read(file),
      /\b(?:PublicSpatialBackdrop|IntelligenceSystemsSpatialBackdrop|ExecutiveIntelligenceSpatialBackdrop|DrugDiscoverySpatialBackdrop|BiologicalSpatialBackdrop)\b/,
      `${route} must not reintroduce the retired full-page render loops`,
    );
  }

  // Validate the real server output: chapter text and native links work before
  // hydration, and each page owns one persistent scene instead of stacked canvases.
  for (const [route, variant] of [
    ["/", "home"],
    ["/executive-intelligence", "executive"],
    ["/intelligence-systems", "systems"],
    ["/drug-discovery-intelligence", "drug-discovery"],
    ["/biological-intelligence", "biology"],
  ]) {
    const html = htmlByRoute.get(route);
    assert.equal(
      (html.match(/data-clarity-journey=/g) || []).length,
      1,
      `${route} needs one continuous journey`,
    );
    assert.equal(
      (html.match(/data-clarity-engine=/g) || []).length,
      1,
      `${route} must share a single scene across its chapters`,
    );
    assert.match(html, new RegExp(`data-clarity-variant="${variant}"`));
    const chapters = [
      ...html.matchAll(
        /<section\b([^>]*data-clarity-chapter="([0-9]+)"[^>]*)>([\s\S]*?)<\/section>/g,
      ),
    ];
    assert.ok(
      chapters.length >= 3,
      `${route} must render a multi-chapter story without JavaScript`,
    );
    if (variant === "drug-discovery" || variant === "biology") {
      assert.equal(chapters.length, 5, `${route} must expose all five scientific stages`);
      assert.match(html, new RegExp(`data-science-journey="${variant}"`));
    }
    const chapterNavigation = html.match(
      /<nav[^>]*aria-label="(?:Clarity|Molecular|Cellular) journey chapters"[^>]*>([\s\S]*?)<\/nav>/,
    );
    assert.ok(
      chapterNavigation,
      `${route} must expose accessible native chapter navigation`,
    );
    assert.equal(
      (chapterNavigation[1].match(/aria-current="step"/g) || []).length,
      1,
    );
    for (let index = 0; index < chapters.length; index++) {
      const [, attributes, chapterIndex, body] = chapters[index];
      assert.equal(
        Number(chapterIndex),
        index,
        `${route} chapters must follow document order`,
      );
      const id = attributes.match(/\bid="([^"]+)"/)[1];
      assert.match(attributes, /aria-label="[^"]+"/);
      assert.match(
        body,
        /<h[12](?:\s|>)/,
        `${route} chapter ${index + 1} needs a readable heading`,
      );
      assert.ok(
        chapterNavigation[1].includes(`href="#${id}"`),
        `${route} chapter ${index + 1} must be reachable by a native anchor`,
      );
    }
    assert.match(
      html,
      /data-clarity-poster/,
      `${route} must retain its no-JavaScript/render-failure image`,
    );
    assert.doesNotMatch(
      html,
      /data-clarity-mode="interactive"/,
      `${route} cannot claim WebGL readiness in server HTML`,
    );
  }

  const policy = loadTs(
    "components/marketing/clarity/clarityDevicePolicy.ts",
  ).clarityDevicePolicy;
  const decide = (overrides = {}) =>
    policy({ reducedMotion: false, compact: false, ...overrides });
  assert.equal(
    decide().fallback,
    null,
    "Unknown optional hardware APIs must not disable the scene",
  );
  for (const compact of [false, true]) {
    const capable = decide({ compact, memory: 8, cores: 8 });
    assert.equal(capable.compact, compact);
    assert.equal(
      capable.fallback,
      null,
      "Narrow width or a touch pointer alone must preserve real-time 3D",
    );
    const balanced = decide({ compact, memory: 4, cores: 4 });
    assert.equal(
      balanced.compact,
      true,
      "Moderate hardware must select cheaper geometry",
    );
    assert.equal(
      balanced.fallback,
      null,
      "Common four-core/four-GB hardware must remain interactive",
    );
    assert.equal(
      decide({ compact, reducedMotion: true }).fallback,
      "reduced-motion",
    );
    assert.equal(decide({ compact, saveData: true }).fallback, "low-power");
    for (const constrained of [{ memory: 2 }, { cores: 2 }]) {
      assert.equal(decide({ compact, ...constrained }).fallback, "low-power");
      assert.equal(
        decide({ compact, ...constrained, reducedMotion: true }).fallback,
        "reduced-motion",
        "Explicit motion preferences take precedence",
      );
    }
    assert.equal(
      decide({ compact, memory: 0, cores: 0 }).fallback,
      null,
      "Missing hardware hints represented as zero must not invent a low-power condition",
    );
  }

  const pricing = htmlByRoute.get("/pricing");
  assert.equal(
    (pricing.match(/href="\/checkout\/legal"/g) || []).length,
    1,
    "Pricing must expose one product checkout action",
  );
  assert.equal(
    (pricing.match(/\$500\/month/g) || []).length,
    1,
    "Pricing must render the authoritative price once",
  );
  for (const system of systems) {
    const article = pricing.match(
      new RegExp(
        `<article[^>]*data-pricing-system="${system.id}"[^>]*>([\\s\\S]*?)</article>`,
      ),
    );
    assert.ok(
      article,
      `${system.id} must have a visible pricing/availability entry`,
    );
    if (system.availability === "under_development") {
      assert.match(article[1], /In Development/);
      assert.match(article[1], /Pricing not yet announced/);
      assert.doesNotMatch(
        article[1],
        /href="\/(?:checkout|signup|login)|<button|<form/,
        "Research availability must not offer purchase or activation",
      );
    }
  }
  for (const policy of [
    "Renews monthly",
    "current paid billing period",
    "Payments are final and non-refundable",
    "will not increase while your subscription remains continuously active",
    "Price reductions do not provide retroactive refunds",
  ]) {
    assert.ok(
      pricing.includes(policy),
      `Pricing must preserve policy: ${policy}`,
    );
  }
  const feedback = await renderPage("app/pricing/page.tsx", {
    searchParams: Promise.resolve({
      checkout: "cancelled",
      checkout_error: '<script>alert("unsafe")</script>',
    }),
  });
  assert.match(
    feedback,
    /role="alert"[^>]*>&lt;script&gt;/,
    "Checkout errors must be escaped and announced",
  );
  assert.match(
    feedback,
    /role="status"[^>]*>Checkout was cancelled/,
    "Checkout cancellation feedback must survive the redesign",
  );
  assert.doesNotMatch(
    feedback,
    /<script>alert/,
    "Query feedback must never render active markup",
  );

  const executive = htmlByRoute.get("/executive-intelligence");
  for (const capability of [
    "Business Health",
    "Explain Finding",
    "Evidence",
    "Saved Analyses",
  ])
    assert.ok(executive.includes(capability));
  assert.match(
    executive,
    /role="tablist"/,
    "The existing product walkthrough must remain interactive",
  );
  assert.match(
    executive,
    /Illustrative sample information/,
    "Demonstration data must be visibly disclosed",
  );
  assert.match(
    executive,
    /does not automatically create one/,
    "Briefings must remain on-demand, not advertised as automatic on upload",
  );
  assert.match(
    executive,
    /application\/ld\+json/,
    "Executive structured metadata must remain present",
  );

  for (const route of [
    "/drug-discovery-intelligence",
    "/biological-intelligence",
  ]) {
    const html = htmlByRoute.get(route);
    assert.match(html, /In Development/);
    assert.match(html, /Pricing not yet announced/);
    assert.match(html, /[Cc]onceptual/);
    assert.match(html, /scientific research and research decision-support/);
    assert.match(html, /patient data, PHI, ePHI/);
    assert.doesNotMatch(
      html,
      /href="\/(?:checkout|signup|login)|<form|start trial|request access/i,
      "Research pages must preserve their non-commercial status",
    );
    assert.match(
      html,
      /<img[^>]*src="\/brand\/science\/[^"]+"[^>]*alt="[^"]+"/,
      "Scientific poster images need accessible descriptions",
    );
  }

  const discovery = htmlByRoute.get("/drug-discovery-intelligence");
  assert.match(discovery, /href="https:\/\/www\.rcsb\.org\/structure\/1AZM"/, "Observed structural references must remain inspectable");
  assert.match(discovery, /Carbonic anhydrase I|carbonic anhydrase I/);
  assert.doesNotMatch(discovery, /carbonic anhydrase II/i, "The illustrative structure is isoform I");
  assert.match(discovery, /surfaces are approximations derived from atomic coordinates/);
  assert.match(discovery, /conceptual illustrations/);
  const biological = htmlByRoute.get("/biological-intelligence");
  assert.match(biological, /[Gg]eneric eukaryotic cell/);
  assert.match(biological, /[Nn]ot to scale|NOT TO SCALE/);

  const home = htmlByRoute.get("/");
  assert.match(
    home,
    /data-clarity-poster/,
    "An image fallback must exist in server HTML before JavaScript or WebGL loads",
  );
  assert.match(
    home,
    /CONCEPT RENDER/,
    "A poster must not be labeled as functioning real-time 3D",
  );
  assert.doesNotMatch(
    home,
    /data-clarity-mode="interactive"/,
    "The initial server response cannot claim unverified WebGL readiness",
  );
  assert.match(
    home,
    /member of the[^<]*<br\/>|member of the NVIDIA/,
    "The existing membership attribution must remain bounded to membership",
  );
  const navigation = renderToStaticMarkup(
    React.createElement(
      loadTs("components/marketing/PublicNavigation.tsx").PublicNavigation,
      { loggedIn: false },
    ),
  );
  for (const system of systems)
    assert.ok(
      navigation.includes(`href="${system.route}"`),
      `Navigation must reach ${system.route}`,
    );
  assert.match(navigation, /Open navigation menu/);
  assert.match(navigation, /href="\/login"/);

  const engine = read("components/marketing/clarity/ClarityEngine.tsx");
  const canvas = read("components/marketing/clarity/ClarityEngineCanvas.tsx");
  const guard = read("components/spatial/PublicSpatialCanvasGuard.tsx");
  assert.match(engine, /prefers-reduced-motion/);
  assert.match(engine, /IntersectionObserver/);
  assert.match(engine, /visibilitychange/);
  assert.match(engine, /deviceMemory|hardwareConcurrency/);
  assert.match(engine, /saveData/);
  assert.match(engine, /SceneBoundary/);
  assert.match(
    engine,
    /aria-pressed=\{paused\}/,
    "Visitors must have a keyboard-operable motion control",
  );
  assert.match(canvas, /frameloop="demand"/);
  assert.doesNotMatch(
    canvas,
    /setInterval\(/,
    "The focal scene must not run a permanent ambient render interval",
  );
  assert.match(canvas, /if \(!active/);
  assert.match(canvas, /probeRenderedCanvas/);
  assert.match(canvas, /PublicSpatialContextGuard/);
  assert.match(guard, /webglcontextlost/);
  assert.match(engine, /SCROLL TO EXPLORE[\s\S]*CONCEPT RENDER/);
  assert.match(
    engine,
    /ResizeObserver/,
    "Chapter measurement must respond to changing content height",
  );
  assert.match(
    engine,
    /data-clarity-chapter/,
    "Progress must follow actual chapters instead of whole-page height",
  );
  assert.match(
    engine,
    /addEventListener\("scroll",\s*schedule,\s*\{\s*passive:\s*true/,
  );
  assert.doesNotMatch(
    engine,
    /preventDefault\(|addEventListener\(["'](?:wheel|touchmove)["']/,
    "Scene motion must preserve native scrolling",
  );
  assert.match(
    engine,
    /progress=\{progress\}/,
    "Document progress must reach the genuine scene",
  );
  assert.match(
    canvas,
    /evaluateClarityMotion/,
    "The renderer must use the tested choreography",
  );

  const form = read("components/legal/PublicRequestForm.tsx");
  assert.match(
    form,
    /action=\{createSupportRequestAction\}/,
    "Public contact/demo forms must retain their working server action",
  );
  for (const field of [
    "return_path",
    "issue_type",
    "page_module",
    "name",
    "email",
    "company",
    "message",
  ])
    assert.ok(
      form.includes(`name="${field}"`),
      `Public form field must remain: ${field}`,
    );
  assert.match(
    read("app/support/actions.ts"),
    /enforceRateLimit[\s\S]*supportRequestSchema/,
    "Submission protections must remain intact",
  );

  for (const asset of [
    "public/brand/clarity-material.webp",
    "public/brand/clarity-engine-poster.webp",
  ]) {
    assert.ok(
      fs.existsSync(path.join(root, asset)),
      `Production image must exist: ${asset}`,
    );
    const size = fs.statSync(path.join(root, asset)).size;
    assert.ok(
      size > 1024 && size < 900000,
      `Image must be meaningful and bounded below 900 KB: ${asset}`,
    );
  }
  process.stdout.write(
    "Public clarity rendering, commerce, availability, and fallback regressions passed.\n",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic-only server rendering: does not bypass any production auth route.
const fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module"),
  ts = require("typescript"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  output = process.argv[2];
if (!output || !path.isAbsolute(output))
  throw new Error("Provide an absolute output directory");
fs.mkdirSync(output, { recursive: true });
for (const ext of [".ts", ".tsx"])
  require.extensions[ext] = (m, f) =>
    m._compile(
      ts.transpileModule(fs.readFileSync(f, "utf8"), {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }).outputText,
      f,
    );
const resolve = Module._resolveFilename;
Module._resolveFilename = function (r, ...args) {
  return resolve.call(
    this,
    r.startsWith("@/") ? path.join(root, r.slice(2)) : r,
    ...args,
  );
};
let enabled = false,
  view = null;
const load = Module._load;
Module._load = function (r, ...args) {
  if (r === "@/lib/integrations/shopify/server")
    return {
      manager: async () => ({}),
      shopifyEnabled: () => enabled,
      lifecycle: async () => view,
    };
  return load.call(this, r, ...args);
};
const { renderToStaticMarkup } = require("react-dom/server"),
  Page = require("../app/app/settings/integrations/shopify/page.tsx").default;
(async () => {
  const css = fs
    .readdirSync(".next/static/css")
    .filter((f) => f.endsWith(".css"))
    .map((f) => fs.readFileSync(".next/static/css/" + f, "utf8"))
    .join("\n");
  for (const mode of ["setup", "connect", "report"]) {
    enabled = mode !== "setup";
    view =
      mode === "report"
        ? {
            shop: "sample-merchant.myshopify.com",
            status: "connected",
            updatedAt: "2026-10-14T00:00:00Z",
            report: {
              start: "2026-09-14T00:00:00.000Z",
              end: "2026-10-14T00:00:00.000Z",
              syncedAt: "2026-10-14T00:00:00.000Z",
              orderCount: 48,
              days: [
                {
                  day: "2026-10-13",
                  currency: "USD",
                  orders: 23,
                  cancelled: 1,
                  orderTotal: "3425.500000",
                  refunded: "150.000000",
                },
                {
                  day: "2026-10-12",
                  currency: "USD",
                  orders: 25,
                  cancelled: 2,
                  orderTotal: "3812.750000",
                  refunded: "84.990000",
                },
              ],
            },
          }
        : null;
    const content = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({}) }),
    );
    assert(content.includes("Shopify"));
    if (mode === "report") {
      assert(content.includes("$7,238.25"));
      assert(content.includes("Disconnect and delete report"));
    }
    if (mode === "setup")
      assert(!content.includes('action="/api/integrations/shopify/connect"'));
    fs.writeFileSync(
      path.join(output, mode + ".html"),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vaeroex Shopify • ${mode} preview</title><style>${css}</style></head><body style="background:#f5f7fa;padding:32px;font-family:Arial,sans-serif"><div style="max-width:1024px;margin:auto;padding-bottom:20px;font-size:13px;color:#64748b">VAEROEX · SHOPIFY PREVIEW · SYNTHETIC SAMPLE DATA</div>${content}</body></html>`,
    );
  }
  console.log(
    "Shopify setup, connect and report page rendering assertions passed.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

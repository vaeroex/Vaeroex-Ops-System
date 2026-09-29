/* eslint-disable @typescript-eslint/no-require-imports -- Local-only CommonJS preview launcher. */
/* Local-only real-component preview. No Next server, environment files, or backend clients. */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const ts = require("typescript");
const postcss = require("postcss");
const tailwind = require("tailwindcss");
const webpackPackage = require("next/dist/compiled/webpack/webpack");
webpackPackage.init();
const webpack = webpackPackage.webpack;
const root = path.resolve(__dirname, "..");
const fixture = path.join(__dirname, "workspace-redesign-fixture");
const actionModules = Object.freeze([
  "lib/auth/actions.ts", "lib/workspaces/actions.ts", "app/app/operations/actions.ts",
  "app/app/files/actions.ts", "app/app/sources/business-notes/actions.ts",
  "app/app/business-health-analysis/actions.ts", "app/app/finding-explanation/actions.ts",
  "app/app/intelligence/lifecycle-actions.ts", "app/app/intelligence/briefings/actions.ts",
  "app/app/reports/saved-analysis-actions.ts", "app/app/accountability/actions.ts",
  "app/app/records/actions.ts", "app/app/record-management/actions.ts", "app/app/operations/record-management-actions.ts"
]);
const readModules = Object.freeze([
  "@/lib/workspaces/page-context", "@/lib/kpis/load-workspace-kpis", "@/lib/ai/evidence-index",
  "@/lib/files/storage-links", "@/lib/ai/providers/workflow-provider-policy",
  "@/lib/integrations/control-plane/qbo-customer-availability",
  "@/lib/integrations/control-plane/square-workspace-evidence", "@/lib/integrations/square-direct/server"
]);
function sourceRoot() {
  return fs.realpathSync(process.env.WORKSPACE_PREVIEW_COMPONENT_ROOT || root);
}
async function build({ componentRoot = sourceRoot(), test = false } = {}) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "vaeroex-workspace-redesign-"));
  fs.chmodSync(output, 0o700);
  const navigation = path.join(fixture, "navigation.tsx");
  const aliases = {
    "next/link$": navigation, "next/navigation$": navigation,
    "next/image$": path.join(fixture, "image.tsx"), "next/headers$": path.join(fixture, "read-adapters.ts"),
    "server-only$": false,
  };
  for (const name of readModules) aliases[`${name}$`] = path.join(fixture, "read-adapters.ts");
  aliases["@"] = componentRoot;
  const allowedActions = actionModules.map(file => path.join(componentRoot, file));
  const moduleFiles = new Set();
  const boundary = { apply(compiler) {
    compiler.hooks.normalModuleFactory.tap("SyntheticBoundary", factory => {
      factory.hooks.afterResolve.tap("SyntheticBoundary", data => {
        const resource = data?.createData?.resource?.split("?")[0];
        if (!resource) return;
        moduleFiles.add(resource);
        if (/[/\\]lib[/\\]supabase[/\\](server|client|admin)\.[jt]s$/.test(resource)
          || /[/\\]node_modules[/\\](?:\.pnpm[/\\])?@supabase/.test(resource)
          || /[/\\]lib[/\\]ai[/\\]providers[/\\](provider-manager|openai|anthropic)/.test(resource)) {
          throw new Error(`Forbidden live dependency in preview: ${path.relative(componentRoot, resource)}`);
        }
      });
    });
  } };
  await new Promise((resolve, reject) => webpack({
    mode: "development", target: test ? "node" : "web", devtool: false,
    externals: test ? Object.fromEntries(["react", "react/jsx-runtime", "react-dom"].map(name => [name, `commonjs ${require.resolve(name)}`])) : undefined,
    entry: path.join(fixture, test ? "screens.tsx" : "entry.tsx"),
    output: { path: output, filename: test ? "render.cjs" : "preview.js", ...(test ? { library: { type: "commonjs2" } } : {}) },
    resolve: { extensions: [".tsx", ".ts", ".js"], alias: aliases, modules: [path.join(root, "node_modules"), "node_modules"] },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: { loader: path.join(fixture, "loader.cjs"), options: { allowedActions, actionRuntime: path.join(fixture, "actions.ts"), intelligencePage: path.join(componentRoot, "app/app/intelligence/page.tsx"), readRuntime: path.join(fixture, "read-adapters.ts") } } }] },
    plugins: [boundary, new webpack.NormalModuleReplacementPlugin(/^(?:node:)?crypto$/, path.join(fixture, "hash.ts")), new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: "development", VERCEL_ENV: "preview" }), "process.env.NODE_ENV": JSON.stringify("development"), "process.env.VERCEL_ENV": JSON.stringify("preview") })],
  }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  if (!test) {
    const configFile = path.join(componentRoot, "tailwind.config.ts");
    const loaded = { exports: {} };
    Function("require", "module", "exports", ts.transpileModule(fs.readFileSync(configFile, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)(require, loaded, loaded.exports);
    const config = loaded.exports.default;
    config.content = [path.join(componentRoot, "app/**/*.{ts,tsx}"), path.join(componentRoot, "components/**/*.{ts,tsx}"), path.join(componentRoot, "lib/**/*.{ts,tsx}"), path.join(fixture, "*.tsx")];
    const css = await postcss([tailwind(config), require("autoprefixer")]).process(fs.readFileSync(path.join(componentRoot, "app/globals.css"), "utf8"), { from: path.join(componentRoot, "app/globals.css") });
    const toolbarCss = "\nhtml.pulsar body #root [data-fixture-toolbar] { background: #fff7ed !important; border-color: #f59e0b !important; } html.pulsar body #root [data-fixture-toolbar], html.pulsar body #root [data-fixture-toolbar] * { color: #0f172a !important; } html.pulsar body #root [data-fixture-toolbar] select, html.pulsar body #root [data-fixture-toolbar] button { background: #fff !important; border-color: #94a3b8 !important; }\n";
    fs.writeFileSync(path.join(output, "preview.css"), css.css + toolbarCss, { mode: 0o600 });
  }
  fs.chmodSync(path.join(output, test ? "render.cjs" : "preview.js"), 0o600);
  fs.writeFileSync(path.join(output, "boundary.json"), JSON.stringify({ componentRoot, fixtureRoot: fixture, moduleFiles: [...moduleFiles].sort(), readModules, actionModules }, null, 2), { mode: 0o600 });
  return { output, componentRoot };
}
function createServer({ output, componentRoot, port }) {
  if (![3186, 3187].includes(port)) throw new Error("Only comparison ports 3186 and 3187 are permitted.");
  const origin = `http://127.0.0.1:${port}`;
  const html = '<!doctype html><html lang="en" class="dark pulsar" data-theme="pulsar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vaeroex — isolated workspace preview</title><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script src="/preview.js"></script></body></html>';
  return http.createServer((request, response) => {
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.headers.host !== `127.0.0.1:${port}`) { response.writeHead(403); response.end("Loopback host only"); return; }
    if (request.method !== "GET") { response.writeHead(405); response.end("Synthetic preview has no write endpoint."); return; }
    const pathname = new URL(request.url, origin).pathname;
    if (["/preview.js", "/preview.css"].includes(pathname)) {
      response.setHeader("Content-Type", pathname.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8");
      response.end(fs.readFileSync(path.join(output, pathname.slice(1))));
    } else if (["/icon-192.png", "/brand/vaeroex-logo-white-wordmark.png"].includes(pathname)) {
      response.setHeader("Content-Type", "image/png"); response.end(fs.readFileSync(path.join(componentRoot, "public", pathname)));
    } else if (pathname === "/" || pathname === "/app" || pathname.startsWith("/app/")) {
      response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html);
    } else { response.writeHead(404); response.end("No such fixture route."); }
  });
}
async function main() {
  const result = await build();
  console.log(`workspace_redesign_preview_built ${result.output} components=${result.componentRoot}`);
  if (process.argv.includes("--build-only")) return;
  const port = Number(process.env.WORKSPACE_PREVIEW_PORT || 3186);
  createServer({ ...result, port }).listen(port, "127.0.0.1", () => console.log(`workspace_redesign_preview_listening http://127.0.0.1:${port}/app`));
}
module.exports = { build, createServer, actionModules, readModules };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

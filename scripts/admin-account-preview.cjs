/* eslint-disable @typescript-eslint/no-require-imports -- Local-only CommonJS preview launcher. */
/* Real Admin React components; explicit synthetic in-memory action boundaries. */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const Module = require("node:module");
const ts = require("typescript");
const postcss = require("postcss");
const tailwind = require("tailwindcss");
const webpackPackage = require("next/dist/compiled/webpack/webpack");
webpackPackage.init();
const webpack = webpackPackage.webpack;
const root = path.resolve(__dirname, "..");
const fixture = path.join(__dirname, "admin-account-fixture");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "vaeroex-admin-account-preview-"));
fs.chmodSync(output, 0o700);
const port = 3158;
const origin = `http://127.0.0.1:${port}`;

function loadConfig() {
  const filename = path.join(root, "tailwind.config.ts");
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename }).outputText, filename);
  return loaded.exports.default;
}
async function build() {
  const navigation = path.join(__dirname, "customer-evidence-workflow-fixture/navigation.tsx");
  const actions = path.join(fixture, "actions.ts");
  // AdminLifecycleBadge uses a pure label helper from the server-marked directory
  // module. Its database imports are type-only; all mutation modules stay mocked.
  const aliases = { "@/app/app/admin/workspaces/actions$": actions, "@/app/app/admin/subscriptions/actions$": actions, "server-only$": false, "next/link$": navigation, "next/navigation$": navigation, "@": root };
  await new Promise((resolve, reject) => webpack({ mode: "development", target: "web", devtool: false, entry: path.join(fixture, "entry.tsx"), output: { path: output, filename: "preview.js" }, resolve: { extensions: [".tsx", ".ts", ".js"], alias: aliases }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, "workspace-clarity-fixture/ts-loader.cjs") }] }, plugins: [new webpack.DefinePlugin({ "process.env.NODE_ENV": JSON.stringify("development") })] }, (error, stats) => {
    if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
    else resolve();
  }));
  const config = loadConfig();
  config.content = [path.join(root, "components/**/*.{ts,tsx}"), path.join(root, "lib/**/*.{ts,tsx}"), path.join(fixture, "*.tsx")];
  const css = await postcss([tailwind(config)]).process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") });
  fs.writeFileSync(path.join(output, "preview.css"), css.css, { mode: 0o600 });
  fs.chmodSync(path.join(output, "preview.js"), 0o600);
  console.log(`admin_account_preview_ready ${output}`);
  if (process.argv.includes("--build-only")) return;
  const html = '<!doctype html><html class="dark pulsar" data-theme="pulsar"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vaeroex — synthetic Admin account preview</title><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script src="/preview.js"></script></body></html>';
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.headers.host !== `127.0.0.1:${port}`) { response.writeHead(403); response.end("Loopback host only"); return; }
    if (request.method !== "GET") { response.writeHead(405); response.end("Static preview only; no request may mutate state."); return; }
    const pathname = new URL(request.url, origin).pathname;
    if (pathname === "/preview.js" || pathname === "/preview.css") {
      response.setHeader("Content-Type", pathname.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8");
      response.end(fs.readFileSync(path.join(output, pathname.slice(1))));
    } else if (pathname === "/" || pathname.startsWith("/app/")) {
      response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html);
    } else { response.writeHead(404); response.end("Not found"); }
  });
  server.listen(port, "127.0.0.1", () => console.log(`admin_account_preview_listening ${origin}/app/admin/customers/00000000-0000-4000-8000-000000000001`));
}
build().catch((error) => { console.error(error.message); process.exitCode = 1; });

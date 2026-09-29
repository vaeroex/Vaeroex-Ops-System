/* eslint-disable @typescript-eslint/no-require-imports -- This local-only Node CommonJS launcher loads the repository's CommonJS build tools; it is not application code. */
/* Local-only UI qualification: actual components, synthetic data, no server actions. */
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
const fixture = path.join(__dirname, "workspace-clarity-fixture");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "vaeroex-clarity-preview-"));
fs.chmodSync(output, 0o700);
const stubs = path.join(fixture, "server-stubs.tsx");
const aliases = Object.fromEntries([
  "@/app/app/sources/business-notes/actions", "@/app/app/finding-explanation/actions", "@/app/app/intelligence/lifecycle-actions", "@/app/app/intelligence/briefings/actions", "@/app/app/reports/saved-analysis-actions", "@/lib/auth/actions", "@/lib/workspaces/page-context", "@/lib/integrations/control-plane/qbo-customer-availability", "@/lib/integrations/control-plane/square-workspace-evidence", "@/lib/integrations/square-direct/server", "@/components/integrations/ConnectionStatusPanel", "@/components/integrations/SquareEvidenceCard", "next/headers", "server-only"
].map((name) => [`${name}$`, stubs]));
aliases["next/link$"] = path.join(fixture, "navigation.tsx");
aliases["next/navigation$"] = path.join(fixture, "navigation.tsx");
aliases["@"] = root;
async function build() {
  await new Promise((resolve, reject) => webpack({ mode: "development", target: "web", devtool: false, entry: path.join(fixture, "entry.tsx"), output: { path: output, filename: "preview.js" }, resolve: { extensions: [".tsx", ".ts", ".js"], alias: aliases }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(fixture, "ts-loader.cjs") }] }, plugins: [new webpack.DefinePlugin({ "process.env.NODE_ENV": JSON.stringify("development") })] }, (error, stats) => {
    if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
    else resolve();
  }));
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, "tailwind.config.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const configModule = { exports: {} };
  Function("module", "exports", compiled)(configModule, configModule.exports);
  const config = configModule.exports.default;
  config.content = [path.join(root, "app/**/*.{js,ts,jsx,tsx}"), path.join(root, "components/**/*.{js,ts,jsx,tsx}"), path.join(root, "lib/**/*.{js,ts,jsx,tsx}"), path.join(fixture, "*.tsx")];
  const css = await postcss([tailwind(config)]).process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") });
  fs.writeFileSync(path.join(output, "preview.css"), css.css, { mode: 0o600 });
  fs.chmodSync(path.join(output, "preview.js"), 0o600);
  console.log(`workspace_clarity_preview_bundle_ready ${output}`);
  if (process.argv.includes("--build-only")) return;
  const html = '<!doctype html><html class="dark pulsar" data-theme="pulsar"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vaeroex — local synthetic UI preview</title><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script src="/preview.js"></script></body></html>';
  const server = http.createServer((request, response) => {
    if (request.method !== "GET") { response.writeHead(405); response.end("Read-only preview"); return; }
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'");
    response.setHeader("Cache-Control", "no-store");
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/preview.js" || pathname === "/preview.css") {
      response.setHeader("Content-Type", pathname.endsWith(".js") ? "text/javascript" : "text/css");
      response.end(fs.readFileSync(path.join(output, pathname.slice(1))));
    } else if (pathname === "/" || pathname.startsWith("/app")) {
      response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html);
    } else { response.writeHead(404); response.end("Not found"); }
  });
  server.listen(3155, "127.0.0.1", () => console.log("workspace_clarity_preview_listening http://127.0.0.1:3155/app/intelligence"));
}
build().catch((error) => { console.error(error.message); process.exitCode = 1; });

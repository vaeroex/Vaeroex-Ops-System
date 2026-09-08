/* Package only the exact pinned server-only dependency; never substitute a
 * no-op stub, download a package on the guest, or rely on parent node_modules. */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "services/square-sandbox-callback/dist");
const source = path.dirname(require.resolve("server-only"));
const manifest = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
if (manifest.name !== "server-only" || manifest.version !== "0.0.1" ||
    manifest.exports?.["."]?.["react-server"] !== "./empty.js" || manifest.exports?.["."]?.default !== "./index.js") {
  throw new Error("square_portal_package_denied");
}
const destination = path.join(output, "node_modules/server-only");
fs.mkdirSync(destination, { recursive: true });
for (const name of ["package.json", "empty.js", "index.js"]) fs.copyFileSync(path.join(source, name), path.join(destination, name));
const bundle = fs.readFileSync(path.join(output, "index.js"), "utf8");
if (bundle.includes("@/lib/") || fs.existsSync(path.join(output, "index.js.map"))) throw new Error("square_portal_package_denied");

// Execute a copied release outside the repository. This reproduces the original
// false require.main guard and missing external-module failures, not just an
// import that happens to resolve dependencies from the checkout's ancestors.
const owned = fs.mkdtempSync(path.join(os.tmpdir(), "square-portal-release-smoke-"));
const files = ["index.js", "node_modules/server-only/package.json", "node_modules/server-only/empty.js", "node_modules/server-only/index.js"];
try {
  fs.mkdirSync(path.join(owned, "node_modules/server-only"), { recursive: true });
  for (const name of files) fs.copyFileSync(path.join(output, name), path.join(owned, name));
  for (const args of [["--wrong"], ["--serve", "--config", "/not-an-approved-config"]]) {
    const result = spawnSync(process.execPath, ["--conditions=react-server", path.join(owned, "index.js"), ...args], {
      cwd: owned, env: { NODE_ENV: "production" }, encoding: "utf8", timeout: 10_000, maxBuffer: 65_536
    });
    if (result.error || result.status !== 78 || result.stdout !== "" || /MODULE_NOT_FOUND|Cannot find module/.test(result.stderr ?? "")) {
      throw new Error("square_portal_release_smoke_denied");
    }
  }
  process.stdout.write("Square native release: standalone entry and pinned dependency smoke checks passed.\n");
} finally {
  for (const name of files) fs.unlinkSync(path.join(owned, name));
  fs.rmdirSync(path.join(owned, "node_modules/server-only")); fs.rmdirSync(path.join(owned, "node_modules")); fs.rmdirSync(owned);
}

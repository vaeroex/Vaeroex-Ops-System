/* eslint-disable @typescript-eslint/no-require-imports -- Local-only CommonJS preview launcher. */
/* Actual UI, validator and parser; synthetic upload/action boundaries only. */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const Module = require("node:module");
const ts = require("typescript");
const postcss = require("postcss");
const tailwind = require("tailwindcss");
const { PDFDocument } = require("pdf-lib");
const webpackPackage = require("next/dist/compiled/webpack/webpack");
webpackPackage.init();
const webpack = webpackPackage.webpack;
const root = path.resolve(__dirname, "..");
const fixture = path.join(__dirname, "customer-evidence-workflow-fixture");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "vaeroex-evidence-preview-"));
fs.chmodSync(output, 0o700);
const port = 3156;
const origin = `http://127.0.0.1:${port}`;
const records = [];

function loadPureModule(relative) {
  const filename = path.join(root, relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded.require = (name) => name === "server-only" ? {} : require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
  return loaded.exports;
}
const { validateUploadFileSafety, MAX_UPLOAD_FILE_SIZE_BYTES } = loadPureModule("lib/security/file-upload-safety.ts");
const { parseSpreadsheetWorkbook } = loadPureModule("lib/imports/spreadsheets.ts");

async function inspectUpload(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_UPLOAD_FILE_SIZE_BYTES + 64 * 1024) return { error: "Fixture request exceeds the 25 MB upload limit." };
    chunks.push(chunk);
  }
  const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers["content-type"] || "" } }).formData();
  const file = form.get("file");
  if (!file || typeof file === "string") return { error: "Choose a file to upload." };
  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateUploadFileSafety({ fileName: file.name, browserMimeType: file.type, size: file.size, buffer });
  if (!validation.ok) return validation;
  const mode = form.get("fixture_mode");
  if (mode === "delayed") await new Promise((resolve) => setTimeout(resolve, 8_000));
  if (mode === "recoverable") return { error: "Synthetic recoverable failure: the selected folder could not be checked. Change the fixture scenario to Success and submit the same retained file." };
  let workbook = null;
  if (["csv", "xlsx"].includes(validation.extension)) {
    try {
      workbook = parseSpreadsheetWorkbook({ fileName: file.name, buffer });
    } catch (error) {
      return { error: `Local spreadsheet parser rejected this file: ${error.message}` };
    }
  }
  const record = {
    id: `synthetic-${records.length + 1}`,
    fileName: file.name,
    displayName: String(form.get("display_name") || file.name),
    folder: String(form.get("folder_id") || "No folder"),
    size: file.size,
    extension: validation.extension,
    rowCount: workbook?.rows.length || 0,
    worksheets: workbook?.worksheets.map((sheet) => ({ name: sheet.name, status: sheet.status, rows: sheet.rows.length })) || [],
    rows: workbook?.rows.slice(0, 5).map((row) => row.values) || [],
    issues: workbook?.issues || [],
    status: workbook ? "Prepared for mapping review — not approved" : "Saved — separate analysis decision required",
  };
  records.push(record);
  if (mode === "unknown") return { error: "Synthetic uncertain response: a source may have been saved. Check saved sources before submitting another copy.", blocked: true, records };
  return { error: null, record, records };
}

async function build() {
  const navigation = path.join(fixture, "navigation.tsx");
  const aliases = { "@/app/app/files/actions$": path.join(fixture, "actions.ts"), "next/link$": navigation, "next/navigation$": navigation, "@": root };
  await new Promise((resolve, reject) => webpack({ mode: "development", target: "web", devtool: false, entry: path.join(fixture, "entry.tsx"), output: { path: output, filename: "preview.js" }, resolve: { extensions: [".tsx", ".ts", ".js"], alias: aliases }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(__dirname, "workspace-clarity-fixture/ts-loader.cjs") }] }, plugins: [new webpack.DefinePlugin({ "process.env.NODE_ENV": JSON.stringify("development") })] }, (error, stats) => {
    if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
    else resolve();
  }));
  const config = loadPureModule("tailwind.config.ts").default;
  config.content = [path.join(root, "components/**/*.{ts,tsx}"), path.join(root, "lib/**/*.{ts,tsx}"), path.join(fixture, "*.tsx")];
  const css = await postcss([tailwind(config)]).process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") });
  fs.writeFileSync(path.join(output, "preview.css"), css.css, { mode: 0o600 });
  fs.chmodSync(path.join(output, "preview.js"), 0o600);
  fs.writeFileSync(path.join(output, "synthetic.csv"), "Date,Metric,Actual,Target\n2026-09-01,Orders,42,40\n2026-09-02,Orders,46,40\n", { mode: 0o600 });
  fs.writeFileSync(path.join(output, "invalid.pdf"), "This is deliberately not a PDF.", { mode: 0o600 });
  fs.copyFileSync(path.join(__dirname, "fixtures/Vaeroex_Retail_Full_Demo_Dataset_Dated.xlsx"), path.join(output, "synthetic.xlsx"));
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 240]).drawText("Synthetic Vaeroex source. No customer data.", { x: 30, y: 160, size: 13 });
  fs.writeFileSync(path.join(output, "synthetic.pdf"), await pdf.save(), { mode: 0o600 });
  console.log(`customer_evidence_preview_ready ${output}`);
  if (process.argv.includes("--build-only")) return;
  const html = '<!doctype html><html class="dark pulsar" data-theme="pulsar"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vaeroex — synthetic evidence workflow</title><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script src="/preview.js"></script></body></html>';
  const server = http.createServer(async (request, response) => {
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'none'; base-uri 'none'");
    response.setHeader("Cache-Control", "no-store");
    const pathname = new URL(request.url, origin).pathname;
    if (request.method === "POST" && pathname === "/__fixture/inspect" && request.headers.origin === origin) {
      response.setHeader("Content-Type", "application/json");
      try { response.end(JSON.stringify(await inspectUpload(request))); }
      catch { response.writeHead(400); response.end(JSON.stringify({ error: "The local fixture could not inspect this request." })); }
      return;
    }
    if (request.method !== "GET") { response.writeHead(405); response.end("Only the local fixture upload endpoint accepts POST."); return; }
    if (pathname === "/preview.js" || pathname === "/preview.css") {
      response.setHeader("Content-Type", pathname.endsWith(".js") ? "text/javascript" : "text/css");
      response.end(fs.readFileSync(path.join(output, pathname.slice(1))));
    } else if (["synthetic.csv", "synthetic.xlsx", "synthetic.pdf", "invalid.pdf"].some((name) => pathname === `/samples/${name}`)) {
      const filename = pathname.slice("/samples/".length);
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      response.end(fs.readFileSync(path.join(output, filename)));
    } else if (pathname === "/" || pathname.startsWith("/app")) {
      response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html);
    } else { response.writeHead(404); response.end("Not found"); }
  });
  server.listen(port, "127.0.0.1", () => console.log(`customer_evidence_preview_listening ${origin}/app/sources`));
}
build().catch((error) => { console.error(error.message); process.exitCode = 1; });

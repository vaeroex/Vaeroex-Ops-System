const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

const { calculateProfitLeakage } = require("../lib/intelligence/profit-leakage.ts");
const eligible = new Set(["invoice-1", "license-1"]);

const candidate = calculateProfitLeakage([{ id: "candidate", category: "Subscription waste", sourceIds: ["license-1"], lifecycle: "Candidate", paidSeats: 42, activeSeats: 26, unitCost: 40 }], eligible);
assert.equal(candidate.confirmedTotal, 0);
assert.equal(candidate.supportedTotal, 0);
assert.equal(candidate.findings[0].amount, null, "candidate amounts never enter supported totals");

const supported = calculateProfitLeakage([{ id: "supported", category: "Subscription waste", sourceIds: ["license-1"], lifecycle: "Supported", paidSeats: 42, activeSeats: 26, unitCost: 40 }], eligible);
assert.equal(supported.supportedTotal, 640);
assert.match(supported.findings[0].formula, /42.*26.*40/);

const receivable = calculateProfitLeakage([{ id: "invoice", category: "Overdue receivables", sourceIds: ["invoice-1"], lifecycle: "Confirmed", invoiceTotal: 1500, paidAmount: 500, pastDue: true, disputed: false }], eligible);
assert.equal(receivable.confirmedTotal, 1000);

const duplicated = calculateProfitLeakage([
  { id: "one", category: "Subscription waste", sourceIds: ["license-1"], lifecycle: "Confirmed", paidSeats: 12, activeSeats: 10, unitCost: 50 },
  { id: "two", category: "Subscription waste", sourceIds: ["license-1"], lifecycle: "Confirmed", paidSeats: 12, activeSeats: 10, unitCost: 50 }
], eligible);
assert.equal(duplicated.confirmedTotal, 100, "duplicate evidence is counted once");

const inactive = calculateProfitLeakage([{ id: "archived", category: "Overdue receivables", sourceIds: ["archived-source"], lifecycle: "Confirmed", invoiceTotal: 500, paidAmount: 0, pastDue: true }], eligible);
assert.equal(inactive.confirmedTotal, 0, "inactive or ineligible source evidence cannot support leakage");

const page = fs.readFileSync("app/app/kpis/profit-leakage/page.tsx", "utf8");
assert.match(page, /No defensible leakage amount yet/);
assert.doesNotMatch(page, /estimated leakage|potential savings: \$/i);
console.log("Profit Leakage regression tests passed.");

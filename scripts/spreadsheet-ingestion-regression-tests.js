const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTypeScriptModule(relativePath) {
  const filePath = path.join(root, relativePath);
  const source = fs.readFileSync(filePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    },
    fileName: filePath
  }).outputText;
  const module = { exports: {} };
  Function("require", "module", "exports", compiled)(require, module, module.exports);
  return module.exports;
}

function entry(name, xml) {
  return [name, { name, data: Buffer.from(xml, "utf8") }];
}

const parser = loadTypeScriptModule("lib/imports/spreadsheets.ts");
const worksheetTypes = loadTypeScriptModule("lib/imports/worksheet-types.ts");
const workbook = parser.parseXlsxWorkbookEntries(new Map([
  entry("xl/workbook.xml", `
    <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>
        <sheet name="Company Profile" sheetId="1" r:id="rId1"/>
        <sheet name="Monthly Sales" sheetId="2" r:id="rId2"/>
        <sheet name="Chart Summary" sheetId="3" r:id="rId3"/>
        <sheet name="Broken Data" sheetId="4" r:id="rId4"/>
        <sheet name="Formatting Only" sheetId="5" r:id="rId5"/>
      </sheets>
    </workbook>`),
  entry("xl/_rels/workbook.xml.rels", `
    <Relationships>
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
      <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet" Target="chartsheets/sheet3.xml"/>
      <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>
      <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet5.xml"/>
    </Relationships>`),
  entry("xl/worksheets/sheet1.xml", `
    <worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Company</t></is></c><c r="B1" t="inlineStr"><is><t>Industry</t></is></c></row>
      <row r="4"><c r="A4" t="inlineStr"><is><t>Vaeroex</t></is></c><c r="B4" t="inlineStr"><is><t>Software</t></is></c></row>
    </sheetData></worksheet>`),
  entry("xl/worksheets/sheet2.xml", `
    <worksheet><sheetData>
      <row r="3"><c r="A3" t="inlineStr"><is><t>Month</t></is></c><c r="B3" t="inlineStr"><is><t>Revenue</t></is></c></row>
      <row r="9"><c r="A9" t="inlineStr"><is><t>July</t></is></c><c r="B9"><v>500</v></c></row>
    </sheetData></worksheet>`),
  entry("xl/worksheets/sheet4.xml", `<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c>`),
  entry("xl/worksheets/sheet5.xml", `<worksheet><sheetData><row r="8" customFormat="1"></row></sheetData></worksheet>`)
]));

assert.strictEqual(workbook.worksheets.length, 5, "every declared workbook tab must be inspected");
assert.strictEqual(workbook.rows.length, 2, "rows from all standard worksheets must be retained");
assert.deepStrictEqual(workbook.rows.map((row) => row.worksheetName), ["Company Profile", "Monthly Sales"]);
assert.deepStrictEqual(workbook.rows.map((row) => row.worksheetRowNumber), [4, 9], "original worksheet row numbers must be preserved");
assert.strictEqual(workbook.worksheets[2].status, "unsupported", "non-worksheet tabs must be reported explicitly");
assert.strictEqual(workbook.issues[0].worksheet, "Chart Summary");
assert.strictEqual(workbook.worksheets[3].status, "failed", "malformed worksheets must report a sheet-specific failure");
assert.strictEqual(workbook.issues[1].worksheet, "Broken Data");
assert.strictEqual(workbook.worksheets[4].status, "empty", "formatting-only worksheets must be ignored safely");

const detectedTypes = [
  ["Company Profile", ["Company", "Industry"], "company_profile"],
  ["Monthly Sales", ["Month", "Revenue", "Target Revenue"], "kpis"],
  ["Inventory", ["SKU", "On Hand", "Reorder Point"], "inventory"],
  ["Orders", ["Order ID", "Status", "Days to Deliver"], "orders"],
  ["Employees", ["Employee", "Department", "Overtime Hours"], "employees"],
  ["Customer Feedback", ["Customer", "Rating", "Comment"], "customers"],
  ["Supplier Invoices", ["Invoice", "Supplier", "Amount"], "financials"]
].map(([name, columns, expected]) => ({
  expected,
  actual: worksheetTypes.detectWorksheetType({ name, columns })
}));
assert.deepStrictEqual(detectedTypes.map((item) => item.actual), detectedTypes.map((item) => item.expected), "each worksheet must receive an independent dataset classification");
assert.notStrictEqual(
  worksheetTypes.detectWorksheetType({ name: "Performance Notes", columns: ["Status", "Comment"] }),
  "kpis",
  "a KPI-like worksheet name must not trigger KPI mapping without the required name and actual-value columns"
);
assert(worksheetTypes.WORKSHEET_IMPORT_FIELDS.kpis.some((field) => field.key === "actual_value"), "KPI worksheets must receive KPI mapping fields");
assert(!worksheetTypes.WORKSHEET_IMPORT_FIELDS.inventory.some((field) => field.key === "actual_value"), "inventory worksheets must not receive KPI mapping fields");

const actions = fs.readFileSync(path.join(root, "app/app/files/actions.ts"), "utf8");
const review = fs.readFileSync(path.join(root, "components/evidence/SourceImportReview.tsx"), "utf8");
const workbookReview = fs.readFileSync(path.join(root, "components/evidence/WorkbookImportReview.tsx"), "utf8");
const evidenceIndex = fs.readFileSync(path.join(root, "lib/ai/evidence-index.ts"), "utf8");
const toolGateway = fs.readFileSync(path.join(root, "lib/security/tool-execution-gateway.ts"), "utf8");
const sources = fs.readFileSync(path.join(root, "app/app/sources/page.tsx"), "utf8");

assert.match(actions, /parseSpreadsheetWorkbook/, "file ingestion must use the multi-worksheet parser");
assert.doesNotMatch(actions, /rows\.slice\(0,\s*1000\)/, "structured imports must not silently truncate rows");
assert.match(actions, /validateImportRow[\s\S]*Required mapping/, "every staged row must receive explicit import validation");
assert.match(actions, /business_memory_indexing[\s\S]*No rows are indexed or activated before import approval/, "the trace must state the Business Memory boundary");
assert.match(actions, /mode: "workbook"[\s\S]*worksheetPlans/, "workbook staging must preserve an independent plan for every worksheet");
assert.match(actions, /approve_workbook_import/, "approved workbook imports must pass through the Tool Execution Gateway");
assert.match(actions, /indexWorksheetImportEvidence/, "approved workbook rows must preserve source lineage in Business Memory");
assert.match(actions, /skipped_worksheet/, "unapproved worksheets must be skipped without receiving irrelevant validation errors");
assert.match(actions, /if \(!plan \|\| !plan\.enabled\) return \{ row, issues: \[\]/, "skipped worksheets must bypass row validation");
assert.match(actions, /plan\.selected_type === "company_profile" \|\| plan\.selected_type === "unknown"/, "context-only worksheets must not create structured records");
assert.match(actions, /metricRows = planRows\.filter\(\(row\) => hasMappedNumericValue/, "non-KPI worksheets must create metric history only from explicitly mapped numeric values");
assert.match(actions, /structuredFailureIds[\s\S]*runtimeIssues[\s\S]*for \(const plan of enabledPlans\)/, "worksheet write failures must be tracked without collapsing all sheets into one operation");
assert.match(actions, /"Vaeroex workbook"[\s\S]*"Vaeroex worksheet"[\s\S]*"Vaeroex source row"/, "structured records must retain workbook, worksheet, and original-row lineage");
assert.match(evidenceIndex, /source_type: "file"[\s\S]*source_file_id: file\.id[\s\S]*worksheet_name[\s\S]*row_numbers/, "Business Memory chunks must retain source-parent and worksheet lineage");
assert.match(toolGateway, /approve_workbook_import:[\s\S]*allowedRoles: OPERATOR_ROLES/, "workbook approval must retain the existing operator-role boundary");
assert.match(workbookReview, /Dataset type/, "users must be able to review and change worksheet detection");
assert.match(workbookReview, /WORKSHEET_IMPORT_FIELDS\[plan\.selected_type\]/, "the review must show only the mapping for the selected worksheet type");
assert.match(workbookReview, /worksheet_\$\{plan\.index\}_map_\$\{field\.key\}/, "worksheet mappings must be submitted independently");
assert.match(review, /Ingestion pipeline trace/, "source review must expose the complete stage trace");
assert.match(review, /issue\.worksheet[\s\S]*issue\.rowNumber/, "source review must identify worksheet and row failures");
assert.match(sources, /Import failed/, "structured import failures must not be mislabeled as AI analysis failures");

console.log("Spreadsheet ingestion regression tests passed.");

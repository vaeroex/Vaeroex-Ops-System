const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const actions = read("app/app/files/actions.ts");
const sources = read("app/app/sources/page.tsx");
const workflows = read("lib/ai/vaeroex-workflows.ts");
const client = read("lib/ai/vaeroex-client.ts");

const fileWorkflow = workflows.slice(
  workflows.indexOf('key: "file_analysis"'),
  workflows.indexOf('key: "ceo_mode"')
);
const analysisAction = actions.slice(actions.indexOf("export async function analyzeFileAction"));
const analysisRunner = actions.slice(
  actions.indexOf("async function runFileVaeroexAnalysis"),
  actions.indexOf("export async function uploadFileAction")
);

assert.match(fileWorkflow, /\$\{fileAnalysisJsonInstructions\}/, "file analysis must use its extraction-specific response contract");
assert.doesNotMatch(fileWorkflow, /\$\{sharedJsonInstructions\}/, "generic answer JSON must not override file extraction fields");
for (const field of [
  "extraction_status",
  "extracted_text",
  "extracted_findings",
  "kpis_found",
  "risks",
  "operational_issues",
  "opportunities",
  "unclear_fields",
  "confidence"
]) {
  assert.match(workflows, new RegExp(`"${field}"`), `file analysis contract must require ${field}`);
}
assert.match(workflows, /extracted_text is required whenever any readable business labels, rows, or values are visible/, "populated images must produce a grounded transcription");
assert.match(workflows, /never infer missing values/, "image analysis must not invent values");
assert.match(actions, /file\.file_extension === "png"[\s\S]{0,120}file\.file_extension === "jpg"/, "PNG and JPG analysis must remain supported");
assert.match(actions, /file\.file_extension === "jpeg"/, "JPEG analysis must remain supported");
assert.match(actions, /file\.file_extension === "pdf"[\s\S]{0,900}fileAttachment\(file, buffer, "file"\)/, "scanned PDFs must retain direct file analysis");
assert.match(client, /type: "input_image"/, "image attachments must use the OpenAI vision input path");
assert.match(client, /type: "input_file"/, "PDF attachments must use the OpenAI file input path");
assert.match(actions, /function validateFileAnalysisOutputContract/, "all file types must validate the dedicated extraction contract");
assert.match(actions, /allowedStatuses\.has\(extractionStatus\)/, "file analysis must validate extraction status");
assert.match(actions, /allowedConfidence\.has\(confidence\)/, "file analysis must validate confidence");
assert.match(actions, /hasRequiredLists/, "file analysis must validate grounded result arrays");
assert.match(actions, /extractionStatus !== "populated" \|\| Boolean\(extractedText\)/, "populated sources must include extracted text");

for (const [status, message] of [
  ["blank_template", "No populated inventory records were detected in this template"],
  ["unreadable", "text was too small or unclear to analyze reliably"],
  ["technical_failure", "Analysis could not be completed due to a processing error"],
  ["incomplete_extraction", "returned an incomplete file extraction"]
]) {
  assert.match(actions, new RegExp(status), `analysis must classify ${status}`);
  assert.match(actions, new RegExp(message), `analysis must expose the specific ${status} result`);
}
assert.match(actions, /Analysis could not access the saved source file\. Your file remains saved\. Try again\./, "Storage retrieval failures must remain specific and retryable");
assert.doesNotMatch(actions, /Vaeroex could not find usable business information in this file/, "the old broad failure must not remain active");

assert.match(analysisAction, /claimFileAnalysis/, "Analyze source must acquire a server-side processing claim");
assert.match(actions, /\.neq\("processing_status", "processing"\)/, "the claim must reject a second active analysis");
assert.equal((analysisAction.match(/\.from\("ai_agent_runs"\)\.insert/g) || []).length, 1, "Analyze source must create exactly one active run");
assert.match(analysisAction, /status: "running"/, "the active run must be visible while processing");
assert.match(analysisAction, /\.from\("ai_agent_runs"\)[\s\S]{0,180}\.update\([\s\S]{0,240}status: "failed"/, "a failed attempt must update the same active run");
assert.match(analysisRunner, /activeRunId[\s\S]{0,500}\.update\(completedRun\)/, "a successful attempt must complete the existing run");
assert.ok(
  analysisRunner.indexOf("if (!evidenceAssessment.eligible)") < analysisRunner.indexOf("indexFileAnalysisEvidence("),
  "invalid or empty extraction must be rejected before Business Memory indexing"
);
assert.ok(
  analysisRunner.indexOf("validateFileAnalysisOutputContract(outputJson)") < analysisRunner.indexOf("indexFileAnalysisEvidence("),
  "the dedicated output contract must be validated before Business Memory indexing"
);
assert.match(actions, /archiveFileAnalysisMemoryChunks[\s\S]{0,500}indexFileAnalysisEvidence/, "reanalyzing must retire prior active analysis chunks before indexing replacements");

for (const status of ["Uploaded", "Analyzing", "No usable data found", "Needs clearer file", "Analysis failed", "Archived"]) {
  assert.match(sources, new RegExp(status), `Sources must support the ${status} state`);
}
assert.equal((sources.match(/>Preview original<\/a>/g) || []).length, 1, "Preview original must appear in one action area");
assert.equal((sources.match(/>Download original<\/a>/g) || []).length, 1, "Download original must appear in one action area");
assert.match(sources, /pendingLabel="Analyzing source\.\.\."/, "Analyze source must keep visible progress feedback");
assert.match(sources, /status !== "Analyzing"/, "Analyze source must be disabled while an analysis is active");
assert.match(sources, /manageSourceFileAction/, "archive and soft-delete lifecycle controls must remain available");

console.log("File analysis regression tests passed.");

import "server-only";

import type {
  BenchmarkDocumentClass,
  DocumentBenchmarkComparison,
  DocumentClassRecommendation,
  DocumentComparisonMetrics
} from "@/lib/ai/document-intelligence-poc/contracts";
import { compareDocumentExtraction } from "@/lib/ai/document-intelligence-poc/comparison";
import { loadDocumentIntelligenceFixtures } from "@/lib/ai/document-intelligence-poc/fixtures";
import { qualifyNvidiaDocumentParser } from "@/lib/ai/document-intelligence-poc/nvidia-document-parser";
import { NvidiaOcrBenchmarkAdapter, privacySafeNvidiaOcrTelemetry } from "@/lib/ai/document-intelligence-poc/nvidia-ocr";
import { extractWithCurrentVaeroexPath } from "@/lib/ai/document-intelligence-poc/vaeroex-current";

function average(values: readonly number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function percentile(values: readonly number[], value: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(value * sorted.length) - 1))];
}

function aggregateMetrics(comparisons: readonly DocumentBenchmarkComparison[]): DocumentComparisonMetrics {
  const keys: Array<keyof DocumentComparisonMetrics> = [
    "characterErrorRate", "wordErrorRate", "exactNumericAccuracy", "signAccuracy", "decimalAccuracy",
    "currencyAccuracy", "percentageAccuracy", "dateAccuracy", "reportingPeriodAccuracy", "kpiNameAccuracy",
    "kpiValueAccuracy", "kpiTargetAccuracy", "unitAccuracy", "rowReconstructionAccuracy",
    "columnReconstructionAccuracy", "mergedCellReconstructionAccuracy", "readingOrderAccuracy",
    "pageAssociationAccuracy", "boundingBoxCoverage", "boundingBoxCorrectness", "headingAccuracy",
    "sectionAssociationAccuracy", "hallucinatedTextRate", "omittedTextRate", "duplicatedTextRate",
    "catastrophicBusinessErrorRate"
  ];
  return Object.fromEntries(keys.map((key) => [key, average(comparisons.map((comparison) => comparison.metrics[key]).filter((metric): metric is number => metric !== null))])) as DocumentComparisonMetrics;
}

const STRUCTURE_CLASSES = new Set<BenchmarkDocumentClass>(["dense_financial_table", "merged_cell_table", "multi_page_table", "spreadsheet_rendered_as_pdf"]);
const DIFFICULT_CLASSES = new Set<BenchmarkDocumentClass>(["scanned_pdf", "image_only_pdf", "rotated_page", "skewed_scan", "low_resolution_image", "poor_contrast_scan", "handwritten_annotation"]);

function recommendation({
  documentClass,
  current,
  nvidia
}: {
  documentClass: BenchmarkDocumentClass;
  current: DocumentComparisonMetrics;
  nvidia: DocumentComparisonMetrics;
}): DocumentClassRecommendation {
  if (STRUCTURE_CLASSES.has(documentClass) && nvidia.rowReconstructionAccuracy === null) {
    return "BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE";
  }
  if (nvidia.exactNumericAccuracy === null && nvidia.wordErrorRate === null) return "REJECT FOR THIS DOCUMENT CLASS";
  const requiredNumeric = DIFFICULT_CLASSES.has(documentClass) ? 0.99 : 0.995;
  const zeroCatastrophic = nvidia.catastrophicBusinessErrorRate === 0;
  const numericPass = nvidia.exactNumericAccuracy === null || nvidia.exactNumericAccuracy >= requiredNumeric;
  const signPass = nvidia.signAccuracy === null || nvidia.signAccuracy === 1;
  const currencyPass = nvidia.currencyAccuracy === null || nvidia.currencyAccuracy === 1;
  const periodPass = nvidia.reportingPeriodAccuracy === null || nvidia.reportingPeriodAccuracy === 1;
  const hallucinationPass = (nvidia.hallucinatedTextRate ?? 1) <= 0.001;
  const currentNumeric = current.exactNumericAccuracy || 0;
  const accuracyImprovement = (nvidia.exactNumericAccuracy || 0) - currentNumeric;
  const wordErrorImprovement = current.wordErrorRate && nvidia.wordErrorRate !== null
    ? (current.wordErrorRate - nvidia.wordErrorRate) / current.wordErrorRate
    : nvidia.wordErrorRate !== null && nvidia.wordErrorRate < 0.25 ? 1 : 0;
  const materiallyBetter = accuracyImprovement >= 0.05 || wordErrorImprovement >= 0.25;
  if (zeroCatastrophic && numericPass && signPass && currencyPass && periodPass && hallucinationPass && materiallyBetter) {
    return DIFFICULT_CLASSES.has(documentClass) ? "QUALIFIED FOR SPECIALIST PILOT" : "QUALIFIED FOR CONDITIONAL FALLBACK";
  }
  if (!zeroCatastrophic || !numericPass || !signPass || !currencyPass || !periodPass) return "REJECT FOR THIS DOCUMENT CLASS";
  return "REMAIN SHADOW ONLY";
}

export async function runDocumentIntelligencePocBenchmark() {
  const fixtures = await loadDocumentIntelligenceFixtures();
  const nvidiaAdapter = new NvidiaOcrBenchmarkAdapter();
  const currentComparisons: DocumentBenchmarkComparison[] = [];
  const nvidiaComparisons: DocumentBenchmarkComparison[] = [];
  const nvidiaTelemetry = [];
  for (const fixture of fixtures) {
    const current = await extractWithCurrentVaeroexPath(fixture);
    const nvidia = await nvidiaAdapter.extract(fixture);
    currentComparisons.push(compareDocumentExtraction(fixture, current));
    nvidiaComparisons.push(compareDocumentExtraction(fixture, nvidia));
    nvidiaTelemetry.push(privacySafeNvidiaOcrTelemetry(nvidia));
  }
  const parserProbePage = fixtures.find((fixture) => fixture.documentId === "synthetic-doc-executive-kpi-review")?.renderedPages[0];
  if (!parserProbePage) throw new Error("The parser qualification fixture is missing.");
  const richerParser = await qualifyNvidiaDocumentParser({ page: parserProbePage });
  const classes = Array.from(new Set(fixtures.flatMap((fixture) => fixture.documentClasses))).sort();
  const byClass = classes.map((documentClass) => {
    const current = currentComparisons.filter((comparison) => comparison.documentClasses.includes(documentClass));
    const nvidia = nvidiaComparisons.filter((comparison) => comparison.documentClasses.includes(documentClass));
    const currentMetrics = aggregateMetrics(current);
    const nvidiaMetrics = aggregateMetrics(nvidia);
    return {
      documentClass,
      fixtureCount: nvidia.length,
      current: currentMetrics,
      nvidia: nvidiaMetrics,
      catastrophicErrors: Array.from(new Set(nvidia.flatMap((comparison) => comparison.catastrophicErrors))).sort(),
      recommendation: recommendation({ documentClass, current: currentMetrics, nvidia: nvidiaMetrics })
    };
  });
  const successfulLatencies = nvidiaComparisons.filter((item) => item.status === "success").map((item) => item.latencyMs);
  return {
    benchmarkVersion: "document_intelligence_benchmark_v1" as const,
    syntheticOnly: true as const,
    fixtureCount: fixtures.length,
    pageCount: fixtures.reduce((sum, fixture) => sum + fixture.renderedPages.length, 0),
    providerCalls: {
      attempted: nvidiaTelemetry.reduce((sum, item) => sum + item.requestCount, 0) + richerParser.requestCount,
      succeeded: nvidiaComparisons.filter((item) => item.status === "success").length + (richerParser.status === "available" ? 1 : 0),
      authenticationFailures: nvidiaComparisons.filter((item) => item.failureCode === "authentication_failed").length + (richerParser.failureCode === "authentication_failed" ? 1 : 0),
      providerFailures: nvidiaComparisons.filter((item) => item.failureCode === "provider_unavailable").length + (richerParser.failureCode === "provider_unavailable" ? 1 : 0),
      schemaFailures: nvidiaComparisons.filter((item) => item.failureCode === "malformed_response" || item.failureCode === "validation_failed").length,
      timeouts: nvidiaComparisons.filter((item) => item.failureCode === "timeout").length + (richerParser.failureCode === "timeout" ? 1 : 0),
      retries: nvidiaComparisons.reduce((sum, item) => sum + item.retryCount, 0),
      latencyMs: {
        p50: percentile(successfulLatencies, 0.5),
        p95: percentile(successfulLatencies, 0.95),
        p99: percentile(successfulLatencies, 0.99)
      }
    },
    currentAggregate: aggregateMetrics(currentComparisons),
    nvidiaAggregate: aggregateMetrics(nvidiaComparisons),
    currentDocuments: currentComparisons,
    nvidiaDocuments: nvidiaComparisons,
    nvidiaTelemetry,
    richerParser,
    byClass,
    cost: { authoritativePricingAvailable: false, estimatedCostUsd: null },
    authorityBoundary: {
      productionEnabled: false,
      activeIngestionChanged: false,
      writesBusinessMemory: false,
      writesKpis: false,
      entersSnapshot: false,
      changesBusinessHealth: false,
      rawContentInTelemetry: false
    }
  };
}

export function privacySafeDocumentIntelligenceReport(report: Awaited<ReturnType<typeof runDocumentIntelligencePocBenchmark>>) {
  return {
    benchmarkVersion: report.benchmarkVersion,
    syntheticOnly: report.syntheticOnly,
    fixtureCount: report.fixtureCount,
    pageCount: report.pageCount,
    providerCalls: report.providerCalls,
    currentAggregate: report.currentAggregate,
    nvidiaAggregate: report.nvidiaAggregate,
    currentDocuments: report.currentDocuments,
    nvidiaDocuments: report.nvidiaDocuments,
    richerParser: report.richerParser,
    byClass: report.byClass,
    cost: report.cost,
    authorityBoundary: report.authorityBoundary
  };
}

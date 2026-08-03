import "server-only";

import {
  NVIDIA_MULTIMODAL_EXTRACTION_ADAPTER_VERSION,
  NVIDIA_MULTIMODAL_EXTRACTION_CLIENT_REVISION,
  NVIDIA_MULTIMODAL_EXTRACTION_MODEL,
  extractWithNvidiaMultimodalClient
} from "@/lib/ai/document-intelligence-poc/nvidia-multimodal-extraction";
import {
  DOCUMENT_PILOT_NORMALIZATION_VERSION,
  DOCUMENT_ROUTER_PILOT_CONTRACT_VERSION,
  type DocumentCriticalField,
  type DocumentExtractionFailureCode,
  type ProviderNeutralDocumentExtractionV1
} from "@/lib/ai/document-intelligence-poc/pilot-contracts";
import type { BenchmarkDocument, NormalizedDocumentElement } from "@/lib/ai/document-intelligence-poc/contracts";

function failureCode(value: string | null): DocumentExtractionFailureCode {
  if (value === "timeout") return "timeout";
  if (value === "rate_limit") return "rate_limit";
  if (value === "transport_failure") return "transport_failure";
  if (value === "provider_unavailable" || value === "client_unavailable" || value === "authentication_failed" || value === "missing_credentials") {
    return "provider_unavailable";
  }
  if (value === "unsupported_input" || value === "unsafe_benchmark_input") return "unsupported_input";
  if (value === "malformed_response") return "malformed_content";
  if (value === "validation_failed") return "validation_failure";
  return value ? "provider_unavailable" : null;
}

function coordinates(element: NormalizedDocumentElement): readonly [number, number, number, number] | null {
  const box = element.sourceCoordinates;
  return box ? [box.xMin, box.yMin, box.xMax, box.yMax] : null;
}

function elementFields(element: NormalizedDocumentElement, page: number): DocumentCriticalField[] {
  const identity = element.kpiName || element.provenance.sourceElementId;
  const fields: DocumentCriticalField[] = [];
  const add = (type: DocumentCriticalField["type"], value: string | number | null, critical = true) => {
    if (value === null || value === "") return;
    fields.push({ identity, type, value: String(value), page, sourceCoordinates: coordinates(element), critical });
  };
  add("kpi_name", element.kpiName);
  add("kpi_value", element.kpiValue);
  add("kpi_target", element.kpiTarget);
  add("sign", element.sign);
  add("decimal", element.normalizedNumericValue);
  add("currency", element.currency);
  add("percentage", element.percentage);
  add("unit", element.unit);
  add("reporting_period", element.reportingPeriod);
  add("page", page, false);
  if (element.sourceCoordinates) add("source_coordinates", coordinates(element)?.join(",") || null, false);
  return fields;
}

export async function extractAuthorizedSyntheticDocumentWithOfficialNvidia(
  document: BenchmarkDocument,
  options: Parameters<typeof extractWithNvidiaMultimodalClient>[1] = { enabled: true }
): Promise<ProviderNeutralDocumentExtractionV1> {
  if (!document.documentId.startsWith("synthetic-doc-")) throw new Error("The Preview routing pilot accepts only approved synthetic documents.");
  const output = await extractWithNvidiaMultimodalClient([document], { ...options, enabled: true });
  const result = output.results[0];
  if (!result) throw new Error("The official client did not return the requested synthetic document.");
  const criticalFields = result.pages.flatMap((page) => page.elements.flatMap((element) => elementFields(element, page.pageNumber)));
  return {
    contractVersion: DOCUMENT_ROUTER_PILOT_CONTRACT_VERSION,
    normalizationVersion: DOCUMENT_PILOT_NORMALIZATION_VERSION,
    source: "nvidia",
    provider: "nvidia",
    model: NVIDIA_MULTIMODAL_EXTRACTION_MODEL,
    clientRevision: NVIDIA_MULTIMODAL_EXTRACTION_CLIENT_REVISION,
    status: result.status === "success" ? "success" : "failed",
    pageCount: result.inputPageCount,
    outputElementCount: result.pages.reduce((sum, page) => sum + page.elements.length, 0),
    criticalFields,
    validationResult: result.status === "success" ? (criticalFields.some((field) => field.critical) ? "review_required" : "valid") : "invalid",
    failureCode: failureCode(result.failureCode),
    latencyMs: result.latencyMs,
    providerCalls: result.requestCount,
    successfulCalls: result.status === "success" ? result.requestCount : 0,
    failedCalls: result.status === "success" ? 0 : result.requestCount,
    retries: result.retryCount
  };
}

export const OFFICIAL_NVIDIA_PILOT_IDENTITY = {
  provider: "nvidia" as const,
  model: NVIDIA_MULTIMODAL_EXTRACTION_MODEL,
  clientRevision: NVIDIA_MULTIMODAL_EXTRACTION_CLIENT_REVISION,
  adapterVersion: NVIDIA_MULTIMODAL_EXTRACTION_ADAPTER_VERSION
};

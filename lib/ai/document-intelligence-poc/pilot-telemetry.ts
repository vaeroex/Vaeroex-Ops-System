import "server-only";

import { createHmac } from "node:crypto";
import type {
  DocumentPilotAggregateMetrics,
  DocumentPilotConfig,
  DocumentPilotTelemetryV1
} from "@/lib/ai/document-intelligence-poc/pilot-contracts";

export function privacySafeWorkspaceScopeHash(workspaceScope: string, key: string) {
  if (key.length < 32) throw new Error("Pilot telemetry hashing requires a caller-provided key of at least 32 characters.");
  return createHmac("sha256", key).update(workspaceScope).digest("hex");
}

export function configuredPlanningCost(config: DocumentPilotConfig, pages: number, calls: number) {
  if (config.planningCostPerPageUsd === null && config.planningCostPerCallUsd === null) return null;
  return Number((
    (config.planningCostPerPageUsd || 0) * Math.max(0, pages) +
    (config.planningCostPerCallUsd || 0) * Math.max(0, calls)
  ).toFixed(6));
}

function ratio(numerator: number, denominator: number) {
  return denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

function average(total: number, count: number) {
  return count ? Number((total / count).toFixed(4)) : 0;
}

export function aggregateDocumentPilotTelemetry(events: readonly DocumentPilotTelemetryV1[]): DocumentPilotAggregateMetrics {
  const documents = events.length;
  const workspaces = new Set(events.map((event) => event.workspaceScopeHash)).size;
  const nvidiaPages = events.reduce((sum, event) => sum + event.pagesSentToNvidia, 0);
  const knownCosts = events.map((event) => event.estimatedCostUsd).filter((value): value is number => value !== null);
  const totalKnownCost = knownCosts.reduce((sum, value) => sum + value, 0);
  const perPageRates = events
    .filter((event) => event.estimatedCostUsd !== null && event.costBasisPages > 0)
    .map((event) => (event.estimatedCostUsd || 0) / event.costBasisPages);
  const averagePageRate = perPageRates.length ? perPageRates.reduce((sum, value) => sum + value, 0) / perPageRates.length : null;
  const per100 = averagePageRate === null ? null : Number((averagePageRate * 100).toFixed(4));

  return {
    documents,
    workspaces,
    averageNvidiaPagesPerDocument: average(nvidiaPages, documents),
    averageNvidiaPagesPerWorkspace: average(nvidiaPages, workspaces),
    uploadsBypassingNvidiaPercent: ratio(events.filter((event) => event.pagesSentToNvidia === 0).length, documents),
    nativeEscalationPercent: ratio(events.filter((event) => event.parserSelected === "nvidia_fallback").length, documents),
    cacheHitRate: ratio(events.filter((event) => event.cacheHit).length, documents),
    duplicateSkipRate: ratio(events.filter((event) => event.duplicateDocumentSkip).length, documents),
    averageEstimatedCostPerWorkspaceUsd: knownCosts.length && workspaces ? Number((totalKnownCost / workspaces).toFixed(6)) : null,
    estimatedCostPer100PagesUsd: per100,
    estimatedCostPer1000PagesUsd: per100 === null ? null : Number((per100 * 10).toFixed(4)),
    estimatedCostPer10000PagesUsd: per100 === null ? null : Number((per100 * 100).toFixed(4)),
    estimatedCostAsPercentOf500Subscription: knownCosts.length && workspaces
      ? Number((((totalKnownCost / workspaces) / 500) * 100).toFixed(6))
      : null
  };
}

export function assertPrivacySafeDocumentPilotTelemetry(event: DocumentPilotTelemetryV1) {
  const serialized = JSON.stringify(event);
  if (!/^[a-f0-9]{64}$/.test(event.workspaceScopeHash) || !/^[a-f0-9]{64}$/.test(event.documentHash)) {
    throw new Error("Pilot telemetry identifiers must be one-way hashes.");
  }
  if (/filename|rawText|extractedValue|businessNote|prompt|authorization|apiKey|customerName|workspaceId|userId/i.test(serialized)) {
    throw new Error("Pilot telemetry contains a forbidden content or identity field.");
  }
  return event;
}

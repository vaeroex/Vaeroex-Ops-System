import { available } from "@/lib/intelligence/snapshot/v1/state";
import type { CoverageProducerOutputV1, CoverageSnapshotV1 } from "@/lib/intelligence/snapshot/v1/types";

export function adaptCoverageProducerOutputV1(output: CoverageProducerOutputV1) {
  const coverage: CoverageSnapshotV1 = {
    overallCoverage: output.overallCoverage,
    overallConfidenceLabel: output.overallConfidenceLabel,
    categories: output.categories.map((category) => ({
      id: category.id,
      coverage: category.coverage,
      confidenceLabel: category.confidenceLabel,
      sourceCount: category.sourceCount,
      lastUpdated: category.lastUpdated,
      historyMonths: category.historyMonths,
      structuredSourceCount: category.structuredSourceCount,
      forecastReady: category.forecastReady
    })),
    evidenceSummary: { ...output.evidenceSummary }
  };

  return available(coverage);
}

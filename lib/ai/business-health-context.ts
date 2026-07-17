import "server-only";

import type { KpiOverviewSummary } from "@/lib/ai/kpi-overview";
import type { Json } from "@/lib/supabase/types";

type JsonRecord = Record<string, Json | undefined>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function countValue(value: unknown) {
  const number = numberValue(value);
  return number === null ? 0 : Math.max(0, Math.round(number));
}

export function buildBusinessHealthDecisionContext({
  snapshots,
  kpiSummary
}: {
  snapshots: Json[];
  kpiSummary: KpiOverviewSummary | null;
}) {
  const latest = snapshots.map(record).find((snapshot) => numberValue(snapshot.score) !== null) || {};
  const sourceSummary = record(latest.source_summary);
  const score = numberValue(latest.score);
  const dataQualityScore = numberValue(latest.data_quality_score);
  const sourceCounts = {
    kpi_records: countValue(sourceSummary.kpis),
    original_source_files: countValue(sourceSummary.files),
    active_issue_records: countValue(sourceSummary.issues),
    customer_activity_records: countValue(sourceSummary.crm_leads),
    business_memory_signals: countValue(latest.memory_signal_count ?? sourceSummary.business_memory_signals),
    original_report_sources: countValue(sourceSummary.reports)
  };
  const knownOriginalSourceTypes = [
    sourceCounts.kpi_records > 0,
    sourceCounts.original_source_files > 0,
    sourceCounts.active_issue_records > 0,
    sourceCounts.customer_activity_records > 0,
    sourceCounts.original_report_sources > 0
  ].filter(Boolean).length;

  return {
    available: score !== null,
    current_assessment: score === null
      ? null
      : {
          score,
          status: stringValue(latest.status),
          trend: stringValue(latest.trend),
          snapshot_date: stringValue(latest.snapshot_date),
          data_confidence: stringValue(latest.data_confidence),
          data_quality_score: dataQualityScore
        },
    score_components: {
      recorded_data_quality_base: dataQualityScore,
      recorded_business_health_score: score,
      observed_difference_from_data_quality_base:
        score !== null && dataQualityScore !== null ? score - dataQualityScore : null,
      formula: "When enough original evidence exists, Business Health is the data-quality base minus active risk penalties plus opportunity adjustments, constrained to 10-100.",
      risk_rules: "Each active High-priority risk subtracts 12 points and each Medium-priority risk subtracts 6 points, with total risk penalties capped at 45 points.",
      opportunity_rules: "Each active opportunity adds 4 points, with the opportunity adjustment capped at 15 points.",
      data_quality_rules: {
        workspace_profile: "10 points when industry or company size is recorded.",
        original_source_files: "15 points when at least one active original source file is available.",
        kpi_history: "25 points when active KPI history is available.",
        original_management_reports: "15 points when an eligible original management report is available; Vaeroex-generated reports do not qualify.",
        operating_context: "10 points when active customer activity, issues, or tracked work records are available.",
        decision_outcomes: "10 points when eligible decision or recommendation outcomes are available."
      },
      availability_rule: "A score requires at least three original source records, at least two original source types, and at least one KPI series, source file, eligible original report, or active issue.",
      confidence_rules: "Data confidence is High at a data-quality score of 70 or above, Medium at 40-69, and Low below 40.",
      decomposition_limit: "The stored snapshot does not preserve the individual risk and opportunity adjustments. Do not invent that breakdown; use the recorded score, data-quality base, and current cited findings only."
    },
    coverage_indicators: {
      ...sourceCounts,
      known_original_source_types: knownOriginalSourceTypes,
      note: "These are the source counts recorded with the Business Health snapshot. They describe assessment coverage, not business performance."
    },
    kpi_readiness: kpiSummary
      ? {
          visible_metrics: kpiSummary.metricCount,
          measurement_rows: kpiSummary.totalRows,
          missing_targets: kpiSummary.counts.missingTargets,
          missing_values: kpiSummary.counts.missingValues,
          stale_metrics: kpiSummary.counts.stale,
          metrics_with_insufficient_history: kpiSummary.counts.insufficientHistory,
          recommendation_confidence: kpiSummary.recommendationConfidence,
          limitations: kpiSummary.limitations
        }
      : null,
    interpretation_policy: {
      operational_performance: "Risk and opportunity adjustments describe supported operating signals.",
      assessment_readiness: "Coverage, freshness, targets, history, and data quality describe how reliably Vaeroex can assess the business.",
      boundary: "Improving assessment readiness can make the score more reliable, but it does not by itself improve real operating performance."
    }
  } satisfies Json;
}

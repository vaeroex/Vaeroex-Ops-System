import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { AlertTriangle, ExternalLink, Filter, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SectionCard } from "@/components/operations/SectionCard";
import {
  AI_TRUST_OUTCOME_FILTERS,
  AI_TRUST_RANGE_OPTIONS,
  AI_TRUST_WORKFLOW_FILTERS,
  shortFingerprint,
  type AiTrustDashboardSnapshot,
  type AiTrustFilters
} from "@/lib/admin/ai-trust-dashboard";

const RANGE_LABELS: Record<(typeof AI_TRUST_RANGE_OPTIONS)[number], string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All available"
};

const WORKFLOW_LABELS: Record<(typeof AI_TRUST_WORKFLOW_FILTERS)[number], string> = {
  all: "All workflows",
  business_health: "Business Health",
  finding_explanation: "Explain Finding",
  file_analysis: "File Analysis",
  business_notes: "Business Notes"
};

const OUTCOME_LABELS: Record<(typeof AI_TRUST_OUTCOME_FILTERS)[number], string> = {
  all: "All outcomes",
  accepted: "Accepted",
  qualifier_required: "Accepted with qualifier",
  unresolved: "Unresolved",
  would_omit: "Would omit",
  would_reject: "Would reject"
};

function percentageLabel(value: number | null) {
  return value === null ? "Not available" : `${value.toFixed(1)}%`;
}

function durationLabel(value: number | null) {
  return value === null ? "Not available" : value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(1)} s`;
}

function numberLabel(value: number | null) {
  return value === null ? "Not available" : value.toLocaleString();
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusTone(status: string) {
  if (["Fully Instrumented", "Candidate for Review", "expected"].includes(status)) return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (["Blocked", "enforcement blocker"].includes(status)) return "border-red-300 bg-red-50 text-red-800";
  if (["Calibration Required", "calibration candidate"].includes(status)) return "border-amber-300 bg-amber-50 text-amber-800";
  if (status === "Extraction Monitoring") return "border-blue-300 bg-blue-50 text-blue-800";
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function StatusBadge({ label }: { label: string }) {
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[0.68rem] font-semibold ${statusTone(label)}`}>{label}</span>;
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="min-w-0 border-b border-line px-3 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="text-xs font-semibold uppercase text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-ink">{value}</p>
      {detail ? <p className="mt-1 text-xs leading-5 text-slate-600">{detail}</p> : null}
    </div>
  );
}

function MetricGrid({ children, columns = 4 }: { children: ReactNode; columns?: 3 | 4 | 5 }) {
  const tracks = columns === 5 ? "xl:grid-cols-5" : columns === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4";
  return <div className={`overflow-hidden rounded-lg border border-line bg-slate-50/80 sm:grid sm:grid-cols-2 ${tracks}`}>{children}</div>;
}

function queryValue(filters: AiTrustFilters, key: keyof AiTrustFilters) {
  const value = filters[key];
  return typeof value === "number" ? String(value) : value;
}

function trustHref(filters: AiTrustFilters, changes: Partial<Record<keyof AiTrustFilters, string | number>>) {
  const params = new URLSearchParams();
  const keys: (keyof AiTrustFilters)[] = ["range", "workflow", "releaseChannel", "provider", "model", "ruleset", "rule", "outcome", "page", "evaluation"];
  for (const key of keys) {
    const value = changes[key] ?? queryValue(filters, key);
    if (!value || value === "all" || (key === "page" && value === 1)) continue;
    params.set(key === "releaseChannel" ? "release_channel" : key, String(value));
  }
  return `/app/admin/ai-trust${params.size ? `?${params.toString()}` : ""}` as Route;
}

function workflowValueLabel(value: number | null) {
  return value === null ? "Not instrumented" : value.toLocaleString();
}

function FilterSelect({ name, label, value, options }: {
  name: string;
  label: string;
  value: string;
  options: readonly Readonly<{ value: string; label: string }>[];
}) {
  return (
    <label className="min-w-0 text-xs font-semibold text-slate-700">
      {label}
      <select name={name} defaultValue={value} className="mt-1 min-h-10 w-full rounded-md border border-line bg-white px-2 text-sm font-medium text-ink outline-none focus-visible:border-vaeroex-blue focus-visible:ring-2 focus-visible:ring-vaeroex-blue/20">
        {options.map((option) => <option key={option.value || "any"} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function AiTrustDashboard({ snapshot, filters }: { snapshot: AiTrustDashboardSnapshot; filters: AiTrustFilters }) {
  const pulse = snapshot.platform;
  const totalClassified = pulse.accepted + pulse.qualifierRequired + pulse.unresolved + pulse.wouldOmit + pulse.wouldReject;
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-4 shadow-panel sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase text-vaeroex-blue">Internal quality control</p>
              <span className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2 py-1 text-[0.68rem] font-semibold text-blue-800">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Shadow Mode
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-ink">AI Trust</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Privacy-safe reliability, extraction, validation, latency, and provider telemetry for supported Vaeroex workflows.</p>
          </div>
          <div className="text-sm text-slate-600 lg:text-right">
            <p className="font-semibold text-ink">{RANGE_LABELS[filters.range]}</p>
            <p className="mt-1">Updated {dateLabel(snapshot.generatedAt)}</p>
          </div>
        </div>
      </section>

      <SectionCard title="Filters" description="All parameters are validated server-side. Workflow-specific filters return only telemetry that can be applied authoritatively.">
        <form action="/app/admin/ai-trust" method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <FilterSelect name="range" label="Period" value={filters.range} options={AI_TRUST_RANGE_OPTIONS.map((value) => ({ value, label: RANGE_LABELS[value] }))} />
          <FilterSelect name="workflow" label="Workflow" value={filters.workflow} options={AI_TRUST_WORKFLOW_FILTERS.map((value) => ({ value, label: WORKFLOW_LABELS[value] }))} />
          <FilterSelect name="release_channel" label="Release channel" value={filters.releaseChannel} options={[{ value: "", label: "Any channel" }, ...snapshot.availableFilters.releaseChannels.map((value) => ({ value, label: value }))]} />
          <FilterSelect name="provider" label="Provider" value={filters.provider} options={[{ value: "", label: "Any provider" }, ...snapshot.availableFilters.providers.map((value) => ({ value, label: value }))]} />
          <FilterSelect name="model" label="Model" value={filters.model} options={[{ value: "", label: "Any model" }, ...snapshot.availableFilters.models.map((value) => ({ value, label: value }))]} />
          <FilterSelect name="ruleset" label="Ruleset" value={filters.ruleset} options={[{ value: "", label: "Any ruleset" }, ...snapshot.availableFilters.rulesets.map((value) => ({ value, label: value }))]} />
          <FilterSelect name="rule" label="Rule" value={filters.rule} options={[{ value: "", label: "Any rule" }, ...snapshot.availableFilters.rules.map((value) => ({ value, label: value.replaceAll("_", " ") }))]} />
          <FilterSelect name="outcome" label="Claim outcome" value={filters.outcome} options={AI_TRUST_OUTCOME_FILTERS.map((value) => ({ value, label: OUTCOME_LABELS[value] }))} />
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4 xl:col-span-2">
            <button type="submit" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-blue/40">
              <Filter className="h-4 w-4" aria-hidden="true" />
              Apply filters
            </button>
            <Link href="/app/admin/ai-trust" className="inline-flex min-h-10 items-center rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-vaeroex-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-blue/30">Clear</Link>
          </div>
        </form>
      </SectionCard>

      {snapshot.sourceErrors.map((error) => <ErrorNotice key={error.source} message={error.message} />)}
      {snapshot.truncated ? <ErrorNotice message="This period exceeds the bounded 5,000-row query limit for at least one source. Narrow the time range for complete metrics." /> : null}
      {snapshot.unsafeTelemetryRows || snapshot.malformedTelemetryRows ? (
        <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{snapshot.unsafeTelemetryRows.toLocaleString()} privacy-unsafe and {snapshot.malformedTelemetryRows.toLocaleString()} malformed Trust telemetry rows were excluded from every aggregate and drill-down.</p>
        </div>
      ) : null}

      <SectionCard title="Overall Platform Pulse" description="Compatible Business Health Trust Layer V1 claim telemetry only. Business Notes extraction outcomes are intentionally excluded.">
        {pulse.instrumentedRuns ? (
          <>
            <MetricGrid columns={5}>
              <Metric label="Instrumented runs" value={pulse.instrumentedRuns.toLocaleString()} detail={pulse.sampleInsufficient ? "Insufficient sample" : "Business Health shadow runs"} />
              <Metric label="Claims evaluated" value={pulse.totalClaims.toLocaleString()} detail={`${totalClassified.toLocaleString()} classified outcomes`} />
              <Metric label="Accepted" value={percentageLabel(pulse.acceptedRate)} detail={`${pulse.accepted.toLocaleString()} of ${pulse.totalClaims.toLocaleString()} claims`} />
              <Metric label="Accepted with qualifier" value={pulse.qualifierRequired.toLocaleString()} detail="Shadow-only outcome" />
              <Metric label="Unresolved" value={pulse.unresolved.toLocaleString()} detail="No visible response change" />
            </MetricGrid>
            <MetricGrid columns={5}>
              <Metric label="Would omit" value={pulse.wouldOmit.toLocaleString()} />
              <Metric label="Would reject" value={pulse.wouldReject.toLocaleString()} />
              <Metric label="Avg validation latency" value={durationLabel(pulse.averageValidationLatencyMs)} />
              <Metric label="Additional provider calls" value={pulse.additionalProviderCalls.toLocaleString()} detail="Trust Layer only" />
              <Metric label="Additional AI cost" value="$0.00" detail="Deterministic validation" />
            </MetricGrid>
          </>
        ) : <EmptyState title="No compatible Trust telemetry" description="No Business Health Trust Layer V1 evaluations match the selected filters." />}
      </SectionCard>

      <SectionCard title="Workflow Comparison" description="Each row uses the workflow's authoritative unit of measurement. Missing Trust claim instrumentation is never inferred from provider success.">
        <div className="vaeroex-mobile-safe-scroll overflow-x-auto rounded-lg border border-line">
          <table className="min-w-[980px] divide-y divide-line text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-muted">
              <tr><th className="px-3 py-2">Workflow</th><th className="px-3 py-2">Instrumentation</th><th className="px-3 py-2">Runs</th><th className="px-3 py-2">Claims / extractions</th><th className="px-3 py-2">Accepted / approved</th><th className="px-3 py-2">Unresolved / review</th><th className="px-3 py-2">Failure rate</th><th className="px-3 py-2">Avg latency</th><th className="px-3 py-2">Fallback rate</th></tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {snapshot.workflows.map((workflow) => (
                <tr key={workflow.key} className="align-top hover:bg-blue-50/40 focus-within:bg-blue-50/40">
                  <td className="px-3 py-3"><p className="font-semibold text-ink">{workflow.label}</p><p className="mt-1 max-w-[260px] text-xs leading-5 text-muted">{workflow.note}</p></td>
                  <td className="px-3 py-3"><StatusBadge label={workflow.sampleInsufficient ? "Insufficient sample" : workflow.instrumentation} /><p className="mt-2 text-xs text-muted">{workflow.instrumentation}</p></td>
                  <td className="px-3 py-3 font-medium text-ink">{workflow.runs.toLocaleString()}</td>
                  <td className="px-3 py-3 text-slate-700">{workflow.units.toLocaleString()}</td>
                  <td className="px-3 py-3 text-slate-700">{workflowValueLabel(workflow.acceptedOrApproved)}</td>
                  <td className="px-3 py-3 text-slate-700">{workflowValueLabel(workflow.unresolvedOrNeedsReview)}</td>
                  <td className="px-3 py-3 text-slate-700">{percentageLabel(workflow.failureRate)}</td>
                  <td className="px-3 py-3 text-slate-700">{durationLabel(workflow.averageLatencyMs)}</td>
                  <td className="px-3 py-3 text-slate-700">{percentageLabel(workflow.fallbackRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <section className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Business Health Trust" description="Fully instrumented Trust Layer V1 shadow outcomes.">
          <MetricGrid columns={3}>
            <Metric label="Runs" value={snapshot.businessHealth.totalRuns.toLocaleString()} detail={snapshot.businessHealth.sampleInsufficient ? "Insufficient sample" : "Sample threshold met"} />
            <Metric label="Claims" value={snapshot.businessHealth.totalClaims.toLocaleString()} />
            <Metric label="Accepted" value={snapshot.businessHealth.accepted.toLocaleString()} />
            <Metric label="Qualifier required" value={snapshot.businessHealth.qualifierRequired.toLocaleString()} />
            <Metric label="Unresolved" value={snapshot.businessHealth.unresolved.toLocaleString()} />
            <Metric label="Would omit / reject" value={`${snapshot.businessHealth.wouldOmit} / ${snapshot.businessHealth.wouldReject}`} />
          </MetricGrid>
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Average validation latency</dt><dd className="mt-1 font-semibold text-ink">{durationLabel(snapshot.businessHealth.averageValidationLatencyMs)}</dd></div>
            <div><dt className="text-muted">p95 validation latency</dt><dd className="mt-1 font-semibold text-ink">{snapshot.businessHealth.p95ValidationLatencyMs === null ? "Insufficient sample" : durationLabel(snapshot.businessHealth.p95ValidationLatencyMs)}</dd></div>
            <div><dt className="text-muted">Sol runs</dt><dd className="mt-1 font-semibold text-ink">{snapshot.businessHealth.solRuns.toLocaleString()}</dd></div>
            <div><dt className="text-muted">Terra fallback runs</dt><dd className="mt-1 font-semibold text-ink">{snapshot.businessHealth.terraFallbackRuns.toLocaleString()} ({percentageLabel(snapshot.businessHealth.fallbackRate)})</dd></div>
            <div><dt className="text-muted">Ruleset versions</dt><dd className="mt-1 break-words font-mono text-xs text-ink">{snapshot.businessHealth.rulesetVersions.join(", ") || "Not recorded"}</dd></div>
            <div><dt className="text-muted">Output contracts</dt><dd className="mt-1 break-words font-mono text-xs text-ink">{snapshot.businessHealth.outputContractVersions.join(", ") || "Not recorded"}</dd></div>
          </dl>
        </SectionCard>

        <SectionCard title="Enforcement Readiness" description="Business Health measurable prerequisites only. This dashboard cannot activate enforcement.">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusBadge label={snapshot.readiness.status} />
            <span className="text-sm font-semibold text-ink">{snapshot.readiness.sampleSize.toLocaleString()} runs</span>
          </div>
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Accepted rate</dt><dd className="mt-1 font-semibold text-ink">{percentageLabel(snapshot.readiness.acceptedRate)}</dd></div>
            <div><dt className="text-muted">Unresolved rate</dt><dd className="mt-1 font-semibold text-ink">{percentageLabel(snapshot.readiness.unresolvedRate)}</dd></div>
            <div><dt className="text-muted">Would-omit rate</dt><dd className="mt-1 font-semibold text-ink">{percentageLabel(snapshot.readiness.wouldOmitRate)}</dd></div>
            <div><dt className="text-muted">Would-reject rate</dt><dd className="mt-1 font-semibold text-ink">{percentageLabel(snapshot.readiness.wouldRejectRate)}</dd></div>
            <div><dt className="text-muted">False-positive reviews</dt><dd className="mt-1 font-semibold text-ink">Not instrumented</dd></div>
            <div><dt className="text-muted">Stable ruleset duration</dt><dd className="mt-1 font-semibold text-ink">{snapshot.readiness.stableRulesetDays === null ? "Not available" : `${snapshot.readiness.stableRulesetDays} days`}</dd></div>
            <div><dt className="text-muted">Privacy incidents</dt><dd className="mt-1 font-semibold text-ink">{snapshot.readiness.privacyIncidents.toLocaleString()}</dd></div>
            <div><dt className="text-muted">Cross-workspace failures</dt><dd className="mt-1 font-semibold text-ink">{snapshot.readiness.crossWorkspaceFailures.toLocaleString()}</dd></div>
            <div><dt className="text-muted">Additional provider calls</dt><dd className="mt-1 font-semibold text-ink">{snapshot.readiness.additionalProviderCalls.toLocaleString()}</dd></div>
            <div><dt className="text-muted">Latest ruleset</dt><dd className="mt-1 break-words font-mono text-xs text-ink">{snapshot.readiness.latestRulesetVersion || "Not recorded"}</dd></div>
          </dl>
          <p className="mt-4 border-t border-line pt-3 text-sm leading-6 text-slate-600">{snapshot.readiness.note}</p>
        </SectionCard>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Explain Finding" description="Partially instrumented provider, artifact, and existing-validator telemetry.">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><StatusBadge label="Partially Instrumented" /><span className="text-xs font-semibold text-muted">Trust claim validation: Not yet instrumented</span></div>
          <MetricGrid columns={3}>
            <Metric label="Runs" value={snapshot.findingExplanation.runs.toLocaleString()} />
            <Metric label="Completed artifacts" value={snapshot.findingExplanation.completedArtifacts.toLocaleString()} />
            <Metric label="Failed artifacts" value={snapshot.findingExplanation.failedArtifacts.toLocaleString()} />
            <Metric label="Validation failures" value={snapshot.findingExplanation.failedValidationAttempts.toLocaleString()} />
            <Metric label="Fallback rate" value={percentageLabel(snapshot.findingExplanation.fallbackRate)} detail={`${snapshot.findingExplanation.fallbackRuns} fallback runs`} />
            <Metric label="Provider latency" value={durationLabel(snapshot.findingExplanation.averageProviderLatencyMs)} />
          </MetricGrid>
          <p className="mt-3 text-sm text-slate-600">Saved Analyses: <span className="font-semibold text-ink">{numberLabel(snapshot.findingExplanation.savedAnalyses)}</span></p>
        </SectionCard>

        <SectionCard title="File Analysis" description="Partially instrumented processing, artifact, provider, and schema diagnostics.">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><StatusBadge label="Partially Instrumented" /><span className="text-xs font-semibold text-muted">Claim Trust: Not yet instrumented</span></div>
          <MetricGrid columns={3}>
            <Metric label="Files processed" value={snapshot.fileAnalysis.runs.toLocaleString()} />
            <Metric label="Completed analyses" value={snapshot.fileAnalysis.completedArtifacts.toLocaleString()} />
            <Metric label="Failed analyses" value={snapshot.fileAnalysis.failedArtifacts.toLocaleString()} />
            <Metric label="Validation failures" value={snapshot.fileAnalysis.failedValidationAttempts.toLocaleString()} />
            <Metric label="Fallback rate" value={percentageLabel(snapshot.fileAnalysis.fallbackRate)} detail={`${snapshot.fileAnalysis.fallbackRuns} fallback runs`} />
            <Metric label="Processing latency" value={durationLabel(snapshot.fileAnalysis.averageProviderLatencyMs)} />
          </MetricGrid>
          <p className="mt-3 text-sm leading-6 text-slate-600">Aggregate evidence-lineage and citation-linkage coverage are not currently available as privacy-safe telemetry. Provider completion is not presented as semantic acceptance.</p>
        </SectionCard>
      </section>

      <SectionCard title="Business Notes Extraction Monitoring" description="Workflow-specific extraction, confidence, provider, human review, and lifecycle measurements. These values do not contribute to reasoning-claim acceptance rates.">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><StatusBadge label="Extraction Monitoring" /><span className="text-xs font-semibold text-muted">Human review remains authoritative</span></div>
        <MetricGrid columns={5}>
          <Metric label="Submitted" value={snapshot.businessNotes.submitted.toLocaleString()} />
          <Metric label="Processed" value={snapshot.businessNotes.processed.toLocaleString()} />
          <Metric label="Successful extractions" value={snapshot.businessNotes.successfulExtractions.toLocaleString()} />
          <Metric label="Extraction failures" value={snapshot.businessNotes.extractionFailures.toLocaleString()} />
          <Metric label="Awaiting review" value={snapshot.businessNotes.awaitingReview.toLocaleString()} />
        </MetricGrid>
        <MetricGrid columns={5}>
          <Metric label="Approved" value={snapshot.businessNotes.approved.toLocaleString()} detail={`${percentageLabel(snapshot.businessNotes.approvalRate)} human approval rate`} />
          <Metric label="Rejected" value={snapshot.businessNotes.rejected.toLocaleString()} />
          <Metric label="Avg / median confidence" value={`${snapshot.businessNotes.averageConfidence ?? "n/a"} / ${snapshot.businessNotes.medianConfidence ?? "n/a"}`} />
          <Metric label="Low confidence" value={snapshot.businessNotes.lowConfidenceCount.toLocaleString()} />
          <Metric label="Processing time" value={durationLabel(snapshot.businessNotes.averageProcessingTimeMs)} />
        </MetricGrid>
        <MetricGrid columns={5}>
          <Metric label="Luna runs" value={snapshot.businessNotes.lunaRuns.toLocaleString()} />
          <Metric label="Terra fallback runs" value={snapshot.businessNotes.terraFallbackRuns.toLocaleString()} detail={percentageLabel(snapshot.businessNotes.fallbackRate)} />
          <Metric label="Human disagreement" value={snapshot.businessNotes.humanDisagreementCount.toLocaleString()} detail={percentageLabel(snapshot.businessNotes.humanDisagreementRate)} />
          <Metric label="Active context" value={snapshot.businessNotes.activeContextRecords.toLocaleString()} />
          <Metric label="Archived context" value={snapshot.businessNotes.archivedContextRecords.toLocaleString()} />
        </MetricGrid>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {snapshot.businessNotes.issueCounts.map((issue) => <div key={issue.label} className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm"><span className="text-slate-600">{issue.label}</span><strong className="text-ink">{issue.count}</strong></div>)}
        </div>
        <p className="mt-3 text-xs leading-5 text-muted">Duplicate-prevention events and structured rejection reason categories are not currently recorded as aggregate telemetry.</p>
      </SectionCard>

      <SectionCard title="Rule Health" description="Privacy-safe reason-code frequencies from instrumented Business Health shadow evaluations. No outcome is labeled a false positive without human review.">
        {snapshot.rules.length ? (
          <div className="vaeroex-mobile-safe-scroll overflow-x-auto rounded-lg border border-line">
            <table className="min-w-[900px] divide-y divide-line text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-muted"><tr><th className="px-3 py-2">Rule</th><th className="px-3 py-2">Workflow</th><th className="px-3 py-2">Occurrences</th><th className="px-3 py-2">Rate</th><th className="px-3 py-2">Severity</th><th className="px-3 py-2">Latest</th><th className="px-3 py-2">Ruleset</th><th className="px-3 py-2">Status</th></tr></thead>
              <tbody className="divide-y divide-line bg-white">
                {snapshot.rules.map((rule) => (
                  <tr key={rule.reasonCode} className="hover:bg-blue-50/40">
                    <td className="px-3 py-3"><p className="font-semibold text-ink">{rule.label}</p><p className="mt-1 font-mono text-[0.68rem] text-muted">{rule.reasonCode}</p></td>
                    <td className="px-3 py-3 text-slate-700">{rule.workflow}</td>
                    <td className="px-3 py-3 font-semibold text-ink">{rule.occurrences.toLocaleString()}</td>
                    <td className="px-3 py-3 text-slate-700">{percentageLabel(rule.occurrenceRate)}</td>
                    <td className="px-3 py-3 capitalize text-slate-700">{rule.severity}</td>
                    <td className="px-3 py-3 text-slate-700">{dateLabel(rule.latestOccurrence)}</td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-700">{rule.rulesetVersion}</td>
                    <td className="px-3 py-3"><StatusBadge label={rule.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No rule issues" description="No privacy-safe Trust reason codes match the selected filters." />}
      </SectionCard>

      <SectionCard title="Provider and Model Health" description="Provider attempts and existing validation diagnostics. A fallback is not interpreted as a quality failure by itself.">
        {snapshot.providers.length ? (
          <div className="vaeroex-mobile-safe-scroll overflow-x-auto rounded-lg border border-line">
            <table className="min-w-[980px] divide-y divide-line text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-muted"><tr><th className="px-3 py-2">Provider / model</th><th className="px-3 py-2">Workflow</th><th className="px-3 py-2">Attempts</th><th className="px-3 py-2">Validated completions</th><th className="px-3 py-2">Fallback</th><th className="px-3 py-2">Provider latency</th><th className="px-3 py-2">Trust latency</th><th className="px-3 py-2">Failure categories</th></tr></thead>
              <tbody className="divide-y divide-line bg-white">
                {snapshot.providers.map((provider) => (
                  <tr key={`${provider.workflow}:${provider.provider}:${provider.model}`} className="align-top hover:bg-blue-50/40">
                    <td className="px-3 py-3"><p className="font-semibold text-ink">{provider.provider}</p><p className="mt-1 break-all font-mono text-[0.68rem] text-muted">{provider.model}</p></td>
                    <td className="px-3 py-3 text-slate-700">{provider.workflow}</td>
                    <td className="px-3 py-3 font-semibold text-ink">{provider.attempts.toLocaleString()}</td>
                    <td className="px-3 py-3 text-slate-700">{provider.successfulValidatedCompletions.toLocaleString()}</td>
                    <td className="px-3 py-3 text-slate-700">{provider.fallbackCount} ({percentageLabel(provider.fallbackRate)})</td>
                    <td className="px-3 py-3 text-slate-700">{durationLabel(provider.averageProviderLatencyMs)}</td>
                    <td className="px-3 py-3 text-slate-700">{durationLabel(provider.averageTrustValidationLatencyMs)}</td>
                    <td className="px-3 py-3 text-xs text-slate-700">{provider.failureCategories.length ? provider.failureCategories.map((failure) => `${failure.code} (${failure.count})`).join(", ") : "None recorded"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No provider telemetry" description="No provider attempts match the selected filters." />}
      </SectionCard>

      {snapshot.selectedEvaluation ? (
        <SectionCard title="Privacy-Safe Evaluation Detail" description="Hashed references and approved operational metadata only. Customer content and raw identifiers are not queried.">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-mono text-xs text-muted">{snapshot.selectedEvaluation.id}</p><p className="mt-1 text-sm font-semibold text-ink">{dateLabel(snapshot.selectedEvaluation.createdAt)}</p></div>
            <StatusBadge label="Shadow only" />
          </div>
          <dl className="mt-4 grid gap-x-6 gap-y-3 border-y border-line py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-muted">Workflow</dt><dd className="mt-1 font-semibold text-ink">{snapshot.selectedEvaluation.workflow}</dd></div>
            <div><dt className="text-muted">Release channel</dt><dd className="mt-1 font-semibold text-ink">{snapshot.selectedEvaluation.releaseChannel}</dd></div>
            <div><dt className="text-muted">Provider / model</dt><dd className="mt-1 break-all font-semibold text-ink">{snapshot.selectedEvaluation.provider} / {snapshot.selectedEvaluation.model}</dd></div>
            <div><dt className="text-muted">Ruleset</dt><dd className="mt-1 break-all font-mono text-xs text-ink">{snapshot.selectedEvaluation.rulesetVersion}</dd></div>
            <div><dt className="text-muted">Output contract</dt><dd className="mt-1 break-all font-mono text-xs text-ink">{snapshot.selectedEvaluation.outputContractVersion}</dd></div>
            <div><dt className="text-muted">Validator</dt><dd className="mt-1 break-all font-mono text-xs text-ink">{snapshot.selectedEvaluation.validatorVersion}</dd></div>
            <div><dt className="text-muted">Claims</dt><dd className="mt-1 font-semibold text-ink">{snapshot.selectedEvaluation.claimCount}</dd></div>
            <div><dt className="text-muted">Validation latency</dt><dd className="mt-1 font-semibold text-ink">{durationLabel(snapshot.selectedEvaluation.validationLatencyMs)}</dd></div>
            <div><dt className="text-muted">Cache / fallback / stale</dt><dd className="mt-1 font-semibold text-ink">{snapshot.selectedEvaluation.cacheState} / {snapshot.selectedEvaluation.fallbackUsed ? "yes" : "no"} / {snapshot.selectedEvaluation.stale ? "yes" : "no"}</dd></div>
            <div><dt className="text-muted">Snapshot fingerprint</dt><dd className="mt-1 font-mono text-xs text-ink">{shortFingerprint(snapshot.selectedEvaluation.snapshotFingerprint)}</dd></div>
            <div><dt className="text-muted">Projection fingerprint</dt><dd className="mt-1 font-mono text-xs text-ink">{shortFingerprint(snapshot.selectedEvaluation.projectionFingerprint)}</dd></div>
            <div><dt className="text-muted">Manifest fingerprint</dt><dd className="mt-1 font-mono text-xs text-ink">{shortFingerprint(snapshot.selectedEvaluation.manifestFingerprint)}</dd></div>
            <div><dt className="text-muted">Output hash</dt><dd className="mt-1 font-mono text-xs text-ink">{shortFingerprint(snapshot.selectedEvaluation.outputHash)}</dd></div>
            <div><dt className="text-muted">Trust fingerprint</dt><dd className="mt-1 font-mono text-xs text-ink">{shortFingerprint(snapshot.selectedEvaluation.trustFingerprint)}</dd></div>
            <div><dt className="text-muted">Provider request reference</dt><dd className="mt-1 font-mono text-xs text-ink">{snapshot.selectedEvaluation.providerRequestRef || "Not recorded"}</dd></div>
            <div><dt className="text-muted">Repair / extra calls</dt><dd className="mt-1 font-semibold text-ink">{snapshot.selectedEvaluation.repairCount} / {snapshot.selectedEvaluation.additionalProviderCalls}</dd></div>
          </dl>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div><h4 className="text-sm font-semibold text-ink">Claim taxonomy</h4><ul className="mt-2 space-y-1 text-sm text-slate-700">{Object.entries(snapshot.selectedEvaluation.claimsByTaxonomy).map(([label, count]) => <li key={label} className="flex justify-between gap-3"><span>{label.replaceAll("_", " ")}</span><strong>{count}</strong></li>)}</ul></div>
            <div><h4 className="text-sm font-semibold text-ink">Outcome counts</h4><ul className="mt-2 space-y-1 text-sm text-slate-700">{Object.entries(snapshot.selectedEvaluation.claimOutcomes).map(([label, count]) => <li key={label} className="flex justify-between gap-3"><span>{label.replaceAll("_", " ")}</span><strong>{count}</strong></li>)}</ul></div>
            <div><h4 className="text-sm font-semibold text-ink">Reason codes</h4><ul className="mt-2 space-y-1 text-sm text-slate-700">{Object.entries(snapshot.selectedEvaluation.reasonFrequencies).map(([label, count]) => <li key={label} className="flex justify-between gap-3"><span className="break-all font-mono text-xs">{label}</span><strong>{count}</strong></li>)}</ul></div>
          </div>
          <div className="mt-4 border-t border-line pt-4"><h4 className="text-sm font-semibold text-ink">Hashed claim references</h4>{snapshot.selectedEvaluation.claimRefs.length ? <div className="mt-2 vaeroex-mobile-safe-scroll overflow-x-auto"><table className="min-w-[700px] text-xs"><thead className="text-left font-semibold uppercase text-muted"><tr><th className="py-2 pr-4">Claim</th><th className="py-2 pr-4">Section</th><th className="py-2 pr-4">Type</th><th className="py-2 pr-4">Hash</th><th className="py-2">Outcome</th></tr></thead><tbody className="divide-y divide-line">{snapshot.selectedEvaluation.claimRefs.map((claim) => <tr key={claim.claimId}><td className="py-2 pr-4 font-mono">{claim.claimId}</td><td className="py-2 pr-4 font-mono">{claim.sectionId}</td><td className="py-2 pr-4">{claim.claimType}</td><td className="py-2 pr-4 font-mono">{shortFingerprint(claim.claimTextHash)}</td><td className="py-2">{claim.outcomes.join(", ") || "accepted"}</td></tr>)}</tbody></table></div> : <p className="mt-2 text-sm text-muted">No claim references were recorded for this evaluation.</p>}</div>
        </SectionCard>
      ) : null}

      <SectionCard title="Trust Evaluations" description="Paginated privacy-safe Business Health evaluations. Inspecting a row never loads generated prose or source content.">
        {snapshot.evaluations.length ? (
          <>
            <div className="vaeroex-mobile-safe-scroll overflow-x-auto rounded-lg border border-line">
              <table className="min-w-[900px] divide-y divide-line text-sm"><thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-muted"><tr><th className="px-3 py-2">Timestamp</th><th className="px-3 py-2">Provider / model</th><th className="px-3 py-2">Claims</th><th className="px-3 py-2">Outcome</th><th className="px-3 py-2">Latency</th><th className="px-3 py-2">State</th><th className="px-3 py-2"><span className="sr-only">Action</span></th></tr></thead><tbody className="divide-y divide-line bg-white">{snapshot.evaluations.map((evaluation) => <tr key={evaluation.id} className="hover:bg-blue-50/40 focus-within:bg-blue-50/40"><td className="px-3 py-3"><p className="font-medium text-ink">{dateLabel(evaluation.createdAt)}</p><p className="mt-1 font-mono text-[0.68rem] text-muted">{evaluation.releaseChannel}</p></td><td className="px-3 py-3"><p className="font-semibold text-ink">{evaluation.provider}</p><p className="mt-1 font-mono text-[0.68rem] text-muted">{evaluation.model}</p></td><td className="px-3 py-3 font-semibold text-ink">{evaluation.claimCount}</td><td className="px-3 py-3 text-xs text-slate-700">{evaluation.claimOutcomes.accepted} accepted, {evaluation.claimOutcomes.unresolved} unresolved</td><td className="px-3 py-3 text-slate-700">{durationLabel(evaluation.validationLatencyMs)}</td><td className="px-3 py-3 text-xs text-slate-700">{evaluation.cacheState}; {evaluation.fallbackUsed ? "fallback" : "primary"}</td><td className="px-3 py-3 text-right"><Link href={trustHref(filters, { evaluation: evaluation.id })} className="inline-flex min-h-10 items-center gap-1 rounded-md border border-line px-3 py-2 text-xs font-semibold text-vaeroex-blue hover:border-vaeroex-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-blue/30">Inspect <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></Link></td></tr>)}</tbody></table>
            </div>
            <div className="mt-3 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between"><p className="text-muted">{snapshot.evaluationCount.toLocaleString()} matching evaluations</p><div className="flex items-center gap-2">{filters.page > 1 ? <Link href={trustHref(filters, { page: filters.page - 1, evaluation: "" })} className="inline-flex min-h-10 items-center rounded-md border border-line px-3 py-2 font-semibold text-ink hover:border-vaeroex-blue">Previous</Link> : <span className="inline-flex min-h-10 items-center rounded-md border border-line px-3 py-2 text-slate-400">Previous</span>}<span className="px-2 font-medium">Page {Math.min(filters.page, snapshot.totalEvaluationPages)} of {snapshot.totalEvaluationPages}</span>{filters.page < snapshot.totalEvaluationPages ? <Link href={trustHref(filters, { page: filters.page + 1, evaluation: "" })} className="inline-flex min-h-10 items-center rounded-md border border-line px-3 py-2 font-semibold text-ink hover:border-vaeroex-blue">Next</Link> : <span className="inline-flex min-h-10 items-center rounded-md border border-line px-3 py-2 text-slate-400">Next</span>}</div></div>
          </>
        ) : <EmptyState title="No Trust evaluations" description="No privacy-safe Business Health Trust evaluations match the selected filters." />}
      </SectionCard>
    </div>
  );
}

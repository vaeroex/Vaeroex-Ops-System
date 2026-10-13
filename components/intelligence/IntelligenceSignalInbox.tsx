"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, History, Pin, PinOff, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { explainFindingAction } from "@/app/app/finding-explanation/actions";
import { mutateIntelligenceCardLifecycleAction } from "@/app/app/intelligence/lifecycle-actions";
import { SaveAnalysisButton } from "@/components/reports/SaveAnalysisButton";
import type { FindingExplanationState } from "@/lib/ai/finding-explanation/contracts";
import type {
  IntelligenceCardLifecycleAction,
  IntelligenceCardLifecycleReason,
  IntelligenceLifecycleCardV1
} from "@/lib/intelligence/card-lifecycle/contracts";
import { sortIntelligenceLifecycleCardsV1 } from "@/lib/intelligence/card-lifecycle/presentation";
import {
  buildEvidenceActivity,
  buildEvidenceGroups,
  collapsedEvidenceGroupLimit,
  selectCollapsedRepresentatives,
  supportingEvidenceHref
} from "@/lib/intelligence/evidence-groups";
import type { IntelligenceConfidence, IntelligenceEvidenceRecord, IntelligenceInsight, IntelligenceInsightType } from "@/lib/intelligence/layer";
import type { IntelligenceBlockedState } from "@/lib/intelligence/blocked-state";
import {
  findingCategoryStatus,
  findingPriorityStatus,
  semanticPresentation,
  semanticStatusClass
} from "@/lib/presentation/semantic-status";

import { findingPage, findingPageNumbers, findingPageSize, repeatsFindingFigures } from "@/lib/presentation/finding-pagination";

const signalTypes: IntelligenceInsightType[] = ["Risk", "Opportunity", "Forecast", "Bottleneck", "Recommendation", "Anomaly"];
type SignalView = "All" | IntelligenceInsightType;
const pageSize = findingPageSize;

type PanelMode = "summary" | "evidence" | "analysis";
type LifecycleView = "current" | "history";

function confidenceClass(confidence: IntelligenceConfidence) {
  return `vaeroex-confidence-badge vaeroex-confidence-${confidence.toLowerCase()}`;
}

function typeEmptyMessage(type: SignalView) {
  if (type === "All") return "No evidence-backed findings currently require leadership review.";
  if (type === "Forecast") return "No forecast signals have enough historical evidence yet.";
  if (type === "Opportunity") return "No evidence-backed opportunity is ready for review.";
  return `No ${type.toLowerCase()} signals currently require attention.`;
}

function typeTabLabel(type: SignalView) {
  if (type === "All") return "All findings";
  if (type === "Opportunity") return "Opportunities";
  if (type === "Anomaly") return "Anomalies";
  return `${type}s`;
}

function formatSignalDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  // Reporting dates are calendar days, not browser-local midnight instants.
  // Actual timestamps use an explicit, labeled zone on both server and client.
  const label = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? label : `${label} UTC`;
}

function formatLifecycleTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(date) + " UTC";
}

function dismissalReasonLabel(reason: IntelligenceCardLifecycleReason | null) {
  if (reason === "temporary") return "Temporary condition";
  if (reason === "irrelevant") return "Not relevant";
  if (reason === "duplicate") return "Duplicate";
  if (reason === "not_material") return "Not material";
  if (reason === "other") return "Other";
  return "Not specified";
}

function compactText(value: string, maxLength = 150) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/\s+\S*$/, "").trim()}...`;
}

function limitationFor(insight: IntelligenceInsight) {
  return insight.limitation || insight.suggestedNextData || "Not enough evidence for a reliable conclusion.";
}

function lacksFindingSpecificity(insight: IntelligenceInsight) {
  const gaps = [...insight.missingEvidence, insight.limitation || "", insight.suggestedNextData || ""]
    .join(" ")
    .toLowerCase();
  const missingSpecificFields = ["owner", "outcome", "completion", "completed", "measurable", "date", "period"]
    .filter((field) => gaps.includes(field));

  return insight.confidence === "Low" && missingSpecificFields.length >= 2;
}

function evidenceDateRange(firstObserved: string, lastObserved: string) {
  if (!firstObserved && !lastObserved) return "Date unavailable";
  if (!firstObserved || firstObserved === lastObserved) return formatSignalDate(lastObserved || firstObserved);
  return `${formatSignalDate(firstObserved)} - ${formatSignalDate(lastObserved)}`;
}

function PanelTabs({
  mode,
  onChange,
  analysisAvailable,
}: {
  mode: PanelMode;
  onChange: (mode: PanelMode) => void;
  analysisAvailable: boolean;
}) {
  const tabs: Array<{ id: PanelMode; label: string }> = [
    { id: "summary", label: "Summary" },
    { id: "evidence", label: "Evidence" },
    ...(analysisAvailable ? [{ id: "analysis" as const, label: "Analysis" }] : [])
  ];

  return (
    <div className={`workspace-finding-tabs grid ${analysisAvailable ? "grid-cols-3" : "grid-cols-2"} rounded-lg border border-white/10 bg-slate-950/50 p-1`} role="tablist" aria-label="Selected finding view">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={mode === tab.id}
          onClick={() => onChange(tab.id)}
          className={`vaeroex-semantic-interactive min-h-10 rounded-md px-2 py-2 text-xs font-semibold transition ${
            mode === tab.id ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function SummaryPanel({
  insight,
  canExplain,
  onExplain
}: {
  insight: IntelligenceInsight;
  canExplain: boolean;
  onExplain: () => void;
}) {
  if (lacksFindingSpecificity(insight)) {
    return (
      <div className="space-y-3 text-sm leading-6">
        <p className="text-slate-100">Vaeroex found related records, but the available information does not identify an owner, completed outcome, or measurable business effect.</p>
        <p className="rounded-lg border border-amber-300/20 bg-amber-950/15 p-3 text-amber-100">More information needed: owner, completion status, and outcome.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm leading-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">What happened</p>
        <p className="mt-2 text-slate-100">{insight.summary}</p>
      </section>
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Why it matters</p>
        <p className="mt-2 text-slate-200">{insight.impact}</p>
      </section>
      <section className="border-l-2 border-slate-500 pl-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100">Leadership decision</p>
        <p className="mt-2 break-words text-slate-100">{insight.recommendedAction}</p>
      </section>
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Limitation</p>
        <p className="mt-2 text-slate-300">{limitationFor(insight)}</p>
      </section>
      {insight.type === "Risk" || insight.type === "Anomaly" || insight.type === "Bottleneck" ? (
        canExplain ? (
          <button
            type="button"
            onClick={onExplain}
            className="vaeroex-semantic-interactive inline-flex min-h-10 items-center rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Explain Finding
          </button>
        ) : null
      ) : null}
    </div>
  );
}

function FindingExplanationPanel({
  state,
  onRetry,
  pending
}: {
  state: FindingExplanationState;
  onRetry: () => void;
  pending: boolean;
}) {
  if (state.status === "available" || state.status === "loading") {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4" role="status">
        <p className="text-sm font-semibold text-white">Investigating this finding</p>
        <p className="mt-2 text-sm leading-6 text-slate-300">Vaeroex is preparing a bounded explanation from the validated finding and its eligible evidence.</p>
      </div>
    );
  }
  if (!state.artifact) {
    return (
      <div className="space-y-3 rounded-lg border border-amber-300/20 bg-amber-950/10 p-4">
        <p className="text-sm font-semibold text-amber-100">Explanation unavailable</p>
        <p className="text-sm leading-6 text-slate-300">{state.message || "This finding could not be explained right now."}</p>
        <button type="button" onClick={onRetry} disabled={pending} className="min-h-10 rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold text-white hover:bg-white/[0.06] disabled:opacity-60">
          Try again
        </button>
      </div>
    );
  }

  const { analysis, citations } = state.artifact;
  const sections = [
    ["What happened", analysis.what_happened],
    ["Why the evidence suggests it", analysis.why_evidence_suggests],
    ["Why leadership should care", analysis.why_leadership_should_care],
    ["What to investigate next", analysis.investigate_next],
    ["What the evidence does not prove", analysis.what_evidence_does_not_prove]
  ] as const;
  return (
    <div className="space-y-4 text-sm leading-6">
      {sections.map(([label, value]) => (
        <section key={label}>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
          <p className="mt-2 text-slate-100">{value}</p>
        </section>
      ))}
      <details className="border-t border-white/10 pt-3">
        <summary className="min-h-10 cursor-pointer text-xs font-semibold text-cyan-200">Supporting evidence ({citations.length})</summary>
        <ol className="mt-2 divide-y divide-white/10">
          {citations.map((citation) => (
            <li key={citation.citationId} className="py-3">
              <p className="text-xs font-semibold text-white">[{citation.citationId}] {citation.title}</p>
              <p className="mt-1 text-[11px] text-slate-500">{citation.sourceLabel} · {citation.sourceType}</p>
              <p className="mt-1 text-xs leading-5 text-slate-300">{citation.excerpt}</p>
            </li>
          ))}
        </ol>
      </details>
      <SaveAnalysisButton analysisType="finding_explanation" fingerprint={state.artifact.fingerprint} generatedAt={state.artifact.generatedAt} />
    </div>
  );
}

function EvidenceRecordRow({ record }: { record: IntelligenceEvidenceRecord }) {
  return (
    <li className="border-t border-white/10 py-2.5 first:border-t-0">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <Link href={record.href as Route} className="break-words text-xs font-semibold text-cyan-100 underline-offset-4 hover:text-white hover:underline">
            {record.title}
          </Link>
          <p className="mt-0.5 text-[11px] text-slate-500">{record.recordType} · {formatSignalDate(record.date)}{record.classification === "Manual" ? "" : ` · ${record.classification}`}</p>
        </div>
        <span className="break-words text-xs font-semibold text-slate-200 sm:max-w-44 sm:text-right">{record.value}</span>
      </div>
      <p className="mt-1.5 break-words text-xs leading-5 text-slate-400">{record.support}</p>
    </li>
  );
}

function EvidencePanel({ insight }: { insight: IntelligenceInsight }) {
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [expandedRecordLimit, setExpandedRecordLimit] = useState(10);
  const groups = useMemo(() => buildEvidenceGroups(insight.supportingRecords), [insight.supportingRecords]);
  const representatives = useMemo(() => selectCollapsedRepresentatives(groups), [groups]);
  const activity = useMemo(() => buildEvidenceActivity(insight.supportingRecords), [insight.supportingRecords]);
  const activityMax = Math.max(...activity.map((item) => item.count), 1);
  const visibleGroups = showAllGroups ? groups : groups.slice(0, collapsedEvidenceGroupLimit);
  const latestEvidenceDate = [...insight.supportingRecords]
    .map((record) => record.date)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0] || insight.lastUpdated;
  const viewAllHref = supportingEvidenceHref(insight) as Route;

  function toggleGroup(key: string) {
    setExpandedGroupKey((current) => current === key ? null : key);
    setExpandedRecordLimit(10);
  }

  return (
    <div className="space-y-4 text-sm leading-6">
      <p className="text-sm leading-6 text-slate-200">These records explain why Vaeroex believes this finding.</p>
      <div className="grid gap-x-4 gap-y-2 border-y border-white/10 py-3 text-xs text-slate-300 sm:grid-cols-2">
        <p><span className="font-semibold text-slate-100">Supporting records:</span> {insight.evidenceCount}</p>
        <p><span className="font-semibold text-slate-100">Independent sources:</span> {insight.independentSourceCount}</p>
        <p><span className="font-semibold text-slate-100">Recent evidence:</span> {formatSignalDate(latestEvidenceDate)}</p>
        <p><span className="font-semibold text-slate-100">Period:</span> {insight.timePeriod === "Current imported records" ? "Dates shown in supporting evidence" : insight.timePeriod}</p>
        <p><span className="font-semibold text-slate-100">Evidence strength:</span> {insight.confidence}</p>
        {insight.contradictoryEvidence.length ? <p><span className="font-semibold text-slate-100">Contradictions:</span> {insight.contradictoryEvidence.length}</p> : null}
      </div>

      {activity.length > 1 ? (
        <section aria-label="Evidence activity by month">
          <div className="flex items-end justify-between gap-3">
            <p className="text-xs font-semibold text-slate-100">Activity by month</p>
            <p className="text-[11px] text-slate-500">Eligible records</p>
          </div>
          <div className="mt-2 grid grid-flow-col auto-cols-fr items-end gap-1.5" style={{ minHeight: "3.25rem" }}>
            {activity.map((point) => {
              return (
                <div key={point.key} className="grid h-full grid-rows-[1fr_auto] gap-1 text-center">
                  <div className="flex items-end justify-center">
                    <span className="w-full max-w-8 rounded-t-sm bg-cyan-400/45" style={{ height: `${Math.max(8, Math.round((point.count / activityMax) * 34))}px` }} title={`${point.count} records in ${point.label}`} />
                  </div>
                  <span className="text-[10px] font-semibold text-slate-500">{point.label}</span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {visibleGroups.length ? (
        <section className="space-y-2" aria-label="Supporting evidence groups">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-slate-100">Evidence groups</p>
            <p className="text-[11px] text-slate-500">{groups.length} group{groups.length === 1 ? "" : "s"}</p>
          </div>
          {visibleGroups.map((group) => {
            const expanded = expandedGroupKey === group.key;
            const records = expanded ? group.records.slice(0, expandedRecordLimit) : representatives[group.key] || [];

            return (
              <article key={group.key} className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={expanded}
                  className="flex min-h-10 w-full items-start justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                >
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-semibold text-white">{group.title}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">{group.records.length} record{group.records.length === 1 ? "" : "s"} · {evidenceDateRange(group.firstObserved, group.lastObserved)}</span>
                  </span>
                  <span className="shrink-0 pt-0.5 text-xs font-semibold text-cyan-200">{expanded ? "Collapse" : "Expand"}</span>
                </button>
                <p className="mt-1 text-xs leading-5 text-slate-400">{group.explanation}</p>
                {records.length ? <ul className="mt-2">{records.map((record) => <EvidenceRecordRow key={record.id} record={record} />)}</ul> : null}
                {expanded && group.records.length > records.length ? (
                  <button type="button" onClick={() => setExpandedRecordLimit((limit) => limit + 10)} className="mt-2 min-h-9 text-xs font-semibold text-cyan-200 hover:text-white">
                    View 10 more
                  </button>
                ) : null}
              </article>
            );
          })}
          {groups.length > collapsedEvidenceGroupLimit ? (
            <button
              type="button"
              onClick={() => {
                setShowAllGroups((current) => !current);
                setExpandedGroupKey(null);
              }}
              className="min-h-10 text-xs font-semibold text-cyan-200 hover:text-white"
            >
              {showAllGroups ? "Show fewer evidence groups" : `Show ${groups.length - collapsedEvidenceGroupLimit} more evidence groups`}
            </button>
          ) : null}
        </section>
      ) : <p className="rounded-lg border border-dashed border-white/15 p-4 text-sm text-slate-400">No eligible supporting records are available for this finding.</p>}

      <Link href={viewAllHref} className="inline-flex min-h-10 items-center text-xs font-semibold text-cyan-200 underline-offset-4 hover:text-white hover:underline">
        View all supporting records
      </Link>

      <div className={`grid gap-3 border-t border-white/10 pt-3 text-xs leading-5 ${insight.contradictoryEvidence.length ? "sm:grid-cols-2" : ""}`}>
        {insight.contradictoryEvidence.length ? (
          <div>
            <p className="font-semibold text-slate-100">Contradictory evidence</p>
            <p className="mt-1 text-slate-400">{insight.contradictoryEvidence.join("; ")}</p>
          </div>
        ) : null}
        <div>
          <p className="font-semibold text-slate-100">Missing evidence</p>
          <p className="mt-1 text-slate-400">{insight.missingEvidence.length ? insight.missingEvidence.join("; ") : "No material gap recorded."}</p>
        </div>
      </div>
    </div>
  );
}

const attentionTypes = new Set<IntelligenceInsightType>(["Risk", "Bottleneck", "Anomaly"]);
const improvementTypes = new Set<IntelligenceInsightType>(["Opportunity", "Recommendation", "Forecast"]);

function lifecycleStatusLabel(card: IntelligenceLifecycleCardV1) {
  if (card.currentFeedStatus === "not_currently_surfaced") return "Not currently surfaced";
  if (card.reopenReason === "material_change") return card.reopenedFrom === "dismissed" ? "Updated since dismissal" : "Updated since acknowledgement";
  if (card.reopenReason === "recheck_due") return "Review period reached";
  if (card.lifecycleState === "acknowledged") return "Acknowledged";
  if (card.lifecycleState === "dismissed") return "Dismissed";
  return null;
}

function LeadershipDisposition({ card }: { card: IntelligenceLifecycleCardV1 }) {
  return (
    <section className="rounded-lg border border-slate-500/30 bg-slate-950/45 p-4" aria-labelledby="leadership-disposition-heading">
      <h4 id="leadership-disposition-heading" className="text-sm font-semibold text-white">Leadership disposition</h4>
      <p className="mt-1 text-xs leading-5 text-slate-400">These actions only affect how this finding is presented. They do not change your business data, Business Memory, or Business Health.</p>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
        <dt className="text-slate-400">Status</dt>
        <dd className="font-medium text-slate-100">Dismissed</dd>
        <dt className="text-slate-400">Reason</dt>
        <dd className="text-slate-100">{dismissalReasonLabel(card.reasonCode)}</dd>
        {card.reasonText ? (
          <>
            <dt className="text-slate-400">Note</dt>
            <dd className="whitespace-pre-wrap break-words text-slate-100">{card.reasonText}</dd>
          </>
        ) : null}
        <dt className="text-slate-400">Dismissed by</dt>
        <dd className="text-slate-100">{card.dismissedBy || "Workspace leader"}</dd>
        <dt className="text-slate-400">Dismissed</dt>
        <dd className="text-slate-100">{card.stateChangedAt ? formatLifecycleTimestamp(card.stateChangedAt) : "Date unavailable"}</dd>
        {card.recheckAfter ? (
          <>
            <dt className="text-slate-400">Recheck after</dt>
            <dd className="text-slate-100">{formatLifecycleTimestamp(card.recheckAfter)}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

export function IntelligenceSignalInbox({
  currentCards,
  historyCards,
  workspaceId = "",
  initialFindingId,
  explanationTokens = {},
  canManageLifecycle,
  blockedState = null
}: {
  workspaceId?: string;
  currentCards: IntelligenceLifecycleCardV1[];
  historyCards: IntelligenceLifecycleCardV1[];
  initialFindingId?: string;
  explanationTokens?: Readonly<Record<string, string>>;
  canManageLifecycle: boolean;
  blockedState?: IntelligenceBlockedState | null;
}) {
  const router = useRouter();
  const pageForCard = useCallback((card: IntelligenceLifecycleCardV1) => {
    const ordered = sortIntelligenceLifecycleCardsV1(card.view === "current" ? currentCards : historyCards);
    return Math.floor(ordered.findIndex(item => item.findingKeyHash === card.findingKeyHash) / pageSize) + 1;
  }, [currentCards, historyCards]);
  const requestedCard = initialFindingId ? [...currentCards, ...historyCards].find((card) => card.findingId === initialFindingId) : null;
  const [lifecycleView, setLifecycleView] = useState<LifecycleView>(requestedCard?.view || "current");
  const [activeType, setActiveType] = useState<SignalView>("All");
  const [selectedKey, setSelectedKey] = useState<string>(() => requestedCard?.findingKeyHash || sortIntelligenceLifecycleCardsV1(currentCards)[0]?.findingKeyHash || "");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(Boolean(requestedCard));
  const [hideLowConfidence, setHideLowConfidence] = useState(false);
  const [page, setPage] = useState(() => requestedCard ? pageForCard(requestedCard) : 1);
  const [panelMode, setPanelMode] = useState<PanelMode>("summary");
  const [explanationStates, setExplanationStates] = useState<Record<string, FindingExplanationState>>({});
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissReason, setDismissReason] = useState<IntelligenceCardLifecycleReason>("temporary");
  const [dismissNote, setDismissNote] = useState("");
  const [lifecycleMessage, setLifecycleMessage] = useState<string | null>(null);
  const [isExplanationPending, startExplanationTransition] = useTransition();
  const [isLifecyclePending, startLifecycleTransition] = useTransition();
  const explanationInFlight = useRef<Set<string>>(new Set());
  const detailRef = useRef<HTMLElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listReturnRef = useRef<{ top: number; trigger: HTMLButtonElement | null }>({ top: 0, trigger: null });

  useEffect(() => {
    if (!mobileDetailOpen || !window.matchMedia("(max-width: 1279px)").matches) return;
    detailRef.current?.focus({ preventScroll: true });
    detailRef.current?.scrollIntoView({ block: "start" });
  }, [mobileDetailOpen, selectedKey]);

  // UI-only history belongs to this workspace. Native history integrates with
  // Next without a server navigation or regenerating evidence on selection.
  type NavigationState = { workspaceId: string; lifecycleView: LifecycleView; activeType: SignalView; selectedKey: string; mobileDetailOpen: boolean; hideLowConfidence: boolean; page: number; panelMode: PanelMode; listTop: number; returnEntry: boolean };
  const navigationRef = useRef<NavigationState | null>(null);
  const returnEntryRef = useRef(false);
  navigationRef.current = { workspaceId, lifecycleView, activeType, selectedKey, mobileDetailOpen, hideLowConfidence, page, panelMode, listTop: listReturnRef.current.top, returnEntry: returnEntryRef.current };

  const commitNavigation = useCallback((overrides: Partial<NavigationState>, push = false) => {
    if (typeof window === "undefined" || !window.history || !window.location) return;
    const state = { ...navigationRef.current!, ...overrides };
    const url = new URL(window.location.href);
    const card = [...currentCards, ...historyCards].find(item => item.findingKeyHash === state.selectedKey);
    if (state.mobileDetailOpen && card) url.searchParams.set("finding", card.findingId);
    else url.searchParams.delete("finding");
    window.history[push ? "pushState" : "replaceState"]({ ...window.history.state, vaeroexFindings: state }, "", `${url.pathname}${url.search}${url.hash}`);
    navigationRef.current = state;
    returnEntryRef.current = state.returnEntry;
  }, [currentCards, historyCards]);

  useEffect(() => {
    function restore() {
      const candidate = window.history.state?.vaeroexFindings as NavigationState | undefined;
      const valid = candidate?.workspaceId === workspaceId && ["current", "history"].includes(candidate.lifecycleView)
        && ["All", ...signalTypes].includes(candidate.activeType) && ["summary", "evidence", "analysis"].includes(candidate.panelMode)
        && Number.isSafeInteger(candidate.page) && candidate.page >= 1 && Number.isFinite(candidate.listTop);
      const requested = new URLSearchParams(window.location.search).get("finding");
      const linked = [...currentCards, ...historyCards].find(card => card.findingId === requested);
      if (valid && candidate) {
        setLifecycleView(candidate.lifecycleView); setActiveType(candidate.activeType); setHideLowConfidence(candidate.hideLowConfidence);
        setPage(candidate.page); setSelectedKey(candidate.selectedKey); setMobileDetailOpen(candidate.mobileDetailOpen);
        setPanelMode(candidate.panelMode); returnEntryRef.current = candidate.returnEntry;
        listReturnRef.current.top = candidate.listTop;
        if (!candidate.mobileDetailOpen) window.requestAnimationFrame(() => {
          focusListSelection(candidate.selectedKey);
          window.scrollTo({ top: candidate.listTop, behavior: "instant" });
        });
      } else if (linked) {
        setPage(pageForCard(linked)); setLifecycleView(linked.view); setActiveType("All"); setHideLowConfidence(false); setSelectedKey(linked.findingKeyHash); setMobileDetailOpen(true); setPanelMode("summary");
        returnEntryRef.current = false;
      }
      else { commitNavigation({}); }
      setDismissOpen(false);
    }
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [workspaceId, currentCards, historyCards, commitNavigation, pageForCard]);

  const viewCards = lifecycleView === "current" ? currentCards : historyCards;
  const counts = useMemo(
    () => signalTypes.reduce<Record<SignalView, number>>((acc, type) => ({ ...acc, [type]: viewCards.filter((card) => card.snapshot.type === type).length }), { All: viewCards.length } as Record<SignalView, number>),
    [viewCards]
  );
  const visibleTypes = useMemo<SignalView[]>(() => ["All", ...signalTypes.filter((type) => counts[type] > 0)], [counts]);
  const filteredCards = useMemo(
    () => sortIntelligenceLifecycleCardsV1(viewCards
      .filter((card) => activeType === "All" || card.snapshot.type === activeType)
      .filter((card) => !hideLowConfidence || card.snapshot.confidence !== "Low")),
    [activeType, hideLowConfidence, viewCards]
  );
  const pagination = findingPage(filteredCards, page);
  const pagedCards = pagination.items;
  const selectedCard = pagedCards.find(card => card.findingKeyHash === selectedKey) || pagedCards[0] || null;
  const selectedInsight = selectedCard?.insight || null;
  const currentAttention = pagedCards.filter(card => attentionTypes.has(card.snapshot.type));
  const currentImprovements = pagedCards.filter(card => improvementTypes.has(card.snapshot.type));

  // A refresh can remove the final row or change its order. Clamp immediately for
  // rendering, then reconcile the stored page/selection and its history entry.
  useEffect(() => {
    const nextKey = selectedCard?.findingKeyHash || "";
    if (page === pagination.page && selectedKey === nextKey) return;
    setPage(pagination.page); setSelectedKey(nextKey); setMobileDetailOpen(false);
    setPanelMode("summary"); setDismissOpen(false);
    commitNavigation({ page: pagination.page, selectedKey: nextKey, mobileDetailOpen: false, panelMode: "summary", returnEntry: false });
  }, [pagination.page, page, selectedKey, selectedCard?.findingKeyHash, commitNavigation]);

  function focusListSelection(key: string) {
    const trigger = Array.from(sectionRef.current?.querySelectorAll<HTMLButtonElement>("[data-finding-key]") || [])
      .find(row => row.dataset.findingKey === key);
    (trigger || listReturnRef.current.trigger)?.focus({ preventScroll: true });
  }

  function browse(overrides: Partial<NavigationState>) {
    if (typeof window !== "undefined") commitNavigation({ listTop: window.scrollY });
    commitNavigation({ ...overrides, mobileDetailOpen: false, panelMode: "summary", returnEntry: false }, true);
    setMobileDetailOpen(false); setPanelMode("summary"); setDismissOpen(false);
  }

  function selectView(view: LifecycleView) {
    const cards = sortIntelligenceLifecycleCardsV1((view === "current" ? currentCards : historyCards)
      .filter(card => !hideLowConfidence || card.snapshot.confidence !== "Low"));
    browse({ lifecycleView: view, activeType: "All", selectedKey: cards[0]?.findingKeyHash || "", page: 1 });
    setLifecycleView(view); setActiveType("All"); setSelectedKey(cards[0]?.findingKeyHash || ""); setPage(1);
  }

  function selectType(type: SignalView) {
    const firstCard = sortIntelligenceLifecycleCardsV1(viewCards
      .filter(card => type === "All" || card.snapshot.type === type)
      .filter(card => !hideLowConfidence || card.snapshot.confidence !== "Low"))[0];
    browse({ activeType: type, selectedKey: firstCard?.findingKeyHash || "", page: 1 });
    setActiveType(type); setSelectedKey(firstCard?.findingKeyHash || ""); setPage(1);
  }

  function changeConfidenceFilter(hide: boolean) {
    const firstCard = sortIntelligenceLifecycleCardsV1(viewCards
      .filter(card => activeType === "All" || card.snapshot.type === activeType)
      .filter(card => !hide || card.snapshot.confidence !== "Low"))[0];
    browse({ hideLowConfidence: hide, selectedKey: firstCard?.findingKeyHash || "", page: 1 });
    setHideLowConfidence(hide); setSelectedKey(firstCard?.findingKeyHash || ""); setPage(1);
  }

  function changePage(requestedPage: number) {
    const next = findingPage(filteredCards, requestedPage);
    if (next.page === pagination.page) return;
    const key = next.items[0]?.findingKeyHash || "";
    const top = typeof window === "undefined" ? 0 : Math.max(0, window.scrollY + (sectionRef.current?.getBoundingClientRect().top || 0) - 96);
    browse({ page: next.page, selectedKey: key, listTop: top });
    setPage(next.page); setSelectedKey(key);
    listReturnRef.current = { top, trigger: null };
    if (typeof window !== "undefined") window.requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
      sectionRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    });
  }

  function paginationControls(position: "top" | "bottom") {
    const buttonClass = "vaeroex-semantic-interactive min-h-9 rounded-md border border-white/10 px-2 text-xs font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed";
    return <nav aria-label={`Findings pagination ${position}`} className="space-y-2 border-white/10 py-2">
      <p role={position === "top" ? "status" : undefined} className="text-xs text-slate-400">Showing {pagination.start ? `${pagination.start}–${pagination.end}` : "0"} of {filteredCards.length}</p>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" disabled={pagination.page === 1} onClick={() => changePage(pagination.page - 1)} className={buttonClass}>Previous</button>
        {findingPageNumbers(pagination.page, pagination.totalPages).map((number, index) => number === "…"
          ? <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-xs text-slate-400">…</span>
          : <button key={number} type="button" aria-label={`Page ${number}`} aria-current={number === pagination.page ? "page" : undefined} onClick={() => changePage(number)} className={`${buttonClass} min-w-8 ${number === pagination.page ? "bg-white/10 text-white" : ""}`}>{number}</button>)}
        <button type="button" disabled={pagination.page === pagination.totalPages} onClick={() => changePage(pagination.page + 1)} className={buttonClass}>Next</button>
      </div>
    </nav>;
  }

  function selectCard(card: IntelligenceLifecycleCardV1, trigger: HTMLButtonElement) {
    listReturnRef.current = { top: window.scrollY, trigger };
    commitNavigation({ selectedKey: card.findingKeyHash, mobileDetailOpen: false, listTop: window.scrollY, returnEntry: false });
    commitNavigation({ selectedKey: card.findingKeyHash, mobileDetailOpen: true, panelMode: "summary", listTop: window.scrollY, returnEntry: true }, true);
    setSelectedKey(card.findingKeyHash);
    setMobileDetailOpen(true);
    setPanelMode("summary");
    setDismissOpen(false);
  }

  function backToList() {
    if (returnEntryRef.current && window.history) { window.history.back(); return; }
    if (!returnEntryRef.current && !listReturnRef.current.trigger) {
      listReturnRef.current.top = Math.max(0, window.scrollY + (sectionRef.current?.getBoundingClientRect().top || 0) - 96);
    }
    commitNavigation({ mobileDetailOpen: false, returnEntry: false, listTop: listReturnRef.current.top });
    setMobileDetailOpen(false);
    setDismissOpen(false);
    const { top } = listReturnRef.current;
    window.requestAnimationFrame(() => {
      focusListSelection(selectedKey);
      window.scrollTo({ top, behavior: "instant" });
    });
  }

  function requestExplanation(insightId: string) {
    const requestToken = explanationTokens[insightId];
    if (!requestToken || explanationInFlight.current.has(insightId)) return;
    setPanelMode("analysis");
    explanationInFlight.current.add(insightId);
    setExplanationStates((current) => ({
      ...current,
      [insightId]: { status: "loading", artifact: current[insightId]?.artifact || null, message: null }
    }));
    startExplanationTransition(async () => {
      try {
        const nextState = await explainFindingAction(requestToken);
        setExplanationStates((current) => ({ ...current, [insightId]: nextState }));
      } catch {
        setExplanationStates((current) => ({
          ...current,
          [insightId]: {
            status: "failed",
            artifact: current[insightId]?.artifact || null,
            message: "This finding could not be explained right now. The finding and evidence remain available."
          }
        }));
      } finally {
        explanationInFlight.current.delete(insightId);
      }
    });
  }

  function changePanelMode(mode: PanelMode) {
    commitNavigation({ panelMode: mode });
    setPanelMode(mode);
    if (mode === "analysis" && selectedInsight && !explanationStates[selectedInsight.id]) requestExplanation(selectedInsight.id);
  }

  function mutateLifecycle(action: IntelligenceCardLifecycleAction) {
    if (!selectedCard?.lifecycleToken || isLifecyclePending) return;
    setLifecycleMessage(null);
    startLifecycleTransition(async () => {
      const result = await mutateIntelligenceCardLifecycleAction({
        token: selectedCard.lifecycleToken || "",
        action,
        reasonCode: action === "dismiss" ? dismissReason : null,
        reasonText: action === "dismiss" ? dismissNote : null
      });
      setLifecycleMessage(result.message);
      if (result.ok) {
        setDismissOpen(false);
        setDismissNote("");
        router.refresh();
      }
    });
  }

  function renderCard(card: IntelligenceLifecycleCardV1) {
    const categoryStatus = findingCategoryStatus(card.snapshot.type);
    const priorityStatus = findingPriorityStatus(card.snapshot.priority);
    const category = semanticPresentation(categoryStatus);
    const priority = semanticPresentation(priorityStatus);
    const CategoryIcon = category.Icon;
    const statusLabel = lifecycleStatusLabel(card);
    const selected = selectedCard?.findingKeyHash === card.findingKeyHash;
    const keyFigure = card.insight?.supportingRecords?.find(record => record.recordType === "KPI record")?.value;
    return (
      <button key={card.findingKeyHash} type="button" data-finding-key={card.findingKeyHash} data-finding-category={card.snapshot.type} aria-current={selected ? "true" : undefined} onClick={(event) => selectCard(card, event.currentTarget)} className={`workspace-finding-card intelligence-finding-row cursor-pointer ${selected ? "is-selected" : ""}`}>
        <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 text-sm font-semibold leading-6 text-white">{card.snapshot.title}</h3><span className="mt-1 inline-flex shrink-0 gap-1">{card.pinned ? <Pin aria-label="Pinned" className="h-4 w-4 text-cyan-200" /> : null}<span className="sr-only">View details</span><ChevronRight aria-hidden="true" className="h-4 w-4 text-slate-400" /></span></div>
        {keyFigure ? <p className="mt-1 break-words text-sm font-medium tabular-nums text-slate-200">{keyFigure}</p> : null}
        {!repeatsFindingFigures(card.snapshot.summary, keyFigure) ? <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-400">{compactText(card.snapshot.summary, 130)}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-slate-400">
          <span className="intelligence-category-badge" data-finding-category={card.snapshot.type}><CategoryIcon aria-hidden="true" className="h-3.5 w-3.5" />{card.snapshot.type}</span>
          <span className="intelligence-priority" data-priority={card.snapshot.priority}>{card.snapshot.priority === "Low" ? "Low priority" : priority.label}</span><span>{card.snapshot.confidence} confidence</span><time dateTime={card.snapshot.lastUpdated}>{formatSignalDate(card.snapshot.lastUpdated)}</time>
          {statusLabel ? <span className="text-slate-300">{statusLabel}</span> : null}
        </div>
      </button>
    );
  }

  return (
    <section ref={sectionRef} className="scroll-mt-24 workspace-findings vaeroex-intelligence-inbox rounded-xl border border-white/10 bg-[#10151f] p-3 text-slate-100 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">Current findings and history</h2>
        </div>
      </div>

      <div className="workspace-inbox-toolbar mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-grid grid-cols-2 rounded-lg border border-white/10 bg-slate-950/50 p-1" role="tablist" aria-label="Intelligence lifecycle view">
          {(["current", "history"] as LifecycleView[]).map((view) => (
            <button key={view} type="button" role="tab" aria-selected={lifecycleView === view} onClick={() => selectView(view)} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${lifecycleView === view ? "bg-vaeroex-blue text-white" : "text-slate-300 hover:bg-cyan-950/30 hover:text-white"}`}>
              {view === "current" ? <Check aria-hidden="true" className="h-4 w-4" /> : <History aria-hidden="true" className="h-4 w-4" />}
              {view === "current" ? "Current" : "History"}
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.7rem]">{view === "current" ? currentCards.length : historyCards.length}</span>
            </button>
          ))}
        </div>
        <label className="inline-flex min-h-10 items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={hideLowConfidence} onChange={(event) => changeConfidenceFilter(event.currentTarget.checked)} className="h-4 w-4 rounded border-white/20 bg-slate-950 text-vaeroex-blue focus:ring-vaeroex-accent" />
          Hide low confidence
        </label>
      </div>

      <div className="workspace-finding-categories mt-4 flex flex-wrap gap-1 border-b border-white/10 pb-3">
        {visibleTypes.map((type) => (
          <button key={type} type="button" onClick={() => selectType(type)} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${activeType === type ? "bg-vaeroex-blue text-white" : "text-slate-300 hover:bg-cyan-950/30 hover:text-white"}`}>
            {typeTabLabel(type)} <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.7rem]">{counts[type]}</span>
          </button>
        ))}
      </div>

      <div className="intelligence-findings-layout mt-4 grid items-start gap-5 xl:grid-cols-[minmax(17rem,.8fr)_minmax(0,1.6fr)]">
        <div data-finding-list className={`${mobileDetailOpen && selectedCard ? "hidden xl:block" : "block"} workspace-finding-list min-w-0 space-y-5`}>
          {paginationControls("top")}
          {pagedCards.length ? lifecycleView === "current" && activeType === "All" ? (
            <>
              {currentAttention.length ? <section className="space-y-1" aria-labelledby="attention-findings-heading">
                <h3 id="attention-findings-heading" className="text-base font-semibold text-white">What needs attention</h3>
                <p className="mt-1 text-xs text-slate-400">Risks, bottlenecks, and anomalies.</p>
                {currentAttention.map(renderCard)}
              </section> : null}
              {currentImprovements.length ? <section className={`space-y-1 ${currentAttention.length ? "border-t border-white/10 pt-5" : ""}`} aria-labelledby="improvement-findings-heading">
                <h3 id="improvement-findings-heading" className="text-base font-semibold text-white">What could improve the business further</h3>
                <p className="mt-1 text-xs text-slate-400">Opportunities, recommendations, and forecasts.</p>
                {currentImprovements.map(renderCard)}
              </section> : null}
            </>
          ) : pagedCards.map(renderCard) : (
            <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/35 p-5 text-sm leading-6 text-slate-300">
              {lifecycleView === "history" ? "No lifecycle history matches these filters." : blockedState?.description || typeEmptyMessage(activeType)}
            </div>
          )}
          {paginationControls("bottom")}
        </div>

        <aside ref={detailRef} tabIndex={-1} aria-label="Selected finding" className={`${mobileDetailOpen && selectedCard ? "block" : "hidden xl:block"} workspace-finding-detail intelligence-finding-detail min-w-0 scroll-mt-24 rounded-lg border border-white/10 bg-[#151c28] p-4 sm:p-6 xl:sticky xl:top-20 xl:self-start`}>
          {selectedCard ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`intelligence-category-badge ${semanticStatusClass(findingCategoryStatus(selectedCard.snapshot.type))}`} data-finding-category={selectedCard.snapshot.type}>{selectedCard.snapshot.type}</span>
                    <span className="intelligence-priority text-xs" data-priority={selectedCard.snapshot.priority}>{selectedCard.snapshot.priority} priority</span>
                    <span className={`intelligence-detail-confidence text-xs ${confidenceClass(selectedCard.snapshot.confidence)}`}>Confidence: {selectedCard.snapshot.confidence}</span>
                    {lifecycleStatusLabel(selectedCard) ? <span className="rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-slate-200">{lifecycleStatusLabel(selectedCard)}</span> : null}
                  </div>
                  <h3 className="mt-3 break-words text-xl font-semibold leading-8 text-white">{selectedCard.snapshot.title}</h3>
                  <p className="mt-2 text-xs text-slate-400">Finding evidence date: {formatSignalDate(selectedCard.snapshot.lastUpdated)}</p>
                </div>
                <button type="button" onClick={backToList} className="min-h-10 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-cyan-950/30 xl:hidden">← Back to list</button>
              </div>

              {selectedCard.view === "history" && selectedCard.lifecycleState === "dismissed" ? <LeadershipDisposition card={selectedCard} /> : null}

              {selectedCard.view === "current" && canManageLifecycle && selectedCard.lifecycleToken ? (
                <section className="space-y-3 border-y border-white/10 py-3" aria-label="Finding lifecycle actions">
                  <div className="flex flex-wrap gap-2">
                    {selectedCard.lifecycleState !== "acknowledged" ? (
                      <button type="button" disabled={isLifecyclePending} onClick={() => mutateLifecycle("acknowledge")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-cyan-300/30 bg-cyan-950/25 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-950/45 disabled:opacity-60"><Check aria-hidden="true" className="h-4 w-4" />Acknowledge</button>
                    ) : null}
                    <button type="button" disabled={isLifecyclePending} onClick={() => mutateLifecycle(selectedCard.pinned ? "unpin" : "pin")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-white/[0.06] disabled:opacity-60">
                      {selectedCard.pinned ? <PinOff aria-hidden="true" className="h-4 w-4" /> : <Pin aria-hidden="true" className="h-4 w-4" />}
                      {selectedCard.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button type="button" disabled={isLifecyclePending} onClick={() => setDismissOpen((current) => !current)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-300/25 px-3 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-950/25 disabled:opacity-60"><X aria-hidden="true" className="h-4 w-4" />Dismiss</button>
                  </div>
                  {dismissOpen ? (
                    <div className="space-y-3 rounded-lg border border-white/10 bg-slate-950/45 p-3">
                      <label className="block text-xs font-semibold text-slate-200">Reason
                        <select value={dismissReason} onChange={(event) => setDismissReason(event.currentTarget.value as IntelligenceCardLifecycleReason)} className="mt-1 min-h-10 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white">
                          <option value="temporary">Temporary condition</option>
                          <option value="irrelevant">Not relevant</option>
                          <option value="duplicate">Duplicate</option>
                          <option value="not_material">Not material</option>
                          <option value="other">Other</option>
                        </select>
                      </label>
                      <label className="block text-xs font-semibold text-slate-200">Optional note
                        <textarea value={dismissNote} maxLength={500} onChange={(event) => setDismissNote(event.currentTarget.value)} rows={3} className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" />
                      </label>
                      <p className="text-xs leading-5 text-slate-400">Dismissal changes presentation only. The finding will return for review after 30 days or sooner if its material evidence changes.</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={isLifecyclePending} onClick={() => mutateLifecycle("dismiss")} className="min-h-10 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-60">Move to History</button>
                        <button type="button" onClick={() => setDismissOpen(false)} className="min-h-10 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/[0.06]">Cancel</button>
                      </div>
                    </div>
                  ) : null}
                  {lifecycleMessage ? <p role="status" className="text-xs leading-5 text-slate-300">{lifecycleMessage}</p> : null}
                </section>
              ) : null}

              {selectedInsight ? (
                <>
                  <PanelTabs mode={panelMode} onChange={changePanelMode} analysisAvailable={Boolean(explanationTokens[selectedInsight.id])}  />
                  {panelMode === "summary" ? <SummaryPanel insight={selectedInsight} canExplain={Boolean(explanationTokens[selectedInsight.id])} onExplain={() => requestExplanation(selectedInsight.id)}  /> : null}
                  {panelMode === "evidence" ? <EvidencePanel insight={selectedInsight} /> : null}
                  {panelMode === "analysis" ? <FindingExplanationPanel state={explanationStates[selectedInsight.id] || { status: "available", artifact: null, message: null }} onRetry={() => requestExplanation(selectedInsight.id)} pending={isExplanationPending} /> : null}
                </>
              ) : (
                <div className="space-y-3 text-sm leading-6 text-slate-300">
                  <p>{selectedCard.snapshot.summary}</p>
                  <p className="rounded-lg border border-white/10 bg-white/[0.025] p-3">This historical finding is not currently surfaced in the bounded deterministic feed. Its absence is not treated as evidence of resolution.</p>
                  {selectedCard.reasonText ? <p><span className="font-semibold text-slate-100">Leadership note:</span> {selectedCard.reasonText}</p> : null}
                </div>
              )}
            </div>
          ) : blockedState ? (
            <div className="space-y-3 py-8 text-sm leading-6 text-slate-300">
              <p className="font-semibold text-white">{blockedState.title}</p>
              <p>{blockedState.description}</p>
              <Link href={blockedState.actionHref} className="inline-flex min-h-10 items-center text-sm font-semibold text-cyan-200 hover:text-white">{blockedState.actionLabel}</Link>
            </div>
          ) : <div className="py-8 text-sm leading-6 text-slate-300">Select a finding to review its summary and supporting evidence.</div>}
        </aside>
      </div>
    </section>
  );
}

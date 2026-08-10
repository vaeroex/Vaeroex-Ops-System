"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, History, Pin, PinOff, X } from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { explainFindingAction } from "@/app/app/finding-explanation/actions";
import { mutateIntelligenceCardLifecycleAction } from "@/app/app/intelligence/lifecycle-actions";
import { SaveAnalysisButton } from "@/components/reports/SaveAnalysisButton";
import { spatialSurfaceClassName } from "@/components/spatial/SpatialSurface";
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
import {
  findingCategoryStatus,
  findingPriorityStatus,
  semanticPresentation,
  semanticStatusClass
} from "@/lib/presentation/semantic-status";

const signalTypes: IntelligenceInsightType[] = ["Risk", "Opportunity", "Forecast", "Bottleneck", "Recommendation", "Anomaly"];
type SignalView = "All" | IntelligenceInsightType;
const confidenceOptions: Array<"All" | IntelligenceConfidence> = ["All", "High", "Medium", "Low"];
const pageSize = 10;

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

  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatLifecycleTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
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
  categoryStatus
}: {
  mode: PanelMode;
  onChange: (mode: PanelMode) => void;
  analysisAvailable: boolean;
  categoryStatus: ReturnType<typeof findingCategoryStatus>;
}) {
  const tabs: Array<{ id: PanelMode; label: string }> = [
    { id: "summary", label: "Summary" },
    { id: "evidence", label: "Evidence" },
    ...(analysisAvailable ? [{ id: "analysis" as const, label: "Analysis" }] : [])
  ];

  return (
    <div className={`grid ${analysisAvailable ? "grid-cols-3" : "grid-cols-2"} rounded-lg border border-white/10 bg-slate-950/50 p-1`} role="tablist" aria-label="Selected finding view">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={mode === tab.id}
          onClick={() => onChange(tab.id)}
          className={`vaeroex-semantic-interactive min-h-10 rounded-md px-2 py-2 text-xs font-semibold transition ${
            mode === tab.id ? `vaeroex-semantic-badge ${semanticStatusClass(categoryStatus)}` : "text-slate-300 hover:bg-cyan-950/35 hover:text-white"
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
  onExplain,
  categoryStatus
}: {
  insight: IntelligenceInsight;
  canExplain: boolean;
  onExplain: () => void;
  categoryStatus: ReturnType<typeof findingCategoryStatus>;
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
        <p className="mt-2 text-slate-100">{compactText(insight.summary, 320)}</p>
      </section>
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Why it matters</p>
        <p className="mt-2 text-slate-200">{compactText(insight.impact, 260)}</p>
      </section>
      <section className={`vaeroex-semantic-detail border-l-2 pl-3 ${semanticStatusClass(categoryStatus)}`}>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100">Leadership decision</p>
        <p className="mt-2 text-slate-100">{compactText(insight.recommendedAction, 260)}</p>
      </section>
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Limitation</p>
        <p className="mt-2 text-slate-300">{compactText(limitationFor(insight), 280)}</p>
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
              <p className="mt-1 text-xs leading-5 text-slate-300">{compactText(citation.excerpt, 220)}</p>
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
        <span className="break-words text-xs font-semibold text-slate-200 sm:max-w-44 sm:text-right">{compactText(record.value, 90)}</span>
      </div>
      <p className="mt-1.5 break-words text-xs leading-5 text-slate-400">{compactText(record.support, 180)}</p>
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
        <p><span className="font-semibold text-slate-100">Period:</span> {insight.timePeriod}</p>
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
                <p className="mt-1 text-xs leading-5 text-slate-400">{compactText(group.explanation, 180)}</p>
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
          <p className="mt-1 text-slate-400">{insight.missingEvidence.length ? compactText(insight.missingEvidence.join("; "), 220) : "No material gap recorded."}</p>
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
  initialFindingId,
  explanationTokens = {},
  canManageLifecycle
}: {
  currentCards: IntelligenceLifecycleCardV1[];
  historyCards: IntelligenceLifecycleCardV1[];
  initialFindingId?: string;
  explanationTokens?: Readonly<Record<string, string>>;
  canManageLifecycle: boolean;
}) {
  const router = useRouter();
  const requestedCard = initialFindingId ? [...currentCards, ...historyCards].find((card) => card.findingId === initialFindingId) : null;
  const [lifecycleView, setLifecycleView] = useState<LifecycleView>(requestedCard?.view || "current");
  const [activeType, setActiveType] = useState<SignalView>("All");
  const [selectedKey, setSelectedKey] = useState<string>(requestedCard?.findingKeyHash || currentCards[0]?.findingKeyHash || historyCards[0]?.findingKeyHash || "");
  const [hideLowConfidence, setHideLowConfidence] = useState(false);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [panelMode, setPanelMode] = useState<PanelMode>("summary");
  const [explanationStates, setExplanationStates] = useState<Record<string, FindingExplanationState>>({});
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissReason, setDismissReason] = useState<IntelligenceCardLifecycleReason>("temporary");
  const [dismissNote, setDismissNote] = useState("");
  const [lifecycleMessage, setLifecycleMessage] = useState<string | null>(null);
  const [isExplanationPending, startExplanationTransition] = useTransition();
  const [isLifecyclePending, startLifecycleTransition] = useTransition();
  const explanationInFlight = useRef<Set<string>>(new Set());

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
  const pagedCards = activeType === "All" && lifecycleView === "current" ? filteredCards : filteredCards.slice(0, visibleCount);
  const selectedCard = selectedKey ? filteredCards.find((card) => card.findingKeyHash === selectedKey) || pagedCards[0] || null : pagedCards[0] || null;
  const selectedInsight = selectedCard?.insight || null;
  const currentAttention = pagedCards.filter((card) => attentionTypes.has(card.snapshot.type));
  const currentImprovements = pagedCards.filter((card) => improvementTypes.has(card.snapshot.type));
  const totalCurrentAttention = currentCards.filter((card) => attentionTypes.has(card.snapshot.type));
  const totalCurrentImprovements = currentCards.filter((card) => improvementTypes.has(card.snapshot.type));
  const surfacedAttention = [...currentCards, ...historyCards].filter((card) => card.currentFeedStatus === "surfaced" && attentionTypes.has(card.snapshot.type));

  function selectView(view: LifecycleView) {
    const cards = view === "current" ? currentCards : historyCards;
    setLifecycleView(view);
    setActiveType("All");
    setSelectedKey(cards[0]?.findingKeyHash || "");
    setVisibleCount(pageSize);
    setPanelMode("summary");
    setDismissOpen(false);
  }

  function selectType(type: SignalView) {
    const firstCard = type === "All" ? viewCards[0] : viewCards.find((card) => card.snapshot.type === type);
    setActiveType(type);
    setSelectedKey(firstCard?.findingKeyHash || "");
    setVisibleCount(pageSize);
    setPanelMode("summary");
    setDismissOpen(false);
  }

  function selectCard(card: IntelligenceLifecycleCardV1) {
    setSelectedKey(card.findingKeyHash);
    setPanelMode("summary");
    setDismissOpen(false);
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
    const PriorityIcon = priority.Icon;
    const statusLabel = lifecycleStatusLabel(card);
    const selected = selectedCard?.findingKeyHash === card.findingKeyHash;
    const historyAffordance = card.view === "history";
    return (
      <button key={card.findingKeyHash} type="button" aria-current={selected ? "true" : undefined} onClick={() => selectCard(card)} className={`${spatialSurfaceClassName({ depth: selected ? "raised" : "subtle", interactive: true, selected })} vaeroex-semantic-card vaeroex-semantic-interactive ${semanticStatusClass(categoryStatus)} block w-full rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 ${historyAffordance ? "cursor-pointer" : ""} ${selected ? historyAffordance ? "border-cyan-300/55 bg-cyan-950/25 ring-2 ring-cyan-300/55 shadow-[0_0_0_1px_rgba(103,232,249,0.08)]" : "ring-1 ring-current/30" : historyAffordance ? "hover:border-cyan-300/50 hover:bg-cyan-950/20 hover:shadow-md" : "hover:brightness-[1.03]"}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap gap-2">
              <span className={`vaeroex-semantic-badge inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${semanticStatusClass(categoryStatus)}`}><CategoryIcon aria-hidden="true" className="h-3.5 w-3.5" />{card.snapshot.type}</span>
              <span className={`vaeroex-semantic-badge inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${semanticStatusClass(priorityStatus)}`}><PriorityIcon aria-hidden="true" className="h-3.5 w-3.5" />{priority.label}</span>
              {card.pinned ? <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/30 bg-cyan-950/30 px-2.5 py-1 text-xs font-semibold text-cyan-100"><Pin aria-hidden="true" className="h-3.5 w-3.5" />Pinned</span> : null}
              {statusLabel ? <span className="rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-slate-200">{statusLabel}</span> : null}
            </div>
            <h3 className="text-sm font-semibold leading-5 text-white">{compactText(card.snapshot.title, 110)}</h3>
            <p className="mt-1 text-sm leading-5 text-slate-300">{compactText(card.snapshot.summary)}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${confidenceClass(card.snapshot.confidence)}`}>Confidence: {card.snapshot.confidence}</span>
            {historyAffordance ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-200">View details <ChevronRight aria-hidden="true" className="h-4 w-4" /></span> : null}
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">{formatSignalDate(card.snapshot.lastUpdated)}</p>
      </button>
    );
  }

  return (
    <section className="vaeroex-intelligence-inbox vaeroex-priority-surface rounded-xl border border-white/10 bg-[#07101f] p-4 text-slate-100 shadow-command">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Intelligence</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Leadership intelligence</h2>
        </div>
        <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-200">
          <input type="checkbox" checked={hideLowConfidence} onChange={(event) => setHideLowConfidence(event.currentTarget.checked)} className="h-4 w-4 rounded border-white/20 bg-slate-950 text-vaeroex-blue focus:ring-vaeroex-accent" />
          Hide low confidence
        </label>
      </div>

      <div className="mt-4 inline-grid grid-cols-2 rounded-lg border border-white/10 bg-slate-950/50 p-1" role="tablist" aria-label="Intelligence lifecycle view">
        {(["current", "history"] as LifecycleView[]).map((view) => (
          <button key={view} type="button" role="tab" aria-selected={lifecycleView === view} onClick={() => selectView(view)} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${lifecycleView === view ? "bg-vaeroex-blue text-white" : "text-slate-300 hover:bg-cyan-950/30 hover:text-white"}`}>
            {view === "current" ? <Check aria-hidden="true" className="h-4 w-4" /> : <History aria-hidden="true" className="h-4 w-4" />}
            {view === "current" ? "Current" : "History"}
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.7rem]">{view === "current" ? currentCards.length : historyCards.length}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto border-b border-white/10 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visibleTypes.map((type) => (
          <button key={type} type="button" onClick={() => selectType(type)} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${activeType === type ? "bg-vaeroex-blue text-white" : "text-slate-300 hover:bg-cyan-950/30 hover:text-white"}`}>
            {typeTabLabel(type)} <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.7rem]">{counts[type]}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(23rem,.82fr)]">
        <div className="space-y-5 xl:max-h-[calc(100dvh-10rem)] xl:overflow-y-auto xl:pr-1">
          <p className="text-xs text-slate-400">Showing {filteredCards.length ? `1-${pagedCards.length}` : "0"} of {filteredCards.length}.</p>
          {lifecycleView === "current" && activeType === "All" ? (
            <>
              <section className="space-y-3" aria-labelledby="attention-findings-heading">
                <div>
                  <h3 id="attention-findings-heading" className="text-base font-semibold text-white">What needs attention</h3>
                  <p className="mt-1 text-xs text-slate-400">Current risks, bottlenecks, and anomalies supported by deterministic evidence.</p>
                </div>
                {currentAttention.length ? currentAttention.map(renderCard) : (
                  <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/35 p-5 text-sm leading-6 text-slate-300">
                    {hideLowConfidence && totalCurrentAttention.length
                      ? "No current attention findings match the selected filter."
                      : surfacedAttention.length
                        ? "No undismissed issues are in the current feed. Dismissed findings remain in History."
                        : "No active issues require attention."}
                  </div>
                )}
              </section>
              <section className="space-y-3 border-t border-white/10 pt-5" aria-labelledby="improvement-findings-heading">
                <div>
                  <h3 id="improvement-findings-heading" className="text-base font-semibold text-white">What could improve the business further</h3>
                  <p className="mt-1 text-xs text-slate-400">Current opportunities, recommendations, and forecasts already produced by deterministic intelligence.</p>
                </div>
                {currentImprovements.length ? currentImprovements.map(renderCard) : (
                  <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/35 p-5 text-sm leading-6 text-slate-300">{hideLowConfidence && totalCurrentImprovements.length ? "No improvement findings match the selected filter." : "No evidence-backed improvement finding is currently surfaced."}</div>
                )}
              </section>
            </>
          ) : pagedCards.length ? pagedCards.map(renderCard) : (
            <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/35 p-5 text-sm leading-6 text-slate-300">
              {lifecycleView === "history" ? "No lifecycle history matches these filters." : typeEmptyMessage(activeType)}
            </div>
          )}
          {filteredCards.length > pagedCards.length ? <button type="button" onClick={() => setVisibleCount((count) => count + pageSize)} className="min-h-10 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30">Load more</button> : null}
        </div>

        <aside className={`${spatialSurfaceClassName({ depth: "raised", selected: Boolean(selectedCard) })} vaeroex-semantic-card ${selectedCard ? semanticStatusClass(findingCategoryStatus(selectedCard.snapshot.type)) : semanticStatusClass("neutral")} rounded-lg border p-4 shadow-panel xl:sticky xl:top-24 xl:max-h-[calc(100dvh-8rem)] xl:self-start xl:overflow-y-auto`}>
          {selectedCard ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`vaeroex-semantic-badge rounded-full border px-2.5 py-1 text-xs font-semibold ${semanticStatusClass(findingCategoryStatus(selectedCard.snapshot.type))}`}>{selectedCard.snapshot.type}</span>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${confidenceClass(selectedCard.snapshot.confidence)}`}>Confidence: {selectedCard.snapshot.confidence}</span>
                    {lifecycleStatusLabel(selectedCard) ? <span className="rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-slate-200">{lifecycleStatusLabel(selectedCard)}</span> : null}
                  </div>
                  <h3 className="mt-3 break-words text-lg font-semibold leading-7 text-white">{compactText(selectedCard.snapshot.title, 140)}</h3>
                </div>
                <button type="button" onClick={() => setSelectedKey("")} className="min-h-10 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-cyan-950/30 xl:hidden">Back to list</button>
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
                  <PanelTabs mode={panelMode} onChange={changePanelMode} analysisAvailable={Boolean(explanationTokens[selectedInsight.id])} categoryStatus={findingCategoryStatus(selectedInsight.type)} />
                  {panelMode === "summary" ? <SummaryPanel insight={selectedInsight} canExplain={Boolean(explanationTokens[selectedInsight.id])} onExplain={() => requestExplanation(selectedInsight.id)} categoryStatus={findingCategoryStatus(selectedInsight.type)} /> : null}
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
          ) : <div className="py-8 text-sm leading-6 text-slate-300">Select a finding to review its summary and supporting evidence.</div>}
        </aside>
      </div>
    </section>
  );
}

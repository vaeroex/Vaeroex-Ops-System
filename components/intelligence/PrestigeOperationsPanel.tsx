import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import {
  acceptPrestigeRecommendationAction,
  createBusinessDecisionAction,
  createBusinessReviewPackageAction,
  createKpiAlertFromPrestigeAction,
  dismissPrestigeRecommendationAction
} from "@/app/app/intelligence/actions";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { LegalSafetyNotice } from "@/components/legal/LegalSafetyNotice";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import type { PrestigeAction, PrestigeIntelligence, ProfitLeak } from "@/lib/intelligence/prestige";

type PrestigeOperationsPanelProps = {
  intelligence: PrestigeIntelligence;
  returnPath?: string;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  compact?: boolean;
  isDemoWorkspace?: boolean;
  showHealthHero?: boolean;
};

const decisionStatuses = ["open", "in_progress", "reviewed", "completed", "dismissed"];

function scoreTone(score: number) {
  if (score >= 80) return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (score >= 65) return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-red-200 bg-red-50 text-red-700";
}

function priorityTone(priority: string) {
  if (priority === "Urgent" || priority === "High") return "border-red-200 bg-red-50 text-red-700";
  if (priority === "Medium") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-vaeroex-accent/50 bg-vaeroex-soft text-vaeroex-blue";
}

function scoreLabel(score: number) {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Strong";
  if (score >= 70) return "Stable";
  if (score >= 60) return "Watch";
  return "At risk";
}

function riskLevel(score: number) {
  if (score >= 85) return "Low";
  if (score >= 70) return "Moderate";
  return "High";
}

function trendSummary(categories: PrestigeIntelligence["businessHealth"]["categories"]) {
  const upward = categories.filter((category) => category.trend === "up").length;
  const downward = categories.filter((category) => category.trend === "down").length;

  if (upward > downward) return { icon: "↑", label: "Improving", detail: `+${upward - downward} positive signal${upward - downward === 1 ? "" : "s"}` };
  if (downward > upward) return { icon: "↓", label: "Declining", detail: `${downward - upward} risk signal${downward - upward === 1 ? "" : "s"}` };
  return { icon: "→", label: "Holding steady", detail: "No major directional change" };
}

function keyFocusArea(intelligence: PrestigeIntelligence) {
  const firstPriority = intelligence.focusPriorities[0]?.relatedModule;
  const weakestCategory = [...intelligence.businessHealth.categories].sort((a, b) => a.score - b.score)[0]?.name;
  return firstPriority || weakestCategory || "Operating rhythm";
}

export function BusinessHealthHero({
  intelligence,
  periodLabel = "current period"
}: {
  intelligence: PrestigeIntelligence;
  periodLabel?: string;
}) {
  const health = intelligence.businessHealth;
  const trend = trendSummary(health.categories);
  const focus = keyFocusArea(intelligence);
  const risk = riskLevel(health.score);
  const progressWidth = `${Math.max(4, Math.min(100, health.score))}%`;

  return (
    <section className="overflow-hidden rounded-lg border border-vaeroex-navy bg-vaeroex-navy text-white shadow-command">
      <div className="grid gap-0 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="border-b border-white/10 p-6 xl:border-b-0 xl:border-r">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-vaeroex-silver">Business Health</p>
              <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-semibold text-vaeroex-accent">Risk: {risk}</span>
            </div>
            <VaeroexLogo variant="symbol" size="sm" />
          </div>
          <div className="mt-5 flex flex-wrap items-end gap-4">
            <p className="text-7xl font-semibold leading-none tracking-normal">
              {health.score}
              <span className="ml-1 text-2xl text-vaeroex-accent">/100</span>
            </p>
            <div className="pb-2">
              <p className="text-xl font-semibold">{scoreLabel(health.score)}</p>
              <p className="mt-1 text-sm text-vaeroex-silver">Vaeroex operating score</p>
            </div>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[linear-gradient(90deg,#1E6BFF,#38BDF8)]" style={{ width: progressWidth }} />
          </div>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-100">{health.explanation}</p>
          <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.06] p-3 text-xs leading-5 text-slate-100">
            Business Health is a directional decision-support signal. Review the underlying records before relying on it.
          </p>
          {health.dataQualityWarning ? (
            <p className="mt-4 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">{health.dataQualityWarning}</p>
          ) : null}
        </div>

        <div className="grid gap-3 p-6 sm:grid-cols-2">
          <article className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-vaeroex-silver">Trend direction</p>
            <p className="mt-3 text-2xl font-semibold">{trend.icon} {trend.label}</p>
            <p className="mt-1 text-sm text-slate-100">{trend.detail} in the {periodLabel.toLowerCase()} view.</p>
          </article>
          <article className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-vaeroex-silver">Risk level</p>
            <p className="mt-3 inline-flex rounded-full bg-[linear-gradient(90deg,#1E6BFF,#38BDF8)] px-3 py-1 text-2xl font-semibold text-white">{risk}</p>
            <p className="mt-2 text-sm text-slate-100">Based on current health score, open risks, and data confidence.</p>
          </article>
          <article className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-vaeroex-silver">Primary focus</p>
            <p className="mt-3 text-2xl font-semibold">{focus}</p>
            <p className="mt-1 text-sm text-slate-100">Start here before adding more work to the team.</p>
          </article>
          <article className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-vaeroex-silver">Weekly change</p>
            <p className="mt-3 text-2xl font-semibold">{trend.icon} {trend.detail}</p>
            <p className="mt-1 text-sm text-slate-100">Workspace signals compared through the current operating view.</p>
          </article>
          <article className="rounded-lg border border-white/10 bg-white/[0.06] p-4 sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-vaeroex-silver">Monthly change</p>
            <p className="mt-3 text-2xl font-semibold">{trend.icon} {trend.label}</p>
            <p className="mt-1 text-sm text-slate-100">Vaeroex combines KPI history, CRM movement, follow-ups, issues, files, and reports before calling a trend.</p>
          </article>
        </div>
      </div>
    </section>
  );
}

function DemoPreviewNotice() {
  return (
    <p className="rounded-lg border border-vaeroex-accent/40 bg-vaeroex-soft p-3 text-xs leading-5 text-vaeroex-navy">
      Demo Workspace actions are previews only. No real emails, customer notifications, or live operational records are created from these prestige controls.
    </p>
  );
}

function ActionButtons({
  item,
  returnPath,
  isDemoWorkspace,
  showReport = false,
  showAlert = false
}: {
  item: PrestigeAction | ProfitLeak;
  returnPath: string;
  isDemoWorkspace?: boolean;
  showReport?: boolean;
  showAlert?: boolean;
}) {
  if (isDemoWorkspace) {
    return (
      <div className="flex flex-wrap gap-2">
        <Link href={item.href} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold">
          View example
        </Link>
        <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">Preview approval</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <form action={acceptPrestigeRecommendationAction}>
        <input type="hidden" name="return_path" value={returnPath} />
        <input type="hidden" name="title" value={item.title} />
        <input type="hidden" name="description" value={item.why} />
        <input type="hidden" name="evidence" value={item.evidence} />
        <input type="hidden" name="owner" value={item.owner} />
        <input type="hidden" name="priority" value={item.priority} />
        <input type="hidden" name="due_date" value={item.dueDate} />
        <input type="hidden" name="related_module" value={item.relatedModule} />
        <input type="hidden" name="expected_outcome" value={item.action} />
        <ConfirmSubmitButton message={`Create a follow-up for "${item.title}"?`} className="rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white">
          Create follow-up
        </ConfirmSubmitButton>
      </form>
      <Link href={item.href} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold">
        Assign
      </Link>
      {showReport ? (
        <Link href="/app/reports" className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold">
          Create report
        </Link>
      ) : null}
      {showAlert ? (
        <form action={createKpiAlertFromPrestigeAction}>
          <input type="hidden" name="return_path" value={returnPath} />
          <input type="hidden" name="kpi_name" value={item.relatedModule === "CRM" ? "Conversion Rate" : item.relatedModule} />
          <input type="hidden" name="owner" value={item.owner} />
          <input type="hidden" name="priority" value={item.priority} />
          <ConfirmSubmitButton message={`Create a KPI alert from "${item.title}"?`} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold">
            Add KPI alert
          </ConfirmSubmitButton>
        </form>
      ) : null}
      <form action={dismissPrestigeRecommendationAction}>
        <input type="hidden" name="return_path" value={returnPath} />
        <input type="hidden" name="title" value={item.title} />
        <input type="hidden" name="evidence" value={item.evidence} />
        <input type="hidden" name="owner" value={item.owner} />
        <input type="hidden" name="priority" value={item.priority} />
        <input type="hidden" name="related_module" value={item.relatedModule} />
        <button className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold">Dismiss</button>
      </form>
    </div>
  );
}

function ActionCard({
  item,
  returnPath,
  isDemoWorkspace,
  children,
  showReport,
  showAlert
}: {
  item: PrestigeAction | ProfitLeak;
  returnPath: string;
  isDemoWorkspace?: boolean;
  children?: ReactNode;
  showReport?: boolean;
  showAlert?: boolean;
}) {
  return (
    <article className={`rounded-lg border p-4 ${priorityTone(item.priority)}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{item.title}</p>
          <p className="mt-1 text-xs opacity-80">{item.relatedModule}</p>
        </div>
        <StatusBadge value={item.priority} />
      </div>
      <p className="mt-3 text-sm leading-6">{item.why}</p>
      <p className="mt-2 rounded-lg bg-white/70 p-3 text-xs leading-5 text-slate-700">{item.evidence}</p>
      {children}
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-semibold">Owner</dt>
          <dd className="mt-1">{item.owner}</dd>
        </div>
        <div>
          <dt className="font-semibold">Due</dt>
          <dd className="mt-1">{item.dueDate}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-5">{item.action}</p>
      <div className="mt-4">
        <ActionButtons item={item} returnPath={returnPath} isDemoWorkspace={isDemoWorkspace} showReport={showReport} showAlert={showAlert} />
      </div>
    </article>
  );
}

function MiniList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) {
    return <p className="text-sm leading-6 text-muted">{empty}</p>;
  }

  return (
    <ul className="space-y-2 text-sm leading-6 text-muted">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vaeroex-blue" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function PrestigeOperationsPanel({
  intelligence,
  returnPath = "/app",
  dateRangeStart,
  dateRangeEnd,
  compact = false,
  isDemoWorkspace = false,
  showHealthHero = true
}: PrestigeOperationsPanelProps) {
  const health = intelligence.businessHealth;

  if (compact) {
    return (
      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Business Health Score" description={health.explanation}>
          <div className={`rounded-lg border p-5 ${scoreTone(health.score)}`}>
            <p className="text-sm font-semibold">Business Health Score</p>
            <p className="mt-2 text-5xl font-semibold">{health.score}<span className="text-xl">/100</span></p>
            {health.dataQualityWarning ? <p className="mt-3 text-xs leading-5">{health.dataQualityWarning}</p> : null}
          </div>
        </SectionCard>
        <SectionCard title="What should I focus on?">
          <MiniList items={intelligence.focusPriorities.slice(0, 4).map((item) => item.title)} empty="No urgent priorities found yet." />
        </SectionCard>
        <SectionCard title="Data Quality Score">
          <div className={`rounded-lg border p-5 ${scoreTone(intelligence.dataQuality.score)}`}>
            <p className="text-4xl font-semibold">{intelligence.dataQuality.score}/100</p>
            <p className="mt-2 text-sm">{intelligence.dataQuality.gaps.length} visible data gap{intelligence.dataQuality.gaps.length === 1 ? "" : "s"}.</p>
          </div>
        </SectionCard>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {isDemoWorkspace ? <DemoPreviewNotice /> : null}

      {showHealthHero ? <BusinessHealthHero intelligence={intelligence} /> : null}

      <SectionCard title="Health breakdown" description="Each category explains what improved, what declined, and what to do next.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {health.categories.map((category) => (
            <article key={category.name} className={`rounded-lg border p-4 ${scoreTone(category.score)}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold">{category.name}</p>
                <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold">{category.score}/100</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/70">
                <div className="h-full rounded-full bg-vaeroex-blue" style={{ width: `${Math.max(4, Math.min(100, category.score))}%` }} />
              </div>
              <p className="mt-3 text-sm leading-6">{category.explanation}</p>
              <p className="mt-2 text-xs leading-5"><strong>Improved:</strong> {category.improved}</p>
              <p className="mt-1 text-xs leading-5"><strong>Declined:</strong> {category.declined}</p>
              <p className="mt-1 text-xs leading-5"><strong>Next:</strong> {category.nextAction}</p>
            </article>
          ))}
        </div>
      </SectionCard>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
        <SectionCard title="What should I focus on this week?" description="Vaeroex limits this to the top priorities that are tied to visible evidence.">
          <div className="mb-4">
            <LegalSafetyNotice tone="review" compact />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {intelligence.focusPriorities.length ? (
              intelligence.focusPriorities.map((item) => <ActionCard key={item.id} item={item} returnPath={returnPath} isDemoWorkspace={isDemoWorkspace} />)
            ) : (
              <p className="text-sm leading-6 text-muted">No urgent focus areas were detected from the current workspace data.</p>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Profit Leak Detector" description="Revenue and opportunity leakage signals from CRM, KPIs, follow-ups, issues, checklists, SOPs, and files.">
          <div className="mb-4">
            <LegalSafetyNotice tone="ai" compact />
          </div>
          <div className="space-y-3">
            {intelligence.profitLeaks.length ? (
              intelligence.profitLeaks.map((item) => (
                <ActionCard key={item.id} item={item} returnPath={returnPath} isDemoWorkspace={isDemoWorkspace} showReport showAlert>
                  <p className="mt-3 rounded-lg bg-white/70 p-3 text-xs leading-5 text-slate-700">
                    Estimated impact: {item.estimatedImpact} · Severity: {item.severity}
                  </p>
                </ActionCard>
              ))
            ) : (
              <p className="text-sm leading-6 text-muted">No obvious profit leaks were found. Keep CRM follow-ups, KPI targets, and ownership records current.</p>
            )}
          </div>
        </SectionCard>
      </section>

      <SectionCard title="Business Memory" description="Important moments Vaeroex can reference when answering what changed, what caused it, and whether actions helped.">
        <div className="grid gap-3 lg:grid-cols-2">
          {intelligence.memoryTimeline.length ? (
            intelligence.memoryTimeline.map((moment) => (
              <article key={moment.id} className="rounded-lg border border-line bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">{moment.title}</p>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{moment.month}</span>
                </div>
                <dl className="mt-3 grid gap-2 text-xs leading-5 text-muted">
                  <div><dt className="font-semibold text-ink">What happened?</dt><dd>{moment.whatHappened}</dd></div>
                  <div><dt className="font-semibold text-ink">Cause</dt><dd>{moment.cause}</dd></div>
                  <div><dt className="font-semibold text-ink">Action taken</dt><dd>{moment.actionTaken}</dd></div>
                  <div><dt className="font-semibold text-ink">Outcome</dt><dd>{moment.outcome}</dd></div>
                </dl>
                <Link href={moment.href} className="mt-3 inline-flex text-xs font-semibold text-vaeroex-blue">Open source</Link>
              </article>
            ))
          ) : (
            <p className="text-sm leading-6 text-muted">Add KPI history, reports, file analyses, decisions, and completed actions to build business memory.</p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {["What changed since last month?", "What changed since March?", "What actions helped performance recover?"].map((prompt) => (
            <Link key={prompt} href={`/app/agents?prompt=${encodeURIComponent(prompt)}` as Route} className="rounded-full border border-line bg-slate-50 px-3 py-2 font-semibold text-slate-700">
              {prompt}
            </Link>
          ))}
        </div>
      </SectionCard>

      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Department Scorecards">
          <div className="space-y-3">
            {intelligence.departmentScorecards.slice(0, 8).map((card) => (
              <article key={card.department} className={`rounded-lg border p-4 ${scoreTone(card.score)}`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">{card.department}</p>
                  <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold">{card.score}/100</span>
                </div>
                <p className="mt-2 text-xs leading-5">{card.explanation}</p>
                <p className="mt-2 text-xs">Open follow-ups: {card.openTasks} · Overdue: {card.overdueTasks} · Issues: {card.openIssues}</p>
              </article>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Data Quality Score">
          <div className={`rounded-lg border p-5 ${scoreTone(intelligence.dataQuality.score)}`}>
            <p className="text-sm font-semibold">Data Quality Score</p>
            <p className="mt-2 text-5xl font-semibold">{intelligence.dataQuality.score}<span className="text-xl">/100</span></p>
          </div>
          <div className="mt-4 space-y-2">
            {intelligence.dataQuality.gaps.slice(0, 6).map((gap) => (
              <Link key={gap.id} href={gap.href} className="block rounded-lg border border-line p-3 text-sm">
                <span className="font-semibold text-ink">{gap.title}</span>
                <span className="mt-1 block text-xs leading-5 text-muted">{gap.why}</span>
              </Link>
            ))}
            {!intelligence.dataQuality.gaps.length ? <p className="text-sm leading-6 text-muted">No major data gaps found.</p> : null}
          </div>
        </SectionCard>

        <SectionCard title="Centralization / Tool Sprawl" description="An insight into how much operational work has moved into Vaeroex.">
          <div className={`rounded-lg border p-5 ${scoreTone(intelligence.toolSprawl.score)}`}>
            <p className="text-sm font-semibold">Operational data centralized</p>
            <p className="mt-2 text-5xl font-semibold">{intelligence.toolSprawl.score}<span className="text-xl">%</span></p>
            <p className="mt-3 text-sm leading-6">{intelligence.toolSprawl.explanation}</p>
          </div>
          <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <div>
              <p className="font-semibold text-ink">Modules used</p>
              <MiniList items={intelligence.toolSprawl.modulesUsed} empty="No modules used yet." />
            </div>
            <div>
              <p className="font-semibold text-ink">Not yet used</p>
              <MiniList items={intelligence.toolSprawl.modulesNotUsed} empty="All core modules are in use." />
            </div>
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[.95fr_1.05fr]">
        <SectionCard title="Decision Journal" description="Log why leadership made decisions, what outcome was expected, and when Vaeroex should review whether it helped.">
          <CreateDrawer title="Log decision" description="Vaeroex will keep this in business memory and include it in monthly and quarterly reviews." triggerLabel="Log Decision">
            <form action={createBusinessDecisionAction} className="grid gap-4 lg:grid-cols-2">
              <input type="hidden" name="return_path" value={returnPath} />
              <TextInput label="Decision title" name="title" required />
              <TextInput label="Owner" name="owner" />
              <TextInput label="Related KPI" name="related_kpi" />
              <TextInput label="Review date" name="review_date" type="date" />
              <SelectInput label="Status" name="status" options={decisionStatuses} defaultValue="open" />
              <div className="lg:col-span-2">
                <TextArea label="Reason" name="reason" rows={3} />
              </div>
              <div className="lg:col-span-2">
                <TextArea label="Expected outcome" name="expected_outcome" rows={3} />
              </div>
              <div className="lg:col-span-2">
                <PrimaryButton>Save decision</PrimaryButton>
              </div>
            </form>
          </CreateDrawer>
          <div className="mt-4 space-y-3">
            {intelligence.decisions.recent.length ? (
              intelligence.decisions.recent.map((decision) => (
                <article key={decision.id} className="rounded-lg border border-line p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-ink">{decision.title}</p>
                    <StatusBadge value={decision.status} />
                  </div>
                  <p className="mt-2 text-muted">{decision.reason || decision.expected_outcome || "Outcome review pending."}</p>
                  <p className="mt-2 text-xs text-muted">Owner: {decision.owner || "Not set"} · Review: {decision.review_date || "Not scheduled"}</p>
                </article>
              ))
            ) : (
              <p className="text-sm leading-6 text-muted">No decisions logged yet.</p>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Vaeroex recommendation queue" description="Vaeroex suggests actions, but a human must approve before anything is saved.">
          <div className="grid gap-3 lg:grid-cols-2">
            {intelligence.recommendationTracking.approvalQueue.slice(0, 6).map((item) => (
              <ActionCard key={item.id} item={item} returnPath={returnPath} isDemoWorkspace={isDemoWorkspace} />
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-line bg-slate-50 p-4">
            <p className="text-sm font-semibold text-ink">Recommendation outcome tracking</p>
            <MiniList items={intelligence.recommendationTracking.outcomeNotes} empty="No recommendation outcomes yet." />
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Weekly Management Meeting Mode">
          <MiniList items={intelligence.meetingMode.agenda} empty="No agenda available." />
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/tasks" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white">Create follow-ups</Link>
            <Link href="/app/reports" className="rounded-lg border border-line px-3 py-2 text-xs font-semibold">Generate weekly report</Link>
          </div>
        </SectionCard>

        <SectionCard title="What could go wrong next month?">
          <div className="space-y-3">
            {intelligence.riskSimulation.slice(0, 4).map((item) => (
              <ActionCard key={item.id} item={item} returnPath={returnPath} isDemoWorkspace={isDemoWorkspace} />
            ))}
          </div>
        </SectionCard>

        <SectionCard title="If I were the CEO">
          <p className="text-sm leading-6 text-muted">{intelligence.ceoMode.summary}</p>
          <div className="mt-4">
            <MiniList items={intelligence.ceoMode.actions} empty="No executive actions found." />
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
        <SectionCard title="Benchmark Mode" description="Default best-practice operating standards. No anonymous customer benchmarking is used.">
          <div className="space-y-3">
            {intelligence.benchmarkMode.map((item) => (
              <article key={item.title} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold text-ink">{item.title}</p>
                  <StatusBadge value={item.status} />
                </div>
                <p className="mt-2 text-muted">{item.evidence}</p>
                <p className="mt-1 text-xs text-muted">{item.recommendedAction}</p>
              </article>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Business Review Package" description="Owner, leadership, bank, investor, franchise, or quarterly review package.">
          <div className="grid gap-3 md:grid-cols-2">
            {intelligence.businessReviewPackage.sections.map((section) => (
              <article key={section.title} className="rounded-lg border border-line bg-white p-4">
                <p className="text-sm font-semibold text-ink">{section.title}</p>
                <MiniList items={section.lines.slice(0, 4)} empty="No content yet." />
              </article>
            ))}
          </div>
          {isDemoWorkspace ? (
            <div className="mt-4">
              <DemoPreviewNotice />
            </div>
          ) : (
            <form action={createBusinessReviewPackageAction} className="mt-4">
              <input type="hidden" name="return_path" value={returnPath} />
              <input type="hidden" name="title" value={intelligence.businessReviewPackage.title} />
              <input type="hidden" name="body_markdown" value={intelligence.businessReviewPackage.body} />
              <input type="hidden" name="date_range_start" value={dateRangeStart || ""} />
              <input type="hidden" name="date_range_end" value={dateRangeEnd || ""} />
              <ConfirmSubmitButton message="Save this Business Review Package to Reports?">
                Prepare Business Review Package
              </ConfirmSubmitButton>
            </form>
          )}
        </SectionCard>
      </section>
    </div>
  );
}

import Link from "next/link";
import { runVaeroexAction, saveVaeroexOutputAction } from "@/app/app/agents/actions";
import { EmptyState } from "@/components/operations/EmptyState";
import { ComplianceNotice } from "@/components/operations/ComplianceNotice";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, TextArea, TextInput } from "@/components/operations/FormControls";
import { JsonPreview } from "@/components/operations/JsonPreview";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { VAEROEX_WORKFLOWS, getVaeroexWorkflow, type VaeroexSaveTarget } from "@/lib/ai/vaeroex-workflows";
import type { Json } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type VaeroexHubPageProps = {
  searchParams?: Promise<{ error?: string; run?: string; saved?: string }>;
};

type JsonRecord = Record<string, unknown>;

const saveLabels: Record<VaeroexSaveTarget, string> = {
  tasks: "suggested tasks",
  sop: "SOP draft",
  form: "form draft",
  checklist: "checklist draft",
  report: "report draft"
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: Json): JsonRecord {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function vaeroexResultLabel(value: string) {
  return getVaeroexWorkflow(value).title;
}

function resultTitle(output: JsonRecord, fallback: string) {
  return str(output.title, fallback);
}

function resultBody(output: JsonRecord) {
  return str(output.response_markdown) || str(output.summary) || "No readable Vaeroex response was returned.";
}

function savedRecords(output: JsonRecord) {
  return asArray(output.saved_records).filter(isRecord);
}

function hasDraftForTarget(output: JsonRecord, target: VaeroexSaveTarget, workflowKey: string) {
  if (target === "tasks") {
    return Boolean(asArray(output.suggested_tasks).length || asArray(output.tasks).length || asArray(output.follow_up_tasks).length);
  }

  if (target === "form") {
    return Boolean(asArray(output.form).length || asArray(output.forms).length || asArray(output.suggested_forms).length);
  }

  if (target === "checklist") {
    return Boolean(asArray(output.checklist).length || asArray(output.checklists).length || asArray(output.suggested_checklists).length);
  }

  if (target === "sop") {
    return Boolean(asArray(output.sop).length || asArray(output.sops).length || asArray(output.suggested_sops).length);
  }

  if (target === "report") {
    return Boolean(
      asArray(output.report).length ||
        asArray(output.reports).length ||
        output.response_markdown ||
        ["operations_audit", "weekly_report", "daily_summary", "bottleneck_detector"].includes(workflowKey)
    );
  }

  return false;
}

function SaveButtons({ runId, workflowKey, output }: { runId: string; workflowKey: string; output: JsonRecord }) {
  const workflow = getVaeroexWorkflow(workflowKey);
  const targets = workflow.saveTargets.filter((target) => hasDraftForTarget(output, target, workflowKey));

  if (!targets.length) {
    return (
      <p className="rounded-lg border border-line bg-slate-50 p-3 text-sm text-muted">
        This Vaeroex result has no record drafts ready to save.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {targets.map((target) => (
        <form key={target} action={saveVaeroexOutputAction}>
          <input type="hidden" name="run_id" value={runId} />
          <input type="hidden" name="save_target" value={target} />
          <ConfirmSubmitButton message={`Save this Vaeroex draft into ${saveLabels[target]} now?`}>
            Confirm and save {saveLabels[target]}
          </ConfirmSubmitButton>
        </form>
      ))}
    </div>
  );
}

function WorkflowCard({ workflowKey }: { workflowKey: string }) {
  const workflow = getVaeroexWorkflow(workflowKey);

  return (
    <article className="rounded-lg border border-line bg-white p-4">
      <div>
        <h3 className="font-semibold">{workflow.title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted">{workflow.description}</p>
      </div>
      <form action={runVaeroexAction} className="mt-4 space-y-3">
        <input type="hidden" name="workflow_key" value={workflow.key} />
        <TextArea label="Context for Vaeroex" name="user_prompt" placeholder={workflow.promptPlaceholder} rows={4} />
        {(workflow.key === "weekly_report" || workflow.key === "daily_summary") ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Start date" name="date_range_start" type="date" />
            <TextInput label="End date" name="date_range_end" type="date" />
          </div>
        ) : null}
        <PrimaryButton>{workflow.actionLabel}</PrimaryButton>
      </form>
    </article>
  );
}

export default async function VaeroexHubPage({ searchParams }: VaeroexHubPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const { data: runs, error } = await supabase
    .from("ai_agent_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(30);
  const selectedRun = runs?.find((run) => run.id === params?.run) ?? runs?.[0] ?? null;
  const selectedOutput = selectedRun ? asRecord(selectedRun.output_json) : {};
  const workflows = VAEROEX_WORKFLOWS.filter((workflow) => workflow.key !== "ask_vaeroex");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Ask Vaeroex"
        title="Vaeroex Hub"
        description="Ask questions, generate operational drafts, review saved Vaeroex results, and confirm before anything is added to tasks, SOPs, forms, checklists, or reports."
      />

      <ErrorNotice message={params?.error || error?.message} />
      {params?.saved ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{params.saved}</div> : null}
      <ComplianceNotice />

      <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <SectionCard title="Ask Vaeroex" description="Use chat for a general operations question. The run is saved for review.">
            <form action={runVaeroexAction} className="space-y-4">
              <input type="hidden" name="workflow_key" value="ask_vaeroex" />
              <TextArea
                label="Question"
                name="user_prompt"
                required
                rows={6}
                placeholder="Ask about missed follow-ups, ownership gaps, handoffs, SOPs, forms, checklists, reporting, or next actions."
              />
              <PrimaryButton>Ask Vaeroex</PrimaryButton>
            </form>
          </SectionCard>

          <SectionCard
            title="Vaeroex workflows"
            description="Each workflow uses the active workspace context and saves the output as a draft result first."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              {workflows.map((workflow) => (
                <WorkflowCard key={workflow.key} workflowKey={workflow.key} />
              ))}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Run history" description="Recent Vaeroex results for this workspace.">
          {runs?.length ? (
            <div className="space-y-3">
              {runs.map((run) => (
                <Link
                  key={run.id}
                  href={{ pathname: "/app/agents", query: { run: run.id } }}
                  className={`block rounded-lg border p-3 text-sm ${
                    selectedRun?.id === run.id ? "border-vaeroex-blue bg-vaeroex-soft" : "border-line bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{vaeroexResultLabel(run.agent_type)}</p>
                      <p className="mt-1 text-xs text-muted">{new Date(run.created_at).toLocaleString()}</p>
                    </div>
                    <StatusBadge value={run.status} />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="No Vaeroex results yet" description="Ask Vaeroex or run a workflow to create the first saved result." />
          )}
        </SectionCard>
      </section>

      <SectionCard title="Selected result" description="Review the draft. Nothing is saved into operations modules until you confirm.">
        {selectedRun ? (
          <div className="space-y-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h3 className="text-xl font-semibold">{resultTitle(selectedOutput, vaeroexResultLabel(selectedRun.agent_type))}</h3>
                <p className="mt-1 text-xs text-muted">
                  {vaeroexResultLabel(selectedRun.agent_type)} · {new Date(selectedRun.created_at).toLocaleString()}
                </p>
              </div>
              <StatusBadge value={selectedRun.status} />
            </div>

            {selectedRun.error_message ? <ErrorNotice message={selectedRun.error_message} /> : null}

            <div className="rounded-lg bg-slate-50 p-4 text-sm leading-6 whitespace-pre-wrap">{resultBody(selectedOutput)}</div>

            {selectedRun.status === "completed" ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">Manager confirmation required</p>
                <p className="mt-1 text-sm leading-6 text-amber-900">
                  Review this Vaeroex draft before saving it into operations records.
                </p>
                <div className="mt-4">
                  <SaveButtons runId={selectedRun.id} workflowKey={selectedRun.agent_type} output={selectedOutput} />
                </div>
              </div>
            ) : null}

            {savedRecords(selectedOutput).length ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                {savedRecords(selectedOutput).length} confirmed save event{savedRecords(selectedOutput).length === 1 ? "" : "s"} recorded for this result.
              </div>
            ) : null}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Structured Vaeroex output</p>
              <JsonPreview value={selectedRun.output_json} />
            </div>
          </div>
        ) : (
          <EmptyState title="No result selected" description="Run a Vaeroex workflow to review output and confirm saves." />
        )}
      </SectionCard>
    </div>
  );
}

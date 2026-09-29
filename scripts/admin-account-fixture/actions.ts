import type { Database } from "@/lib/supabase/types";
import { navigate } from "../customer-evidence-workflow-fixture/navigation";

type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];
type Subscription = Database["public"]["Tables"]["customer_subscriptions"]["Row"];
type Request = Database["public"]["Tables"]["manual_activation_requests"]["Row"];
export type Lifecycle = "active" | "inactive" | "pending_activation" | "archived";
export type Mode = "manual" | "delayed_success" | "delayed_failure";
type Outcome = "success" | "failure";
export const workspaceId = "00000000-0000-4000-8000-000000000001";
export const detailPath = `/app/admin/customers/${workspaceId}`;
const timestamp = "2026-09-29T00:00:00Z";
let state = {
  mode: "manual" as Mode,
  lifecycle: "inactive" as Lifecycle,
  submitted: 0,
  succeeded: 0,
  failed: 0,
  revision: 0,
  pending: [] as Array<{ id: number; label: string }>,
  workspace: { id: workspaceId, name: "Acme Sample", subscription_status: "expired", plan_slug: "vaeroex", subscription_required: true, manually_unlocked: false, trial_ends_at: null, created_at: timestamp, updated_at: timestamp } as Workspace,
  subscription: { id: "00000000-0000-4000-8000-000000000002", workspace_id: workspaceId, customer_email: "owner@example.test", customer_name: "Sample Owner", status: "expired", plan_slug: "vaeroex", source: "manual", billing_provider: "manual", manually_activated: true, notes: "Synthetic record for local verification.", created_at: timestamp, updated_at: timestamp } as Subscription,
  request: { id: "00000000-0000-4000-8000-000000000003", email: "owner@example.test", name: "Sample Owner", company: "Acme Sample", status: "pending", message: "Synthetic activation request.", created_at: timestamp } as Request
};
const listeners = new Set<() => void>();
const completions = new Map<number, (outcome: Outcome) => void>();
export const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const snapshot = () => state;
function update(patch: Partial<typeof state>) { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); }
export function setMode(mode: Mode) { update({ mode }); }
export function complete(id: number, outcome: Outcome) { const resolve = completions.get(id); completions.delete(id); resolve?.(outcome); }
export function setLifecycle(lifecycle: Lifecycle) {
  if (state.pending.length) return;
  const status = lifecycle === "active" ? "active" : lifecycle === "pending_activation" ? "manual_review" : "expired";
  update({ lifecycle, workspace: { ...state.workspace, subscription_status: status, manually_unlocked: lifecycle === "active" }, subscription: { ...state.subscription, status }, revision: state.revision + 1 });
}
function value(form: FormData, key: string) { return String(form.get(key) || "").trim(); }
function bool(form: FormData, key: string) { return ["on", "true"].includes(value(form, key)); }
function refreshLifecycle() {
  if (state.lifecycle === "archived") return;
  const statuses = [state.workspace.subscription_status, state.subscription.status];
  const lifecycle = !state.workspace.subscription_required || state.workspace.manually_unlocked || statuses.includes("active") || statuses.includes("trialing") ? "active" : statuses.includes("manual_review") ? "pending_activation" : "inactive";
  update({ lifecycle });
}

// UI-only action stand-ins. They do not implement auth, RLS, SQL transactions,
// billing reconciliation, connected-service access, or persistence.
async function run(form: FormData, label: string, mutation: () => string) {
  const id = state.submitted + 1;
  const mode = state.mode;
  update({ submitted: id, pending: [...state.pending, { id, label }] });
  const outcome = await new Promise<Outcome>((resolve) => {
    completions.set(id, resolve);
    if (mode !== "manual") window.setTimeout(() => complete(id, mode === "delayed_success" ? "success" : "failure"), 8000);
  });
  let message: string;
  let failed = outcome === "failure";
  try {
    message = failed ? "Synthetic failure: no fixture records were changed. Review the form and try again." : mutation();
  } catch (error) {
    failed = true;
    message = error instanceof Error ? error.message : "Synthetic action failed.";
  }
  update({ pending: state.pending.filter((request) => request.id !== id), succeeded: state.succeeded + Number(!failed), failed: state.failed + Number(failed), revision: state.revision + 1 });
  const target = value(form, "return_to").startsWith(detailPath) ? value(form, "return_to") : detailPath;
  const url = new URL(target, window.location.origin);
  url.searchParams.set(failed ? "error" : "message", message);
  url.searchParams.delete(failed ? "message" : "error");
  navigate(`${url.pathname}${url.search}`);
}
export async function updateWorkspaceAccessAction(form: FormData) {
  await run(form, "Workspace access", () => {
    update({ workspace: { ...state.workspace, subscription_status: value(form, "subscription_status"), plan_slug: value(form, "plan_slug"), subscription_required: bool(form, "subscription_required"), manually_unlocked: bool(form, "manually_unlocked") } });
    refreshLifecycle();
    return "Synthetic workspace access settings saved once.";
  });
}
export async function updateSubscriptionAction(form: FormData) {
  await run(form, "Subscription record", () => {
    const status = value(form, "status");
    update({ subscription: { ...state.subscription, status, plan_slug: value(form, "plan_slug"), notes: value(form, "notes") }, workspace: { ...state.workspace, subscription_status: status, manually_unlocked: ["active", "trialing"].includes(status) } });
    refreshLifecycle();
    return "Synthetic subscription record saved once. Stripe was not called.";
  });
}
export async function createManualSubscriptionAction(form: FormData) {
  await run(form, "Manual activation", () => {
    const status = value(form, "status");
    update({ subscription: { ...state.subscription, customer_email: value(form, "customer_email"), customer_name: value(form, "customer_name"), status, billing_provider: "manual", source: "manual", manually_activated: true, notes: value(form, "notes") }, workspace: { ...state.workspace, subscription_status: status, manually_unlocked: ["active", "trialing"].includes(status) } });
    refreshLifecycle();
    return "Synthetic manual activation saved once. No paid subscription was created.";
  });
}
export async function reviewActivationRequestAction(form: FormData) {
  await run(form, "Activation review", () => {
    const status = value(form, "status");
    if (state.request.status === "approved" && status !== "approved") throw new Error("Synthetic lifecycle guard: an approved activation request cannot change review status.");
    update({ request: { ...state.request, status } });
    if (status === "approved") update({ subscription: { ...state.subscription, status: "active" }, workspace: { ...state.workspace, subscription_status: "active", subscription_required: true, manually_unlocked: true } });
    refreshLifecycle();
    return "Synthetic activation review saved once.";
  });
}
export async function transitionWorkspaceLifecycleAction(form: FormData) {
  const action = value(form, "lifecycle_action");
  await run(form, action === "restore" ? "Restore workspace" : "Archive workspace", () => {
    if (action === "archive") {
      if (state.lifecycle !== "inactive") throw new Error("Synthetic lifecycle guard: workspace must be inactive before archiving.");
      update({ lifecycle: "archived" });
      return "Synthetic workspace archived once. All fixture data is retained.";
    }
    if (action !== "restore") throw new Error("Invalid synthetic lifecycle action.");
    update({ lifecycle: "inactive" });
    refreshLifecycle();
    return "Synthetic workspace restored to Admin lists once. Access settings are unchanged.";
  });
}

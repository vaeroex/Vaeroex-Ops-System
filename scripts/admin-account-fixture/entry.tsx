import { useSyncExternalStore, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { AdminAccountOverview } from "@/components/admin/AdminAccountOverview";
import { AdminCompanyTabs, type AdminCompanyTab } from "@/components/admin/AdminCompanyTabs";
import { AdminLifecycleBadge } from "@/components/admin/AdminLifecycleBadge";
import { AdminWorkspaceAccessForm } from "@/components/admin/AdminWorkspaceAccessForm";
import { AdminWorkspaceLifecycleActions } from "@/components/admin/AdminWorkspaceLifecycleActions";
import { AdminSubscriptionEditor } from "@/components/admin/AdminSubscriptionEditor";
import { AdminManualActivationForm } from "@/components/admin/AdminManualActivationForm";
import { AdminActivationRequestReview } from "@/components/admin/AdminActivationRequestReview";
import { ActivityProvider } from "@/components/app/ActivityProvider";
import { SectionCard } from "@/components/operations/SectionCard";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { complete, detailPath, setLifecycle, setMode, snapshot, subscribe, workspaceId, type Lifecycle, type Mode } from "./actions";
import Link, { usePathname, useSearchParams } from "../customer-evidence-workflow-fixture/navigation";

window.fetch = async () => { throw new Error("Synthetic preview: all network connections are blocked."); };
const members = [{ id: "synthetic-member", userId: "00000000-0000-4000-8000-000000000004", name: "Sample Owner", email: "owner@example.test", role: "owner", status: "active" }];
const buttonClass = "min-h-11 rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50";
function Preview() {
  const fixture = useSyncExternalStore(subscribe, snapshot, snapshot);
  const pathname = usePathname();
  const params = useSearchParams();
  const requestedTab = params.get("tab") || "overview";
  const tab = (["overview", "workspace", "subscription", "agreement"].includes(requestedTab) ? requestedTab : "overview") as AdminCompanyTab;
  const returnTo = `${detailPath}?tab=${tab}`;
  const company = { workspace_id: workspaceId, company_name: "Acme Sample", primary_contact_name: "Sample Owner", primary_contact_email: "owner@example.test", lifecycle_status: fixture.lifecycle, industry: "Sample services", size: "1–10", subscription_status: fixture.subscription.status } as ComponentProps<typeof AdminAccountOverview>["company"];
  return <ActivityProvider><div className="vaeroex-app-shell min-h-dvh overflow-x-hidden bg-[#f8fafc] text-ink">
    <div className="border-b border-white/10 bg-[#08111f] p-3 text-xs leading-5 text-amber-100">LOCAL SYNTHETIC PREVIEW — actual Admin components. Server actions, lifecycle guards, redirects, and persistence are mocked in memory. This does not qualify database authorization, RLS, or Production behavior. No provider or network connections.</div>
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <details className="rounded-lg border border-white/10 bg-[#08111f] p-4" open>
        <summary className="cursor-pointer text-sm font-semibold">Fixture controls · synthetic actions only</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Response mode<select value={fixture.mode} onChange={(event) => setMode(event.target.value as Mode)} className="mt-1 min-h-11 w-full rounded-md border border-line bg-slate-950 px-3 text-white"><option value="manual">Hold pending until completed below</option><option value="delayed_success">Success after 8 seconds</option><option value="delayed_failure">Failure after 8 seconds</option></select></label>
          <label className="text-sm">Mock workspace state<select value={fixture.lifecycle} disabled={Boolean(fixture.pending.length)} onChange={(event) => setLifecycle(event.target.value as Lifecycle)} className="mt-1 min-h-11 w-full rounded-md border border-line bg-slate-950 px-3 text-white"><option value="inactive">Inactive</option><option value="active">Active</option><option value="pending_activation">Pending activation</option><option value="archived">Archived</option></select></label>
        </div>
        <p data-fixture-counts className="mt-3 text-xs text-slate-300">Submitted: {fixture.submitted} · Pending: {fixture.pending.length} · Succeeded: {fixture.succeeded} · Failed: {fixture.failed}</p>
        {fixture.pending.map((request) => <div key={request.id} className="mt-3 flex flex-wrap items-center gap-3"><span className="text-sm">#{request.id} {request.label}</span><button type="button" className={buttonClass} onClick={() => complete(request.id, "success")}>Complete success #{request.id}</button><button type="button" className={buttonClass} onClick={() => complete(request.id, "failure")}>Complete failure #{request.id}</button></div>)}
        <p className="mt-3 text-xs text-slate-400">Submit a real form below, verify its pending control, then complete the synthetic response. Canceling archive/restore should leave Submitted unchanged. Reload resets all fixture state.</p>
      </details>
      {pathname === "/app/admin/customers" ? <SectionCard title="Customers" description="Synthetic return destination only. The production company directory is not reproduced by this fixture."><Link href={detailPath} className="inline-flex min-h-11 items-center text-sm font-semibold text-vaeroex-blue">Acme Sample · owner@example.test · Open account</Link></SectionCard> : pathname.startsWith("/app/admin/workspace-agreements/") ? <SectionCard title="Synthetic agreement detail" description="Navigation-only substitute. Immutable agreement records, secure PDFs, printing, and email delivery are outside this fixture."><Link href={`${detailPath}?tab=agreement`} className="inline-flex min-h-11 items-center text-sm font-semibold text-vaeroex-blue">Back to Acme Sample agreement</Link></SectionCard> : <>
      <Link href="/app/admin/customers" className="inline-flex min-h-11 items-center text-sm font-semibold text-vaeroex-blue hover:underline">Back to Customers</Link>
      <header><p className="text-xs uppercase tracking-wide text-slate-400">Workspace account</p><h1 className="mt-1 text-2xl font-semibold">Acme Sample</h1><p className="mt-2 text-sm text-slate-400">Manage this workspace’s access, subscription records, and agreement. User logins are separate.</p></header>
      {params.get("message") ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{params.get("message")}</p> : null}
      <ErrorNotice message={params.get("error")} />
      <AdminCompanyTabs workspaceId={workspaceId} activeTab={tab} />
      <div key={`${tab}-${fixture.revision}`} className="space-y-6">
      {tab === "overview" ? <AdminAccountOverview company={company} members={members} memberCount={1} memberError={null} subscriptionLabel={`${fixture.subscription.status} · Vaeroex · manual`} agreementLabel="No agreement" attention={fixture.lifecycle === "inactive" ? ["Access required", "Missing agreement"] : ["Missing agreement"]} footprint={[{ label: "KPIs", value: "4" }, { label: "Evidence files", value: "3" }, { label: "Saved analyses", value: "2" }, { label: "Analysis artifacts", value: "2" }]} /> : null}
      {tab === "workspace" ? <>
        <SectionCard title="Workspace access settings" description="Changes affect this workspace’s eligibility, not a user’s login or membership. Linked subscriptions also determine access."><AdminWorkspaceAccessForm workspace={fixture.workspace} returnTo={returnTo} /></SectionCard>
        <SectionCard title="Admin list visibility" description="Archive hides an inactive workspace from normal Admin lists. It does not deactivate a login, delete data, cancel billing, or disconnect services."><div className="flex flex-col items-start gap-4"><AdminLifecycleBadge value={fixture.lifecycle} /><AdminWorkspaceLifecycleActions workspaceId={workspaceId} companyName="Acme Sample" lifecycle={fixture.lifecycle} returnTo={returnTo} /></div></SectionCard>
      </> : null}
      {tab === "subscription" ? <>
        <CreateDrawer title="Manual subscription record" description="Record a manually approved subscription. Existing records may be updated. Check workspace access after saving; this does not charge the customer." triggerLabel="Manage manual subscription"><AdminManualActivationForm returnTo={returnTo} workspaceId={workspaceId} customerEmail="owner@example.test" customerName="Sample Owner" /></CreateDrawer>
        <SectionCard title="Subscription records" description="These are Vaeroex records, not controls for canceling or charging a Stripe subscription."><p className="font-semibold text-ink">{fixture.subscription.customer_email}</p><p className="mt-1 text-sm text-muted">{fixture.subscription.status} · manual</p><details className="mt-4 border-t border-line pt-4" open={Boolean(params.get("error"))}><summary className="cursor-pointer text-sm font-semibold text-ink">Edit subscription record</summary><div className="mt-4"><AdminSubscriptionEditor subscription={fixture.subscription} returnTo={returnTo} /></div></details></SectionCard>
        <details className="rounded-lg border border-line p-4"><summary className="cursor-pointer font-semibold text-ink">Activation and subscription history</summary><div className="mt-4"><SectionCard title="Activation requests"><p className="font-semibold text-ink">owner@example.test</p><p className="mt-1 text-sm text-muted">Acme Sample · {fixture.request.status}</p><AdminActivationRequestReview request={fixture.request} returnTo={returnTo} /></SectionCard></div></details>
      </> : null}
      {tab === "agreement" ? <SectionCard title="Workspace Agreement"><p className="text-sm text-muted">No stored agreement in this synthetic fixture. PDF and email actions are outside this preview.</p><Link href="/app/admin/workspace-agreements/synthetic-agreement" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-vaeroex-blue">Open synthetic agreement return-path check</Link></SectionCard> : null}
      </div>
      </>}
    </main>
  </div></ActivityProvider>;
}
createRoot(document.getElementById("root")!).render(<Preview />);

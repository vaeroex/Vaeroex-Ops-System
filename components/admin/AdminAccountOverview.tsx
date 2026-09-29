import Link from "next/link";
import type { Route } from "next";
import { AdminLifecycleBadge } from "@/components/admin/AdminLifecycleBadge";
import { SectionCard } from "@/components/operations/SectionCard";
import type { AdminCompanyRow } from "@/lib/admin/company-directory";

export type AdminAccountMember = { id: string; userId: string | null; name: string | null; email: string | null; role: string; status: string };

export function AdminAccountOverview({ company, members, memberCount, memberError, subscriptionLabel, agreementLabel, attention, footprint }: {
  company: AdminCompanyRow;
  members: AdminAccountMember[];
  memberCount: number | null;
  memberError: string | null;
  subscriptionLabel: string;
  agreementLabel: string;
  attention: string[];
  footprint: Array<{ label: string; value: string }>;
}) {
  const detail = `/app/admin/customers/${company.workspace_id}`;
  return (
    <SectionCard title="Account overview" description="This customer record represents a workspace, not a separate login account.">
      <div className="space-y-5">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <div className="min-w-0"><dt className="text-xs font-semibold uppercase text-muted">Primary contact</dt><dd className="mt-1 font-semibold text-ink">{company.primary_contact_name || "Name not set"}</dd><dd className="break-all text-sm text-muted">{company.primary_contact_email || "Email not set"}</dd></div>
          <div><dt className="mb-2 text-xs font-semibold uppercase text-muted">Admin list status</dt><dd><AdminLifecycleBadge value={company.lifecycle_status} /></dd><dd className="mt-1 text-xs text-muted">Not the user’s sign-in status. Linked subscriptions also determine access.</dd></div>
          <div><dt className="text-xs font-semibold uppercase text-muted">Subscription record</dt><dd className="mt-1 text-sm text-ink">{subscriptionLabel}</dd></div>
          <div><dt className="text-xs font-semibold uppercase text-muted">Agreement</dt><dd className="mt-1 text-sm text-ink">{agreementLabel}</dd></div>
        </dl>
        {attention.length ? <p className="rounded-lg border border-amber-300/30 px-3 py-2 text-sm text-amber-900"><span className="font-semibold">Review: </span>{attention.join(" · ")}</p> : <p className="text-sm text-muted">No current access, activation, or agreement exceptions.</p>}
        <div className="flex flex-wrap gap-3">
          <Link href={`${detail}?tab=workspace` as Route} className="inline-flex min-h-11 items-center rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Manage workspace access</Link>
          <Link href={`${detail}?tab=subscription` as Route} className="inline-flex min-h-11 items-center rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink">Review subscription records</Link>
        </div>
        <details className="rounded-lg border border-line p-3" open={Boolean(memberError)}>
          <summary className="cursor-pointer text-sm font-semibold text-ink">Workspace members{memberCount === null ? " · unavailable" : ` · ${memberCount}`}</summary>
          <p className="mt-2 text-xs text-muted">Roles and membership statuses apply only to this workspace. They do not describe whether a login is enabled.</p>
          {memberError ? <p role="status" className="mt-3 text-sm text-amber-900">{memberError}</p> : !members.length ? <p className="mt-3 text-sm text-muted">No membership records.</p> : (
            <ul className="mt-3 divide-y divide-line">
              {members.map((member) => <li key={member.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:justify-between sm:gap-4">
                <div className="min-w-0"><p className="font-semibold text-ink">{member.name || member.email || "Profile unavailable"}</p>{member.name && member.email ? <p className="break-all text-sm text-muted">{member.email}</p> : null}<p className="break-all text-xs text-muted">{member.userId ? `User ID: ${member.userId}` : "Invitation only · no linked login"}</p></div>
                <p className="shrink-0 text-sm text-muted">{member.role} · {member.status}</p>
              </li>)}
            </ul>
          )}
          {memberCount !== null && memberCount > members.length ? <p className="mt-2 text-xs text-muted">Showing the first {members.length} of {memberCount} membership records.</p> : null}
        </details>
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink">Workspace details and retained records</summary>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="min-w-0"><dt className="text-xs text-muted">Workspace ID</dt><dd className="break-all text-sm text-ink">{company.workspace_id}</dd></div>
            <div><dt className="text-xs text-muted">Company profile</dt><dd className="text-sm text-ink">{company.industry || "Industry not set"} · {company.size || "Size not set"}</dd></div>
            {footprint.map(({ label, value }) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="text-sm text-ink">{value}</dd></div>)}
          </dl>
        </details>
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink">Login, removal, and deletion limits</summary>
          <p className="mt-3 text-sm text-muted">Login-account deactivation/reactivation, removing a member’s access, and deleting an account or workspace are not supported by this Admin area. Archive only changes visibility in Admin; it is not deletion or deactivation.</p>
          <p className="mt-2 text-sm text-muted">These controls do not cancel Stripe billing or disconnect connected services. Connection records and saved data are retained; service availability still depends on its own access checks.</p>
        </details>
      </div>
    </SectionCard>
  );
}

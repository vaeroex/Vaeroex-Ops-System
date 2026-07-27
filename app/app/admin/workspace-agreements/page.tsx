import Link from "next/link";
import type { Route } from "next";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";
import type { Database } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type AgreementRow = Database["public"]["Tables"]["workspace_agreements"]["Row"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

function quotedPostgrestValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export default async function AdminWorkspaceAgreementsPage({
  searchParams
}: {
  searchParams?: Promise<{ q?: string; date?: string }>;
}) {
  const { admin } = await requireVaeroexAdmin("/app");
  const params = (await searchParams) || {};
  const query = (params.q || "").trim();
  const date = (params.date || "").trim();
  let agreementsQuery = admin
    .from("workspace_agreements")
    .select("*")
    .order("signed_at", { ascending: false });

  if (query) {
    agreementsQuery = UUID_PATTERN.test(query)
      ? agreementsQuery.or(`id.eq.${query},workspace_id.eq.${query}`)
      : agreementsQuery.or([
        `organization_name.ilike.${quotedPostgrestValue(`*${query}*`)}`,
        `owner_business_email.ilike.${quotedPostgrestValue(`*${query}*`)}`
      ].join(","));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    agreementsQuery = agreementsQuery.gte("signed_at", start.toISOString()).lt("signed_at", end.toISOString());
  }

  const { data, error } = await agreementsQuery.limit(200);
  const rows = (data || []) as AgreementRow[];

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-white p-6 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Legal records</p>
        <h1 className="mt-2 text-2xl font-semibold">Workspace Agreements</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Search immutable signed agreements. Administrators may view or download records, but cannot edit them.</p>
      </section>

      <form method="get" className="grid gap-3 rounded-lg border border-line bg-white p-4 shadow-panel md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="text-sm font-medium">Agreement, workspace, organization, or owner email
          <input name="q" defaultValue={params.q || ""} className="mt-2 min-h-11 w-full rounded-md border border-line px-3 py-2" />
        </label>
        <label className="text-sm font-medium">Signed date
          <input type="date" name="date" defaultValue={date} className="mt-2 min-h-11 rounded-md border border-line px-3 py-2" />
        </label>
        <button className="min-h-11 self-end rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Search</button>
      </form>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">Workspace Agreements could not be loaded.</div> : null}

      <section className="rounded-lg border border-line bg-white p-4 shadow-panel">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
          <h2 className="font-semibold">Signed agreements</h2>
          <span className="text-xs text-muted">{rows.length} showing</span>
        </div>
        <div className="divide-y divide-line">
          {rows.map((agreement) => (
            <article key={agreement.id} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
              <div className="min-w-0">
                <p className="font-semibold">{agreement.organization_name}</p>
                <p className="mt-1 break-all text-xs text-muted">{agreement.owner_business_email}</p>
              </div>
              <div className="min-w-0 text-xs leading-5 text-muted">
                <p>Signed {formatDate(agreement.signed_at)}</p>
                <p className="truncate">Agreement {agreement.id}</p>
                <p className="truncate">Workspace {agreement.workspace_id}</p>
              </div>
              <Link href={`/app/admin/workspace-agreements/${agreement.id}` as Route} className="inline-flex min-h-11 items-center justify-center rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink hover:border-vaeroex-blue hover:text-vaeroex-blue">View agreement</Link>
            </article>
          ))}
          {!rows.length ? <p className="py-8 text-center text-sm text-muted">No Workspace Agreements match this search.</p> : null}
        </div>
      </section>
    </div>
  );
}

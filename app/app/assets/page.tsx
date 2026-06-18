import { createAssetAction, createAssetCheckAction } from "@/app/app/operations/actions";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type AssetsPageProps = {
  searchParams?: Promise<{ error?: string }>;
};

export default async function AssetsPage({ searchParams }: AssetsPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [{ data: assets, error: assetsError }, { data: checks, error: checksError }] = await Promise.all([
    supabase
      .from("assets")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    supabase
      .from("asset_checks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(12)
  ]);
  const assetNameById = new Map((assets || []).map((asset) => [asset.id, asset.asset_name]));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Assets"
        title="Equipment and readiness"
        description="Track asset status, location, identifiers, inspection history, and equipment that needs attention."
      />

      <ErrorNotice message={params?.error || assetsError?.message || checksError?.message} />

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <SectionCard title="Asset register" description="Current equipment and operational assets for this workspace.">
            {assets?.length ? (
              <div className="overflow-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="py-2">Asset</th>
                      <th>Type</th>
                      <th>Identifier</th>
                      <th>Location</th>
                      <th>Status</th>
                      <th>Last check</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {assets.map((asset) => (
                      <tr key={asset.id}>
                        <td className="py-3">
                          <p className="font-semibold">{asset.asset_name}</p>
                          <p className="text-xs text-muted">{asset.notes || "No notes."}</p>
                        </td>
                        <td>{asset.asset_type || "-"}</td>
                        <td>{asset.identifier || "-"}</td>
                        <td>{asset.location || "-"}</td>
                        <td>
                          <StatusBadge value={asset.status} />
                        </td>
                        <td className="text-muted">{asset.last_checked_at ? new Date(asset.last_checked_at).toLocaleDateString() : "Never"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No assets yet" description="Add equipment, vehicles, kits, devices, rooms, or other tracked operational assets." />
            )}
          </SectionCard>

          <SectionCard title="Recent asset checks" description="Status checks submitted by workspace members.">
            {checks?.length ? (
              <div className="space-y-3">
                {checks.map((check) => (
                  <article key={check.id} className="rounded-lg border border-line p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{assetNameById.get(check.asset_id) || "Asset"}</p>
                        <p className="mt-1 text-xs text-muted">{new Date(check.created_at).toLocaleString()}</p>
                      </div>
                      <StatusBadge value={check.status} />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-muted">{check.notes || "No notes."}</p>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="No asset checks" description="Run a quick asset check to document readiness or needed repairs." />
            )}
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Add asset" description="Create a new tracked item.">
            <form action={createAssetAction} className="space-y-4">
              <TextInput label="Asset name" name="asset_name" required />
              <TextInput label="Asset type" name="asset_type" placeholder="Vehicle, equipment, kit, device" />
              <TextInput label="Identifier" name="identifier" placeholder="Serial, unit number, license" />
              <TextInput label="Location" name="location" />
              <SelectInput label="Status" name="status" defaultValue="Ready" options={["Ready", "Needs attention", "Out of service", "Missing"]} />
              <TextArea label="Notes" name="notes" rows={3} />
              <PrimaryButton>Add asset</PrimaryButton>
            </form>
          </SectionCard>

          <SectionCard title="Add asset check" description="Record current readiness.">
            {assets?.length ? (
              <form action={createAssetCheckAction} className="space-y-4">
                <label className="block text-sm font-medium">
                  Asset
                  <select
                    name="asset_id"
                    required
                    className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
                  >
                    {assets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.asset_name}
                      </option>
                    ))}
                  </select>
                </label>
                <SelectInput label="Status" name="status" defaultValue="Ready" options={["Ready", "Needs attention", "Out of service", "Missing"]} />
                <TextArea label="Notes" name="notes" rows={4} />
                <PrimaryButton>Save check</PrimaryButton>
              </form>
            ) : (
              <EmptyState title="Add an asset first" description="Asset checks need a tracked asset." />
            )}
          </SectionCard>
        </div>
      </section>
    </div>
  );
}

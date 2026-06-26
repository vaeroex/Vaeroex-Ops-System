import { createAssetAction, createAssetCheckAction } from "@/app/app/operations/actions";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { PageHeader } from "@/components/operations/PageHeader";
import { getRecordFolders, managedValues, shortPreview } from "@/lib/records/management";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type AssetsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const assetStatuses = ["Ready", "Needs attention", "Out of service", "Missing"];
const assetEditFields: ManagedRecordEditField[] = [
  { name: "asset_name", label: "Asset name", required: true },
  { name: "asset_type", label: "Asset type" },
  { name: "identifier", label: "Identifier" },
  { name: "location", label: "Location" },
  { name: "status", label: "Status", type: "select", options: assetStatuses },
  { name: "notes", label: "Notes", type: "textarea", rows: 4 }
];
const assetCheckEditFields: ManagedRecordEditField[] = [
  { name: "status", label: "Status", type: "select", options: assetStatuses },
  { name: "notes", label: "Notes", type: "textarea", rows: 4 }
];

export default async function AssetsPage({ searchParams }: AssetsPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [{ data: assets, error: assetsError }, { data: checks, error: checksError }, assetFolders, checkFolders] = await Promise.all([
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
      .limit(12),
    getRecordFolders(supabase, workspaceId, "assets"),
    getRecordFolders(supabase, workspaceId, "asset_checks")
  ]);
  const assetNameById = new Map((assets || []).map((asset) => [asset.id, asset.asset_name]));
  const managedAssets = (assets || []).map((asset) => {
    const management = managedValues(asset);

    return {
      id: asset.id,
      title: asset.asset_name,
      type: asset.asset_type || "Asset",
      status: asset.status,
      owner: asset.assigned_to ? "Assigned" : "Unassigned",
      category: asset.location || "No location",
      createdAt: asset.created_at,
      updatedAt: management.updatedAt || asset.updated_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(asset.notes, "No notes."),
      meta: [
        { label: "Identifier", value: asset.identifier || "Not set" },
        { label: "Location", value: asset.location || "Not set" },
        { label: "Last check", value: asset.last_checked_at ? new Date(asset.last_checked_at).toLocaleDateString() : "Never" }
      ],
      editFields: assetEditFields,
      editValues: {
        asset_name: asset.asset_name,
        asset_type: asset.asset_type,
        identifier: asset.identifier,
        location: asset.location,
        status: asset.status,
        notes: asset.notes
      },
      children: <p className="text-sm leading-6 text-muted">{asset.notes || "No notes."}</p>
    };
  });
  const managedChecks = (checks || []).map((check) => {
    const management = managedValues(check);
    const assetName = assetNameById.get(check.asset_id) || "Asset";

    return {
      id: check.id,
      title: assetName,
      type: "Asset check",
      status: check.status,
      owner: check.checked_by ? "Checked" : "Unassigned",
      category: assetName,
      createdAt: check.created_at,
      updatedAt: management.updatedAt || check.created_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(check.notes, "No notes."),
      meta: [{ label: "Asset", value: assetName }],
      editFields: assetCheckEditFields,
      editValues: {
        status: check.status,
        notes: check.notes
      },
      children: <p className="text-sm leading-6 text-muted">{check.notes || "No notes."}</p>
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Assets"
        title="Assets"
        description="Keep visibility into asset status, location, identifiers, inspection history, and equipment that needs attention."
      />

      <ErrorNotice message={(params?.error as string | undefined) || assetsError?.message || checksError?.message || assetFolders.error?.message || checkFolders.error?.message} />

      <section className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <CreateDrawer title="Add asset" description="Create a new tracked item." triggerLabel="New Asset">
            <form action={createAssetAction} className="grid gap-4">
              <TextInput label="Asset name" name="asset_name" required />
              <TextInput label="Asset type" name="asset_type" placeholder="Vehicle, equipment, kit, device" />
              <TextInput label="Identifier" name="identifier" placeholder="Serial, unit number, license" />
              <TextInput label="Location" name="location" />
              <SelectInput label="Status" name="status" defaultValue="Ready" options={assetStatuses} />
              <TextArea label="Notes" name="notes" rows={3} />
              <PrimaryButton>Add asset</PrimaryButton>
            </form>
          </CreateDrawer>

          <CreateDrawer title="Add asset check" description="Record current readiness." triggerLabel="New Check">
            {assets?.length ? (
              <form action={createAssetCheckAction} className="grid gap-4">
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
                <SelectInput label="Status" name="status" defaultValue="Ready" options={assetStatuses} />
                <TextArea label="Notes" name="notes" rows={4} />
                <PrimaryButton>Save check</PrimaryButton>
              </form>
            ) : (
              <EmptyState title="Add an asset first" description="Asset checks need a tracked asset." />
            )}
          </CreateDrawer>
        </div>

        <ManagedRecordList
          collection="assets"
          records={managedAssets}
          folders={assetFolders.folders}
          title="Asset records"
          description="Track readiness and organize equipment without a long open table."
          emptyTitle="No assets yet"
          emptyDescription="Add equipment, vehicles, kits, devices, rooms, or other tracked business assets."
          searchParams={params}
        />

        <ManagedRecordList
          collection="asset_checks"
          records={managedChecks}
          folders={checkFolders.folders}
          title="Asset check records"
          description="Recent checks can also be archived, moved, duplicated, or deleted."
          emptyTitle="No asset checks"
          emptyDescription="Run a quick asset check to document readiness or needed repairs."
          returnPath="/app/assets"
          searchParams={params}
        />
      </section>
    </div>
  );
}

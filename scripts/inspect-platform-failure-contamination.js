const { createClient } = require("@supabase/supabase-js");

const KNOWN_CONTAMINATION = Object.freeze({
  failedTimeoutRuns: [
    "d884b279-065e-4622-a4f0-3d848f1ad656",
    "2253c54f-8cf4-4b38-96f2-598794feeb06",
    "b17d1b3a-d432-4369-9118-a7fc6e1875b1"
  ],
  contaminatedContextualRuns: [
    "b8397c2e-b599-4eca-baf3-52e55a01ae91",
    "e9116dc5-adaf-47ee-ab41-e7ffccc68173",
    "b86bde70-74f0-477b-a377-6755e448e117",
    "dbbd0d16-3eb0-4dd3-bc71-0e90b7d1fa5a",
    "fcbf441c-cfa0-481c-ba23-c809b0120f74",
    "945268d0-1650-43b3-b194-c8edca427131"
  ],
  deletedSourceFiles: ["4d013217-0ef8-4768-90f8-f410b53c04cd"],
  invalidMemoryChunks: [
    "3489ec8a-7a66-4024-bc39-1655412ca8b1",
    "8c68c7dc-9922-455b-a312-83e4a8695491",
    "d604a432-c6fe-44c4-8dfc-669ecf05efe7",
    "2cc6e195-8372-4aee-8a04-8eda0cb60e60"
  ]
});

const FAILURE_LANGUAGE = /image extraction failed|no readable data|no usable information|unable to extract|provider error|parser (?:error|failure)|timed? out/i;

function lifecycle(record) {
  if (!record) return "not_found";
  if (record.deleted_at) return "deleted";
  if (record.archived_at) return "archived";
  return record.status || record.processing_status || "active";
}

function classification(record) {
  const containers = [record?.source_metadata, record?.metadata_json, record?.output_json, record?.input_json];
  for (const value of containers) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (typeof value.evidence_classification === "string") return value.evidence_classification;
    if (value.metadata && typeof value.metadata.evidence_classification === "string") return value.metadata.evidence_classification;
  }
  return "unclassified_legacy";
}

function offlinePlan() {
  const planned = (ids, recordType, remediation) => ids.map((id) => ({
    id,
    recordType,
    found: "not_queried",
    lifecycle: "unknown",
    evidenceClassification: "unknown",
    proposedRemediation: remediation,
    downstreamReferences: "inspect_live_required"
  }));

  return {
    mode: "offline_dry_run",
    readOnly: true,
    productionMutationAttempted: false,
    records: [
      ...planned(KNOWN_CONTAMINATION.failedTimeoutRuns, "ai_agent_run", "retain execution history; classify as platform_telemetry; exclude from business derivation"),
      ...planned(KNOWN_CONTAMINATION.contaminatedContextualRuns, "ai_agent_run", "classify as invalid_evidence; record derived-from contaminated evidence"),
      ...planned(KNOWN_CONTAMINATION.deletedSourceFiles, "file_upload", "retain soft deletion; invalidate derived analyses and chunks"),
      ...planned(KNOWN_CONTAMINATION.invalidMemoryChunks, "business_memory_chunk", "archive or invalidate; do not hard-delete")
    ],
    healthOrBriefingAffected: "inspect_live_required",
    copiedFailureLanguageFoundElsewhere: "inspect_live_required",
    recomputation: "prepare current Home, Business Health, Intelligence, and briefing recomputation after controlled remediation"
  };
}

async function selectKnown(client, table, ids, workspaceId, columns = "*") {
  const { data, error } = await client.from(table).select(columns).eq("workspace_id", workspaceId).in("id", ids);
  if (error) throw new Error(`${table} inspection failed: ${error.message}`);
  return data || [];
}

async function inspectLive({ url, key, workspaceId }) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const runIds = [...KNOWN_CONTAMINATION.failedTimeoutRuns, ...KNOWN_CONTAMINATION.contaminatedContextualRuns];
  const [runs, files, chunks, reports, healthSnapshots] = await Promise.all([
    selectKnown(client, "ai_agent_runs", runIds, workspaceId),
    selectKnown(client, "file_uploads", KNOWN_CONTAMINATION.deletedSourceFiles, workspaceId),
    selectKnown(client, "business_memory_chunks", KNOWN_CONTAMINATION.invalidMemoryChunks, workspaceId),
    client.from("reports").select("id,title,report_type,body_markdown,source_data_json,created_at").eq("workspace_id", workspaceId).limit(1000),
    client.from("business_health_snapshots").select("id,source_summary,created_at").eq("workspace_id", workspaceId).limit(100)
  ]);
  if (reports.error) throw new Error(`reports inspection failed: ${reports.error.message}`);
  const healthSnapshotsUnavailable = Boolean(
    healthSnapshots.error && ["42P01", "PGRST205"].includes(healthSnapshots.error.code)
  );
  if (healthSnapshots.error && !healthSnapshotsUnavailable) {
    throw new Error(`business_health_snapshots inspection failed: ${healthSnapshots.error.message}`);
  }

  const allKnownIds = Object.values(KNOWN_CONTAMINATION).flat();
  const generatedOutputs = [...(reports.data || []), ...(healthSnapshotsUnavailable ? [] : healthSnapshots.data || [])];
  const references = generatedOutputs.filter((record) => allKnownIds.some((id) => JSON.stringify(record).includes(id)));
  const copiedFailures = generatedOutputs.filter((record) => FAILURE_LANGUAGE.test(JSON.stringify(record)));
  const recordsById = new Map([...runs, ...files, ...chunks].map((record) => [record.id, record]));

  return {
    mode: "live_read_only_dry_run",
    readOnly: true,
    productionMutationAttempted: false,
    records: offlinePlan().records.map((planned) => {
      const record = recordsById.get(planned.id);
      const downstream = references.filter((candidate) => JSON.stringify(candidate).includes(planned.id)).map((candidate) => candidate.id);
      return {
        ...planned,
        found: Boolean(record),
        lifecycle: lifecycle(record),
        evidenceClassification: classification(record),
        downstreamReferences: downstream
      };
    }),
    healthOrBriefingAffected: references.map((record) => ({ id: record.id, title: record.title || null })),
    copiedFailureLanguageFoundElsewhere: copiedFailures.map((record) => ({ id: record.id, title: record.title || null })),
    warnings: healthSnapshotsUnavailable ? ["Business Health snapshots are not available in this schema."] : [],
    recomputation: offlinePlan().recomputation
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => /^(--apply|--execute|--mutate|--write)$/.test(arg))) {
    throw new Error("This inspector is permanently read-only. Mutation flags are not supported.");
  }

  if (!args.includes("--inspect-live")) {
    process.stdout.write(`${JSON.stringify(offlinePlan(), null, 2)}\n`);
    return;
  }

  const workspaceIndex = args.indexOf("--workspace-id");
  const workspaceId = workspaceIndex >= 0 ? args[workspaceIndex + 1] : "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!workspaceId || !url || !key) {
    throw new Error("Live inspection requires --workspace-id, NEXT_PUBLIC_SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY. An anonymous key cannot produce a trustworthy audit through RLS.");
  }

  process.stdout.write(`${JSON.stringify(await inspectLive({ url, key, workspaceId }), null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { FAILURE_LANGUAGE, KNOWN_CONTAMINATION, classification, inspectLive, lifecycle, offlinePlan };

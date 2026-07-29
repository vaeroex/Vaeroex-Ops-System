type PotentialChecklistRecord = {
  name?: string | null;
  metric_name?: string | null;
  category?: string | null;
  kpi_name?: string | null;
  canonical_name?: string | null;
  display_name?: string | null;
  original_source_label?: string | null;
  source_type?: string | null;
  source_title?: string | null;
  related_module?: string | null;
  related_kpi?: string | null;
  created_action_type?: string | null;
  agent_type?: string | null;
  issue_type?: string | null;
  input_json?: unknown;
  output_json?: unknown;
};

export function isChecklistDerivedRecord(record: PotentialChecklistRecord) {
  const identity = [
    record.name,
    record.metric_name,
    record.category,
    record.kpi_name,
    record.canonical_name,
    record.display_name,
    record.original_source_label,
    record.source_type,
    record.source_title,
    record.related_module,
    record.related_kpi,
    record.created_action_type,
    record.agent_type,
    record.issue_type,
    record.input_json,
    record.output_json
  ]
    .filter(Boolean)
    .map((value) => typeof value === "string" ? value : JSON.stringify(value))
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");

  return /\bchecklists?\b/.test(identity);
}

export function excludeChecklistDerivedMetrics<T extends PotentialChecklistRecord>(records: T[]) {
  return records.filter((record) => !isChecklistDerivedRecord(record));
}

export const excludeChecklistDerivedRecords = excludeChecklistDerivedMetrics;

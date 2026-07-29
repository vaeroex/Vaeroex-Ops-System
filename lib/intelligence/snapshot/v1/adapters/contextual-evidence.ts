import { CONTEXTUAL_EVIDENCE_SNAPSHOT_ADAPTER_VERSION, INTELLIGENCE_SNAPSHOT_LIMITS } from "@/lib/intelligence/snapshot/v1/versions";
import type {
  ContextualEvidenceProducerOutputV1,
  ContextualEvidenceSnapshotV1
} from "@/lib/intelligence/snapshot/v1/types";

function compact(value: string, maximum: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximum) return normalized;
  return normalized.slice(0, maximum).trim();
}

function boundedLabels(values: readonly string[], maximum: number) {
  return values
    .map((value) => compact(value, INTELLIGENCE_SNAPSHOT_LIMITS.boundedLabel))
    .filter(Boolean)
    .filter((value, index, items) => items.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index)
    .slice(0, maximum);
}

export function adaptContextualEvidenceProducerOutputV1({
  output,
  workspaceId,
  asOf,
  evaluationDate
}: {
  output: ContextualEvidenceProducerOutputV1;
  workspaceId: string;
  asOf: string;
  evaluationDate: string;
}): ContextualEvidenceSnapshotV1[] {
  return [...output.records]
    .sort((left, right) => right.approvedAt.localeCompare(left.approvedAt) || left.id.localeCompare(right.id))
    .slice(0, INTELLIGENCE_SNAPSHOT_LIMITS.contextualEvidenceRecords)
    .map((record) => {
      if (record.workspaceId !== workspaceId) {
        throw new Error(`Contextual evidence ${record.id} belongs to another workspace.`);
      }
      if (record.releaseChannel !== output.releaseChannel) {
        throw new Error(`Contextual evidence ${record.id} belongs to another release channel.`);
      }
      if (Date.parse(record.approvedAt) > Date.parse(asOf)) {
        throw new Error(`Contextual evidence ${record.id} was approved after the snapshot cutoff.`);
      }
      if (record.applicability.end && record.applicability.end < evaluationDate) {
        throw new Error(`Contextual evidence ${record.id} expired before the snapshot cutoff.`);
      }
      return {
        ...record,
        snapshotAdapterVersion: CONTEXTUAL_EVIDENCE_SNAPSHOT_ADAPTER_VERSION,
        title: compact(record.title, 160),
        summary: compact(record.summary, 800),
        departments: boundedLabels(record.departments, 12),
        topics: boundedLabels(record.topics, 20),
        entities: [...record.entities]
          .sort((left, right) => left.id.localeCompare(right.id))
          .slice(0, INTELLIGENCE_SNAPSHOT_LIMITS.contextualEntitiesPerRecord)
          .map((entity) => ({
            ...entity,
            name: compact(entity.name, 240),
            sourceQuote: compact(entity.sourceQuote, 2_000)
          })),
        statements: [...record.statements]
          .sort((left, right) => left.id.localeCompare(right.id))
          .slice(0, INTELLIGENCE_SNAPSHOT_LIMITS.contextualStatementsPerRecord)
          .map((statement) => ({
            ...statement,
            text: compact(statement.text, 600),
            sourceQuote: compact(statement.sourceQuote, 2_000)
          })),
        userAddedContext: [...record.userAddedContext]
          .sort((left, right) => left.field.localeCompare(right.field))
          .slice(0, INTELLIGENCE_SNAPSHOT_LIMITS.contextualUserFieldsPerRecord)
          .map((item) => ({
            ...item,
            label: compact(item.label, 240),
            value: compact(item.value, 240)
          }))
      };
    });
}

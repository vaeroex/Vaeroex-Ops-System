import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import { IsoDateSchema, IsoTimestampSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import { ActiveContributionSchema, DeterministicStateSnapshotSchema, DirtyNodeSchema } from "@/lib/integrations/deterministic/contracts";
import { cleanFullRecompute, contributionStateFingerprint, deterministicStateFingerprint } from "@/lib/integrations/deterministic/engine";
import { PHASE_3_DEPENDENCY_REGISTRY } from "@/lib/integrations/deterministic/registry";
import { DeterministicChangeSetCommitSchema, DeterministicChangeSetResultSchema } from "@/lib/integrations/persistence/deterministic-commands";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";

export const QboAccountingCalculationInputSchema = z.object({
  connectionId: UuidSchema,
  authorityId: UuidSchema,
  contributions: z.array(ActiveContributionSchema).max(100_000),
  prior: DeterministicStateSnapshotSchema,
  asOfDate: IsoDateSchema,
  calculatedAt: IsoTimestampSchema
}).strict();

/** Bounded clean recomputation uses only admitted contributions, never sources
 * or provider reports. The existing registry owns the formulas and fan-out. */
export function prepareQboAccountingCalculation(raw: unknown, id = randomUUID()) {
  const input = QboAccountingCalculationInputSchema.parse(raw);
  if (input.contributions.some(contribution => contribution.workspaceId !== input.prior.workspaceId ||
    contribution.businessEntityId !== input.prior.businessEntityId)) {
    throw new Error("qbo_accounting_calculation_scope_mismatch");
  }
  const registry = PHASE_3_DEPENDENCY_REGISTRY;
  const fingerprint = contributionStateFingerprint(input.contributions);
  if (input.prior.watermark && input.prior.watermark.stateFingerprint !== deterministicStateFingerprint(input.prior.states)) {
    throw new Error("qbo_accounting_calculation_head_mismatch");
  }
  if (input.prior.watermark?.inputContributionFingerprint === fingerprint &&
    input.prior.watermark.registryFingerprint === registry.registryFingerprint) return null;
  const full = cleanFullRecompute({ workspaceId: input.prior.workspaceId, businessEntityId: input.prior.businessEntityId,
    contributions: input.contributions, registry, asOfDate: input.asOfDate, scopeHints: input.prior.states });
  const watermark = full.snapshot.watermark;
  if (!watermark) throw new Error("qbo_accounting_calculation_watermark_missing");
  const previous = new Map(input.prior.states.map(state => [state.nodeIdentityFingerprint, state]));
  const changed = full.snapshot.states.filter(state => contractSha256(state) !== contractSha256(previous.get(state.nodeIdentityFingerprint) ?? null));
  const nodes = new Map<string, z.infer<typeof DirtyNodeSchema>>();
  const causeFingerprint = contractSha256({ purpose: "qbo_accounting_clean_input", before: input.prior.watermark?.inputContributionFingerprint ?? null, after: fingerprint });
  function dirty(nodeKey: string, nodeKind: "aggregate" | "kpi" | "downstream", scope: typeof changed[number]["scope"], depth: number) {
    const nodeIdentityFingerprint = contractSha256({ fingerprintPurpose: "deterministic_node_identity",
      fingerprintVersion: "deterministic_node_identity_v1", payload: {
        workspaceId: input.prior.workspaceId, businessEntityId: input.prior.businessEntityId, nodeKey, scope } });
    nodes.set(nodeIdentityFingerprint, DirtyNodeSchema.parse({ contractVersion: "dependency_dirty_node_v1",
      workspaceId: input.prior.workspaceId, businessEntityId: input.prior.businessEntityId,
      nodeKey, nodeKind, nodeIdentityFingerprint, scope, causeCount: 1,
      boundedCauseContributionEventIds: [], causeFingerprint, dependencyDepth: depth }));
  }
  for (const state of changed) {
    dirty(state.nodeKey, state.nodeKind, state.scope, state.nodeKind === "aggregate" ? 0 : 1);
    const affected = new Set([state.nodeKey]);
    // Registry order is not assumed; a fixed point visits only reachable nodes.
    let depth = 2;
    for (let pass = 0; pass < registry.downstream.length; pass++) {
      let added = false;
      for (const downstream of registry.downstream) {
        if (!affected.has(downstream.nodeKey) && downstream.dependencies.some(key => affected.has(key))) {
          if (downstream.invalidationWindow.kind !== "same_period") throw new Error("qbo_accounting_dependency_window_unsupported");
          affected.add(downstream.nodeKey); dirty(downstream.nodeKey, "downstream", state.scope, depth); added = true;
        }
      }
      if (!added) break;
      depth++;
    }
  }
  const changeSet = DeterministicChangeSetCommitSchema.parse({ contractVersion: "deterministic_change_set_v1", id,
    workspaceId: input.prior.workspaceId, businessEntityId: input.prior.businessEntityId, executionMode: "clean_full",
    inputContributionFingerprint: fingerprint, dependencyRegistryVersion: registry.registryVersion,
    dependencyRegistryFingerprint: registry.registryFingerprint, calculationPolicyVersion: registry.calculationPolicyVersion,
    priorDeterministicWatermark: input.prior.watermark?.watermarkFingerprint ?? null,
    priorStateFingerprint: input.prior.watermark?.stateFingerprint ?? null,
    changeSetFingerprint: contractSha256({ purpose: "qbo_accounting_clean_change_set_v1", authorityId: input.authorityId,
      prior: input.prior.watermark?.watermarkFingerprint ?? null, input: fingerprint, registry: registry.registryFingerprint }),
    requestedAt: input.calculatedAt });
  const result = DeterministicChangeSetResultSchema.parse({ changeSetId: id, expectedRowVersion: 1,
    inputContributionFingerprint: fingerprint, resultWatermark: watermark.watermarkFingerprint,
    resultStateFingerprint: watermark.stateFingerprint, incrementalStateFingerprint: watermark.stateFingerprint,
    cleanStateFingerprint: watermark.stateFingerprint, equivalenceStatus: "matched", failureCode: null,
    failureFingerprint: null, completedAt: input.calculatedAt, states: full.snapshot.states });
  return { connectionId: input.connectionId, authorityId: input.authorityId, changeSet,
    nodes: [...nodes.values()].sort((a, b) => a.nodeIdentityFingerprint.localeCompare(b.nodeIdentityFingerprint))
      .map(node => ({ ...node, changeSetId: id })), result };
}

export async function calculateQboAccounting(connectionId: string, client: ExternalIntegrationsRpcClient) {
  UuidSchema.parse(connectionId);
  const read = await client.rpc("read_qbo_accounting_calculation_v1", { p_connection_id: connectionId });
  if (read.error) throw new Error("qbo_accounting_calculation_read_failed");
  const input = QboAccountingCalculationInputSchema.parse(read.data);
  if (input.connectionId !== connectionId) throw new Error("qbo_accounting_calculation_connection_mismatch");
  const command = prepareQboAccountingCalculation(input);
  if (!command) return { state: "completed" as const, publishedStateCount: 0, idempotent: true };
  const committed = await client.rpc("commit_qbo_accounting_calculation_v1", {
    p_connection_id: connectionId, p_authority_id: command.authorityId, p_change_set: command.changeSet,
    p_nodes: command.nodes, p_result: command.result, p_request_id: `qbo_accounting_calculate_${randomUUID()}` });
  if (committed.error) throw new Error("qbo_accounting_calculation_commit_failed");
  const result = z.object({ state: z.literal("completed"), publishedStateCount: z.number().int().nonnegative().max(10000),
    idempotent: z.boolean() }).strict().parse(committed.data);
  if (result.publishedStateCount !== (result.idempotent ? 0 : command.result.states.length)) {
    throw new Error("qbo_accounting_calculation_commit_count_mismatch");
  }
  return result;
}

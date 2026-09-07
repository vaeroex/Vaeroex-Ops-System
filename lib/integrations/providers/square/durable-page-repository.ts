import "server-only";

import { z } from "zod";
import { Sha256FingerprintSchema } from "@/lib/integrations/contracts/primitives";
import {
  checkedSquareDurableTaskContext, snapshotSquareDurableJson,
  type SquareDurableDependencies
} from "@/lib/integrations/providers/square/durable-contracts";
import type { SquarePageRepository, SquarePageBinding, SquarePageLease } from "@/lib/integrations/providers/square/ingestion-contracts";
import { assertSquarePendingSource } from "@/lib/integrations/providers/square/ingestion-mapping";

const integer = z.number().int().nonnegative().safe();
const bindingSchema = z.object({
  scanKey: Sha256FingerprintSchema, scopeFingerprint: Sha256FingerprintSchema,
  queryFingerprint: Sha256FingerprintSchema, cursorBindingFingerprint: Sha256FingerprintSchema,
  generation: integer.positive()
}).strict();
const cursorSchema = z.object({
  value: z.string().min(1).max(4_096).regex(/^[A-Za-z0-9._~:+-]+={0,2}$/),
  responseFingerprint: Sha256FingerprintSchema, expiresAt: integer
}).strict().nullable();
const completenessSchema = z.object({
  pageSequence: z.enum(["partial", "finished", "blocked"]), historical: z.literal("unknown"), economic: z.literal("blocked"),
  reasons: z.array(z.enum([
    "partial_page_sequence", "history_unknown", "economic_fields_omitted", "references_unresolved",
    "returns_unknown", "eventual_consistency", "overlapping_representations", "inventory_optional",
    "unsupported_page", "interrupted_scan", "unordered_provider_revision"
  ])).max(11).refine(value => new Set(value).size === value.length)
}).strict();
const leaseSchema = z.object({
  binding: bindingSchema, leaseId: Sha256FingerprintSchema, expiresAt: integer,
  checkpointVersion: integer.max(100), cursor: cursorSchema,
  attempt: integer.min(1).max(3), pageNumber: integer.min(1).max(101)
}).strict().refine(value => value.pageNumber === value.checkpointVersion + 1);
const leaseResultSchema = z.union([
  z.object({ outcome: z.literal("leased"), lease: leaseSchema }).strict(),
  z.object({ outcome: z.enum(["finished", "conflict", "expired", "blocked", "deferred"]),
    completeness: completenessSchema.nullable(), retryAfterMs: integer.max(60_000).nullable() }).strict()
]);
const commitResultSchema = z.object({
  outcome: z.enum(["committed", "replayed", "conflict"]), completeness: completenessSchema.nullable(), continuation: z.boolean()
}).strict().refine(value => value.outcome !== "conflict" || !value.continuation);

/**
 * Checked Square-only RPCs. No default client, service-role lookup, direct DML,
 * authority enrollment, credential access, or QBO RPC reuse exists here.
 * The database reads its clock AFTER authority/row locks; caller `now` values
 * remain interface-compatible observations, never database lease authority.
 */
export function createSquareDurablePageRepository(dependencies: SquareDurableDependencies): SquarePageRepository {
  const context = checkedSquareDurableTaskContext({ taskId: dependencies.taskId, leaseOwnerFingerprint: dependencies.leaseOwnerFingerprint });
  const client = dependencies.client;
  if (!client || typeof client.rpc !== "function") throw new Error("square_durable_page_client_required");
  const call = async (name: string, args: Record<string, unknown>) => {
    let result;
    try {
      result = await client.rpc(name, {
        p_task_id: context.taskId, p_lease_owner_fingerprint: context.leaseOwnerFingerprint, ...args
      });
    } catch { throw new Error("square_durable_page_failed"); }
    if (result.error) throw new Error(result.error.code === "42501" ? "square_durable_page_denied" : "square_durable_page_failed");
    return snapshotSquareDurableJson(result.data);
  };
  const binding = (input: SquarePageBinding) => bindingSchema.parse(snapshotSquareDurableJson(input));
  const lease = (input: SquarePageLease) => leaseSchema.parse(snapshotSquareDurableJson(input));
  return Object.freeze({
    async acquire(input: SquarePageBinding) {
      const result = leaseResultSchema.parse(await call("acquire_square_ingestion_page_v1", { p_binding: binding(input) }));
      return snapshotSquareDurableJson(result) as typeof result;
    },
    async commitPage(input: Parameters<SquarePageRepository["commitPage"]>[0]) {
      // Same complete expanded command guard as PR #350, BEFORE pending-source
      // schema/hash checks or RPC serialization. Never count aliases only once.
      const command = snapshotSquareDurableJson(input) as typeof input;
      lease(command.lease);
      Sha256FingerprintSchema.parse(command.pageId);
      completenessSchema.parse(command.completeness);
      cursorSchema.parse(command.nextCursor);
      integer.parse(command.now);
      if (!Array.isArray(command.sources) || command.sources.length > 3_000 ||
          Object.keys(command).sort().join(",") !== "completeness,lease,nextCursor,now,pageId,sources") throw new Error("square_durable_page_invalid");
      command.sources.forEach(assertSquarePendingSource);
      const result = commitResultSchema.parse(await call("commit_square_ingestion_page_v1", { p_command: command }));
      return snapshotSquareDurableJson(result) as typeof result;
    },
    async release(input: SquarePageLease, release: Parameters<SquarePageRepository["release"]>[1]) {
      const parsed = z.object({ now: integer, retryAfterMs: integer.max(60_000).nullable(), blocked: z.boolean(), completeness: completenessSchema.optional() }).strict().parse(snapshotSquareDurableJson(release));
      const result = await call("release_square_ingestion_page_v1", { p_lease: lease(input), p_release: parsed });
      if (result !== null) throw new Error("square_durable_page_result_invalid");
    }
  });
}

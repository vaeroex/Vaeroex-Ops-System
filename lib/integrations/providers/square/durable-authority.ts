import "server-only";

import { isProxy } from "node:util/types";
import { z } from "zod";
import { UuidSchema } from "@/lib/integrations/contracts/primitives";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import type { SquareIngestionAuthority, SquareIngestionGrant } from "@/lib/integrations/providers/square/ingestion-contracts";
import {
  checkedSquareDurableTaskContext, snapshotSquareDurableJson,
  type SquareDurableDependencies, type SquareDurableTaskContext
} from "@/lib/integrations/providers/square/durable-contracts";

const invocationSchema = z.object({ taskId: UuidSchema }).strict();

/**
 * Bind one checked DB task to its actual database login. This does not verify a
 * seller, enroll IDs, read credentials, or provide a live transport. The database
 * resolves immutable, explicitly enrolled synthetic qualification evidence and
 * checks its current generation, mappings, retention approval and connection fence.
 */
export function createSquareDatabaseAuthority(dependencies: SquareDurableDependencies): SquareIngestionAuthority {
  if (!dependencies || typeof dependencies !== "object" || isProxy(dependencies)) {
    throw new Error("square_durable_contract_invalid");
  }
  const descriptors = Object.getOwnPropertyDescriptors(dependencies);
  if (Reflect.ownKeys(descriptors).length !== 3 ||
      !["client", "taskId", "leaseOwnerFingerprint"].every((key) =>
        descriptors[key]?.enumerable && "value" in descriptors[key])) {
    throw new Error("square_durable_contract_invalid");
  }
  let context: SquareDurableTaskContext;
  try {
    context = checkedSquareDurableTaskContext({
      taskId: descriptors.taskId.value,
      leaseOwnerFingerprint: descriptors.leaseOwnerFingerprint.value
    });
  } catch {
    throw new Error("square_durable_contract_invalid");
  }
  // The RPC transport is a trusted dependency; authority still comes only from
  // the checked DB role/task, never from public invocation fields or response IDs.
  const client = descriptors.client.value as ExternalIntegrationsRpcClient;
  return Object.freeze({
    async resolve(invocation: unknown): Promise<SquareIngestionGrant | null> {
      try {
        const parsed = invocationSchema.parse(snapshotSquareDurableJson(invocation, {
          containers: 1, values: 2, bytes: 128, depth: 1,
          arrayLength: 0, properties: 1, stringLength: 36
        }));
        if (parsed.taskId !== context.taskId) return null;
        const result = await client.rpc("resolve_square_ingestion_authority_v1", {
          p_task_id: context.taskId,
          p_lease_owner_fingerprint: context.leaseOwnerFingerprint
        });
        if (result.error || result.data === null) return null;
        // <1,020 values for the fixed grant plus its bounded request body. The
        // unchanged ingestion adapter independently validates the complete grant,
        // operation/request contract and all parser context before any transport.
        return snapshotSquareDurableJson(result.data, {
          containers: 1_024, values: 5_000, bytes: 2_097_152, depth: 8,
          arrayLength: 1_000, properties: 64, stringLength: 1_048_576
        }) as SquareIngestionGrant;
      } catch {
        // Caller values, SQL text, seller/location IDs and private request bodies
        // never enter an error/diagnostic surface on authority failure.
        return null;
      }
    }
  });
}

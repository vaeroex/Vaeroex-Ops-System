import "server-only";

import { z } from "zod";
import { UuidSchema } from "@/lib/integrations/contracts/primitives";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { SquareAccountContextSchema, type SquareAccountContext } from "@/lib/integrations/providers/square/account-connection-contracts";
import { snapshotSquareDurableJson } from "@/lib/integrations/providers/square/durable-contracts";

const MappingSchema = z.object({
  connectionId: UuidSchema,
  businessEntityId: UuidSchema,
  locationIds: z.array(z.string().min(1).max(32).regex(/^[A-Za-z0-9._:-]+$/)).min(1).max(500),
  confirmation: z.literal("map")
}).strict().superRefine((value, ctx) => {
  if (new Set(value.locationIds).size !== value.locationIds.length) ctx.addIssue({ code: "custom", message: "Duplicate mapping" });
});

/** Input minimization only: the checked database resolves current verified evidence and actor authority. */
export function createSquareAccountMapping(input: Readonly<{ client: ExternalIntegrationsRpcClient; context: SquareAccountContext }>) {
  let context: SquareAccountContext;
  try {
    context = snapshotSquareDurableJson(SquareAccountContextSchema.parse(snapshotSquareDurableJson(input.context, {
      containers: 2, values: 9, bytes: 16_384, depth: 2, arrayLength: 0, properties: 4, stringLength: 2_048
    })), { containers: 2, values: 9, bytes: 16_384, depth: 2, arrayLength: 0, properties: 4, stringLength: 2_048 }) as SquareAccountContext;
  } catch { throw new Error("square_account_mapping_denied"); }
  const client = input.client;
  return Object.freeze({
    async confirm(value: unknown): Promise<unknown> {
      try {
        const command = MappingSchema.parse(snapshotSquareDurableJson(value, {
          containers: 2, values: 505, bytes: 32_768, depth: 2, arrayLength: 500, properties: 4, stringLength: 36
        }));
        if (!["owner", "admin", "manager"].includes(context.actor.role)) throw new Error("denied");
        const result = await client.rpc("square_account_connection_v1", {
          p_context: context, p_operation: "confirm_mapping", p_command: command
        });
        if (result.error || result.data === null) throw new Error("denied");
        return result.data;
      } catch { throw new Error("square_account_mapping_denied"); }
    }
  });
}

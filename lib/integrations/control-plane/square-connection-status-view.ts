import { z } from "zod";
import { IsoTimestampSchema } from "@/lib/integrations/contracts/primitives";
import { SquareConnectionViewSchema } from "@/lib/integrations/providers/square/account-connection-contracts";

// Presentation-only extension. The internal consent image imports the base
// account contract, whose exact reviewed release bytes remain unchanged.
export const SquareConnectionStatusViewSchema = SquareConnectionViewSchema.extend({
  connections: z.array(SquareConnectionViewSchema.shape.connections.element.extend({
    // Absence is unknown, never evidence that a scan completed or is current.
    sync: z.object({
      state: z.enum(["not_started", "running", "checkpointed", "interrupted", "recovery_required"]),
      lastVerifiedObservationAt: IsoTimestampSchema.nullable(),
      historicalCompleteness: z.literal("unknown")
    }).strict().optional()
  })).max(32)
}).strict();

export type SquareConnectionStatusView = Readonly<z.infer<typeof SquareConnectionStatusViewSchema>>;

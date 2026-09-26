import { z } from "zod";

const uuid = z.string().uuid();
export const ProductionSquareCustomerViewSchema = z.object({
  canManage: z.literal(true),
  businessEntities: z.array(z.object({ id: uuid, label: z.string().min(1).max(255) }).strict()).max(1000),
  connections: z.array(z.object({
    connectionId: uuid, businessEntityId: uuid,
    state: z.enum(["authorization_required", "consent_pending", "mapping_required", "recovery_required", "disconnected"]),
    sellerLabel: z.string().min(1).max(255).nullable(),
    locations: z.tuple([]), mappedLocationIds: z.tuple([]),
    retentionApproved: z.literal(false), revocationPending: z.literal(false)
  }).strict()).max(32)
}).strict();
export type ProductionSquareCustomerView = z.infer<typeof ProductionSquareCustomerViewSchema>;

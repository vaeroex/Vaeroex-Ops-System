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

export const ProductionSquareReadViewSchema=z.object({
  locations:z.array(z.object({fingerprint:z.string().regex(/^sha256:[a-f0-9]{64}$/),label:z.string().min(1).max(255)}).strict()).max(1000),
  mappedLocation:z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  readStatus:z.enum(["not_requested","ready","leased","committed","uncertain"]),
  observationCount:z.number().int().min(0).max(100).nullable(),verifiedAt:z.string().datetime({offset:true}).nullable(),hasMore:z.boolean().nullable(),
  source:z.literal("Square Production"),historicalCompleteness:z.literal("unknown"),nonEconomic:z.literal(true)
}).strict().refine(view=>view.readStatus==="committed" ? view.observationCount!==null&&view.verifiedAt!==null&&view.hasMore!==null
  : view.observationCount===null&&view.verifiedAt===null&&view.hasMore===null);
export type ProductionSquareReadView=z.infer<typeof ProductionSquareReadViewSchema>;

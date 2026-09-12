import { z } from "zod";
import { SquareWorkspaceEvidenceSchema } from "./workspace-evidence";

const Activity=z.object({evidenceRef:z.string().regex(/^sqe_[a-f0-9]{16}$/),kind:z.enum(["payment","refund","order","catalog","inventory"]),
  status:z.string().min(1).max(80),occurredAt:z.string().datetime({offset:true}).nullable(),location:z.enum(["mapped_location","seller_scoped","explicitly_unresolved"]),
  amount:z.object({amountMinor:z.string().regex(/^-?(0|[1-9][0-9]{0,39})$/),currency:z.string().regex(/^[A-Z]{3}$/)}).strict().nullable(),
  quantity:z.string().max(80).nullable(),unitState:z.enum(["not_applicable","unverified"]),label:z.string().min(1).max(512).nullable(),
  relationship:z.enum(["not_applicable","observed_id_match","unresolved","conflict"]),admission:z.literal("verified_non_economic")}).strict();
const Summary=z.object({count:z.number().int().min(0).max(1000),total:Activity.shape.amount,exactAverageMinor:z.string().regex(/^-?(0|[1-9][0-9]{0,39})$/).nullable(),
  averageState:z.enum(["exact","no_observations","mixed_currency","non_integral_minor_unit","amount_unavailable"])}).strict();
export const SquareWorkspaceOperationalSchema=z.object({version:z.literal("square_workspace_operational_v1"),evidence:SquareWorkspaceEvidenceSchema,
  calculation:z.object({policyVersion:z.literal("square_operational_intelligence_v1"),economic:z.literal("blocked"),historical:z.literal("unknown"),aiDispatch:z.literal("disabled"),
    payment:Summary,refund:Summary,order:Summary,groups:z.array(z.object({kind:z.enum(["payment","refund","order"]),locationGroup:z.string().regex(/^(seller_scoped|explicitly_unresolved|sqg_[a-f0-9]{16})$/),currency:z.string().regex(/^[A-Z]{3}$/).nullable(),summary:Summary}).strict()).max(1000),refundRate:z.object({numerator:z.number().int().min(0),denominator:z.number().int().min(0),state:z.literal("observed_count_ratio_not_financial_rate")}).strict(),
    statusMix:z.record(z.enum(["payment","refund","order","catalog","inventory"]),z.record(z.string().min(1).max(80),z.number().int().min(0))),orderStatusMix:z.record(z.string(),z.number().int().min(0)),catalog:z.object({admittedVariations:z.number().int().min(0),activeVariations:z.null(),activeState:z.literal("lifecycle_state_not_admitted")}).strict(),
    inventory:z.object({observations:z.number().int().min(0),movementTotal:z.null(),movementState:z.literal("unit_compatibility_and_completeness_unverified")}).strict(),
    fulfillment:z.object({activity:z.null(),state:z.literal("fulfillment_state_not_admitted")}).strict(),insights:z.array(z.object({code:z.string(),state:z.enum(["observed","insufficient_evidence"]),rule:z.string(),text:z.string(),blockedReason:z.string().nullable(),evidenceRefs:z.array(z.string())}).strict()).max(20)}).strict(),
  page:z.object({rows:z.array(Activity).max(25),page:z.number().int().min(1).max(40),pageSize:z.number().int().min(1).max(25),total:z.number().int().min(0).max(1000),pages:z.number().int().min(1).max(40)}).strict()
}).strict();
export type SquareWorkspaceOperational=z.infer<typeof SquareWorkspaceOperationalSchema>;
export function parseSquareWorkspaceOperational(value:unknown):SquareWorkspaceOperational|null {const parsed=SquareWorkspaceOperationalSchema.safeParse(value);return parsed.success?parsed.data:null;}

import { z } from "zod";
import { DirectPaymentSchema, DirectStateSchema, DirectViewSchema } from "./contracts";

export const DirectPaymentBrowseStatusSchema = z.enum(["all", "COMPLETED", "FAILED", "CANCELED", "APPROVED", "PENDING", "UNKNOWN"]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= "1970-01-01";
});
export const DirectPaymentBrowseQuerySchema = z.object({
  connectionId: z.string().uuid().nullable().default(null),
  page: z.number().int().min(1).max(2_147_483_647).default(1),
  startDate: date.nullable().default(null), endDate: date.nullable().default(null),
  status: DirectPaymentBrowseStatusSchema.default("all")
}).strict().refine(value => !value.startDate || !value.endDate || value.startDate <= value.endDate);
export type DirectPaymentBrowseQuery = z.infer<typeof DirectPaymentBrowseQuerySchema>;

export function parseDirectPaymentBrowseQuery(params: Record<string, string | string[] | undefined>): DirectPaymentBrowseQuery {
  const scalar = (key: string) => {
    const value = params[key];
    if (Array.isArray(value)) throw new Error("square_payment_browse_filter_invalid");
    return value || null;
  };
  const page = scalar("page");
  if (page !== null && !/^[1-9]\d{0,9}$/.test(page)) throw new Error("square_payment_browse_filter_invalid");
  return DirectPaymentBrowseQuerySchema.parse({ connectionId: scalar("connectionId"), page: page === null ? 1 : Number(page),
    startDate: scalar("startDate"), endDate: scalar("endDate"), status: scalar("status") ?? "all" });
}

const instant = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString());
const timeZone = z.string().min(1).max(255).refine(value => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
});
export const DirectPaymentBrowserSchema = z.object({
  connectionId: z.string().uuid().nullable(), timeZone,
  currentConnection: DirectViewSchema.shape.connections.element.nullable(),
  page: z.number().int().positive().safe(), pageSize: z.literal(25),
  totalCount: z.number().int().nonnegative().safe(), totalPages: z.number().int().positive().safe(),
  filters: z.object({ startDate: date.nullable(), endDate: date.nullable(), status: DirectPaymentBrowseStatusSchema }).strict(),
  payments: z.array(DirectPaymentSchema).max(25),
  connections: z.array(z.object({ connectionId: z.string().uuid(), businessEntityId: z.string().uuid(),
    businessEntityLabel: z.string().min(1).max(255), sellerLabel: z.string().max(255).nullable(),
    locationLabel: z.string().max(255).nullable(), state: DirectStateSchema, timeZone,
    createdAt: instant, paymentCount: z.number().int().nonnegative().safe()
  }).strict())
}).strict().refine(value => value.page <= value.totalPages && value.totalPages === Math.max(1, Math.ceil(value.totalCount / 25)));
export type DirectPaymentBrowser = z.infer<typeof DirectPaymentBrowserSchema>;

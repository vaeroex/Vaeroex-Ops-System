import { z } from "zod";

const point = z.object({ label: z.string().min(1).max(80), value: z.number().finite().min(-1e12).max(1e12), context: z.string().max(180) }).strict();
const source = z.object({ label: z.string().min(1).max(240), href: z.string().regex(/^\/app(?:[/?#]|$)/).refine(value => !/[\\\r\n]/.test(value)) }).strict();
export const comparisonSchema = z.object({
  version: z.literal(1), id: z.string().min(1).max(200), title: z.string().min(1).max(160),
  unit: z.string().max(40), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  before: point, after: point, kind: z.enum(["period", "observation", "target"]),
  direction: z.enum(["maximize", "minimize", "neutral"]),
  targetRange: z.object({ min: z.number().finite().min(-1e12).max(1e12), max: z.number().finite().min(-1e12).max(1e12) }).refine(range => range.min <= range.max).optional(),
  outcome: z.enum(["favorable", "unfavorable", "neutral"]).optional(),
  context: z.string().max(500), limitations: z.array(z.string().max(500)).max(8),
  sources: z.array(source).min(1).max(8)
}).strict();
export type Comparison = z.infer<typeof comparisonSchema>;
export function parseComparisons(value: unknown): Comparison[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).flatMap(item => { const result = comparisonSchema.safeParse(item); return result.success ? [result.data] : []; });
}
export function comparisonChange(chart: Comparison) {
  const delta = Number((chart.after.value - chart.before.value).toFixed(6));
  const percent = chart.before.value > 0 ? delta / chart.before.value * 100 : null;
  const outcome = chart.outcome ?? (delta === 0 || chart.direction === "neutral" ? "neutral" : (delta > 0) === (chart.direction === "maximize") ? "favorable" : "unfavorable");
  return { delta, percent, outcome };
}
export function comparisonDomain(chart: Comparison) {
  const min = Math.min(0, chart.before.value, chart.after.value, chart.targetRange?.min ?? 0), max = Math.max(0, chart.before.value, chart.after.value, chart.targetRange?.max ?? 0);
  return { min, max: min === max ? 1 : max };
}
export function isPercentageUnit(unit: string) { return /^(%|percent|percentage)$/i.test(unit); }
export function comparisonValue(value: number, chart: Pick<Comparison, "currency" | "unit">) {
  if (chart.currency) return new Intl.NumberFormat("en-US", { style: "currency", currency: chart.currency, maximumFractionDigits: 2 }).format(value);
  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  return `${number}${isPercentageUnit(chart.unit) ? "%" : chart.unit ? ` ${chart.unit}` : ""}`;
}

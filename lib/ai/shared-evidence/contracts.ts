import { z } from "zod";

export const pluginProviders = ["google_sheets", "quickbooks_online", "square", "loyverse", "zoho-books", "wix-orders", "xero", "harvest", "clockify", "toggl", "zoho-inventory", "katana"] as const;
export type PluginProvider = typeof pluginProviders[number];
export type EvidenceProvider = PluginProvider | "file" | "business_note";
export const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
});
function decimalText(value: number) {
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const [mantissa, exponent] = text.split(/[eE]/), negative = mantissa.startsWith("-");
  const [whole, fraction = ""] = mantissa.replace(/^-/, "").split("."), digits = whole + fraction;
  const point = whole.length + Number(exponent);
  const expanded = point <= 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? `${digits}${"0".repeat(point - digits.length)}` : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return `${negative ? "-" : ""}${expanded}`;
}
// Preserve source numeric precision, including Clockify's seconds / 3600 hours.
// Only final display calculations round; parsing must not round stored observations.
export const decimalSchema = z.union([z.string(), z.number().finite().min(-1e15).max(1e15).transform(decimalText)])
  .pipe(z.string().regex(/^-?\d{1,15}(?:\.\d{1,24})?$/));
export const instantSchema = z.string().datetime({ offset: true });
const key = z.string().min(1).max(160);
const href = z.string().max(1500).refine(value => value.startsWith("/app/") && !/[\\\u0000-\u001f]/.test(value));
export const contextSchema = z.object({
  workspaceId: z.string().uuid(), connectionId: z.string().uuid(),
  // Canonical identity must come from protected correspondence, never account labels.
  entityId: z.string().uuid().nullable(), entityBinding: z.enum(["protected", "missing"]),
  scopeKey: key, scopeVerified: z.boolean(),
  start: daySchema, end: daySchema, timeZone: key,
  observedAt: instantSchema, currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  sourceId: key, version: key.nullable(), href,
  coverage: z.enum(["complete", "partial", "unknown", "snapshot"]),
  lifecycle: z.enum(["active", "revoked", "unknown"])
}).strict().refine(value => value.start <= value.end)
  .refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value.timeZone }); return true; } catch { return false; } });
export type ParseContext = z.infer<typeof contextSchema>;
export type Observation = Readonly<{
  id: string; provider: EvidenceProvider; workspaceId: string; connectionId: string;
  entityId: string | null; entityBinding: "protected" | "missing"; scopeKey: string; scopeVerified: boolean;
  metric: string; value: string; unit: string; currency: string | null; partition: string | null;
  start: string; end: string; timeZone: string; observedAt: string;
  temporalKind: "period" | "snapshot" | "lifetime"; basis: string;
  coverage: ParseContext["coverage"]; lifecycle: ParseContext["lifecycle"];
  // Dependencies describe exact originals; a mutable report is explicitly unversioned.
  dependencies: readonly Dependency[];
  qualifications: readonly string[];
}>;
export type Dependency = Readonly<{ id: string; workspaceId: string; connectionId: string; provider: EvidenceProvider; sourceId: string; version: string | null; href: string }>;
export type ParsedEvidence = Readonly<{
  stage: "unadmitted"; provider: EvidenceProvider; workspaceId: string;
  observations: readonly Observation[]; dependencies: readonly Dependency[]; limitations: readonly string[];
}>;

// These parsers never confer permission. No live reader or model imports this module.
// Runtime admission must independently verify owner/session, source lifecycle,
// entity correspondence, source binding and saved-output audience.
export const missingAdmissionContracts = ["owner_audience", "source_binding", "stable_citation_version"] as const;

export function dependency(provider: EvidenceProvider, context: ParseContext): Dependency {
  return { id: JSON.stringify([context.workspaceId, provider, context.connectionId, context.sourceId, context.version]),
    workspaceId: context.workspaceId, connectionId: context.connectionId, provider, sourceId: context.sourceId, version: context.version, href: context.href };
}
export function observation(provider: EvidenceProvider, context: ParseContext, metric: string, value: unknown,
  unit: string, basis: string, temporalKind: Observation["temporalKind"] = "period", currency = context.currency, partition = currency): Observation {
  return { ...context, id: JSON.stringify([dependency(provider, context).id, metric, currency, partition]), provider,
    metric, value: decimalSchema.parse(value), unit, currency, partition, basis, temporalKind,
    dependencies: [dependency(provider, context)], qualifications: [] };
}
export function parsed(provider: EvidenceProvider, context: ParseContext, observations: Observation[], limitations: string[] = []): ParsedEvidence {
  if (new Set(observations.map(row => row.id)).size !== observations.length) throw new Error("duplicate_observation");
  const qualifications = [...limitations,
      ...(!context.entityId || context.entityBinding !== "protected" ? ["Canonical entity correspondence is unavailable."] : []),
      ...(!context.version ? ["Stored source has no immutable version; saved citation admission is blocked."] : [])];
  return { stage: "unadmitted", provider, workspaceId: context.workspaceId,
    observations: observations.map(row => ({ ...row, qualifications })),
    dependencies: [...new Map((observations.length ? observations.flatMap(row => row.dependencies) : [dependency(provider, context)]).map(source => [source.id, source])).values()],
    limitations: qualifications };
}

import { z } from "zod";
import { QboPreviewSchema } from "@/lib/integrations/qbo-customer/contracts";
import { sandboxDescriptiveModelUseEnabled, sandboxSharedEvidenceInstallation } from "./sandbox-policy";

export const sandboxPolicyVersion = "sandbox_descriptive_evidence_v1" as const;
export function requireSandboxInstallation(id: unknown): string {
  const installation = z.string().uuid().parse(id);
  if (!sandboxDescriptiveModelUseEnabled() || sandboxSharedEvidenceInstallation() !== installation) throw new Error("sandbox_model_use_disabled");
  return installation;
}
/** These are descriptive observations, never production payment/accounting facts.
 * The protected SQL reader supplies authority; this parser cannot confer it. */
export function sandboxFacts(identity: Record<string, unknown>, data: Record<string, unknown>): string[] {
  const installation = requireSandboxInstallation(data.installation_id);
  if (identity.installation_id !== installation || data.environment !== "sandbox" || identity.environment !== "sandbox"
    || data.model_use_policy !== sandboxPolicyVersion || data.economic !== "blocked" || data.coverage !== "unknown") throw new Error("sandbox_scope_denied");
  if (identity.kind === "qbo_sandbox_version" && data.provider === "quickbooks_online") {
    const q = QboPreviewSchema.parse(data.preview);
    if (q.kind === "record") return Object.entries(q.amounts).map(([key, money]) => `QuickBooks Sandbox ${z.string().max(80).parse(data.record_type)} ${key}: ${money!.amount} ${money!.currency}, posting date ${q.temporal.postingDate ?? "unknown"}, ${q.accounting.basis} basis. Sandbox record, not merchant production evidence; coverage and reconciliation are unknown.`);
    if (q.truncated || q.columns.length !== 2 || !/^(account|distribution account)$/i.test(q.columns[0].title || "") || !/^(total|amount|[A-Z]{3})$/i.test(q.columns[1].title || "")) throw new Error("sandbox_qbo_projection_unqualified");
    return q.rows.filter(row => row.rowType === "summary").map(row => {
      const name = row.cells.find(cell => cell.columnKey === q.columns[0].columnKey)?.value;
      const amount = row.cells.find(cell => cell.columnKey === q.columns[1].columnKey)?.value;
      if (!name || !amount || !/^-?\d{1,15}(?:\.\d{1,24})?$/.test(amount)) throw new Error("sandbox_qbo_projection_unqualified");
      return `QuickBooks Sandbox ${q.reportType} reports ${name}: ${amount} ${q.sourceCurrency}, ${q.periodStart} through ${q.periodEnd}, ${q.reportBasis} basis. Summary rows may overlap; this is not merchant production evidence or a reconciliation.`;
    });
  }
  if (identity.kind === "square_sandbox_observation" && data.provider === "square") {
    const observation = z.object({ kind: z.enum(["payment", "refund", "order", "catalog", "inventory"]),
      status: z.string().max(80).nullable(), observed_at: z.string().datetime({ offset: true }),
      amount_minor: z.string().regex(/^-?\d{1,39}$/).nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable()
    }).strict().parse(data.observation);
    return [`Square Sandbox ${observation.kind} observation: status ${observation.status ?? "unknown"}, observed ${observation.observed_at}${observation.amount_minor && observation.currency ? `, ${observation.amount_minor} ${observation.currency} minor units` : ""}. Verified non-economic observation; historical completeness, unit conversion and reconciliation are not established. This is not production revenue or profit.`];
  }
  throw new Error("sandbox_projection_denied");
}

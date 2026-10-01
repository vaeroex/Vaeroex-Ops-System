import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { applyQboProductionAccountingPage } from "@/lib/integrations/persistence/qbo-production-accounting-repository";
import { calculateQboAccounting } from "@/lib/integrations/persistence/qbo-accounting-calculation-repository";

export const QboAccountingRecoveryResultSchema = z.object({
  visitedConnections: z.number().int().min(0).max(25),
  appliedSources: z.number().int().min(0).max(625),
  calculatedConnections: z.number().int().min(0).max(25),
  admissionFailures: z.number().int().min(0).max(25),
  calculationFailures: z.number().int().min(0).max(25)
}).strict();

/** Independent visit times prevent a blocked tenant from starving the next
 * bounded cycle. No provider calls, task dispatch, or credential access. */
export async function recoverQboProductionAccounting(client: ExternalIntegrationsRpcClient, maximumConnections = 5) {
  const maximum = z.number().int().min(1).max(25).parse(maximumConnections);
  const claim = await client.rpc("claim_qbo_accounting_work_v1", { p_maximum_connections: maximum });
  if (claim.error) throw new Error("qbo_accounting_work_claim_failed");
  const work = z.array(z.object({ connectionId: z.string().uuid(), admissionEnabled: z.boolean() }).strict()).max(maximum).parse(claim.data);
  if (new Set(work.map(row => row.connectionId)).size !== work.length) throw new Error("qbo_accounting_work_duplicate");
  const result = { visitedConnections: work.length, appliedSources: 0, calculatedConnections: 0, admissionFailures: 0, calculationFailures: 0 };
  for (const row of work) {
    if (row.admissionEnabled) {
      try {
        const applied = await applyQboProductionAccountingPage({ connectionId: row.connectionId, afterSourceId: null,
          maximumSources: 25, requestId: `qbo_accounting_apply_${randomUUID()}` }, client);
        result.appliedSources += applied.applications.length;
      } catch { result.admissionFailures++; }
    }
    // A native withdrawal must still reach deterministic state even if current
    // source admission is blocked or the owner has revoked financial authority.
    try { await calculateQboAccounting(row.connectionId, client); result.calculatedConnections++; }
    catch { result.calculationFailures++; }
  }
  return QboAccountingRecoveryResultSchema.parse(result);
}

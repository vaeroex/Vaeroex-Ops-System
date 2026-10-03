import "server-only";

import { z } from "zod";
import { checkedSquareGcpCallbackBinding, type SquareGcpCallbackBinding } from "./square-gcp-callback-contracts";
import { snapshotSquareDurableJson } from "@/lib/integrations/providers/square/durable-contracts";

export const SQUARE_GCP_MAPPED_ROLES = ["broker", "enroller", "runtime"] as const;
export type SquareGcpMappedRole = typeof SQUARE_GCP_MAPPED_ROLES[number];
const extraSchema = z.object({
  capability: z.enum(SQUARE_GCP_MAPPED_ROLES),
  enrollerLogin: z.string().regex(/^square_sandbox_[a-z_]{1,40}$/),
  runtimeLogin: z.string().regex(/^square_sandbox_[a-z_]{1,40}$/),
  connectionId: z.string().uuid(), connectionGeneration: z.number().int().positive().safe(),
  operatorSessionId: z.string().uuid(),
  defaultLocationId: z.string().min(1).max(32).regex(/^[A-Za-z0-9._:-]+$/),
  discoveryFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  mappedProviderCallsEnabled: z.boolean(),
  mappedApprovalExpiresAt: z.string().datetime({ offset: true }),
  enrollerDatabaseSecretVersionResource: z.string().regex(/^projects\/vaeroex-square-sandbox\/secrets\/square-sandbox-enroller-db\/versions\/[1-9][0-9]*$/),
  runtimeDatabaseSecretVersionResource: z.string().regex(/^projects\/vaeroex-square-sandbox\/secrets\/square-sandbox-runtime-db\/versions\/[1-9][0-9]*$/)
}).strict();
export type SquareGcpMappedBinding = Readonly<Omit<SquareGcpCallbackBinding, "contractVersion"> &
  z.infer<typeof extraSchema> & { contractVersion: "square_gcp_mapped_runtime_binding_v1" }>;

/** Representation validation only. The native database getter establishes current
 * session_user, operator session, enrolled generation and host authority. */
export function checkedSquareGcpMappedBinding(raw: unknown, now = Date.now()): SquareGcpMappedBinding {
  try {
    const value = snapshotSquareDurableJson(raw, { containers: 1, values: 50, bytes: 32_768,
      depth: 1, arrayLength: 0, properties: 50, stringLength: 2_048 }) as Record<string, unknown>;
    if (value.contractVersion !== "square_gcp_mapped_runtime_binding_v1") throw 0;
    const extras: Record<string, unknown> = {}, host = { ...value };
    for (const key of Object.keys(extraSchema.shape)) { extras[key] = value[key]; delete host[key]; }
    const extra = extraSchema.parse(extras);
    const checked = checkedSquareGcpCallbackBinding({ ...host, contractVersion: "square_gcp_callback_binding_v1" }, now);
    if (new Set([checked.brokerLogin, extra.enrollerLogin, extra.runtimeLogin]).size !== 3 ||
      checked.providerCallsEnabled || Date.parse(extra.mappedApprovalExpiresAt) <= now ||
      Date.parse(extra.mappedApprovalExpiresAt) > Date.parse(checked.approvalExpiresAt)) throw 0;
    return Object.freeze({ ...checked, ...extra, contractVersion: "square_gcp_mapped_runtime_binding_v1" });
  } catch { throw new Error("square_gcp_mapped_binding_denied"); }
}

export function squareGcpMappedHost(binding: SquareGcpMappedBinding): SquareGcpCallbackBinding {
  const value = { ...checkedSquareGcpMappedBinding(binding) } as Record<string, unknown>;
  for (const key of Object.keys(extraSchema.shape)) delete value[key];
  return checkedSquareGcpCallbackBinding({ ...value, contractVersion: "square_gcp_callback_binding_v1" });
}

export function squareGcpMappedDatabaseSecret(binding: SquareGcpMappedBinding, role: SquareGcpMappedRole): string {
  const checked = checkedSquareGcpMappedBinding(binding);
  if (role === "broker") return checked.databaseSecretVersionResource;
  if (role === "enroller") return checked.enrollerDatabaseSecretVersionResource;
  if (role === "runtime") return checked.runtimeDatabaseSecretVersionResource;
  throw new Error("square_gcp_mapped_binding_denied");
}

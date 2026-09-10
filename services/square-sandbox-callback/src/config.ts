import "server-only";

import { z } from "zod";
import { checkedSquareGcpCallbackBinding } from "@/lib/integrations/control-plane/square-gcp-callback-contracts";
import { snapshotSquareDurableJson } from "@/lib/integrations/providers/square/durable-contracts";

const Schema = z.object({
  schemaVersion: z.literal(1), enabled: z.boolean(), binding: z.unknown().nullable(),
  supabasePublishableKey: z.string().min(20).max(2_048).nullable(),
  databaseCaPath: z.literal("/etc/vaeroex-square-callback/supabase-root-2021.crt").nullable().default(null),
  databaseCaSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  tlsCertPath: z.literal("/run/credentials/vaeroex-square-callback.service/tls-cert"),
  tlsKeyPath: z.literal("/run/credentials/vaeroex-square-callback.service/tls-key"),
  challengeWebroot: z.literal("/run/vaeroex-square-callback/acme"),
  hostPolicyPath: z.literal("/etc/vaeroex-square-callback/host-policy.json")
}).strict();
export function checkedPortalConfig(value: unknown, serving = false) {
  try {
    const raw = snapshotSquareDurableJson(value, { containers: 2, values: 60, bytes: 32_768,
      depth: 2, arrayLength: 0, properties: 40, stringLength: 2_048 });
    const config = Schema.parse(raw);
    if (!Object.prototype.hasOwnProperty.call(config, "binding")) throw new Error();
    if (!config.enabled) {
      if (serving || config.binding !== null || config.supabasePublishableKey !== null ||
        config.databaseCaPath !== null || config.databaseCaSha256 !== null) throw new Error();
      return Object.freeze({ ...config, binding: null });
    }
    const binding = checkedSquareGcpCallbackBinding(config.binding);
    if (!config.supabasePublishableKey || !config.databaseCaPath || !config.databaseCaSha256) throw new Error();
    const key = config.supabasePublishableKey;
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
      const parts = key.split(".");
      if (parts.length !== 3 || JSON.parse(Buffer.from(parts[1], "base64url").toString()).role !== "anon") throw new Error();
    }
    return Object.freeze({ ...config, binding });
  } catch { throw new Error("square_portal_configuration_denied"); }
}
export const HostPolicySchema = z.object({ schemaVersion: z.literal(1), approvedUntil: z.string().datetime(),
  operator: z.string().min(1).max(120), configurationEvidenceId: z.string().min(1).max(160),
  budgetDeliveryEvidenceId: z.string().min(1).max(160), nodeVersion: z.string().regex(/^v24\.\d+\.\d+$/),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/), hostConfigurationReviewed: z.literal(true), syntheticPrivacyPassed: z.literal(true)
}).strict();

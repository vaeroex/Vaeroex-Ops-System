import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { oauthStateHash } from "@/lib/integrations/credentials/oauth-state";
import { parseSquareOAuthCallback } from "@/lib/integrations/providers/square/account-connection-oauth";
import { sealCredential, openCredential } from "./crypto";
import { createDirectSquareProvider, directCallbackUri } from "./provider";
import { DirectContextSchema, DirectViewSchema, DirectHistoricalWindowSchema, type DirectHistoricalWindow,
  type DirectActor, type DirectContext, type DirectRpc } from "./contracts";

const stored = z.object({ stored: z.literal(true) }).strict();
const denied = () => new Error("square_customer_action_failed");
type Provider = ReturnType<typeof createDirectSquareProvider>;

/** Network and persistence are explicit capabilities so all branches can be
 * exercised without credentials. The host binds rpc to its verified actor. */
export function createDirectSquareService(input: {
  actor: DirectActor; rpc: DirectRpc; encryptionKey: string;
  provider(authorize: () => Promise<void>): Provider; now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());
  function context(value: unknown, connectionId?: string, leaseId?: string) {
    const row = DirectContextSchema.parse(value);
    if (row.workspaceId !== input.actor.workspaceId || connectionId && row.connectionId !== connectionId ||
      leaseId && row.leaseId !== leaseId) throw denied();
    return row;
  }
  function aad(row: DirectContext, credentialVersion = row.credentialVersion) {
    return { workspaceId: row.workspaceId, connectionId: row.connectionId, generation: row.generation, credentialVersion };
  }
  function provider(connectionId: string, leaseId: string, disconnect = false) {
    return input.provider(async () => {
      z.object({ authorized: z.literal(true) }).strict().parse(await input.rpc(
        disconnect ? "authorize_disconnect" : "authorize", { connectionId, leaseId }));
    });
  }
  async function fail(connectionId: string, leaseId: string, error: unknown) {
    const reason = error instanceof Error && error.message === "square_direct_reauthorization_required"
      ? "reauthorization_required" : "retry_required";
    // A failed fence is not retried; persisted lease/CAS still blocks a stale
    // result. Never expose provider/SQL errors or credential material.
    try { await input.rpc("fail", { connectionId, leaseId, reason }); } catch { /* retain durable state */ }
  }
  return Object.freeze({
    async view() { return DirectViewSchema.parse(await input.rpc("status", {})); },
    async connect(businessEntityId: string) {
      const connectionId = randomUUID(), state = randomBytes(32).toString("base64url");
      context(await input.rpc("begin", { businessEntityId, connectionId, stateHash: oauthStateHash(state) }), connectionId);
      return input.provider(async () => { throw denied(); }).authorizationUrl(state);
    },
    async callback(url: string) {
      const callback = parseSquareOAuthCallback(url, directCallbackUri), leaseId = randomUUID();
      const row = context(await input.rpc("consume", { stateHash: oauthStateHash(callback.state), leaseId }), undefined, leaseId);
      if (callback.kind === "denied") {
        await input.rpc("decline", { connectionId: row.connectionId, leaseId });
        return;
      }
      try {
        let ciphertext: string | null = null;
        const result = await provider(row.connectionId, leaseId).exchange(callback.authorizationCode, async credential => {
          // Keep the verified credential before discovery or finalization can
          // fail. A lost staging acknowledgement is read back, never retried.
          const candidate = sealCredential(credential, input.encryptionKey, aad(row, 1));
          let receipt: unknown;
          try { receipt = await input.rpc("stage_credential", { connectionId: row.connectionId, leaseId,
            ciphertext: candidate, merchantId: credential.externalAuthorizedEntityReference,
            accessExpiresAt: credential.accessExpiresAt }); }
          catch { receipt = await input.rpc("reconcile", { connectionId: row.connectionId, leaseId }); }
          const committed = context(receipt, row.connectionId, leaseId);
          if (committed.ciphertext !== candidate || committed.credentialVersion !== 1 || committed.generation !== row.generation ||
            committed.merchantId !== credential.externalAuthorizedEntityReference || committed.accessExpiresAt !== credential.accessExpiresAt) throw denied();
          ciphertext = candidate;
        });
        if (ciphertext === null) throw denied();
        stored.parse(await input.rpc("complete_connect", { connectionId: row.connectionId, leaseId,
          ciphertext, merchantId: result.merchantId, sellerLabel: result.sellerLabel,
          locations: result.locations, accessExpiresAt: result.credential.accessExpiresAt }));
      } catch (error) { await fail(row.connectionId, leaseId, error); throw denied(); }
    },
    async map(connectionId: string, locationId: string) {
      z.object({ mapped: z.literal(true) }).strict().parse(await input.rpc("map", { connectionId, locationId }));
    },
    async read(connectionId: string, historical?: DirectHistoricalWindow) {
      const leaseId = randomUUID();
      const range = historical === undefined ? undefined : DirectHistoricalWindowSchema.parse(historical);
      if (range && Date.parse(range.windowEnd) > now().getTime()) throw denied();
      let row = context(await input.rpc(range ? "claim_history" : "claim", { connectionId, leaseId, ...range }), connectionId, leaseId);
      try {
        if (range && (row.readKind !== "created" || row.windowStart !== range.windowStart || row.windowEnd !== range.windowEnd)) throw denied();
        if (!row.ciphertext || !row.merchantId || !row.locationId || !row.accessExpiresAt || !row.windowStart || !row.windowEnd) throw denied();
        let credential = openCredential(row.ciphertext, input.encryptionKey, aad(row));
        if (credential.externalAuthorizedEntityReference !== row.merchantId || credential.accessExpiresAt !== row.accessExpiresAt) throw denied();
        const square = provider(connectionId, leaseId);
        if (Date.parse(credential.accessExpiresAt) <= now().getTime() + 5 * 60_000) {
          const renewed = await square.refresh(credential), version = row.credentialVersion + 1;
          const ciphertext = sealCredential(renewed, input.encryptionKey, aad(row, version));
          let receipt: unknown;
          try { receipt = await input.rpc("commit_refresh", { connectionId, leaseId, credentialVersion: version,
            ciphertext, accessExpiresAt: renewed.accessExpiresAt }); }
          catch { receipt = await input.rpc("reconcile", { connectionId, leaseId }); }
          const committed = context(receipt, connectionId, leaseId);
          if (committed.credentialVersion !== version || committed.ciphertext !== ciphertext ||
            committed.accessExpiresAt !== renewed.accessExpiresAt || committed.generation !== row.generation) throw denied();
          row = committed; credential = renewed;
        }
        if (Date.parse(credential.accessExpiresAt) <= now().getTime()) throw denied();
        const page = await square.payments({ credential, workspaceId: row.workspaceId, connectionId,
          merchantId: row.merchantId!, locationId: row.locationId!, windowStart: row.windowStart!, windowEnd: row.windowEnd!,
          readKind: row.readKind,
          cursor: row.cursor, cursorBindingFingerprint: row.cursorBindingFingerprint, cursorFingerprint: row.cursorFingerprint });
        z.object({ stored: z.literal(true), hasMore: z.boolean() }).strict().parse(await input.rpc("commit_page", {
          connectionId, leaseId, ...page,
          cursorBindingFingerprint: page.cursor ? page.cursorBindingFingerprint : null
        }));
      } catch (error) { await fail(connectionId, leaseId, error); throw denied(); }
    },
    async disconnect(connectionId: string) {
      const leaseId = randomUUID();
      const row = context(await input.rpc("disconnect", { connectionId, leaseId }), connectionId);
      // Local provider dispatch is fenced before any network revocation.
      if (row.ciphertext) {
        if (row.leaseId !== leaseId) throw denied();
        const credential = openCredential(row.ciphertext, input.encryptionKey, aad(row));
        if (credential.externalAuthorizedEntityReference !== row.merchantId) throw denied();
        await provider(connectionId, leaseId, true).revoke(credential);
      }
      z.object({ disconnected: z.literal(true) }).strict().parse(await input.rpc("complete_disconnect", { connectionId, leaseId }));
    }
  });
}

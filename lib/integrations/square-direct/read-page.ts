import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { openCredential, sealCredential } from "./crypto";
import { DirectContextSchema, DirectHistoricalWindowSchema, type DirectHistoricalWindow, type DirectRpc } from "./contracts";
import type { createDirectSquareProvider } from "./provider";

type Provider = ReturnType<typeof createDirectSquareProvider>;
const denied = () => new Error("square_customer_action_failed");

/** Reusable single-page execution with explicit authority capabilities. This
 * accepts no browser session: the caller supplies either the original verified
 * owner RPC or the separately consented recurring RPC. It cannot connect, map,
 * broaden scopes, or revoke an account. */
export async function readDirectSquarePage(input: {
  workspaceId: string; connectionId: string; encryptionKey: string; rpc: DirectRpc;
  provider(authorize: () => Promise<void>): Provider; now?: () => Date;
  historical?: DirectHistoricalWindow; updatedOnly?: boolean;
  fail(connectionId: string, leaseId: string, error: unknown): Promise<void>;
}): Promise<{ hasMore: boolean }> {
  const now = input.now ?? (() => new Date()), connectionId = input.connectionId, leaseId = randomUUID();
  const range = input.historical === undefined ? undefined : DirectHistoricalWindowSchema.parse(input.historical);
  if (range && (input.updatedOnly || Date.parse(range.windowEnd) > now().getTime())) throw denied();
  function context(value: unknown) {
    const row = DirectContextSchema.parse(value);
    if (row.workspaceId !== input.workspaceId || row.connectionId !== connectionId || row.leaseId !== leaseId) throw denied();
    return row;
  }
  try {
    let row = context(await input.rpc(range ? "claim_history" : "claim", { connectionId, leaseId, ...range }));
    const aad = (version = row.credentialVersion) => ({ workspaceId: row.workspaceId, connectionId: row.connectionId,
      generation: row.generation, credentialVersion: version });
    if (input.updatedOnly && row.readKind !== "updated") throw denied();
    if (range && (row.readKind !== "created" || row.windowStart !== range.windowStart || row.windowEnd !== range.windowEnd)) throw denied();
    if (!row.ciphertext || !row.merchantId || !row.locationId || !row.accessExpiresAt || !row.windowStart || !row.windowEnd) throw denied();
    let credential = openCredential(row.ciphertext, input.encryptionKey, aad());
    if (credential.externalAuthorizedEntityReference !== row.merchantId || credential.accessExpiresAt !== row.accessExpiresAt) throw denied();
    const square = input.provider(async () => {
      z.object({ authorized: z.literal(true) }).strict().parse(await input.rpc("authorize", { connectionId, leaseId }));
    });
    if (Date.parse(credential.accessExpiresAt) <= now().getTime() + 5 * 60_000) {
      const renewed = await square.refresh(credential), version = row.credentialVersion + 1;
      const ciphertext = sealCredential(renewed, input.encryptionKey, aad(version));
      let receipt: unknown;
      try { receipt = await input.rpc("commit_refresh", { connectionId, leaseId, credentialVersion: version,
        ciphertext, accessExpiresAt: renewed.accessExpiresAt }); }
      catch { receipt = await input.rpc("reconcile", { connectionId, leaseId }); }
      const committed = context(receipt);
      if (committed.credentialVersion !== version || committed.ciphertext !== ciphertext ||
        committed.accessExpiresAt !== renewed.accessExpiresAt || committed.generation !== row.generation) throw denied();
      row = committed; credential = renewed;
    }
    if (Date.parse(credential.accessExpiresAt) <= now().getTime()) throw denied();
    const page = await square.payments({ credential, workspaceId: row.workspaceId, connectionId,
      merchantId: row.merchantId!, locationId: row.locationId!, windowStart: row.windowStart!, windowEnd: row.windowEnd!,
      readKind: row.readKind, cursor: row.cursor, cursorBindingFingerprint: row.cursorBindingFingerprint, cursorFingerprint: row.cursorFingerprint });
    const receipt = z.object({ stored: z.literal(true), hasMore: z.boolean() }).strict().parse(await input.rpc("commit_page", {
      connectionId, leaseId, ...page, cursorBindingFingerprint: page.cursor ? page.cursorBindingFingerprint : null
    }));
    return { hasMore: receipt.hasMore };
  } catch (error) { await input.fail(connectionId, leaseId, error); throw denied(); }
}

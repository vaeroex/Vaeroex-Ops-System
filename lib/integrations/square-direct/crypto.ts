import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import { CredentialEnvelopeSchema, type CredentialEnvelope } from "@/lib/integrations/credentials/contracts";

export type DirectCredentialContext = Readonly<{
  workspaceId: string; connectionId: string; generation: number; credentialVersion: number;
}>;
const contextSchema = z.object({ workspaceId: z.string().uuid(), connectionId: z.string().uuid(),
  generation: z.number().int().positive().safe(), credentialVersion: z.number().int().positive().safe() }).strict();
const failure = () => new Error("square_direct_credential_invalid");
function contextBytes(context: DirectCredentialContext) {
  return Buffer.from(canonicalContractJson({ format: "square_direct_credential_v1", provider: "square",
    environment: "production", ...contextSchema.parse(context) }));
}
function keyBytes(value: string) {
  if (typeof value !== "string" || value.length !== 44) throw failure();
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) { key.fill(0); throw failure(); }
  return key;
}
function productionCredential(value: unknown) {
  const credential = CredentialEnvelopeSchema.parse(value);
  if (credential.providerKey !== "square" || credential.environment !== "production") throw failure();
  return credential;
}

/** Opaque encrypted envelope; context is authenticated, never read from ciphertext. */
export function sealCredential(credential: CredentialEnvelope, keyBase64: string, context: DirectCredentialContext): string {
  let key: Buffer | undefined, plaintext: Buffer | undefined, aad: Buffer | undefined;
  try {
    key = keyBytes(keyBase64); aad = contextBytes(context);
    plaintext = Buffer.from(canonicalContractJson(productionCredential(credential)));
    if (!plaintext.length || plaintext.length > 65_536) throw failure();
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return `sd1.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url")}`;
  } catch { throw failure(); }
  finally { key?.fill(0); plaintext?.fill(0); aad?.fill(0); }
}

export function openCredential(sealed: string, keyBase64: string, context: DirectCredentialContext): CredentialEnvelope {
  let key: Buffer | undefined, plaintext: Buffer | undefined, aad: Buffer | undefined, packed: Buffer | undefined;
  try {
    key = keyBytes(keyBase64); aad = contextBytes(context);
    if (typeof sealed !== "string" || sealed.length > 90_000 || !/^sd1\.[A-Za-z0-9_-]+$/.test(sealed)) throw failure();
    packed = Buffer.from(sealed.slice(4), "base64url");
    if (packed.length < 29 || packed.length > 65_564 || packed.toString("base64url") !== sealed.slice(4)) throw failure();
    const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
    decipher.setAAD(aad); decipher.setAuthTag(packed.subarray(12, 28));
    plaintext = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]);
    return productionCredential(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)));
  } catch { throw failure(); }
  finally { key?.fill(0); plaintext?.fill(0); aad?.fill(0); packed?.fill(0); }
}

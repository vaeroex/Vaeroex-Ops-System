import "server-only";

import { createHash } from "node:crypto";
import type {
  DocumentPilotCacheIdentity,
  ProviderNeutralDocumentExtractionV1
} from "@/lib/ai/document-intelligence-poc/pilot-contracts";

export type DocumentPilotCache = {
  get(key: string): Promise<ProviderNeutralDocumentExtractionV1 | null>;
  set(key: string, result: ProviderNeutralDocumentExtractionV1): Promise<void>;
};

export function documentPilotCacheKey(identity: DocumentPilotCacheIdentity) {
  return createHash("sha256").update(JSON.stringify({
    documentHash: identity.documentHash,
    provider: identity.provider,
    model: identity.model,
    clientRevision: identity.clientRevision,
    extractionContractVersion: identity.extractionContractVersion,
    normalizationVersion: identity.normalizationVersion,
    routingPolicyVersion: identity.routingPolicyVersion
  })).digest("hex");
}

export function workspaceScopedDocumentPilotCacheKey(baseKey: string, workspaceScopeHash: string) {
  if (!/^[a-f0-9]{64}$/.test(workspaceScopeHash)) throw new Error("A privacy-safe workspace scope hash is required for pilot caching.");
  return createHash("sha256").update(`${workspaceScopeHash}:${baseKey}`).digest("hex");
}

export class MemoryDocumentPilotCache implements DocumentPilotCache {
  private readonly entries = new Map<string, ProviderNeutralDocumentExtractionV1>();

  async get(key: string) {
    return this.entries.get(key) || null;
  }

  async set(key: string, result: ProviderNeutralDocumentExtractionV1) {
    if (result.status === "success") this.entries.set(key, result);
  }
}

export type CoordinatedExtractionResult = Readonly<{
  result: ProviderNeutralDocumentExtractionV1;
  cacheHit: boolean;
  duplicateDocumentSkip: boolean;
}>;

export class DocumentPilotExtractionCoordinator {
  private readonly inFlight = new Map<string, Promise<ProviderNeutralDocumentExtractionV1>>();

  constructor(private readonly cache: DocumentPilotCache) {}

  async run(key: string, factory: () => Promise<ProviderNeutralDocumentExtractionV1>): Promise<CoordinatedExtractionResult> {
    const cached = await this.cache.get(key);
    if (cached) return { result: cached, cacheHit: true, duplicateDocumentSkip: true };

    const existing = this.inFlight.get(key);
    if (existing) {
      return { result: await existing, cacheHit: false, duplicateDocumentSkip: true };
    }

    const created = factory();
    this.inFlight.set(key, created);
    try {
      const result = await created;
      if (result.status === "success") await this.cache.set(key, result);
      return { result, cacheHit: false, duplicateDocumentSkip: false };
    } finally {
      this.inFlight.delete(key);
    }
  }
}

export class DocumentPilotCircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly failureThreshold = 3,
    private readonly coolDownMs = 5 * 60_000
  ) {}

  canAttempt(now = Date.now()) {
    if (this.openedAt === null) return true;
    if (now - this.openedAt < this.coolDownMs) return false;
    this.consecutiveFailures = 0;
    this.openedAt = null;
    return true;
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  recordFailure(now = Date.now()) {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) this.openedAt = now;
  }

  state() {
    return { consecutiveFailures: this.consecutiveFailures, open: this.openedAt !== null } as const;
  }
}

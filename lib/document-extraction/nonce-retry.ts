import "server-only";

export type DocumentExtractionCacheCompletion = {
  completed: boolean;
  reason?: "nonce_collision";
};

const MAX_NONCE_COLLISION_ATTEMPTS = 3;

export async function persistWithDocumentExtractionNonceRetry<TEnvelope, TResult extends DocumentExtractionCacheCompletion>(
  createEnvelope: () => Promise<TEnvelope>,
  persist: (envelope: TEnvelope) => Promise<TResult>
) {
  let lastResult: TResult | null = null;
  for (let attempt = 0; attempt < MAX_NONCE_COLLISION_ATTEMPTS; attempt += 1) {
    const envelope = await createEnvelope();
    lastResult = await persist(envelope);
    if (lastResult.completed) return lastResult;
    if (lastResult.reason !== "nonce_collision") {
      throw new Error("document_extraction_cache_store_failed");
    }
  }
  throw new Error("document_extraction_nonce_collision_retry_exhausted");
}

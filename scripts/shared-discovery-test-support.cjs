/* eslint-disable @typescript-eslint/no-require-imports -- Offline fixtures model the exact discovery RPC envelope. */
const assert = require('node:assert/strict');
/** Complete synthetic catalogs only. Larger/truncated discovery is qualified by
 * the isolated SQL suite, not invented by this compatibility fixture helper. */
function completeCatalog(candidates) {
  assert(Array.isArray(candidates) && candidates.length <= 96);
  const counts = new Map();
  for (const candidate of candidates) counts.set(candidate.provider, (counts.get(candidate.provider) || 0) + 1);
  return {stage: 'catalog_only', candidates, truncated: false, totalCandidates: candidates.length,
    providerCounts: [...counts].map(([provider, total]) => ({provider, total, returned: total}))};
}
module.exports = {completeCatalog};

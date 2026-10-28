/* eslint-disable @typescript-eslint/no-require-imports -- Real preparation and engine with synthetic authority only; no network or database. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { z } = require('zod');
const { installLoader, id } = require('./qbo-customer-test-support.cjs');

const workspace = id(1), actor = id(2), session = id(3), request = id(4), ticket = id(5), manifest = id(6);
const marker = 'DO_NOT_LOG_PRIVATE_VALUE https://private.invalid/customer Bearer secret-key';
const question = 'Use stored Xero and Google Sheets observations from the last 30 days. Do not search the web.';
let scenario = {}, seen = [], bindCount = 0, productCalls = 0, fetchCalls = 0, prepared;
const sheet = () => ({
  identity: { kind: 'sheets_ticket_source', source_id: id(20), version_id: id(21) }, hash: 'a'.repeat(64),
  data: { workspace_id: workspace, provider: 'google_sheets', connection_id: id(22), entity_id: id(23),
    date: '2026-10-15', metrics: [{ metric: 'dispatch count', value: '6', unit: 'count' }], read_sources: [] }
});
const xero = () => ({
  identity: { kind: 'legacy_binding', binding_id: id(30), start: '2026-10-01', end: '2026-10-30' },
  hash: createHash('sha256').update('synthetic invoice').digest('hex'),
  data: { workspace_id: workspace, provider: 'xero', entity_id: id(23), connection_id: id(31), scope: 'stored observations',
    records: [{ day: '2026-10-13', metrics: [
      { key: 'invoices', value: '1', currency: 'USD' }, { key: 'billed', value: '1200', currency: 'USD' },
      { key: 'outstanding', value: '400', currency: 'USD' }, { key: 'bills', value: '0', currency: 'USD' },
      { key: 'purchases', value: '0', currency: 'USD' }
    ] }], read_sources: [] }
});
const rawError = (code, message = marker) => ({ code, message, details: { source: marker, identity: id(999), token: marker }, hint: marker, stack: marker });
const reader = {
  auth: {
    getUser: async () => { seen.push('getUser'); return { data: { user: scenario.actorMissing ? null : { id: actor } }, error: null }; },
    getClaims: async () => { seen.push('getClaims'); return { data: { claims: { sub: actor, session_id: session } }, error: null }; }
  },
  rpc: async (name, args) => {
    seen.push(name); assert.equal(args.p_workspace_id, workspace);
    if (scenario.throwRpc === name) throw scenario.error;
    if (scenario.errorRpc === name) return { data: null, error: scenario.error };
    if (scenario.badResponse === name) return { data: { [marker]: marker }, error: null };
    const sources = [sheet(), xero()];
    if (scenario.foreignWorkspace) sources[0].data.workspace_id = id(998);
    if (scenario.badProjection) sources[0].data.metrics[0].value = marker;
    if (name === 'discover_shared_evidence_v2') {
      const catalog = require('./shared-discovery-test-support.cjs').completeCatalog(sources.map(s => ({ provider: s.data.provider, identity: s.identity })));
      // The envelope and count types remain valid, but the provider totals no
      // longer agree with the actual candidates. This exercises semantic checks.
      if (scenario.inconsistentCatalog) catalog.providerCounts[0].returned = 0;
      return { data: catalog, error: null };
    }
    if (name === 'read_shared_typed_evidence_v1') return { data: { stage: 'unadmitted', resolved: sources[0] }, error: null };
    if (name === 'preview_shared_legacy_evidence_v1') return { data: { stage: 'unadmitted', resolved: sources[1] }, error: null };
    if (name === 'capture_legacy_evidence_v1') return { data: { reference_id: id(32), source_hash: scenario.captureChanged ? 'f'.repeat(64) : sources[1].hash }, error: null };
    if (name === 'shared_evidence_dependencies_v1') return { data: { manifestIds: [], readSources: [] }, error: null };
    if (name === 'seal_shared_evidence_manifest_v1') {
      assert.equal(args.p_target_id, request); assert.equal(args.p_read_ticket_id, ticket); assert.equal(args.p_sources.length, 2);
      return { data: { stage: 'database_bound', manifest_id: manifest, provider_policy_required: true }, error: null };
    }
    throw new Error('unexpected_synthetic_rpc');
  }
};
const mocks = {
  'server-only': {},
  '@supabase/supabase-js': { createClient: () => { throw new Error('database_client_forbidden'); } },
  '@/lib/supabase/admin': { createSupabaseAdminClient: () => { throw new Error('admin_client_forbidden'); } },
  '@/lib/ai/shared-evidence/runtime-gate': { sharedEvidenceRuntimeEnabled: () => true },
  './retrieval': {
    authorizeVsiRead: async () => ({ supabase: reader, workspaceId: workspace, user: { id: actor }, membership: { role: 'owner' }, workspace: { id: workspace, name: 'Synthetic workspace' } }),
    retrieveVsiEvidence: async () => { throw new Error('legacy_fallback_forbidden'); }
  },
  './product-context': { loadVsiProductContext: async () => {
    productCalls++; seen.push('product_context');
    if (scenario.productError) throw scenario.productError;
    if (scenario.preparedChanged) prepared.rows[0].facts[0] = marker;
    return { authoritative: { assistant: { name: 'Vaeroex' } }, sources: [], limitations: [] };
  } },
  '@/lib/integrations/google-sheets/read-authority': { bindGoogleSheetsRead: async () => {
    bindCount++; seen.push(`bind_roots_${bindCount}`);
    if (scenario.bindFailure === bindCount) throw new Error(marker);
    return { ticketId: ticket };
  } },
  '@/lib/ai/providers/google-data-policy': { googleSheetsOpenAIHeaders: async () => ({}) }
};
installLoader(mocks);
const generation = require('../lib/ai/shared-evidence/generation.ts');
mocks['@/lib/ai/shared-evidence/generation'] = { ...generation, prepareSharedGeneration: async (...args) => {
  prepared = await generation.prepareSharedGeneration(...args); return prepared;
} };
const { sharedPreparationDiagnostic: diagnose, withSharedPreparationPhase } = require('../lib/ai/shared-evidence/preparation-diagnostics.ts');
const actualReadAuthority = require('../lib/integrations/google-sheets/read-authority.ts');
const { runVsiAnswer, VsiEngineError } = require('../lib/vsi/engine.ts');
const originalFetch = global.fetch;
global.fetch = async () => { fetchCalls++; throw new Error('external_dispatch_forbidden'); };

function reset(next = {}) { scenario = next; seen = []; bindCount = 0; productCalls = 0; fetchCalls = 0; prepared = undefined; }
function safe(diagnostic) {
  const serialized = JSON.stringify(diagnostic);
  assert(serialized.length <= 700, 'diagnostic has a fixed small envelope');
  assert.doesNotMatch(serialized, /DO_NOT_LOG|private\.invalid|Bearer|secret-key|00000000-|synthetic invoice|dispatch count|\b1200\b|\b400\b/);
  assert.deepEqual(Object.keys(diagnostic).filter(key => !['version', 'phase', 'category', 'reason', 'operation', 'rpcCode', 'schemaIssueCount'].includes(key)), []);
  assert.equal(diagnostic.version, 1);
  if (diagnostic.schemaIssueCount !== undefined) assert(diagnostic.schemaIssueCount >= 0 && diagnostic.schemaIssueCount <= 32);
}
function input(overrides = {}) { return { supabase: reader, workspaceId: workspace, actorUserId: actor, readTicket: { ticketId: ticket },
  reservedRequest: { id: request, attempt: 1 }, question, recentMessages: [], requestId: id(7), ...overrides }; }
let cases = 0;
async function fails(name, fault, expected, overrides = {}) {
  reset(fault); const logs = [], previousError = console.error; console.error = (...args) => logs.push(args);
  let failure;
  try { await assert.rejects(runVsiAnswer(input(overrides)), error => { failure = error; return true; }); }
  finally { console.error = previousError; }
  assert(failure instanceof VsiEngineError, name);
  assert.equal(failure.message, 'Workspace source access could not be verified before generation.', name);
  assert.equal(failure.accountingUncertain, false, name); assert.equal(failure.usage.providerCalls, 0, name);
  assert.equal(failure.usage.estimatedCostUsd, 0, name); assert.equal(failure.usage.inputTokens, 0, name); assert.equal(failure.usage.outputTokens, 0, name);
  assert.equal(failure.usage.outcomeFailure, 'evidence_unavailable', name); assert.equal(fetchCalls, 0, name);
  assert.equal(logs.length, 1, name); assert.equal(logs[0][0], '[vsi-preparation]', name); assert.equal(logs[0].length, 2, name);
  const diagnostic = logs[0][1]; safe(diagnostic);
  for (const [key, value] of Object.entries(expected)) assert.equal(diagnostic[key], value, `${name}: ${key}`);
  if (['request_binding', 'discovery', 'source_read', 'source_projection'].includes(expected.phase)) assert.equal(productCalls, 0, name);
  if (expected.phase !== 'manifest_seal') assert(!seen.includes('seal_shared_evidence_manifest_v1'), `${name}: no later sealing call`);
  assert(!seen.includes('validate_shared_evidence_manifest_v1'), `${name}: no pre-provider validation/dispatch`);
  cases++; return diagnostic;
}

(async () => {
  for (const [code, message, category, reason] of [
    ['42501', 'evidence_owner_required', 'denial', 'actor_denied'],
    ['42501', 'evidence_binding_changed', 'snapshot_conflict', 'source_changed'],
    ['40001', 'shared_evidence_source_changed', 'snapshot_conflict', 'source_changed'],
    ['40001', 'shared_typed_identity_changed', 'snapshot_conflict', 'identity_changed'],
    ['PT409', 'shared_typed_identity_changed', 'snapshot_conflict', 'identity_changed'],
    ['PGRST202', marker, 'rpc_schema_mismatch', 'rpc_contract_missing'],
    ['57014', marker, 'operational', 'timeout'],
    ['42501', marker, 'unknown', 'unclassified']
  ]) {
    reset(); let error;
    try { await generation.sharedRpc({ rpc: async () => ({ data: null, error: rawError(code, message) }) }, 'discover_shared_evidence_v2', {}); }
    catch (caught) { error = caught; }
    assert(error instanceof Error); assert.equal(error.message, 'shared_evidence_authority_unavailable');
    const diagnostic = diagnose('discovery', error); safe(diagnostic);
    assert.equal(diagnostic.category, category); assert.equal(diagnostic.reason, reason); assert.equal(diagnostic.operation, 'discover_shared_evidence_v2');
    assert.doesNotMatch(JSON.stringify(error), /DO_NOT_LOG|private\.invalid|Bearer|secret-key|00000000-/);
    cases++;
  }
  const arbitrary = { code: marker, message: marker, details: marker, hint: marker, phase: marker, diagnostic: { phase: 'discovery', category: 'denial', reason: 'actor_denied' } };
  let unknown;
  try { await generation.sharedRpc({ rpc: async () => ({ data: null, error: arbitrary }) }, marker, {}); } catch (caught) { unknown = caught; }
  const unknownDiagnostic = diagnose('preparation', unknown); safe(unknownDiagnostic); assert.equal(unknownDiagnostic.category, 'unknown');
  assert.notEqual(unknownDiagnostic.operation, marker); cases++;
  assert.equal(diagnose('preparation', arbitrary).category, 'unknown', 'plain-object diagnostic spoof cannot upgrade a failure'); cases++;
  // Remote RPC messages cannot impersonate local invariant errors, even when
  // a transport happens to return an Error instance rather than plain JSON.
  for (const cause of [
    { message: 'shared_source_changed', details: marker },
    { code: 42, message: 'shared_source_changed', details: marker },
    { code: 'x'.repeat(201), message: 'shared_source_changed', details: marker },
    Object.assign(new Error('shared_source_changed'), { details: marker })
  ]) {
    let error;
    try { await generation.sharedRpc({ rpc: async () => ({ data: null, error: cause }) }, 'discover_shared_evidence_v2', {}); } catch (caught) { error = caught; }
    const diagnostic = diagnose('discovery', error); safe(diagnostic); assert.equal(diagnostic.category, 'unknown'); assert.equal(diagnostic.reason, 'unclassified');
    if (Object.hasOwn(cause, 'code')) assert.equal(diagnostic.rpcCode, 'other');
    assert.doesNotMatch(JSON.stringify(error), /DO_NOT_LOG|private\.invalid|Bearer|secret-key/); cases++;
  }
  const localConflict = diagnose('legacy_capture', new Error('shared_source_changed')); safe(localConflict);
  assert.equal(localConflict.category, 'snapshot_conflict'); assert.equal(localConflict.reason, 'source_changed'); cases++;
  let getterReads = 0;
  const getterPayload = {};
  for (const key of ['code', 'message', 'name', 'details', 'hint']) Object.defineProperty(getterPayload, key, { get() { getterReads++; return marker; } });
  const getterDiagnostic = diagnose('preparation', getterPayload); safe(getterDiagnostic); assert.equal(getterReads, 0); assert.equal(getterDiagnostic.category, 'unknown'); assert.equal(getterDiagnostic.rpcCode, 'other'); cases++;
  for (const payload of [
    new Proxy({}, { getPrototypeOf() { throw new Error(marker); } }),
    new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(marker); } })
  ]) {
    const diagnostic = diagnose('preparation', payload); safe(diagnostic); assert.equal(diagnostic.category, 'unknown'); assert.equal(diagnostic.reason, 'unclassified'); cases++;
  }
  const invalidPhase = diagnose(marker, new Error(marker)); safe(invalidPhase); assert.equal(invalidPhase.phase, 'preparation'); cases++;
  let annotatedInvalidPhase;
  try { await withSharedPreparationPhase(marker, () => { throw new Error(marker); }); } catch (caught) { annotatedInvalidPhase = caught; }
  const annotatedInvalid = diagnose(marker, annotatedInvalidPhase); safe(annotatedInvalid); assert.equal(annotatedInvalid.phase, 'preparation'); cases++;
  let nested;
  try { await withSharedPreparationPhase('preparation', () => withSharedPreparationPhase('source_read', () => { throw new Error(marker); })); } catch (caught) { nested = caught; }
  const nestedDiagnostic = diagnose('sealing', nested); safe(nestedDiagnostic); assert.equal(nestedDiagnostic.phase, 'source_read', 'outer boundaries retain the precise inner failure phase'); cases++;
  const hugeError = z.array(z.number()).safeParse(Array.from({ length: 1000 }, () => marker)).error;
  const bounded = diagnose('source_projection', hugeError); safe(bounded); assert.equal(bounded.category, 'invalid_evidence'); assert.equal(bounded.reason, 'schema_invalid'); assert.equal(bounded.schemaIssueCount, 32); cases++;
  for (const [sentinel, phase, category, reason] of [
    ['shared_discovery_counts_invalid', 'discovery', 'rpc_schema_mismatch', 'rpc_response_invalid'],
    ...['shared_memory_workspace_mismatch', 'shared_memory_ineligible', 'fact_time_semantics_invalid', 'fact_time_index_alignment']
      .map(sentinel => [sentinel, 'source_projection', 'invalid_evidence', 'projection_invalid'])
  ]) {
    const error = Object.assign(new Error(sentinel), { privateSource: marker, details: marker, stack: marker });
    const diagnostic = diagnose(phase, error); safe(diagnostic); assert.equal(diagnostic.category, category); assert.equal(diagnostic.reason, reason); cases++;
    const unknown = diagnose(phase, new Error(`${sentinel} ${marker}`)); safe(unknown); assert.equal(unknown.category, 'unknown'); assert.equal(unknown.reason, 'unclassified'); cases++;
  }

  // Exercise the real read-authority wrapper as well as the engine's phase
  // boundary: an opaque user message must not erase a safe RPC distinction.
  const validTicket = { ticketId: ticket, epoch: 1, expiresAt: '2026-10-29T00:00:00Z' };
  for (const [label, result, category, reason] of [
    ['stale ticket', { data: null, error: rawError('40001', 'google_sheets_read_ticket_stale') }, 'snapshot_conflict', 'source_changed'],
    ['read denied', { data: null, error: rawError('42501', 'google_sheets_read_denied') }, 'denial', 'actor_denied'],
    ['unknown read error', { data: null, error: rawError('42501') }, 'unknown', 'unclassified'],
    ['remote read Error cannot impersonate local conflict', { data: null, error: Object.assign(new Error('shared_source_changed'), { details: marker }) }, 'unknown', 'unclassified'],
    ['malformed ticket', { data: { ticketId: marker, epoch: -1, expiresAt: marker }, error: null }, 'rpc_schema_mismatch', 'rpc_response_invalid'],
    ['mismatched ticket', { data: { ...validTicket, ticketId: id(999) }, error: null }, 'invalid_evidence', 'read_ticket_mismatch']
  ]) {
    let rpcCalls = 0, error;
    const fake = { rpc: async (name, args) => { rpcCalls++; assert.equal(name, 'bind_google_sheets_read_v1'); assert.equal(args.p_ticket_id, ticket); return result; } };
    try { await withSharedPreparationPhase('source_roots', () => actualReadAuthority.bindGoogleSheetsRead(fake, ticket, [])); }
    catch (caught) { error = caught; }
    assert(error instanceof actualReadAuthority.GoogleSheetsReadUnavailable, label); assert.equal(rpcCalls, 1, label);
    assert.equal(error.message, 'Workspace data changed or is being updated. Reload this page before trying again.', label);
    assert.equal(error.cause, undefined, label); assert.doesNotMatch(JSON.stringify(error), /DO_NOT_LOG|private\.invalid|Bearer|secret-key|00000000-/);
    const diagnostic = diagnose('sealing', error); safe(diagnostic); assert.equal(diagnostic.phase, 'source_roots', label);
    assert.equal(diagnostic.category, category, label); assert.equal(diagnostic.reason, reason, label); cases++;
  }
  let invalidReadCalls = 0;
  const neverRead = { rpc: async () => { invalidReadCalls++; throw new Error('unexpected_read'); } };
  for (const [badTicket, sources, reason] of [[marker, [], 'read_ticket_invalid'], [ticket, [{ table: marker, id: ticket }], 'read_sources_invalid']]) {
    let error; try { await actualReadAuthority.bindGoogleSheetsRead(neverRead, badTicket, sources); } catch (caught) { error = caught; }
    const diagnostic = diagnose('source_roots', error); safe(diagnostic); assert.equal(diagnostic.reason, reason); cases++;
  }
  assert.equal(invalidReadCalls, 0);
  const validRead = await actualReadAuthority.bindGoogleSheetsRead({ rpc: async () => ({ data: validTicket, error: null }) }, ticket, []);
  assert.deepEqual(validRead, validTicket); cases++;

  await fails('reservation missing', {}, { phase: 'request_binding' }, { reservedRequest: undefined });
  await fails('explicit authority denial', { errorRpc: 'discover_shared_evidence_v2', error: rawError('42501', 'evidence_owner_required') }, { phase: 'discovery', category: 'denial', reason: 'actor_denied' });
  await fails('missing discovery RPC', { errorRpc: 'discover_shared_evidence_v2', error: rawError('PGRST202') }, { phase: 'discovery', category: 'rpc_schema_mismatch' });
  await fails('discovery timeout', { errorRpc: 'discover_shared_evidence_v2', error: rawError('57014') }, { phase: 'discovery', category: 'operational', reason: 'timeout' });
  await fails('unclassified authority-shaped response', { errorRpc: 'discover_shared_evidence_v2', error: rawError('42501') }, { phase: 'discovery', category: 'unknown' });
  await fails('private thrown transport error', { throwRpc: 'discover_shared_evidence_v2', error: new Error(marker) }, { phase: 'discovery' });
  await fails('malformed discovery response', { badResponse: 'discover_shared_evidence_v2' }, { phase: 'discovery', category: 'rpc_schema_mismatch', reason: 'rpc_response_invalid' });
  await fails('shape-valid inconsistent catalog counts', { inconsistentCatalog: true }, { phase: 'discovery', category: 'rpc_schema_mismatch', reason: 'rpc_response_invalid' });
  assert.deepEqual(seen, ['discover_shared_evidence_v2'], 'catalog semantic failure prevents every source read');
  await fails('read binding changed', { errorRpc: 'read_shared_typed_evidence_v1', error: rawError('42501', 'evidence_binding_changed') }, { phase: 'source_read', category: 'snapshot_conflict' });
  await fails('malformed source envelope', { badResponse: 'read_shared_typed_evidence_v1' }, { phase: 'source_read', category: 'rpc_schema_mismatch', reason: 'rpc_response_invalid' });
  await fails('malformed projection values', { badProjection: true }, { phase: 'source_projection', category: 'invalid_evidence' });
  await fails('foreign workspace stays rejected', { foreignWorkspace: true }, { phase: 'source_projection' });
  await fails('product context failure', { productError: new Error(marker) }, { phase: 'product_context' });
  await fails('prepared object changed', { preparedChanged: true }, { phase: 'prepared_validation', category: 'snapshot_conflict' });
  await fails('actor missing', { actorMissing: true }, { phase: 'actor_validation' });
  await fails('captured source hash changed', { captureChanged: true }, { phase: 'legacy_capture', category: 'snapshot_conflict' });
  await fails('source read roots unavailable', { bindFailure: 1 }, { phase: 'source_roots' });
  await fails('dependency RPC missing', { errorRpc: 'shared_evidence_dependencies_v1', error: rawError('PGRST202') }, { phase: 'dependency_read', category: 'rpc_schema_mismatch' });
  await fails('dependency root binding unavailable', { bindFailure: 2 }, { phase: 'dependency_roots' });
  await fails('manifest snapshot changed', { errorRpc: 'seal_shared_evidence_manifest_v1', error: rawError('40001', 'shared_evidence_source_changed') }, { phase: 'manifest_seal', category: 'snapshot_conflict' });
  await fails('manifest response contract invalid', { badResponse: 'seal_shared_evidence_manifest_v1' }, { phase: 'manifest_seal', category: 'rpc_schema_mismatch', reason: 'rpc_response_invalid' });

  reset(); const originals = JSON.stringify([sheet(), xero()]);
  const success = await runVsiAnswer(input({ question: 'Remember this: Synthetic workshop hours are weekdays.' }));
  assert(success.noteDraft); assert.equal(success.sharedManifestId, manifest); assert.equal(success.usage.providerCalls, 0);
  assert.equal(success.usage.estimatedCostUsd, 0); assert.equal(fetchCalls, 0); assert.equal(bindCount, 2); assert.equal(productCalls, 1);
  assert(seen.includes('capture_legacy_evidence_v1')); assert(seen.includes('seal_shared_evidence_manifest_v1'));
  assert.equal(JSON.stringify([sheet(), xero()]), originals); cases++;
  // An issued preparation still rejects later source changes; diagnostics do not
  // turn a conflicting snapshot into an accepted or partially admitted source.
  reset(); const before = await generation.prepareSharedGeneration(reader, workspace, '2026-10-01', '2026-10-30', question);
  scenario.captureChanged = true;
  await assert.rejects(generation.sealSharedGeneration(reader, before, { kind: 'vsi_request', id: request, attempt: 1, ticketId: ticket }));
  assert(!seen.includes('seal_shared_evidence_manifest_v1')); assert.equal(fetchCalls, 0); cases++;
  console.log(JSON.stringify({ passed: true, cases, realEngineAndPreparation: true, phasesRetained: true,
    genericUserErrorPreserved: true, noSourcePayloadsInDiagnostics: true, zeroCallsExplicit: true,
    successAndLaterConflict: true, permissionAndValidationStrict: true, externalCalls: 0, sqlCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = originalFetch; });

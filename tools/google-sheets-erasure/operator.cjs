/* eslint-disable @typescript-eslint/no-require-imports -- Restricted private support orchestration. */
'use strict';
const crypto = require('node:crypto');
const { normalizeManifest, pendingManifest, verifyRecord } = require('./journal.cjs');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HEX = /^[a-f0-9]{64}$/;
const fail = code => { throw Error(`sheets_operator_${code}`); };
function identity(requestId, scopeHash) { if (!UUID.test(requestId) || !HEX.test(scopeHash)) fail('identity'); }
function exactManifest(input, requestId, scopeHash) {
  const manifest = normalizeManifest(input);
  if (manifest.version !== 2) fail('exact_hash_manifest_required');
  if (manifest.requestId !== requestId || manifest.scopeHash !== scopeHash) fail('scope_changed');
  return manifest;
}
function storageCheckpointProof(input, manifests, inventoryDigest, targetEndpointHash, now) {
  const receipts = new Map();
  for (const manifest of manifests) for (const receipt of manifest.storageReceipts ?? []) {
    const key = `${receipt.bucket}:${receipt.path}`;
    if (receipts.has(key) && JSON.stringify(receipts.get(key)) !== JSON.stringify(receipt)) fail('storage_receipt_conflict');
    receipts.set(key, receipt);
  }
  if (!receipts.size) return null;
  const expected = [...receipts.values()].sort((a, b) => a.fileId.localeCompare(b.fileId));
  if (!input || Object.keys(input).sort().join(',') !== 'checkedAt,evidence,inventoryDigest,objectRestoreStatus,objects,targetEndpointHash,version' ||
      input.version !== 1 || input.inventoryDigest !== inventoryDigest || input.targetEndpointHash !== targetEndpointHash ||
      input.objectRestoreStatus !== 'not-restored' || JSON.stringify(input.objects) !== JSON.stringify(expected) ||
      typeof input.checkedAt !== 'string' || !Number.isFinite(Date.parse(input.checkedAt)) ||
      now.getTime() - Date.parse(input.checkedAt) < 0 || now.getTime() - Date.parse(input.checkedAt) > 86400000 ||
      !Array.isArray(input.evidence) || input.evidence.length < 2 || input.evidence.length > 20 ||
      !['provider-object-absence', 'storage-restore-inventory'].every(kind => input.evidence.some(e => e.kind === kind)) ||
      input.evidence.some(e => Object.keys(e).sort().join(',') !== 'kind,sha256,size' ||
        !['provider-object-absence', 'storage-restore-inventory'].includes(e.kind) || !HEX.test(e.sha256) ||
        !Number.isSafeInteger(e.size) || e.size < 1 || e.size > 8 * 1024 * 1024)) fail('storage_checkpoint_required');
  // Files were read/hash-checked by the private CLI. The release owner must still
  // inspect their provider/restore evidence before activation; this is not an API
  // assertion, an object restore permission or a generic storage deletion token.
  return { digest: crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex'), objects: expected.length,
    evidenceReview: 'manual-provider-and-no-object-restore-evidence-required-at-activation' };
}
function createOperator({ database, journal, witness, publicKey, pinnedFingerprint, now = () => new Date() }) {
  async function execute(requestId, scopeHash) {
    identity(requestId, scopeHash);
    const before = exactManifest(await database.getExecution(requestId, scopeHash), requestId, scopeHash);
    if (before.withdrawal) fail('withdrawn');
    const pending = { ...before, completedAt: null };
    journal.writePending(pending);
    const bytes = journal.readSignedRecord(requestId, 'pending');
    const intent = verifyRecord(bytes, publicKey, pinnedFingerprint);
    // Both durable boundaries precede the only destructive dispatch. An uncertain
    // remote create or SQL acknowledgement is reconciled under this same request.
    const witnessed = await witness.append(bytes);
    if (witnessed.digest !== intent.digest) fail('witness_mismatch');
    await database.execute(requestId, scopeHash, intent.digest);
    const after = exactManifest(await database.getExecution(requestId, scopeHash), requestId, scopeHash);
    if (after.completedAt === null || JSON.stringify({ ...after, completedAt: null }) !== JSON.stringify(pending)) fail('completion_unconfirmed');
    journal.writeCompletedReceipt(after);
    const completed = journal.readSignedRecord(requestId, 'completed');
    const receipt = verifyRecord(completed, publicKey, pinnedFingerprint);
    const saved = await witness.append(completed);
    if (saved.digest !== receipt.digest) fail('witness_mismatch');
    return { requestId, scopeHash, state: 'active_store_erased', completedAt: after.completedAt,
      counts: after.counts, intentDigest: intent.digest, receiptDigest: receipt.digest,
      backupProcessorStatus: 'separate-review-required' };
  }
  async function withdraw(requestId, scopeHash, reason, expectedInventoryDigest) {
    identity(requestId, scopeHash);
    if (!['scope_changed', 'approval_expired', 'owner_withdrawn'].includes(reason) || !HEX.test(expectedInventoryDigest)) fail('withdrawal_schema');
    const inventory = await witness.inventory();
    if (inventory.digest !== expectedInventoryDigest) fail('inventory_changed');
    let recovery = await database.getRecovery(requestId, scopeHash);
    if (recovery.state === 'completed') return { ...await execute(requestId, scopeHash), withdrawal: 'refused_completed_reconciled' };
    if (!['prepared', 'approved', 'withdrawn'].includes(recovery.state)) fail('withdrawal_state');
    const pending = exactManifest(recovery.manifest, requestId, scopeHash);
    if (pending.completedAt !== null || pending.withdrawal) fail('withdrawal_state');
    // Deterministic reconstruction also binds a delayed identical pending upload
    // whose dispatch will be rejected by the terminal SQL withdrawal state.
    journal.writePending(pending);
    const intent = verifyRecord(journal.readSignedRecord(requestId, 'pending'), publicKey, pinnedFingerprint);
    for (const record of inventory.records.filter(r => r.manifest.requestId === requestId)) {
      if (record.state === 'completed' || (record.state === 'pending' && record.digest !== intent.digest) ||
          JSON.stringify(pendingManifest(record.manifest)) !== JSON.stringify(pending)) fail('withdrawal_conflict');
    }
    await database.withdraw(requestId, scopeHash, inventory.digest, reason);
    recovery = await database.getRecovery(requestId, scopeHash);
    if (recovery.state !== 'withdrawn' || recovery.withdrawalReason !== reason ||
        JSON.stringify(exactManifest(recovery.manifest, requestId, scopeHash)) !== JSON.stringify(pending)) fail('withdrawal_unconfirmed');
    const receiptManifest = normalizeManifest({ ...pending, withdrawal: { at: recovery.withdrawnAt,
      reason: recovery.withdrawalReason, intentDigest: intent.digest, inventoryDigest: recovery.withdrawalInventoryDigest } });
    journal.writeWithdrawalReceipt(receiptManifest);
    const bytes = journal.readSignedRecord(requestId, 'withdrawn');
    const receipt = verifyRecord(bytes, publicKey, pinnedFingerprint), saved = await witness.append(bytes);
    if (saved.digest !== receipt.digest) fail('witness_mismatch');
    const witnessed = await witness.inventory();
    if (!witnessed.records.some(record => record.state === 'withdrawn' && record.digest === receipt.digest)) fail('withdrawal_unconfirmed');
    const result = await database.finishWithdrawal(requestId, scopeHash, receipt.digest, witnessed.digest);
    if (result.state !== 'withdrawn' || result.released !== true || result.requestId !== requestId || result.scopeHash !== scopeHash) fail('withdrawal_unconfirmed');
    if ((await witness.inventory()).digest !== witnessed.digest) fail('inventory_changed');
    return { state: 'withdrawn', released: true, requestId, scopeHash, receiptDigest: receipt.digest,
      inventoryDigest: witnessed.digest, nextStep: 'fresh-exact-preparation-and-owner-approval-required' };
  }

  async function dailyExpiry(limit = 10) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) fail('daily_limit');
    const [roots, disconnected] = await Promise.all([database.dueRetention(), database.dueDisconnected()]);
    if (!Array.isArray(roots) || !Array.isArray(disconnected)) fail('database_response');
    const operations = [], groups = new Map(), held = [];
    for (const item of disconnected) {
      if (!UUID.test(item.workspaceId) || !UUID.test(item.connectionId)) fail('database_response');
      const key = `${item.workspaceId}:${item.connectionId}`;
      if (item.manualReviewRequired) held.push({ workspaceId: item.workspaceId, connectionId: item.connectionId, reason: 'disconnected_review_required' });
      else operations.push({ kind: 'disconnected', workspaceId: item.workspaceId, connectionId: item.connectionId });
      groups.set(key, null);
    }
    for (const item of roots) {
      if (!UUID.test(item.rootId) || !UUID.test(item.workspaceId) || !UUID.test(item.connectionId)) fail('database_response');
      if (!item.automaticExpiryAuthorized) { held.push({ workspaceId: item.workspaceId, connectionId: item.connectionId, reason: 'retention_review_required' }); continue; }
      const key = `${item.workspaceId}:${item.connectionId}`;
      if (groups.has(key) && groups.get(key) === null) continue;
      if (!groups.has(key)) groups.set(key, { kind: 'roots', workspaceId: item.workspaceId, connectionId: item.connectionId, rootIds: [] });
      const group = groups.get(key); if (!group.rootIds.includes(item.rootId)) group.rootIds.push(item.rootId);
    }
    operations.push(...[...groups.values()].filter(Boolean));
    const completed = [];
    for (const operation of operations.slice(0, limit)) {
      const requestId = crypto.randomUUID(), caseId = crypto.randomUUID(); let scopeHash = null, stage = 'prepare';
      try {
        const input = { requestId, workspaceId: operation.workspaceId, connectionId: operation.connectionId, caseId };
        const prepared = operation.kind === 'disconnected' ? await database.prepareDisconnected(input) :
          await database.prepareRetention({ ...input, rootIds: operation.rootIds });
        identity(prepared.requestId, prepared.scopeHash);
        if (prepared.requestId !== requestId || prepared.state !== 'approved') fail('database_response');
        scopeHash = prepared.scopeHash; stage = 'execute';
        completed.push(await execute(requestId, prepared.scopeHash));
      } catch (error) {
        const reason = /^(sheets_(operator|witness|journal|erasure)_[a-z0-9_]+|google_sheets_privacy_paused)$/.test(error?.message ?? '') ? error.message : 'review_required';
        held.push({ requestId, scopeHash, stage, workspaceId: operation.workspaceId, connectionId: operation.connectionId, reason });
      }
    }
    const deferred = Math.max(0, operations.length - limit);
    return { runAt: now().toISOString(), processed: completed.length, held: held.length, deferred,
      inventoryMayHaveMore: roots.length >= 100 || disconnected.length >= 100,
      attentionRequired: held.length > 0 || deferred > 0 || roots.length >= 100 || disconnected.length >= 100,
      completed, reviewQueue: held, physicalPurgeTarget: 'next-business-day-support-run' };
  }

  async function restore(expectedInventoryDigest, targetEndpointHash, storageCheckpoint) {
    if (!HEX.test(expectedInventoryDigest) || !HEX.test(targetEndpointHash)) fail('restore_identity');
    const inventory = await witness.inventory();
    if (inventory.digest !== expectedInventoryDigest) fail('inventory_changed');
    const withdrawn = inventory.records.filter(record => record.state === 'withdrawn');
    const cancelled = new Set(withdrawn.map(record => record.manifest.requestId));
    const pending = inventory.records.filter(record => record.state === 'pending' && !cancelled.has(record.manifest.requestId));
    const storageProof = storageCheckpointProof(storageCheckpoint, [...pending, ...withdrawn].map(record => record.manifest), inventory.digest, targetEndpointHash, now());
    const replays = [];
    for (const record of pending) {
      // Verify independently again at the destructive boundary. Restore does not
      // need local files or private signing keys; missing local files do not erase
      // the independent witness inventory or silently reduce replay scope.
      const trusted = verifyRecord(record.bytes, publicKey, pinnedFingerprint);
      const manifest = exactManifest(trusted.manifest, trusted.manifest.requestId, trusted.manifest.scopeHash);
      if (trusted.state !== 'pending' || trusted.digest !== record.digest) fail('witness_mismatch');
      const result = await database.replay(manifest.requestId, manifest.scopeHash, manifest, trusted.digest);
      if (result.remaining !== 0 || result.scopeHash !== manifest.scopeHash) fail('residual_content');
      replays.push({ requestId: manifest.requestId, scopeHash: manifest.scopeHash, intentDigest: trusted.digest });
    }
    // Old writers and erasure operators must be externally stopped throughout
    // restore/activation. A second complete inventory detects concurrent changes;
    // this tool never starts applications, schedules or outbound integrations.
    const after = await witness.inventory();
    if (after.digest !== inventory.digest) fail('inventory_changed');
    const finalized = await database.finishRestore([...pending, ...withdrawn].map(record => record.manifest), after.digest);
    if (finalized.remaining !== 0 || finalized.inventoryDigest !== after.digest) fail('restore_finalization');
    const finalInventory = await witness.inventory();
    if (finalInventory.digest !== after.digest) fail('inventory_changed');
    const checkpoint = { version: 1, targetEndpointHash, inventoryDigest: after.digest,
      requestsReplayed: pending.length, withdrawalsReconciled: withdrawn.length, remainingTargets: 0, checkedAt: now().toISOString(),
      activation: 'external-release-required', replays, ...(storageProof ? { storageProof } : {}) };
    return { ...checkpoint, checkpointDigest: crypto.createHash('sha256').update(JSON.stringify(checkpoint)).digest('hex') };
  }
  return Object.freeze({ execute, withdraw, dailyExpiry, restore });
}

/** Fixed SQL only. Caller connects as a separately provisioned, non-admin
 * support login. Neither the application service role nor raw SQL is accepted. */
async function restrictedDatabase(client, purpose = 'support') {
  if (!['support', 'isolated-restore'].includes(purpose)) fail('configuration');
  const role = (await client.query(`select session_user::text as session_user,current_user::text as current_user,
    r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolreplication,pg_has_role(current_user,'google_sheets_erasure_support','MEMBER') as support,
    pg_has_role(current_user,'google_sheets_erasure_restore','MEMBER') as restore,
    exists(select 1 from pg_roles inherited where inherited.rolname not in (current_user,$1)
      and pg_has_role(current_user,inherited.oid,'MEMBER')) as extra_memberships,
    (pg_has_role(current_user,'service_role','MEMBER') or pg_has_role(current_user,'authenticated','MEMBER') or pg_has_role(current_user,'anon','MEMBER')) as application
    from pg_roles r where r.rolname=current_user`,
    [purpose === 'support' ? 'google_sheets_erasure_support' : 'google_sheets_erasure_restore'])).rows[0];
  if (!role || role.session_user !== role.current_user || role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb || role.rolreplication ||
      (purpose === 'support' ? (!role.support || role.restore) : (!role.restore || role.support)) || role.extra_memberships || role.application || ['postgres', 'authenticated', 'anon', 'service_role'].includes(role.current_user)) fail('restricted_login_required');
  const call = async (sql, params) => {
    const result = await client.query(sql, params);
    if (result.rows.length !== 1 || result.rows[0].result === null) fail('database_response');
    return result.rows[0].result;
  };
  return Object.freeze({
    prepare: input => {
      if (!input || Object.keys(input).sort().join(',') !== 'artifacts,caseId,connectionId,requestId,reviewComplete,workspaceId' ||
          !['requestId', 'workspaceId', 'connectionId', 'caseId'].every(key => UUID.test(input[key])) ||
          !Array.isArray(input.artifacts) || input.reviewComplete !== true) fail('preparation_schema');
      return call('select private.prepare_google_sheets_erasure_v1($1,$2,$3,$4,$5::jsonb,$6) result',
        [input.requestId, input.workspaceId, input.connectionId, input.caseId, JSON.stringify(input.artifacts), input.reviewComplete]);
    },
    dueDisconnected: () => call('select private.due_google_sheets_disconnected_expiry_v1($1) result', [100]),
    prepareDisconnected: input => {
      if (!input || Object.keys(input).sort().join(',') !== 'caseId,connectionId,requestId,workspaceId' ||
          !['requestId', 'workspaceId', 'connectionId', 'caseId'].every(key => UUID.test(input[key]))) fail('retention_schema');
      return call('select private.prepare_google_sheets_disconnected_expiry_v1($1,$2,$3,$4) result',
        [input.requestId, input.workspaceId, input.connectionId, input.caseId]);
    },
    inspectRecovery: async id => {
      if (!UUID.test(id)) fail('identity');
      const recovery = await call('select private.get_google_sheets_erasure_recovery_v1($1,$2) result', [id, null]);
      const manifest = exactManifest(recovery.manifest, id, recovery.manifest?.scopeHash);
      return { requestId: id, workspaceId: manifest.workspaceId, connectionId: manifest.connectionId, scopeHash: manifest.scopeHash,
        state: recovery.state, completedAt: manifest.completedAt, withdrawnAt: recovery.withdrawnAt, withdrawalReason: recovery.withdrawalReason };
    },
    getRecovery: (id, hash) => call('select private.get_google_sheets_erasure_recovery_v1($1,$2) result', [id, hash]),
    withdraw: (id, hash, inventory, reason) => call('select private.withdraw_google_sheets_erasure_v1($1,$2,$3,$4) result', [id, hash, inventory, reason]),
    finishWithdrawal: (id, hash, receipt, inventory) => call('select private.finish_google_sheets_withdrawal_v1($1,$2,$3,$4) result', [id, hash, receipt, inventory]),
    dueRetention: () => call('select private.due_google_sheets_retention_v1($1) result', [100]),
    prepareRetention: input => {
      if (!input || Object.keys(input).sort().join(',') !== 'caseId,connectionId,requestId,rootIds,workspaceId' ||
          !['requestId', 'workspaceId', 'connectionId', 'caseId'].every(key => UUID.test(input[key])) ||
          !Array.isArray(input.rootIds) || input.rootIds.length < 1 || input.rootIds.length > 500 ||
          input.rootIds.some(id => !UUID.test(id)) || new Set(input.rootIds).size !== input.rootIds.length) fail('retention_schema');
      return call('select private.prepare_google_sheets_retention_v1($1,$2,$3,$4,$5::uuid[]) result',
        [input.requestId, input.workspaceId, input.connectionId, input.caseId, input.rootIds]);
    },
    getExecution: (id, hash) => call('select private.get_google_sheets_erasure_execution_v1($1,$2) result', [id, hash]),
    execute: (id, hash, journalDigest) => call('select private.execute_google_sheets_erasure_v1($1,$2,$3) result', [id, hash, journalDigest]),
    replay: (id, hash, manifest, journalDigest) => call('select private.replay_google_sheets_erasure_v1($1,$2,$3::jsonb,$4) result', [id, hash, JSON.stringify(manifest), journalDigest]),
    finishRestore: (manifests, inventoryDigest) => call('select private.finish_google_sheets_restore_v1($1::jsonb,$2) result', [JSON.stringify(manifests), inventoryDigest])
  });
}
module.exports = { createOperator, restrictedDatabase, storageCheckpointProof };

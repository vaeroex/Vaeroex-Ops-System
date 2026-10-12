/* eslint-disable @typescript-eslint/no-require-imports -- Offline protocol tests; synthetic keys and transport only. */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { normalizeManifest, signManifest, verifyRecord, publicKeyFingerprint } = require('../tools/google-sheets-erasure/journal.cjs');
const { createGcsWitness, auditInventory, genesisBytes } = require('../tools/google-sheets-erasure/witness.cjs');
const { createOperator, restrictedDatabase } = require('../tools/google-sheets-erasure/operator.cjs');
const { endpointHash, readStorageCheckpoint } = require('../tools/google-sheets-erasure/operator-cli.cjs');
const pair = crypto.generateKeyPairSync('ed25519'), pin = publicKeyFingerprint(pair.publicKey);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const completedAt = '2026-10-12T20:00:00.000Z';
function manifest() {
  return normalizeManifest({ version: 2, requestId: crypto.randomUUID(), workspaceId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(), scopeHash: 'b'.repeat(64),
    targets: [{ table: 'google_sheets_source_versions', id: crypto.randomUUID(), hash: 'a'.repeat(64) }],
    counts: { google_sheets_source_versions: 1 }, completedAt: null });
}
function cloud() {
  const config = { serviceAccount: 'sheets-witness@synthetic-project.iam.gserviceaccount.com', bucket: 'synthetic-erasure-witness', datasetId: crypto.randomUUID(), primaryEndpointHash: '9'.repeat(64), publicKey: pair.publicKey, pinnedFingerprint: pin };
  const genesis = genesisBytes(config); config.genesisDigest = hash(genesis);
  const prefix = `google-sheets-erasure/${config.datasetId}/`, objects = new Map([[prefix + 'genesis.json', genesis]]);
  const metadata = { name: config.bucket, versioning: { enabled: true }, iamConfiguration: {
    uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' } };
  const permissions = ['storage.buckets.get', 'storage.objects.create', 'storage.objects.get', 'storage.objects.list'];
  const calls = []; let before = null;
  const response = (value, status = 200) => new Response(Buffer.isBuffer(value) ? value : JSON.stringify(value), { status });
  const fetch = async (url, init) => {
    const u = new URL(url); calls.push({ method: init.method ?? 'GET', url: u });
    assert.equal(u.hostname, 'storage.googleapis.com'); assert.equal(init.redirect, 'error');
    assert(init.signal instanceof AbortSignal); assert.equal(init.headers.authorization, 'Bearer synthetic-cloud-access-token');
    if (before) { const result = await before(u, init); if (result) return result; }
    if (u.pathname.includes('/iam/testPermissions')) return response({ permissions });
    if (u.pathname.startsWith('/upload/')) {
      assert.equal(init.method, 'POST'); assert.equal(u.searchParams.get('ifGenerationMatch'), '0');
      const name = u.searchParams.get('name'); if (objects.has(name)) return response({}, 412);
      objects.set(name, Buffer.from(init.body)); return response({ generation: '1' });
    }
    const marker = '/o/';
    if (u.pathname.includes(marker)) {
      const name = decodeURIComponent(u.pathname.split(marker)[1]);
      return objects.has(name) ? response(objects.get(name)) : response({}, 404);
    }
    if (u.pathname.endsWith('/o')) return response({ items: [...objects].map(([name, bytes]) => ({ name, generation: '1', size: String(bytes.length) })) });
    return response(metadata);
  };
  return { objects, prefix, config, metadata, permissions, calls, setHook: hook => { before = hook; },
    witness: createGcsWitness(config, { token: async () => 'synthetic-cloud-access-token', fetch }) };
}
function localJournal(events) {
  const records = new Map();
  return {
    records,
    writePending: value => { events.push('local-pending'); const bytes = signManifest(value, pair.privateKey), key = `${value.requestId}.pending`;
      if (records.has(key)) assert.deepEqual(records.get(key), bytes); else records.set(key, bytes); },
    writeCompletedReceipt: value => { events.push('local-completed'); records.set(`${value.requestId}.completed`, signManifest(value, pair.privateKey)); },
    writeWithdrawalReceipt: value => { events.push('local-withdrawn'); records.set(`${value.requestId}.withdrawn`, signManifest(value, pair.privateKey)); },
    readSignedRecord: (id, state) => records.get(`${id}.${state}`)
  };
}

test('GCS append is create-only with exact duplicate reconciliation and complete inventory', async () => {
  const f = cloud(), m = manifest(), bytes = signManifest(m, pair.privateKey);
  await f.witness.append(bytes); await f.witness.append(bytes);
  await f.witness.append(signManifest({ ...m, completedAt }, pair.privateKey));
  const result = await f.witness.inventory();
  assert.equal(result.requestCount, 1); assert.equal(result.records.length, 2);
  assert(f.calls.every(call => ['GET', 'POST'].includes(call.method)));
  assert.equal(result.records.find(r => r.state === 'pending').digest, hash(bytes));
  const changed = signManifest({ ...m, scopeHash: 'c'.repeat(64) }, pair.privateKey);
  await assert.rejects(f.witness.append(changed), /conflict/);
});

test('configuration refuses missing genesis, mutable buckets, lifecycle expiry and excessive operator IAM', async () => {
  for (const mutate of [
    f => f.objects.clear(), f => { f.metadata.versioning.enabled = false; },
    f => { f.metadata.lifecycle = { rule: [{ action: { type: 'Delete' } }] }; },
    f => { f.metadata.iamConfiguration.publicAccessPrevention = 'inherited'; },
    f => { f.permissions.push('storage.objects.delete'); },
    f => { f.permissions.push('storage.buckets.setIamPolicy'); },
    f => { f.permissions.splice(f.permissions.indexOf('storage.objects.list'), 1); }
  ]) { const f = cloud(); mutate(f); await assert.rejects(f.witness.verifyConfiguration(), /sheets_witness_/); }
});

test('genesis/key identity, missing signed intent and content-hash schema are independently required', () => {
  const f = cloud();
  assert.throws(() => createGcsWitness({ ...f.config, genesisDigest: 'd'.repeat(64) }, { token: async () => '' }), /configuration/);
  const m = manifest(), completed = signManifest({ ...m, completedAt }, pair.privateKey);
  assert.throws(() => auditInventory([{ name: `${m.requestId}.completed.json`, bytes: completed }], pair.publicKey, pin), /receipt_without_intent/);
  const legacy = { ...m, version: 1, targets: m.targets.map(({ table, id }) => ({ table, id })) };
  assert.throws(() => auditInventory([{ name: `${m.requestId}.pending.json`, bytes: signManifest(legacy, pair.privateKey) }], pair.publicKey, pin), /exact_hash_manifest_required/);
});

test('uncertain object creation never silently overwrites and succeeds on exact retry', async () => {
  const f = cloud(), m = manifest(), bytes = signManifest(m, pair.privateKey);
  let once = true;
  f.setHook((u, init) => { if (once && u.pathname.startsWith('/upload/')) {
    once = false; f.objects.set(u.searchParams.get('name'), Buffer.from(init.body)); throw Error('synthetic lost acknowledgement');
  } });
  await assert.rejects(f.witness.append(bytes), /transport/);
  assert.equal((await f.witness.append(bytes)).digest, hash(bytes));
});

test('inventory pagination is complete; repeated tokens, missing genesis, changed listings and corrupt bytes hold replay', async () => {
  for (const fault of ['repeat', 'missing-genesis', 'changed', 'corrupt']) {
    const f = cloud(), m = manifest(), bytes = signManifest(m, pair.privateKey); await f.witness.append(bytes);
    let lists = 0;
    f.setHook(u => {
      if (!u.pathname.endsWith('/o')) return;
      lists++;
      let items = [...f.objects].map(([name, value]) => ({ name, generation: '1', size: String(value.length) }));
      if (fault === 'repeat') return new Response(JSON.stringify({ items: [], nextPageToken: 'same' }));
      if (fault === 'missing-genesis') items = items.filter(i => !i.name.endsWith('genesis.json'));
      if (fault === 'changed' && lists > 1) items = items.filter(i => i.name.endsWith('genesis.json'));
      if (fault === 'corrupt') f.objects.set(f.prefix + m.requestId + '.pending.json', Buffer.from('bad'));
      return new Response(JSON.stringify({ items }));
    });
    await assert.rejects(f.witness.inventory(), /sheets_witness_|sheets_journal_/);
  }
});

test('all local journal files can disappear without losing independent restore targets', async () => {
  const f = cloud(), m = manifest(); await f.witness.append(signManifest(m, pair.privateKey));
  const events = [], journal = localJournal(events); journal.writePending(m); journal.records.clear();
  const inventory = await f.witness.inventory(), replayed = [];
  const operator = createOperator({ journal, witness: f.witness, publicKey: pair.publicKey, pinnedFingerprint: pin,
    database: { replay: async (id, scope, passed, digest) => { replayed.push({ id, passed, digest }); return { remaining: 0, scopeHash: scope }; },
      finishRestore: async (_manifests, inventoryDigest) => ({ remaining: 0, inventoryDigest }) } });
  const checkpoint = await operator.restore(inventory.digest, 'e'.repeat(64));
  assert.equal(checkpoint.requestsReplayed, 1); assert.equal(checkpoint.remainingTargets, 0);
  assert.equal(replayed[0].passed.targets[0].hash, m.targets[0].hash);
  assert.equal(checkpoint.activation, 'external-release-required');
});

test('dual durability precedes destruction and uncertain SQL commit retries reconcile the same request', async () => {
  const events = [], journal = localJournal(events), m = manifest(); let current = m, attempts = 0;
  const f = cloud();
  const witness = { append: async bytes => { const r = verifyRecord(bytes, pair.publicKey, pin); events.push(`cloud-${r.state}`); return f.witness.append(bytes); } };
  const database = { getExecution: async () => current, execute: async () => {
    events.push('sql-execute'); attempts++; current = { ...m, completedAt }; if (attempts === 1) throw Error('synthetic lost SQL ack');
  } };
  const operator = createOperator({ database, journal, witness, publicKey: pair.publicKey, pinnedFingerprint: pin });
  await assert.rejects(operator.execute(m.requestId, m.scopeHash), /lost SQL ack/);
  assert.deepEqual(events, ['local-pending', 'cloud-pending', 'sql-execute']);
  assert.equal(journal.records.size, 1);
  const result = await operator.execute(m.requestId, m.scopeHash);
  assert.equal(result.state, 'active_store_erased'); assert.equal(attempts, 2);
  assert.deepEqual(events.slice(-5), ['local-pending', 'cloud-pending', 'sql-execute', 'local-completed', 'cloud-completed']);
  assert.equal((await f.witness.inventory()).requestCount, 1);
});

test('failed independent intent persistence dispatches no destructive SQL', async () => {
  const m = manifest(), events = [];
  const operator = createOperator({ database: { getExecution: async () => m, execute: async () => events.push('sql') },
    journal: localJournal(events), witness: { append: async () => { throw Error('independent store unavailable'); } }, publicKey: pair.publicKey, pinnedFingerprint: pin });
  await assert.rejects(operator.execute(m.requestId, m.scopeHash), /store unavailable/);
  assert.deepEqual(events, ['local-pending']);
});

test('unconfirmed completion, stale scope and residual targets never issue success or activation', async () => {
  const f = cloud(), m = manifest(), events = [];
  const operator = createOperator({ database: { getExecution: async () => m, execute: async () => {} },
    journal: localJournal(events), witness: f.witness, publicKey: pair.publicKey, pinnedFingerprint: pin });
  await assert.rejects(operator.execute(m.requestId, m.scopeHash), /completion_unconfirmed/);
  await assert.rejects(operator.execute(m.requestId, 'c'.repeat(64)), /scope_changed/);
  const inventory = await f.witness.inventory();
  const restore = createOperator({ database: { replay: async () => ({ remaining: 1, scopeHash: m.scopeHash }) }, witness: f.witness, publicKey: pair.publicKey, pinnedFingerprint: pin });
  await assert.rejects(restore.restore(inventory.digest, 'e'.repeat(64)), /residual_content/);
  await assert.rejects(restore.restore('f'.repeat(64), 'e'.repeat(64)), /inventory_changed/);
});

test('restricted database refuses admin, service role, role impersonation and nonmember logins', async () => {
  const good = { session_user: 'support_login', current_user: 'support_login', rolsuper: false, rolbypassrls: false, support: true, application: false };
  for (const change of [{ rolsuper: true }, { rolbypassrls: true }, { rolcreaterole: true }, { rolcreatedb: true }, { rolreplication: true }, { application: true }, { extra_memberships: true }, { support: false }, { restore: true }, { session_user: 'postgres' }]) {
    await assert.rejects(restrictedDatabase({ query: async () => ({ rows: [{ ...good, ...change }] }) }), /restricted_login_required/);
  }
  await assert.rejects(restrictedDatabase({ query: async () => ({ rows: [good] }) }, 'isolated-restore'), /restricted_login_required/);
  await restrictedDatabase({ query: async () => ({ rows: [{ ...good, support: false, restore: true }] }) }, 'isolated-restore');
  await assert.rejects(restrictedDatabase({ query: async () => ({ rows: [{ ...good, restore: true }] }) }, 'isolated-restore'), /restricted_login_required/);
  const calls = [], db = await restrictedDatabase({ query: async (sql, args) => { calls.push({ sql, args }); return { rows: [calls.length === 1 ? good : { result: {} }] }; } });
  const m = manifest(); await db.execute(m.requestId, m.scopeHash, 'd'.repeat(64));
  assert.equal(calls.at(-1).sql, 'select private.execute_google_sheets_erasure_v1($1,$2,$3) result');
  await assert.rejects(async () => db.prepare({ workspaceId: m.workspaceId, table: 'anything' }), /preparation_schema/);
  const rootId = crypto.randomUUID(), retention = { requestId: m.requestId, workspaceId: m.workspaceId, connectionId: m.connectionId, caseId: crypto.randomUUID(), rootIds: [rootId] };
  await db.prepareRetention(retention);
  assert.equal(calls.at(-1).args[4][0], rootId);
  await assert.rejects(async () => db.prepareRetention({ ...retention, rootIds: [rootId, rootId] }), /retention_schema/);
  await assert.rejects(async () => db.prepareRetention({ ...retention, table: 'kpis' }), /retention_schema/);
});

test('endpoint pins omit credentials and reject mutable connection query configuration', () => {
  assert.equal(endpointHash('postgres://first:secret@db.example.invalid:5432/postgres'), endpointHash('postgresql://second:different@db.example.invalid/postgres'));
  assert.notEqual(endpointHash('postgres://one@db.example.invalid/postgres'), endpointHash('postgres://one@restore.example.invalid/postgres'));
  for (const url of ['postgres://one@localhost/postgres', 'postgres://one@db.example.invalid/postgres?sslmode=disable']) assert.throws(() => endpointHash(url), /database_endpoint/);
});


test('successful multi-page inventory reads all witnessed requests before a restore checkpoint', async () => {
  const f = cloud();
  for (let i = 0; i < 3; i++) await f.witness.append(signManifest(manifest(), pair.privateKey));
  let pageReads = 0;
  f.setHook(u => {
    if (!u.pathname.endsWith('/o')) return;
    pageReads++;
    const objects = [...f.objects].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => ({ name, generation: '1', size: String(bytes.length) }));
    const offset = Number(u.searchParams.get('pageToken') || '0');
    return new Response(JSON.stringify({ items: objects.slice(offset, offset + 2), ...(offset + 2 < objects.length ? { nextPageToken: String(offset + 2) } : {}) }));
  });
  const result = await f.witness.inventory();
  assert.equal(result.requestCount, 3); assert.equal(pageReads, 4);
});


test('restore finalization uncertainty or a newly witnessed request prevents activation checkpoint', async () => {
  for (const mode of ['uncertain-finalization', 'new-witness']) {
    const f = cloud(), m = manifest(); await f.witness.append(signManifest(m, pair.privateKey));
    const inventory = await f.witness.inventory();
    const operator = createOperator({ witness: f.witness, publicKey: pair.publicKey, pinnedFingerprint: pin,
      database: { replay: async (_id, scopeHash) => ({ remaining: 0, scopeHash }), finishRestore: async (_manifests, inventoryDigest) => {
        if (mode === 'uncertain-finalization') throw Error('synthetic acknowledgement loss');
        await f.witness.append(signManifest(manifest(), pair.privateKey));
        return { remaining: 0, inventoryDigest };
      } } });
    await assert.rejects(operator.restore(inventory.digest, 'e'.repeat(64)), /acknowledgement loss|inventory_changed/);
  }
});

test('withdrawal resolves a pending scope conflict durably before reopening and restores without deletion', async () => {
  for (const published of [true, false]) {
    const f = cloud(), m = manifest(), local = localJournal([]), bytes = signManifest(m, pair.privateKey);
    if (published) await f.witness.append(bytes);
    let state = 'prepared', released = false, storedInventory;
    const database = {
      getRecovery: async () => ({ state, manifest: m, withdrawnAt: state === 'withdrawn' ? completedAt : null,
        withdrawalReason: state === 'withdrawn' ? 'approval_expired' : null, withdrawalInventoryDigest: storedInventory }),
      withdraw: async (_id, _scope, inventoryDigest) => { state = 'withdrawn'; storedInventory ??= inventoryDigest; },
      finishWithdrawal: async (id, scopeHash, receiptDigest) => {
        assert((await f.witness.inventory()).records.some(r => r.state === 'withdrawn' && r.digest === receiptDigest));
        released = true; return { requestId: id, scopeHash, state, released };
      },
      replay: async () => assert.fail('withdrawn request may not delete restored content'),
      finishRestore: async (manifests, inventoryDigest) => {
        assert.equal(manifests.length, 1); assert.equal(manifests[0].withdrawal.intentDigest, hash(bytes));
        return { remaining: 0, inventoryDigest };
      }
    };
    const operator = createOperator({ database, journal: local, witness: f.witness, publicKey: pair.publicKey, pinnedFingerprint: pin });
    const result = await operator.withdraw(m.requestId, m.scopeHash, 'approval_expired', (await f.witness.inventory()).digest);
    assert(released); assert.equal(result.state, 'withdrawn');
    // A delayed identical upload after DB terminalization is reconciled by the
    // signed expected intent digest; it cannot become a new restore deletion.
    if (!published) await f.witness.append(bytes);
    const restored = await operator.restore((await f.witness.inventory()).digest, 'e'.repeat(64));
    assert.equal(restored.requestsReplayed, 0); assert.equal(restored.withdrawalsReconciled, 1);
    const repeat = await operator.withdraw(m.requestId, m.scopeHash, 'approval_expired', (await f.witness.inventory()).digest);
    assert.equal(repeat.receiptDigest, result.receiptDigest);
  }
});

test('withdrawal witness failure leaves SQL barrier held and exact retry reconciles', async () => {
  const f = cloud(), m = manifest(), local = localJournal([]); let held = true, state = 'approved', stored;
  await f.witness.append(signManifest(m, pair.privateKey));
  const database = {
    getRecovery: async () => ({ state, manifest: m, withdrawnAt: completedAt, withdrawalReason: 'scope_changed', withdrawalInventoryDigest: stored }),
    withdraw: async (_id, _scope, value) => { state = 'withdrawn'; stored ??= value; },
    finishWithdrawal: async (id, scopeHash) => { held = false; return { requestId: id, scopeHash, state, released: true }; }
  };
  const operator = createOperator({ database, journal: local, witness: f.witness, publicKey: pair.publicKey, pinnedFingerprint: pin });
  const before = await f.witness.inventory();
  f.setHook(u => u.pathname.startsWith('/upload/') ? new Response('{}', { status: 503 }) : undefined);
  await assert.rejects(operator.withdraw(m.requestId, m.scopeHash, 'scope_changed', before.digest), /http_503/);
  assert.equal(state, 'withdrawn'); assert(held);
  f.setHook(null);
  await operator.withdraw(m.requestId, m.scopeHash, 'scope_changed', before.digest); assert.equal(held, false);
});

test('a completion receipt conflicts with withdrawal and blocks all restore inventory', async () => {
  const m = manifest(), pending = signManifest(m, pair.privateKey);
  const withdrawn = signManifest({ ...m, withdrawal: { at: completedAt, reason: 'scope_changed', intentDigest: hash(pending), inventoryDigest: 'd'.repeat(64) } }, pair.privateKey);
  const completed = signManifest({ ...m, completedAt }, pair.privateKey);
  assert.throws(() => auditInventory([{ name: `${m.requestId}.pending.json`, bytes: pending },
    { name: `${m.requestId}.withdrawn.json`, bytes: withdrawn }, { name: `${m.requestId}.completed.json`, bytes: completed }], pair.publicKey, pin), /withdrawal_conflict/);
});

test('daily expiry is bounded and alerts on manual review, failure, pagination and deferred backlog', async () => {
  const f = cloud(), local = localJournal([]), rows = Array.from({ length: 12 }, () => ({ workspaceId: crypto.randomUUID(), connectionId: crypto.randomUUID(), rootId: crypto.randomUUID(), automaticExpiryAuthorized: true }));
  rows.push({ ...rows[0], rootId: crypto.randomUUID(), automaticExpiryAuthorized: false });
  const manifests = new Map(); let prepared = 0;
  const database = {
    dueRetention: async () => rows, dueDisconnected: async () => [],
    prepareRetention: async input => {
      prepared++; if (prepared === 1) throw Error('sheets_erasure_review_required');
      const m = manifest(); Object.assign(m, { requestId: input.requestId, workspaceId: input.workspaceId, connectionId: input.connectionId });
      manifests.set(m.requestId, m); return { requestId: m.requestId, scopeHash: m.scopeHash, state: 'approved' };
    },
    getExecution: async id => manifests.get(id),
    execute: async id => { manifests.set(id, { ...manifests.get(id), completedAt }); }
  };
  const operator = createOperator({ database, journal: local, witness: f.witness, publicKey: pair.publicKey, pinnedFingerprint: pin });
  const result = await operator.dailyExpiry();
  assert.equal(prepared, 10); assert.equal(result.processed, 9); assert.equal(result.deferred, 2);
  assert.equal(result.held, 2); assert.equal(result.attentionRequired, true);
  await assert.rejects(operator.dailyExpiry(11), /daily_limit/);
});

test('independent genesis pins the dedicated service account and refuses unbound identities', () => {
  const f = cloud();
  for (const serviceAccount of [undefined, '', 'owner@example.com', 'other@project.invalid']) {
    assert.throws(() => createGcsWitness({ ...f.config, serviceAccount }, { token: async () => 'never-requested' }), /configuration/);
  }
  assert.throws(() => createGcsWitness({ ...f.config, serviceAccount: 'other-witness@synthetic-project.iam.gserviceaccount.com' }, { token: async () => 'never-requested' }), /configuration/);
});

test('identified full-file receipts are signed and restore requires exact retained Storage evidence', async () => {
  const f = cloud(), m = manifest(), fileId = crypto.randomUUID(), rowHash = 'a'.repeat(64);
  m.targets = [{ table: 'file_uploads', id: fileId, hash: rowHash }]; m.counts = { file_uploads: 1 };
  m.storageReceipts = [{ fileId, bucket: 'workspace-files', path: `${m.workspaceId}/${fileId}/copy.csv`, purgedAt: completedAt, rowHash }];
  await f.witness.append(signManifest(m, pair.privateKey));
  const inventory = await f.witness.inventory(), endpoint = 'e'.repeat(64); let replays = 0;
  const database = { replay: async () => { replays++; return { remaining: 0, scopeHash: m.scopeHash }; },
    finishRestore: async (_manifests, inventoryDigest) => ({ remaining: 0, inventoryDigest }) };
  const operator = createOperator({ database, witness: f.witness, publicKey: pair.publicKey, pinnedFingerprint: pin, now: () => new Date(completedAt) });
  await assert.rejects(operator.restore(inventory.digest, endpoint), /storage_checkpoint_required/); assert.equal(replays, 0);
  const checkpoint = { version: 1, inventoryDigest: inventory.digest, targetEndpointHash: endpoint, checkedAt: completedAt,
    objectRestoreStatus: 'not-restored', objects: normalizeManifest(m).storageReceipts,
    evidence: [{ kind: 'provider-object-absence', sha256: 'b'.repeat(64), size: 100 }, { kind: 'storage-restore-inventory', sha256: 'c'.repeat(64), size: 100 }] };
  for (const changed of [{ ...checkpoint, objects: [] }, { ...checkpoint, objectRestoreStatus: 'restored' },
    { ...checkpoint, inventoryDigest: 'd'.repeat(64) }, { ...checkpoint, checkedAt: '2020-01-01T00:00:00.000Z' }, { ...checkpoint, evidence: [] }]) {
    await assert.rejects(operator.restore(inventory.digest, endpoint, changed), /storage_checkpoint_required/);
  }
  assert.equal(replays, 0);
  const proof = await operator.restore(inventory.digest, endpoint, checkpoint);
  assert.equal(proof.storageProof.objects, 1); assert.equal(proof.activation, 'external-release-required');
  assert.throws(() => signManifest({ ...m, storageReceipts: [{ ...m.storageReceipts[0], path: `other-workspace/${fileId}` }] }, pair.privateKey), /storage_receipt/);
  assert.throws(() => signManifest({ ...m, storageReceipts: [{ ...m.storageReceipts[0], rowHash: 'b'.repeat(64) }] }, pair.privateKey), /storage_receipt/);
});

test('manual Storage checkpoint evidence must be private retained files with matching hashes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sheets-storage-evidence-'));
  try {
    const provider = path.join(directory, 'provider.json'), restore = path.join(directory, 'restore.json'), config = path.join(directory, 'checkpoint.json');
    const first = Buffer.from('{"synthetic":"current object absence"}'), second = Buffer.from('{"synthetic":"database only restore inventory"}');
    fs.writeFileSync(provider, first, { mode: 0o600 }); fs.writeFileSync(restore, second, { mode: 0o600 });
    fs.writeFileSync(config, JSON.stringify({ evidence: [{ kind: 'provider-object-absence', path: provider, sha256: hash(first) },
      { kind: 'storage-restore-inventory', path: restore, sha256: hash(second) }] }), { mode: 0o600 });
    const result = readStorageCheckpoint(config); assert.equal(result.evidence[0].size, first.length);
    assert.equal(Object.hasOwn(result.evidence[0], 'path'), false);
    fs.writeFileSync(provider, 'changed'); assert.throws(() => readStorageCheckpoint(config), /storage_evidence_changed/);
    fs.writeFileSync(provider, first); fs.chmodSync(provider, 0o644); assert.throws(() => readStorageCheckpoint(config), /private_file_required/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('same-request status recovers a lost preparation acknowledgement without exposing target metadata', async () => {
  const m = manifest(), calls = [];
  const db = await restrictedDatabase({ query: async (sql, params) => {
    calls.push({ sql, params });
    if (calls.length === 1) return { rows: [{ session_user: 'support_login', current_user: 'support_login', support: true }] };
    return { rows: [{ result: { manifest: m, state: 'prepared', withdrawnAt: null, withdrawalReason: null } }] };
  } });
  const result = await db.inspectRecovery(m.requestId);
  assert.equal(result.scopeHash, m.scopeHash); assert.equal(result.state, 'prepared');
  assert.deepEqual(calls.at(-1).params, [m.requestId, null]);
  assert.equal(Object.hasOwn(result, 'targets'), false); assert.equal(Object.hasOwn(result, 'storageReceipts'), false);
});

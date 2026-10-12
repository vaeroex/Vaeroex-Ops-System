/* eslint-disable @typescript-eslint/no-require-imports -- Private support tooling; no application import. */
'use strict';
const crypto = require('node:crypto');
const { verifyRecord, pendingManifest, publicKeyFingerprint } = require('./journal.cjs');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HEX = /^[a-f0-9]{64}$/;
const MAX_BYTES = 8 * 1024 * 1024;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Error(`sheets_witness_${code}`); };
const REQUIRED = ['storage.buckets.get', 'storage.objects.create', 'storage.objects.get', 'storage.objects.list'];
const FORBIDDEN = ['storage.objects.delete', 'storage.objects.update', 'storage.objects.restore',
  'storage.objects.move', 'storage.objects.setRetention', 'storage.buckets.update',
  'storage.buckets.delete', 'storage.buckets.setIamPolicy'];

function genesisBytes({ datasetId, bucket, pinnedFingerprint, primaryEndpointHash, serviceAccount }) {
  if (typeof serviceAccount !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(serviceAccount) || !UUID.test(datasetId) || !/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(bucket) || (!HEX.test(pinnedFingerprint) || !HEX.test(primaryEndpointHash))) fail('configuration');
  return Buffer.from(JSON.stringify({ version: 1, purpose: 'vaeroex-google-sheets-erasure-witness',
    datasetId, bucket, pinnedFingerprint, primaryEndpointHash, serviceAccount }) + '\n');
}

function auditInventory(items, publicKey, pin) {
  const byName = new Map();
  for (const item of items) {
    const verified = verifyRecord(item.bytes, publicKey, pin);
    if (verified.manifest.version !== 2) fail('exact_hash_manifest_required');
    const name = `${verified.manifest.requestId}.${verified.state}.json`;
    if (item.name !== name || byName.has(name)) fail('object_identity');
    byName.set(name, { ...verified, bytes: Buffer.from(item.bytes) });
  }
  for (const item of byName.values()) {
    if (item.state !== 'completed') continue;
    const pending = byName.get(`${item.manifest.requestId}.pending.json`);
    if (!pending || JSON.stringify({ ...item.manifest, completedAt: null }) !== JSON.stringify(pending.manifest)) fail('receipt_without_intent');
  }
  for (const item of byName.values()) {
    if (item.state !== 'withdrawn') continue;
    const id = item.manifest.requestId, pending = byName.get(`${id}.pending.json`);
    if (byName.has(`${id}.completed.json`) || (pending && (pending.digest !== item.manifest.withdrawal.intentDigest ||
        JSON.stringify(pending.manifest) !== JSON.stringify(pendingManifest(item.manifest))))) fail('withdrawal_conflict');
  }
  const records = [...byName.values()].sort((a, b) => a.manifest.requestId.localeCompare(b.manifest.requestId) || a.state.localeCompare(b.state));
  return { records, digest: digest(Buffer.from(JSON.stringify(records.map(r => ({ requestId: r.manifest.requestId, state: r.state, digest: r.digest }))))),
    requestCount: records.filter(r => r.state === 'pending').length };
}

/** GCS is independent of application DB/local journal backups. No delete, update,
 * bucket creation, IAM change or retention-lock operation exists in this adapter.
 * Provisioning/backup-expiry custody remains a separately reviewed operation. */
function createGcsWitness(options, { token, fetch: request = globalThis.fetch } = {}) {
  const { bucket, datasetId, genesisDigest, publicKey, pinnedFingerprint, minimumRetentionSeconds = 0, primaryEndpointHash, serviceAccount } = options;
  const genesis = genesisBytes({ datasetId, bucket, pinnedFingerprint, primaryEndpointHash, serviceAccount });
  if (genesisDigest !== digest(genesis) || publicKeyFingerprint(publicKey) !== pinnedFingerprint ||
      !Number.isSafeInteger(minimumRetentionSeconds) || minimumRetentionSeconds < 0 || typeof token !== 'function') fail('configuration');
  const prefix = `google-sheets-erasure/${datasetId}/`;
  const root = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}`;
  async function http(url, init = {}, accepted = [200]) {
    const accessToken = await token();
    if (typeof accessToken !== 'string' || accessToken.length < 20 || /\s/.test(accessToken)) fail('authentication');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await request(url, { ...init, redirect: 'error', signal: controller.signal,
        headers: { authorization: `Bearer ${accessToken}`, ...init.headers } });
      if (!accepted.includes(response.status)) { await response.body?.cancel(); fail(`http_${response.status}`); }
      const chunks = []; let size = 0;
      if (response.body) for await (const chunk of response.body) {
        size += chunk.length; if (size > MAX_BYTES) { controller.abort(); fail('size'); } chunks.push(Buffer.from(chunk));
      }
      return { status: response.status, bytes: Buffer.concat(chunks) };
    } catch (error) {
      if (error instanceof Error && /^sheets_witness_/.test(error.message)) throw error;
      fail(controller.signal.aborted ? 'timeout' : 'transport');
    } finally { clearTimeout(timer); }
  }
  const json = async url => { const result = await http(url); try { return JSON.parse(result.bytes); } catch { fail('json'); } };
  const objectUrl = name => `${root}/o/${encodeURIComponent(prefix + name)}`;
  async function verifyConfiguration() {
    const metadata = await json(`${root}?fields=name,versioning,lifecycle,retentionPolicy,iamConfiguration`);
    if (metadata.name !== bucket || metadata.versioning?.enabled !== true ||
        (metadata.lifecycle?.rule?.length ?? 0) !== 0 ||
        metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true ||
        metadata.iamConfiguration?.publicAccessPrevention !== 'enforced') fail('bucket_policy');
    const retained = metadata.retentionPolicy?.retentionPeriod === undefined ? 0 : Number(metadata.retentionPolicy.retentionPeriod);
    if (!Number.isSafeInteger(retained) || retained < minimumRetentionSeconds) fail('retention_policy');
    const query = new URLSearchParams();
    for (const permission of [...REQUIRED, ...FORBIDDEN]) query.append('permissions', permission);
    const permissions = await json(`${root}/iam/testPermissions?${query}`);
    const granted = new Set(permissions.permissions ?? []);
    if (REQUIRED.some(p => !granted.has(p)) || FORBIDDEN.some(p => granted.has(p))) fail('operator_permissions');
    const found = await http(`${objectUrl('genesis.json')}?alt=media`);
    if (!found.bytes.equals(genesis) || digest(found.bytes) !== genesisDigest) fail('genesis');
    return { genesisDigest, retainedSeconds: retained, locked: metadata.retentionPolicy?.isLocked === true };
  }
  async function append(bytes) {
    const record = verifyRecord(bytes, publicKey, pinnedFingerprint);
    if (record.manifest.version !== 2) fail('exact_hash_manifest_required');
    await verifyConfiguration();
    const name = `${record.manifest.requestId}.${record.state}.json`;
    const query = new URLSearchParams({ uploadType: 'media', ifGenerationMatch: '0', name: prefix + name });
    // A duplicate is reconciled by exact readback, never overwritten.
    await http(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?${query}`,
      { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: bytes }, [200, 201, 412]);
    const saved = await http(`${objectUrl(name)}?alt=media`);
    if (!saved.bytes.equals(Buffer.from(bytes)) || digest(saved.bytes) !== record.digest) fail('conflict');
    return { digest: record.digest, state: record.state };
  }
  async function listObjects() {
    const objects = []; const tokens = new Set(); let pageToken;
    do {
      const query = new URLSearchParams({ prefix, maxResults: '1000', fields: 'nextPageToken,items(name,generation,size)' });
      if (pageToken) query.set('pageToken', pageToken);
      const page = await json(`${root}/o?${query}`);
      if (page.items !== undefined && !Array.isArray(page.items)) fail('inventory');
      objects.push(...(page.items ?? []));
      if (objects.length > 100001) fail('inventory_size');
      pageToken = page.nextPageToken;
      if (pageToken !== undefined && (typeof pageToken !== 'string' || !pageToken || tokens.has(pageToken))) fail('pagination');
      tokens.add(pageToken);
    } while (pageToken);
    const names = new Set();
    for (const object of objects) {
      if (typeof object.name !== 'string' || !object.name.startsWith(prefix) || names.has(object.name) ||
          !/^[0-9]+$/.test(object.generation) || !/^[0-9]+$/.test(object.size) || Number(object.size) > MAX_BYTES) fail('inventory');
      names.add(object.name);
      const name = object.name.slice(prefix.length);
      if (name !== 'genesis.json' && !/^[a-f0-9-]{36}\.(pending|completed|withdrawn)\.json$/.test(name)) fail('unexpected_object');
    }
    if (!names.has(prefix + 'genesis.json')) fail('genesis_missing');
    return objects.sort((a, b) => a.name.localeCompare(b.name));
  }
  async function inventory() {
    await verifyConfiguration();
    const before = await listObjects(), items = [];
    if (before.reduce((total, object) => total + Number(object.size), 0) > 128 * 1024 * 1024) fail('inventory_size');
    for (const object of before) {
      const name = object.name.slice(prefix.length);
      if (name === 'genesis.json') continue;
      const result = await http(`${objectUrl(name)}?alt=media&generation=${encodeURIComponent(object.generation)}`);
      if (result.bytes.length !== Number(object.size)) fail('size');
      items.push({ name, bytes: result.bytes });
    }
    const after = await listObjects();
    if (JSON.stringify(before) !== JSON.stringify(after)) fail('inventory_changed');
    return auditInventory(items, publicKey, pinnedFingerprint);
  }
  return Object.freeze({ append, inventory, verifyConfiguration });
}
module.exports = { createGcsWitness, auditInventory, genesisBytes };

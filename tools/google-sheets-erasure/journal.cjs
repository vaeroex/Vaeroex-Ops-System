/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS support library. */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// No CLI, environment overrides, SQL, or key generation at import time. The caller
// must provision storage outside application backups and pin the public key elsewhere.
const TABLES = Object.freeze([
  'google_sheets_connections', 'google_sheets_oauth_states', 'google_sheets_credentials',
  'google_sheets_mapping_approvals', 'google_sheets_sync_runs', 'google_sheets_source_rows',
  'google_sheets_source_versions', 'google_sheets_fact_links', 'kpis', 'ai_agent_runs',
  'reports', 'kpi_alert_events', 'business_memory_chunks', 'record_shares', 'notifications',
  'operational_assignments', 'business_decisions', 'vaeroex_recommendation_outcomes',
  'scheduled_report_runs', 'kpi_settings', 'kpi_alert_rules', 'audit_logs',
  'security_audit_events', 'ai_usage', 'business_health_snapshots', 'vsi_exchanges',
  'vsi_conversations', 'business_notes', 'file_uploads', 'file_imports', 'operational_metrics',
  'intelligence_card_lifecycle', 'intelligence_card_lifecycle_events', 'file_upload_analysis', 'vsi_request_content', 'file_processing_jobs', 'google_sheets_retention_boundary'
]);
const allowedTables = new Set(TABLES);
const KEY_FILE = 'ed25519-private.pem';
const LOCK = '.journal-lock';
const DOMAIN = 'vaeroex-google-sheets-erasure-journal:v1\n';
const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const MAX_TARGETS = 50_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HEX = /^[a-f0-9]{64}$/;
const MANIFEST_FIELDS = [
  'version', 'requestId', 'workspaceId', 'connectionId', 'scopeHash',
  'targets', 'counts', 'completedAt'
];
const nodeAdapter = Object.freeze({
  fs, cwd: () => process.cwd(), tmpdir: () => os.tmpdir(), uid: () => process.getuid(),
  hostname: () => os.hostname(), pid: () => process.pid,
  isAlive: pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } }
});

function deny(code) {
  throw new Error(`sheets_journal_${code}`);
}

function objectKeys(value) {
  if (!value || typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) deny('schema');
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor)) deny('schema');
  }
  return keys;
}

function exactKeys(value, expected) {
  const actual = objectKeys(value);
  if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) deny('schema');
}

function strictArray(value) {
  if (!Array.isArray(value) || value.length > MAX_TARGETS ||
      Reflect.ownKeys(value).length !== value.length + 1) deny('schema');
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) deny('schema');
  }
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) deny('schema');
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** Pure, strict schema normalization. v2 uses stable row IDs plus content hashes;
 * credentials use connection_id. Legacy v1 fact links used unique kpi_id. Scope/ownership comes from
 * the parent's reviewed SQL inventory; a signature is not authorization evidence. */
function normalizeManifest(input) {
  const supplied = objectKeys(input), hasWithdrawal = supplied.includes('withdrawal'), hasStorage = supplied.includes('storageReceipts');
  exactKeys(input, [...MANIFEST_FIELDS, ...(hasStorage ? ['storageReceipts'] : []), ...(hasWithdrawal ? ['withdrawal'] : [])]);
  if (![1, 2].includes(input.version)) deny('schema');
  for (const key of ['requestId', 'workspaceId', 'connectionId']) uuid(input[key]);
  if (typeof input.scopeHash !== 'string' || !HEX.test(input.scopeHash)) deny('schema');
  if (input.completedAt !== null && (typeof input.completedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.completedAt) ||
      !Number.isFinite(Date.parse(input.completedAt)) ||
      new Date(input.completedAt).toISOString() !== input.completedAt)) deny('schema');
  let withdrawal;
  if (hasWithdrawal) {
    if (input.version !== 2 || input.completedAt !== null) deny('state');
    exactKeys(input.withdrawal, ['at', 'reason', 'intentDigest', 'inventoryDigest']);
    const w = input.withdrawal;
    if (typeof w.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(w.at) ||
        !Number.isFinite(Date.parse(w.at)) || new Date(w.at).toISOString() !== w.at ||
        !['scope_changed', 'approval_expired', 'owner_withdrawn'].includes(w.reason) ||
        !HEX.test(w.intentDigest) || !HEX.test(w.inventoryDigest)) deny('withdrawal');
    withdrawal = { at: w.at, reason: w.reason, intentDigest: w.intentDigest, inventoryDigest: w.inventoryDigest };
  }
  strictArray(input.targets);
  const seen = new Set();
  const totals = new Map();
  const targets = input.targets.map(target => {
    exactKeys(target, input.version === 2 ? ['table', 'id', 'hash'] : ['table', 'id']);
    if (input.version === 2 && (typeof target.hash !== 'string' || !HEX.test(target.hash))) deny('hash');
    if (!allowedTables.has(target.table)) deny('table');
    uuid(target.id);
    if (['google_sheets_connections', 'google_sheets_credentials'].includes(target.table) &&
        target.id !== input.connectionId) deny('connection');
    const key = `${target.table}:${target.id}`;
    if (seen.has(key)) deny('duplicate_target');
    seen.add(key);
    totals.set(target.table, (totals.get(target.table) || 0) + 1);
    return { table: target.table, id: target.id, ...(input.version === 2 ? { hash: target.hash } : {}) };
  }).sort((a, b) => a.table < b.table ? -1 : a.table > b.table ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const countKeys = objectKeys(input.counts).sort();
  const counts = {};
  for (const table of countKeys) {
    if (!allowedTables.has(table)) deny('table');
    if (!Number.isSafeInteger(input.counts[table]) || Object.is(input.counts[table], -0) ||
        input.counts[table] !== (totals.get(table) || 0)) deny('counts');
    counts[table] = input.counts[table];
  }
  if ([...totals.keys()].some(table => !countKeys.includes(table))) deny('counts');
  let storageReceipts;
  if (hasStorage) {
    if (input.version !== 2) deny('storage_receipt');
    strictArray(input.storageReceipts); const files = new Set();
    storageReceipts = input.storageReceipts.map(receipt => {
      exactKeys(receipt, ['fileId', 'bucket', 'path', 'purgedAt', 'rowHash']); uuid(receipt.fileId);
      if (receipt.bucket !== 'workspace-files' || typeof receipt.path !== 'string' || receipt.path.length > 1024 ||
          !receipt.path.startsWith(`${input.workspaceId}/`) || /[\x00-\x1f\\]/.test(receipt.path) || receipt.path.split('/').some(part => !part || part === '.' || part === '..') ||
          typeof receipt.purgedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.purgedAt) ||
          !Number.isFinite(Date.parse(receipt.purgedAt)) || new Date(receipt.purgedAt).toISOString() !== receipt.purgedAt ||
          files.has(receipt.fileId) || !targets.some(t => t.table === 'file_uploads' && t.id === receipt.fileId && t.hash === receipt.rowHash)) deny('storage_receipt');
      files.add(receipt.fileId);
      return { fileId: receipt.fileId, bucket: receipt.bucket, path: receipt.path, purgedAt: receipt.purgedAt, rowHash: receipt.rowHash };
    }).sort((a, b) => a.fileId.localeCompare(b.fileId));
  }
  return {
    version: input.version, requestId: input.requestId, workspaceId: input.workspaceId,
    connectionId: input.connectionId, scopeHash: input.scopeHash,
    targets, counts, completedAt: input.completedAt, ...(storageReceipts ? { storageReceipts } : {}), ...(withdrawal ? { withdrawal } : {})
  };
}

function keyObject(input, type) {
  let key;
  try {
    key = input instanceof crypto.KeyObject ? input :
      type === 'private' ? crypto.createPrivateKey(input) : crypto.createPublicKey(input);
  } catch { deny('key'); }
  if (key.type !== type || key.asymmetricKeyType !== 'ed25519') deny('key');
  return key;
}

/** SHA-256 of SPKI DER, lowercase hex. Store this pin independently of the journal. */
function publicKeyFingerprint(publicKey) {
  return digest(keyObject(publicKey, 'public').export({ type: 'spki', format: 'der' }));
}

function trustedKey(publicKey, pinnedFingerprint) {
  if (typeof pinnedFingerprint !== 'string' || !HEX.test(pinnedFingerprint)) deny('pin_required');
  const key = keyObject(publicKey, 'public');
  if (!crypto.timingSafeEqual(Buffer.from(publicKeyFingerprint(key), 'hex'),
    Buffer.from(pinnedFingerprint, 'hex'))) deny('pin_mismatch');
  return key;
}

function signedBytes(manifest) {
  return Buffer.from(DOMAIN + JSON.stringify(manifest), 'utf8');
}

function envelopeBytes(manifest, signature) {
  return Buffer.from(JSON.stringify({ manifest, signature }) + '\n', 'utf8');
}

function signManifest(input, privateKey) {
  const manifest = normalizeManifest(input);
  const signature = crypto.sign(null, signedBytes(manifest), keyObject(privateKey, 'private')).toString('base64');
  const bytes = envelopeBytes(manifest, signature);
  if (bytes.length > MAX_RECORD_BYTES) deny('size');
  return bytes;
}

/** Reject noncanonical JSON (including duplicate keys), extra fields and embedded keys. */
function verifyRecord(input, publicKey, pinnedFingerprint) {
  const key = trustedKey(publicKey, pinnedFingerprint);
  if (!Buffer.isBuffer(input) && typeof input !== 'string') deny('schema');
  const bytes = Buffer.from(input);
  if (bytes.length > MAX_RECORD_BYTES) deny('size');
  let envelope;
  try { envelope = JSON.parse(bytes.toString('utf8')); } catch { deny('json'); }
  exactKeys(envelope, ['manifest', 'signature']);
  const manifest = normalizeManifest(envelope.manifest);
  if (typeof envelope.signature !== 'string') deny('signature');
  const signature = Buffer.from(envelope.signature, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== envelope.signature) deny('signature');
  if (!bytes.equals(envelopeBytes(manifest, envelope.signature))) deny('noncanonical');
  if (!crypto.verify(null, signedBytes(manifest), key, signature)) deny('signature');
  return { state: manifest.withdrawal ? 'withdrawn' : manifest.completedAt === null ? 'pending' : 'completed', manifest, digest: digest(bytes) };
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function maybeStat(io, filename) {
  try { return io.lstatSync(filename); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function sameInode(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}

function privateMode(stat, uid, directory = false) {
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile()) ||
      stat.uid !== uid || (stat.mode & 0o7777) !== (directory ? 0o700 : 0o600) ||
      (!directory && stat.nlink !== 1)) deny('permissions');
}

function validateDirectory(directory, adapter) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) ||
      path.resolve(directory) !== directory) deny('directory_required');
  const excluded = ['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', '/dev/shm',
    path.resolve(adapter.tmpdir()), path.resolve(adapter.cwd()), path.resolve(__dirname, '../..')];
  if (excluded.some(root => isWithin(directory, root))) deny('directory_location');
  const io = adapter.fs;
  const uid = adapter.uid();
  if (!Number.isInteger(uid) || io.constants.O_NOFOLLOW === undefined ||
      io.constants.O_DIRECTORY === undefined) deny('platform');
  let current = directory;
  let leaf;
  while (true) {
    const stat = io.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) deny('symlink');
    if (current === directory) {
      privateMode(stat, uid, true);
      leaf = stat;
    } else if ((stat.mode & 0o022) !== 0 || ![0, uid].includes(stat.uid)) deny('parent_permissions');
    if (maybeStat(io, path.join(current, '.git'))) deny('repository');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (io.realpathSync(directory) !== directory) deny('symlink');
  return leaf;
}

function storage(directory, adapter) {
  const io = adapter.fs;
  const uid = adapter.uid();
  const identity = validateDirectory(directory, adapter);
  const flags = io.constants;
  function checkDirectory() {
    if (!sameInode(identity, validateDirectory(directory, adapter))) deny('directory_changed');
  }
  function syncDirectory() {
    checkDirectory();
    const fd = io.openSync(directory, flags.O_RDONLY | flags.O_DIRECTORY | flags.O_NOFOLLOW);
    try {
      if (!sameInode(identity, io.fstatSync(fd))) deny('directory_changed');
      io.fsyncSync(fd);
    } finally { io.closeSync(fd); }
  }
  function read(name, maxBytes = MAX_RECORD_BYTES, sync = false) {
    checkDirectory();
    const filename = path.join(directory, name);
    const before = io.lstatSync(filename);
    privateMode(before, uid);
    const fd = io.openSync(filename, flags.O_RDONLY | flags.O_NOFOLLOW | flags.O_NONBLOCK);
    try {
      const stat = io.fstatSync(fd);
      privateMode(stat, uid);
      if (!sameInode(before, stat)) deny('file_changed');
      if (stat.size > maxBytes) deny('size');
      const bytes = io.readFileSync(fd);
      const after = io.fstatSync(fd);
      privateMode(after, uid);
      if (bytes.length > maxBytes || bytes.length !== stat.size || after.size !== stat.size ||
          after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs ||
          !sameInode(after, io.lstatSync(filename))) deny('file_changed');
      if (sync) io.fsyncSync(fd);
      return bytes;
    } finally { io.closeSync(fd); }
  }
  function entries(locked = false) {
    checkDirectory();
    const names = io.readdirSync(directory).sort();
    for (const name of names) {
      if (name === LOCK && locked) continue;
      if (name === LOCK || name.startsWith('.stage-')) deny('recovery_required');
      if (name !== KEY_FILE && !/^[a-f0-9-]{36}\.(pending|completed|withdrawn)\.json$/.test(name)) deny('unexpected_file');
      privateMode(io.lstatSync(path.join(directory, name)), uid);
    }
    return names.filter(name => name !== LOCK);
  }
  function withLock(action) {
    checkDirectory();
    const lockPath = path.join(directory, LOCK);
    try { io.mkdirSync(lockPath, { mode: 0o700 }); } catch (error) {
      if (error.code === 'EEXIST') deny('recovery_required');
      throw error;
    }
    const transaction = { dirty: false };
    let succeeded = false;
    try {
      privateMode(io.lstatSync(lockPath), uid, true);
      const ownerPath = path.join(lockPath, 'owner.json');
      const fd = io.openSync(ownerPath, flags.O_WRONLY | flags.O_CREAT | flags.O_EXCL | flags.O_NOFOLLOW, 0o600);
      try { io.writeFileSync(fd, Buffer.from(JSON.stringify({ version: 1, hostname: adapter.hostname?.() ?? os.hostname(),
        pid: adapter.pid?.() ?? process.pid, createdAt: new Date().toISOString() }) + '\n')); io.fsyncSync(fd); } finally { io.closeSync(fd); }
      const ownerDirectory = io.openSync(lockPath, flags.O_RDONLY | flags.O_DIRECTORY | flags.O_NOFOLLOW);
      try { io.fsyncSync(ownerDirectory); } finally { io.closeSync(ownerDirectory); }
      syncDirectory();
      const result = action(transaction);
      succeeded = true;
      return result;
    } finally {
      // A failed write keeps its lock and staging evidence for explicit recovery.
      // Never automatically break a possibly live lock or label an uncertain write complete.
      if (succeeded || !transaction.dirty) {
        checkDirectory();
        if (maybeStat(io, path.join(lockPath, 'owner.json'))) io.unlinkSync(path.join(lockPath, 'owner.json'));
        io.rmdirSync(lockPath);
        syncDirectory();
      }
    }
  }
  function writeOnce(name, bytes, transaction) {
    checkDirectory();
    const destination = path.join(directory, name);
    if (maybeStat(io, destination)) {
      const existing = read(name, MAX_RECORD_BYTES, true);
      if (!existing.equals(bytes) || digest(existing) !== digest(bytes)) deny('conflict');
      syncDirectory();
      return { digest: digest(existing), replayed: true };
    }
    const temporary = path.join(directory, `.stage-${crypto.randomUUID()}`);
    transaction.dirty = true;
    const fd = io.openSync(temporary, flags.O_WRONLY | flags.O_CREAT | flags.O_EXCL | flags.O_NOFOLLOW, 0o600);
    let written;
    try {
      privateMode(io.fstatSync(fd), uid);
      io.writeFileSync(fd, bytes);
      io.fsyncSync(fd);
      written = io.fstatSync(fd);
      privateMode(written, uid);
      if (written.size !== bytes.length) deny('write_incomplete');
    } finally { io.closeSync(fd); }
    checkDirectory();
    if (!sameInode(written, io.lstatSync(temporary))) deny('file_changed');
    if (maybeStat(io, destination)) deny('conflict');
    // All journal writers hold the exclusive directory lock; rename follows a
    // second no-overwrite check in owner-only storage, then parent fsync.
    io.renameSync(temporary, destination);
    syncDirectory();
    if (!read(name).equals(bytes)) deny('write_incomplete');
    return { digest: digest(bytes), replayed: false };
  }
  return { read, entries, withLock, writeOnce };
}

/** Explicit initialization only. The private directory must already exist.
 * The optional adapter is dependency injection for synthetic tests, never a CLI flag. */
function generateJournalKey(options, adapter = nodeAdapter) {
  exactKeys(options, ['directory']);
  const store = storage(options.directory, adapter);
  return store.withLock(transaction => {
    const files = store.entries(true);
    if (files.includes(KEY_FILE)) deny('key_exists');
    if (files.length) deny('not_empty');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pem = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }));
    try { store.writeOnce(KEY_FILE, pem, transaction); } finally { pem.fill(0); }
    return {
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
      pinnedFingerprint: publicKeyFingerprint(publicKey)
    };
  });
}

function pendingManifest(manifest) {
  const pending = { ...manifest, completedAt: null };
  delete pending.withdrawal;
  return pending;
}
function pendingIdentity(manifest) { return JSON.stringify(pendingManifest(manifest)); }

/** Synchronous durability boundary for the parent's private support entry point.
 * writePending must return before SQL. writeCompletedReceipt must be called only
 * after the parent has independently confirmed the SQL commit and exact scope.
 * Restore needs only externally supplied publicKey/pinnedFingerprint, not the key file.
 * listRecords returns ALL intents AND receipts; pending alone proves no completion. */
function openJournal(options, adapter = nodeAdapter) {
  exactKeys(options, ['directory', 'publicKey', 'pinnedFingerprint']);
  const publicKey = trustedKey(options.publicKey, options.pinnedFingerprint);
  const pin = options.pinnedFingerprint;
  const store = storage(options.directory, adapter);
  function records(locked = false) {
    const names = store.entries(locked);
    const result = names.filter(name => name !== KEY_FILE).map(name => {
      const record = verifyRecord(store.read(name), publicKey, pin);
      if (name !== `${record.manifest.requestId}.${record.state}.json`) deny('record_name');
      return record;
    });
    if (JSON.stringify(names) !== JSON.stringify(store.entries(locked))) deny('journal_changed');
    const pending = new Map(result.filter(record => record.state === 'pending')
      .map(record => [record.manifest.requestId, record]));
    for (const record of result.filter(item => item.state === 'completed')) {
      const intent = pending.get(record.manifest.requestId);
      if (!intent || pendingIdentity(intent.manifest) !== pendingIdentity(record.manifest)) deny('receipt_without_matching_intent');
    }
    for (const record of result.filter(item => item.state === 'withdrawn')) {
      const intent = pending.get(record.manifest.requestId);
      if (!intent || intent.digest !== record.manifest.withdrawal.intentDigest ||
          pendingIdentity(intent.manifest) !== pendingIdentity(record.manifest) ||
          result.some(item => item.state === 'completed' && item.manifest.requestId === record.manifest.requestId)) deny('withdrawal_conflict');
    }
    return result;
  }
  function append(input, expectedState) {
    const manifest = normalizeManifest(input);
    const state = manifest.withdrawal ? 'withdrawn' : manifest.completedAt === null ? 'pending' : 'completed';
    if (state !== expectedState) deny('state');
    return store.withLock(transaction => {
      const existing = records(true);
      if (state !== 'pending') {
        const intent = existing.find(record => record.state === 'pending' && record.manifest.requestId === manifest.requestId);
        if (!intent || pendingIdentity(intent.manifest) !== pendingIdentity(manifest)) deny('receipt_without_matching_intent');
        if (state === 'withdrawn' && (intent.digest !== manifest.withdrawal.intentDigest ||
            existing.some(record => record.state === 'completed' && record.manifest.requestId === manifest.requestId))) deny('withdrawal_conflict');
        if (state === 'completed' && existing.some(record => record.state === 'withdrawn' && record.manifest.requestId === manifest.requestId)) deny('withdrawal_conflict');
      }
      const pem = store.read(KEY_FILE, 16 * 1024);
      let privateKey;
      try { privateKey = keyObject(pem, 'private'); } finally { pem.fill(0); }
      trustedKey(crypto.createPublicKey(privateKey), pin);
      const bytes = signManifest(manifest, privateKey);
      return { state, ...store.writeOnce(`${manifest.requestId}.${state}.json`, bytes, transaction) };
    });
  }
  return Object.freeze({
    writePending: manifest => append(manifest, 'pending'),
    writeCompletedReceipt: manifest => append(manifest, 'completed'),
    writeWithdrawalReceipt: manifest => append(manifest, 'withdrawn'),
    listRecords: () => records(),
    readSignedRecord: (requestId, state) => {
      uuid(requestId);
      if (!['pending', 'completed', 'withdrawn'].includes(state)) deny('state');
      records();
      return store.read(`${requestId}.${state}.json`);
    }
  });
}

/** Recovery never removes or edits the original lock/staging evidence. A verified
 * dead local writer plus a fixed snapshot authorizes reconstruction elsewhere. */
function recoverySnapshot(options, adapter) {
  exactKeys(options, ['directory', 'publicKey', 'pinnedFingerprint']);
  const publicKey = trustedKey(options.publicKey, options.pinnedFingerprint);
  const store = storage(options.directory, adapter), io = adapter.fs;
  const names = io.readdirSync(options.directory).sort();
  const lockPath = path.join(options.directory, LOCK);
  if (!names.includes(LOCK)) deny('recovery_lock_required');
  privateMode(io.lstatSync(lockPath), adapter.uid(), true);
  if (JSON.stringify(io.readdirSync(lockPath).sort()) !== JSON.stringify(['owner.json'])) deny('recovery_owner_unknown');
  const ownerBytes = store.read(`${LOCK}/owner.json`, 4096), owner = JSON.parse(ownerBytes);
  exactKeys(owner, ['version', 'hostname', 'pid', 'createdAt']);
  if (owner.version !== 1 || owner.hostname !== (adapter.hostname?.() ?? os.hostname()) ||
      !Number.isSafeInteger(owner.pid) || owner.pid < 1) deny('recovery_owner_unknown');
  const alive = adapter.isAlive ?? nodeAdapter.isAlive;
  if (alive(owner.pid)) deny('recovery_writer_alive');
  const records = [], files = [{ name: `${LOCK}/owner.json`, digest: digest(ownerBytes), size: ownerBytes.length }];
  let incompleteStages = 0;
  for (const name of names) {
    if (name === LOCK) continue;
    if (name !== KEY_FILE && !/^\.stage-[a-f0-9-]{36}$/.test(name) && !/^[a-f0-9-]{36}\.(pending|completed|withdrawn)\.json$/.test(name)) deny('unexpected_file');
    const bytes = store.read(name, name === KEY_FILE ? 16384 : MAX_RECORD_BYTES);
    files.push({ name, digest: digest(bytes), size: bytes.length });
    if (name === KEY_FILE) {
      try { trustedKey(crypto.createPublicKey(keyObject(bytes, 'private')), options.pinnedFingerprint); } finally { bytes.fill(0); }
      continue;
    }
    let record;
    try { record = verifyRecord(bytes, publicKey, options.pinnedFingerprint); } catch (error) {
      if (!name.startsWith('.stage-')) throw error;
      incompleteStages++; continue;
    }
    if (record.manifest.version !== 2) deny('exact_hash_manifest_required');
    const expected = `${record.manifest.requestId}.${record.state}.json`;
    if (!name.startsWith('.stage-') && name !== expected) deny('record_name');
    records.push({ name: expected, bytes, ...record });
  }
  if (!names.includes(KEY_FILE)) deny('key');
  if (JSON.stringify(names) !== JSON.stringify(io.readdirSync(options.directory).sort())) deny('journal_changed');
  const snapshotDigest = digest(Buffer.from(JSON.stringify(files)));
  return { store, records, snapshotDigest, owner, incompleteStages, fileCount: files.length };
}
function inspectJournalRecovery(options, adapter = nodeAdapter) {
  const snapshot = recoverySnapshot(options, adapter);
  return { snapshotDigest: snapshot.snapshotDigest, writerPid: snapshot.owner.pid,
    writerHost: snapshot.owner.hostname, writerConfirmedStopped: true,
    fileCount: snapshot.fileCount, verifiedRecords: snapshot.records.length, incompleteStagesRetained: snapshot.incompleteStages };
}
function rebuildJournal(options, input, adapter = nodeAdapter) {
  exactKeys(input, ['destination', 'snapshotDigest', 'witnessRecords']);
  if (isWithin(input.destination, options.directory) || isWithin(options.directory, input.destination) || !HEX.test(input.snapshotDigest) || !Array.isArray(input.witnessRecords)) deny('recovery_schema');
  const before = recoverySnapshot(options, adapter);
  if (before.snapshotDigest !== input.snapshotDigest) deny('journal_changed');
  const merged = new Map();
  for (const item of [...before.records, ...input.witnessRecords]) {
    const verified = verifyRecord(item.bytes, options.publicKey, options.pinnedFingerprint);
    if (verified.manifest.version !== 2) deny('exact_hash_manifest_required');
    const name = `${verified.manifest.requestId}.${verified.state}.json`;
    if (item.name !== name || (merged.has(name) && !merged.get(name).bytes.equals(item.bytes))) deny('conflict');
    merged.set(name, { ...verified, bytes: Buffer.from(item.bytes) });
  }
  // Independently signed receipts may outlive the local pending file. Recreate
  // only their exact deterministic intent with the original pinned signing key.
  const pem = before.store.read(KEY_FILE, 16384);
  let privateKey;
  try { privateKey = keyObject(pem, 'private'); } finally { pem.fill(0); }
  for (const item of [...merged.values()]) if (item.state !== 'pending') {
    const pending = pendingManifest(item.manifest), bytes = signManifest(pending, privateKey);
    const name = `${pending.requestId}.pending.json`;
    if (merged.has(name) && !merged.get(name).bytes.equals(bytes)) deny('conflict');
    if (item.state === 'withdrawn' && digest(bytes) !== item.manifest.withdrawal.intentDigest) deny('withdrawal_conflict');
    merged.set(name, { ...verifyRecord(bytes, options.publicKey, options.pinnedFingerprint), bytes });
  }
  for (const item of merged.values()) if (item.state === 'withdrawn' && merged.has(`${item.manifest.requestId}.completed.json`)) deny('withdrawal_conflict');
  const target = storage(input.destination, adapter);
  if (target.entries().length || maybeStat(adapter.fs, path.join(input.destination, KEY_FILE))) deny('not_empty');
  target.withLock(transaction => {
    const keyBytes = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }));
    try { target.writeOnce(KEY_FILE, keyBytes, transaction); } finally { keyBytes.fill(0); }
  });
  const journal = openJournal({ ...options, directory: input.destination }, adapter);
  for (const item of [...merged.values()].sort((a, b) => (a.state === 'pending' ? 0 : 1) - (b.state === 'pending' ? 0 : 1))) {
    if (item.state === 'pending') journal.writePending(item.manifest);
    else if (item.state === 'completed') journal.writeCompletedReceipt(item.manifest);
    else journal.writeWithdrawalReceipt(item.manifest);
  }
  if (recoverySnapshot(options, adapter).snapshotDigest !== before.snapshotDigest) deny('journal_changed');
  return { state: 'journal_rebuilt', activation: 'config-cutover-required', sourcePreserved: true,
    sourceSnapshotDigest: before.snapshotDigest, records: journal.listRecords().length,
    incompleteStagesRetained: before.incompleteStages };
}

module.exports = Object.freeze({
  TABLES, normalizeManifest, pendingManifest, publicKeyFingerprint, signManifest, verifyRecord,
  generateJournalKey, openJournal, inspectJournalRecovery, rebuildJournal
});

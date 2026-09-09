import { timingSafeEqual } from "node:crypto";

const denied = () => new Error("google_secret_manager_staging_denied");
const identifier = value => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);
const rawCodec = Object.freeze({ encode: value => Buffer.from(value), decode: value => Buffer.from(value) });
const methods = ["addSecretVersion", "accessSecretVersion", "getSecretVersion", "disableSecretVersion"];
const MAX_PAYLOAD = 8192;

function credential(bytes) {
  return Buffer.isBuffer(bytes) && !(bytes.buffer instanceof SharedArrayBuffer) && bytes.length === 128 && bytes.every(value =>
    value >= 48 && value <= 57 || value >= 97 && value <= 102);
}

function crc32c(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function checksum(value) {
  if (typeof value === "string" && /^(?:0|[1-9][0-9]{0,9})$/.test(value)) value = Number(value);
  // google-gax can return protobuf int64 values as Long instances.
  if (value && typeof value === "object" && value.high === 0 &&
      Number.isInteger(value.low) && value.low >= -2147483648 && value.low <= 4294967295) value = value.low >>> 0;
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw denied();
  return value;
}

function response(value) {
  const result = Array.isArray(value) ? value[0] : value;
  if (!result || typeof result !== "object" || Array.isArray(result)) throw denied();
  return result;
}

function wipeResponse(value) {
  try {
    const bytes = response(value).payload?.data;
    if (bytes instanceof Uint8Array) bytes.fill(0);
  } catch { /* A malformed response never supplies usable credentials. */ }
}

function payloadBytes(reply) {
  const data = reply.payload?.data;
  if (!(data instanceof Uint8Array) || data.buffer instanceof SharedArrayBuffer ||
      !data.byteLength || data.byteLength > MAX_PAYLOAD) throw denied();
  return Buffer.from(data);
}

/**
 * Private staging adapter, not a runtime credential reader or publication API.
 * Construction and reserve perform no I/O. The supplied trusted client exposes
 * the supported Secret Manager SDK methods (SDK tuple or normalized responses).
 * Its access response transfers ownership of payload.data (Buffer/Uint8Array).
 * A REST composition must decode base64 privately before returning that buffer.
 * No SDK/ADC/environment/CLI/key-file fallback is selected here.
 *
 * addVersion creates an ENABLED version: withholding the version reference is an
 * application publication boundary, NOT version-level IAM isolation. Existing
 * runtime readers must continue using their separately approved immutable pin.
 * Provisioner permissions are add/access/get/disable on this dedicated secret;
 * this module neither grants IAM nor chooses retention, deletes or destroys.
 *
 * payloadCodec is trusted, synchronous and buffer-only. Its encode/decode must
 * return fresh buffers, never the input or a view into it. Composition can encode
 * a pinned DSN while native verification still consumes only the 128 hex bytes.
 * We wipe owned buffers; this is not a guarantee about SDK/HTTP/runtime copies.
 *
 * https://cloud.google.com/secret-manager/docs/data-integrity
 * https://cloud.google.com/secret-manager/docs/reference/rest/v1/projects.secrets/addVersion
 * https://cloud.google.com/secret-manager/docs/reference/rest/v1/projects.secrets.versions/disable
 */
export function createGoogleSecretManagerStagingStore({
  client, projectId, projectNumber, secretParent, payloadCodec = rawCodec,
  capacity = 16, timeoutMs = 5000,
} = {}) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId ?? "") ||
      !/^[1-9][0-9]{0,20}$/.test(projectNumber ?? "") ||
      typeof secretParent !== "string" || !Number.isInteger(capacity) || capacity < 1 || capacity > 256 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000 ||
      !client || methods.some(method => typeof client[method] !== "function") ||
      !payloadCodec || typeof payloadCodec.encode !== "function" || typeof payloadCodec.decode !== "function") throw denied();
  const match = /^projects\/([^/]+)\/secrets\/([a-zA-Z0-9_-]{1,255})$/.exec(secretParent);
  if (!match || ![projectId, projectNumber].includes(match[1])) throw denied();
  const parents = new Set([`projects/${projectId}/secrets/${match[2]}`, `projects/${projectNumber}/secrets/${match[2]}`]);
  const transport = Object.fromEntries(methods.map(method => [method, client[method].bind(client)]));
  const codec = Object.freeze({ encode: payloadCodec.encode.bind(payloadCodec), decode: payloadCodec.decode.bind(payloadCodec) });
  const options = Object.freeze({ timeout: timeoutMs, retry: null });
  const reservations = new WeakMap(), active = new Set(), unresolved = new Set(), intents = new Set();

  function versionName(name) {
    if (typeof name !== "string" || name.length > 512) throw denied();
    const parts = /^(projects\/[^/]+\/secrets\/[^/]+)\/versions\/([1-9][0-9]{0,20})$/.exec(name);
    if (!parts || !parents.has(parts[1])) throw denied();
    // Canonicalize only the two explicitly bound aliases of this one project.
    return `projects/${projectNumber}/secrets/${match[2]}/versions/${parts[2]}`;
  }

  function entry(handle) {
    const value = reservations.get(handle);
    if (!value) throw denied();
    return value;
  }

  function check(value) {
    if (value.terminal || value.signal?.aborted) throw denied();
  }

  function invalidate(value) {
    value.terminal = true;
    value.state = "discarded";
    value.signal?.removeEventListener("abort", value.cancel);
    for (const bytes of value.buffers) bytes.fill(0);
    value.buffers.clear();
    active.delete(value);
    if (value.submitted && !value.retired) unresolved.add(value);
  }

  function own(value, bytes) { value.buffers.add(bytes); return bytes; }
  function wipe(value, bytes) { bytes?.fill(0); value.buffers.delete(bytes); }

  function transform(value, method, bytes) {
    const input = own(value, Buffer.from(bytes));
    let output;
    try {
      output = codec[method](input);
      // A misconfigured async codec is still denied. Consume late rejection so
      // its raw error cannot become an unhandled diagnostic; wipe any eventual
      // Buffer without accepting it or resuming this reservation.
      if (output && typeof output.then === "function") {
        Promise.resolve(output).then(bytes => { if (Buffer.isBuffer(bytes)) bytes.fill(0); }, () => undefined);
        throw denied();
      }
      // Independent small Buffers may share Node's allocation pool. Reject only
      // overlapping ranges, not otherwise independent allocations in that pool.
      const overlaps = Buffer.isBuffer(output) && output.buffer === input.buffer &&
        output.byteOffset < input.byteOffset + input.byteLength &&
        input.byteOffset < output.byteOffset + output.byteLength;
      if (!Buffer.isBuffer(output) || output.buffer instanceof SharedArrayBuffer ||
          overlaps || !output.length || output.length > MAX_PAYLOAD) throw denied();
      return own(value, output);
    } catch { if (Buffer.isBuffer(output)) output.fill(0); throw denied(); }
    finally { wipe(value, input); }
  }

  // A timeout/abort closes the reservation, but cannot prove that Google did not
  // commit an RPC. The original add promise is retained for exact late-ACK
  // ownership only; no late completion reactivates a reservation or runs I/O.
  function bounded(promise, signal, late = () => undefined) {
    return new Promise((resolve, reject) => {
      let finished = false;
      const settle = (callback, result) => {
        if (finished) return false;
        finished = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
        callback(result); return true;
      };
      const abort = () => settle(reject, denied());
      const timer = setTimeout(abort, timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      Promise.resolve(promise).then(result => {
        if (!settle(resolve, result)) late(result);
      }, () => settle(reject, denied()));
    });
  }

  function invoke(method, request) {
    try { return Promise.resolve(transport[method](request, options)); }
    catch { return Promise.reject(denied()); }
  }

  async function read(value) {
    check(value);
    const reply = await bounded(invoke("accessSecretVersion", { name: value.version }), value.signal, wipeResponse);
    let bytes;
    try {
      check(value);
      const result = response(reply);
      if (versionName(result.name) !== value.version) throw denied();
      bytes = own(value, payloadBytes(result));
      if (checksum(result.payload?.dataCrc32c) !== crc32c(bytes)) throw denied();
      return bytes;
    } catch { wipe(value, bytes); throw denied(); }
    finally { wipeResponse(reply); }
  }

  function checkedVersion(reply, expected) {
    const result = response(reply);
    if (versionName(result.name) !== expected) throw denied();
    const state = ({ 1: "ENABLED", 2: "DISABLED", 3: "DESTROYED" })[result.state] ?? result.state;
    if (!["ENABLED", "DISABLED", "DESTROYED"].includes(state)) throw denied();
    return { state, etag: result.etag };
  }

  const receipt = (ack, outcome) => Object.freeze({ ack, outcome, credentialPublished: false });
  function pending() { return receipt(false, "recovery_pending"); }

  async function reconcileEntry(value) {
    if (!value.terminal) throw denied();
    if (!value.submitted || value.retired) return receipt(true, "discarded");
    if (!value.settled) {
      try { await bounded(value.addPromise); } catch { /* Only a known exact late ACK permits cleanup. */ }
    }
    if (!value.version) return pending();
    try {
      const current = checkedVersion(await bounded(invoke("getSecretVersion", { name: value.version })), value.version);
      if (current.state === "ENABLED") {
        if (typeof current.etag !== "string" || !current.etag.length || current.etag.length > 256 || /[\u0000-\u001f\u007f]/.test(current.etag)) return pending();
        try {
          checkedVersion(await bounded(invoke("disableSecretVersion", { name: value.version, etag: current.etag })), value.version);
        } catch { /* Lost disable ACK: re-read this same owned version, never retry the write blindly. */ }
      }
      const after = checkedVersion(await bounded(invoke("getSecretVersion", { name: value.version })), value.version);
      if (!["DISABLED", "DESTROYED"].includes(after.state)) return pending();
      value.retired = true; unresolved.delete(value);
      return receipt(true, "discarded");
    } catch { return pending(); }
  }

  function reconcile(handle) {
    const value = entry(handle);
    if (!value.terminal) throw denied();
    if (!value.cleanup) value.cleanup = reconcileEntry(value).finally(() => { value.cleanup = undefined; });
    return value.cleanup;
  }

  return Object.freeze({
    reserve(context) {
      if (!context || !identifier(context.intent) || !identifier(context.actor) || !identifier(context.approvalId) ||
          !["create", "rotate", "recover"].includes(context.operation) ||
          !/^[a-z_][a-z0-9_]{0,62}$/.test(context.target?.role ?? "") ||
          (context.signal !== undefined && !(context.signal instanceof AbortSignal)) || context.signal?.aborted ||
          active.size >= capacity || intents.size >= 256 || intents.has(context.intent) || unresolved.size) throw denied();
      const handle = Object.freeze(Object.create(null));
      const value = { state: "reserved", terminal: false, submitted: false, settled: false, retired: false,
        signal: context.signal, intent: context.intent, role: context.target.role, operation: context.operation,
        buffers: new Set(), reads: 0, busy: false, version: undefined, addPromise: undefined, cleanup: undefined };
      value.cancel = () => invalidate(value);
      value.signal?.addEventListener("abort", value.cancel, { once: true });
      reservations.set(handle, value); active.add(value); intents.add(value.intent);
      return handle;
    },
    async stage(handle, bytes) {
      const value = entry(handle);
      check(value);
      if (value.state !== "reserved" || !credential(bytes)) throw denied();
      value.state = "adding";
      let candidate, encoded, stored, decoded;
      try {
        candidate = own(value, Buffer.from(bytes));
        encoded = transform(value, "encode", candidate);
        check(value);
        value.submitted = true;
        value.addPromise = invoke("addSecretVersion", { parent: secretParent,
          payload: { data: encoded, dataCrc32c: crc32c(encoded) } }).then(reply => {
          // Even an unusable checksum/state ACK can identify our newly created
          // version for cleanup. An unrelated resource can never be adopted.
          const result = response(reply);
          value.version = versionName(result.name);
          value.settled = true;
          if (result.clientSpecifiedPayloadChecksum !== true || checkedVersion(reply, value.version).state !== "ENABLED") throw denied();
          return undefined;
        }).catch(() => { value.settled = true; throw denied(); });
        await bounded(value.addPromise, value.signal);
        check(value);
        stored = await read(value);
        if (stored.length !== encoded.length || !timingSafeEqual(stored, encoded)) throw denied();
        decoded = transform(value, "decode", stored);
        if (!credential(decoded) || !timingSafeEqual(candidate, decoded)) throw denied();
        check(value); value.state = "staged";
        return receipt(true, "staged");
      } catch { invalidate(value); throw denied(); }
      finally { for (const buffer of [candidate, encoded, stored, decoded]) wipe(value, buffer); }
    },
    async withCredential(handle, consume) {
      const value = entry(handle);
      check(value);
      if (value.state !== "staged" || value.busy || value.reads >= 4 || typeof consume !== "function") throw denied();
      value.busy = true; value.reads++;
      let stored, decoded;
      try {
        stored = await read(value);
        decoded = transform(value, "decode", stored);
        if (!credential(decoded)) throw denied();
        check(value);
        await bounded(Promise.resolve().then(() => { check(value); return consume(decoded); }), value.signal);
        check(value);
        return receipt(true, "read_verified");
      } catch { invalidate(value); throw denied(); }
      finally { value.busy = false; wipe(value, stored); wipe(value, decoded); }
    },
    async markStagedReady(handle) {
      const value = entry(handle);
      check(value);
      if (value.state !== "staged" || value.busy || value.reads < 2) throw denied();
      value.busy = true;
      try {
        const result = checkedVersion(await bounded(invoke("getSecretVersion", { name: value.version }), value.signal), value.version);
        check(value);
        if (result.state !== "ENABLED") throw denied();
        value.state = "staged_ready";
        value.signal?.removeEventListener("abort", value.cancel);
        return Object.freeze({ ...receipt(true, "staged_ready"), versionName: value.version });
      } catch { invalidate(value); throw denied(); }
      finally { value.busy = false; }
    },
    discard(handle) {
      const value = entry(handle);
      // Synchronous tombstone precedes any await and prevents every late read,
      // stage and readiness ACK. Cancellation does not cancel cleanup authority.
      invalidate(value);
      return reconcile(handle);
    },
    reconcile,
    metadata(handle) {
      const value = entry(handle);
      return Object.freeze({ intent: value.intent, targetRole: value.role, operation: value.operation,
        state: unresolved.has(value) ? "recovery_pending" : value.state,
        ownedVersionKnown: Boolean(value.version), recoveryPending: unresolved.has(value), credentialPublished: false,
        ...(value.state === "staged_ready" && !value.terminal ? { versionName: value.version } : {}) });
    },
  });
}

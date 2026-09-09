import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLocalSyntheticNativeAdapter, createManagedSupabaseNativeAdapter } from "../adapter.mjs";

const target = Object.freeze({ projectReference: "oysjpoondtcrqpghhrbd", host: "aws-0-us-west-2.pooler.supabase.com",
  port: 5432, database: "postgres", role: "square_sandbox_synthetic_broker", adminRole: "postgres",
  systemIdentifier: "7678069749886157684", databaseOid: "5", roleOid: "42",
  capabilityRole: "square_account_broker_authority", rootCertificate: "/etc/vaeroex-native-broker/supabase-root-2021.crt" });
const denied = error => error.constructor === Error && error.message === "local_synthetic_native_operation_failed";
const publicAdmin = "PUBLIC_SYNTHETIC_ADMIN_NEVER_USABLE";
const publicCandidate = () => Buffer.alloc(128, 97);
const context = (extra = {}) => ({ target, intent: "synthetic-intent", approvalId: "synthetic-approval",
  signal: new AbortController().signal, ...extra });

// A finite local child speaks only the native private-FD protocol. It contains
// no socket, database or HTTP client. Approved host strings are checked as argv
// metadata only; there is no connection to that host, even in failure cases.
const worker = `#!${process.execPath}
const fs = require('node:fs');
const mode = require('node:path').basename(__filename).split('.')[0];
const args = process.argv.slice(2), op = args[0];
const outcomes = {inspect:'inspected',assign:'assigned',authenticate:'authenticated'};
const stop = () => process.exit(2);
if (args.length !== 13 || !outcomes[op] || args.some(v => v.includes('PUBLIC_SYNTHETIC_ADMIN') || v === 'a'.repeat(128))) stop();
if (Object.keys(process.env).some(k => /^(?:PG|LD_|DYLD_|NODE_OPTIONS)/.test(k))) stop();
const terminal = () => { process.stdout.write(JSON.stringify({outcome:outcomes[op],committed:true,role_oid:'42'})+'\\n',()=>process.exit(0)); };
if (mode === 'early') terminal();
else if (mode === 'waiting') setTimeout(stop, 10000);
else {
  const read = fd => new Promise((resolve,reject) => {
    const chunks=[]; let size=0;
    const input=fs.createReadStream(null,{fd,autoClose:false});
    input.on('error',reject);
    input.on('data',bytes=>{size+=bytes.length;if(size>1024){input.destroy();reject(new Error('fixed'));}else chunks.push(bytes);});
    input.on('end',()=>{const value=Buffer.concat(chunks);for(const b of chunks)b.fill(0);resolve(value);});
  });
  (async()=>{
    const admin=await read(3);
    const valid=admin.equals(Buffer.from('${publicAdmin}\\n'));admin.fill(0);if(!valid)stop();
    if(op==='authenticate'){
      const candidate=await read(6);const valid=candidate.equals(Buffer.from('a'.repeat(128)+'\\n'));candidate.fill(0);if(!valid)stop();
    }
    if(op==='assign'){
      process.stdout.write('{"phase":"ready"}\\n');
      fs.writeSync(4,Buffer.from('a'.repeat(128)+'\\n'));
      const ack=await read(5);const valid=ack.equals(Buffer.from('STORED\\n'));ack.fill(0);if(!valid)stop();
    }
    terminal();
  })().catch(stop);
}
`;

async function executable(t, mode = "normal") {
  const directory = await mkdtemp(join(tmpdir(), "vaeroex-managed-adapter-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, `${mode}.cjs`);
  await writeFile(file, worker, { mode: 0o700 });
  return file;
}

function administrator() {
  const borrowed = [], signals = [];
  return { borrowed, signals, withAdministrator: async (consume, signal) => {
    const bytes = Buffer.from(publicAdmin); borrowed.push(bytes); signals.push(signal);
    try { await consume(bytes); return { ack: true }; }
    finally { bytes.fill(0); }
  } };
}

test("managed authentication supplies administrator FD3 and separate candidate FD6", async t => {
  const supplier = administrator();
  const adapter = createManagedSupabaseNativeAdapter({ executable: await executable(t), target, ...supplier });
  const candidate = publicCandidate(); let candidateReads = 0;
  const result = await adapter.authenticate(context({ withCredential: async consume => {
    candidateReads++; await consume(candidate); return { ack: true };
  } }));
  assert.equal(result.ack, true); assert.equal(result.sessionUser, target.role);
  assert.equal(candidateReads, 1); assert.equal(supplier.borrowed.length, 1);
  assert.ok(candidate.every(byte => byte === 0));
  assert.ok(supplier.borrowed[0].every(byte => byte === 0));
  assert.ok(supplier.signals[0].aborted); // Scope closes even on success.
  assert.deepEqual(await adapter.abortAndDrain(), { ack: true, drained: true });
});

test("managed assignment delivers only private candidate bytes and awaits store acknowledgement", async t => {
  const supplier = administrator();
  const adapter = createManagedSupabaseNativeAdapter({ executable: await executable(t), target, ...supplier });
  let delivery;
  const result = await adapter.assign(context({ deliver: async bytes => {
    delivery = bytes; assert.ok(bytes.equals(publicCandidate()));
  } }));
  assert.equal(result.storeAcknowledged, true); assert.equal(result.committed, true);
  assert.ok(delivery.every(byte => byte === 0));
  assert.ok(supplier.borrowed[0].every(byte => byte === 0));
});

test("child success cannot outrun required administrator supplier acknowledgement", async t => {
  let aborted = false;
  const adapter = createManagedSupabaseNativeAdapter({ executable: await executable(t), target,
    withAdministrator: async (consume, signal) => {
      const bytes = Buffer.from(publicAdmin);
      try {
        await consume(bytes);
        await new Promise(resolve => signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }));
        return { ack: true };
      } finally { bytes.fill(0); }
    } });
  await assert.rejects(adapter.inspect(context()), denied);
  assert.equal(aborted, true);
  assert.deepEqual(await adapter.abortAndDrain(), { ack: true, drained: true });
});

test("child close aborts pending administrator entry and rejects later delivery", async t => {
  let lateConsume, entrySignal;
  const adapter = createManagedSupabaseNativeAdapter({ executable: await executable(t, "early"), target,
    withAdministrator: (consume, signal) => {
      lateConsume = consume; entrySignal = signal;
      return new Promise(resolve => signal.addEventListener("abort", () => resolve({ ack: false }), { once: true }));
    } });
  await assert.rejects(adapter.inspect(context()), denied);
  assert.ok(entrySignal.aborted);
  const late = Buffer.from(publicAdmin);
  await assert.rejects(lateConsume(late), denied); late.fill(0);
  assert.deepEqual(await adapter.abortAndDrain(), { ack: true, drained: true });
});

test("external cancellation and adapter timeout each close private-entry scope", async t => {
  const file = await executable(t, "waiting");
  for (const cause of ["external", "timeout"]) {
    const controller = new AbortController();
    let entrySignal, lateConsume;
    const adapter = createManagedSupabaseNativeAdapter({ executable: file, target, timeoutMs: cause === "timeout" ? 100 : 5000,
      withAdministrator: (consume, signal) => {
        entrySignal = signal; lateConsume = consume;
        if (cause === "external") queueMicrotask(() => controller.abort());
        return new Promise(resolve => signal.addEventListener("abort", () => resolve({ ack: false }), { once: true }));
      } });
    await assert.rejects(adapter.inspect(context({ signal: controller.signal })), denied);
    assert.ok(entrySignal.aborted);
    const bytes = Buffer.from(publicAdmin);
    await assert.rejects(lateConsume(bytes), denied); bytes.fill(0);
    assert.deepEqual(await adapter.abortAndDrain(), { ack: true, drained: true });
  }
});

test("invalid administrator input and duplicate delivery fail closed", async t => {
  const file = await executable(t, "waiting");
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(511, 97), Buffer.from("public\nfixture"), Buffer.from("public\0fixture"), "not a Buffer"]) {
    const adapter = createManagedSupabaseNativeAdapter({ executable: file, target,
      withAdministrator: async consume => { await consume(bytes); return { ack: true }; } });
    await assert.rejects(adapter.inspect(context()), denied);
  }
  const adapter = createManagedSupabaseNativeAdapter({ executable: file, target,
    withAdministrator: async consume => {
      const bytes = Buffer.from(publicAdmin);
      try { await consume(bytes); await consume(bytes); return { ack: true }; }
      finally { bytes.fill(0); }
    } });
  await assert.rejects(adapter.inspect(context()), denied);
});

test("managed target pins and local-only factory reject crossing before spawning", async t => {
  const file = await executable(t);
  const supplier = administrator();
  for (const [field, value] of [["projectReference", "foreign"], ["host", "127.0.0.1"], ["port", 6543],
    ["database", "other"], ["adminRole", "other"], ["systemIdentifier", "123"], ["databaseOid", "9"], ["role", "postgres"]]) {
    assert.throws(() => createManagedSupabaseNativeAdapter({ executable: file, target: { ...target, [field]: value }, ...supplier }), denied);
  }
  assert.throws(() => createLocalSyntheticNativeAdapter({ executable: file, target }), denied);
  const adapter = createManagedSupabaseNativeAdapter({ executable: file, target, ...supplier });
  await assert.rejects(adapter.inspect(context({ target: { ...target, roleOid: "43" } })), denied);
  assert.equal(supplier.borrowed.length, 0);
});

// Isolated PostgreSQL contract qualification. No network, credentials, or hosted execution.
// PGlite proves SQL rejection/atomicity, not PostgREST 14's real transport retry behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  read, typedSetup, typedRead, typedSeal, admin, login, uuid,
  w, other, owner, member, session, memberSession, secondSession
} from './shared-evidence-sql-fixture.mjs';

const require = createRequire(import.meta.url);
const { assemble } = require('./shared-evidence-identity-conflict-upgrade.cjs');
const signature = 'private.shared_evidence_before_memory_receipts_v1(uuid,jsonb,uuid)';
const selected = { kind: 'square_payment', connection_id: uuid(210), payment_id: 'payment:1' };
let cases = 0;
let admissionQualified = false;

async function setup() {
  const { db } = await typedSetup();
  await admin(db);
  await db.exec(read('docs/security-drafts/10-memory-semantic-receipts.sql'));
  await db.exec('create table private.identity_conflict_atomic_probe(id integer primary key);');
  await login(db);
  return db;
}

async function metadata(db) {
  return (await db.query(`select p.prosrc as body, pg_get_functiondef(p.oid) as definition,
    encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') as body_hash,
    p.proowner::regrole::text as owner, l.lanname as language,
    p.proacl::text as acl, p.proconfig as config, p.provolatile as volatility,
    p.prosecdef as security_definer, p.proisstrict as strict, p.proleakproof as leakproof,
    p.proparallel as parallel, p.proargnames as argument_names,
    p.pronargdefaults as default_arguments, p.procost as cost, p.prorows as rows,
    p.prosupport::text as support, p.proretset as returns_set,
    p.prorettype::regtype::text as returns_type
    from pg_proc p join pg_language l on l.oid=p.prolang
    where p.oid=to_regprocedure($1)`, [signature])).rows[0] ?? null;
}

function security(meta) {
  const rest = { ...meta };
  delete rest.body;
  delete rest.definition;
  delete rest.body_hash;
  return rest;
}

async function snapshot(db) {
  await admin(db);
  const tables = [
    'private.shared_evidence_manifests', 'private.shared_evidence_manifest_sources',
    'private.shared_evidence_commit_claims', 'private.shared_evidence_artifact_manifests',
    'private.shared_memory_semantic_receipts', 'public.vsi_requests', 'public.vsi_exchanges',
    'square_customer_private.payments', 'square_customer_private.connections',
    'private.identity_conflict_atomic_probe'
  ];
  const values = {};
  for (const table of tables) {
    values[table] = (await db.query(`select coalesce(jsonb_agg(v order by v::text),'[]'::jsonb) as value
      from (select to_jsonb(t) as v from ${table} t) s`)).rows[0].value;
  }
  return values;
}

async function denyOnce(action, code, message) {
  let submissions = 0;
  await assert.rejects(async () => { submissions++; return action(); }, error => {
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return true;
  });
  assert.equal(submissions, 1, 'one local SQL submission; no test retry loop');
  cases++;
}

async function unchangedDenial(db, action, code, message, authenticate = () => login(db)) {
  const before = await snapshot(db);
  await authenticate();
  await denyOnce(action, code, message);
  assert.deepEqual(await snapshot(db), before, 'invalid call cannot alter source, request, claim or artifact rows');
}

test('non-retryable identity rejection preserves valid admission, exact bindings, privileges and atomicity', async () => {
  const db = await setup();
  try {
    const upgrade = assemble();
    assert.equal(upgrade.forward, read('docs/security-drafts/identity-conflict-upgrade/forward.sql'));
    assert.equal(upgrade.rollback, read('docs/security-drafts/identity-conflict-upgrade/rollback.sql'));
    const resolved = await typedRead(db, selected);
    const invalid = { ...resolved.identity, authority_hash: 'f'.repeat(64) };
    await unchangedDenial(db, () => typedSeal(db, [invalid]), '40001', /^shared_typed_identity_changed$/);
    await admin(db);
    const baseline = await metadata(db);
    const functionOid = async () => (await db.query('select to_regprocedure($1)::oid as oid', [signature])).rows[0].oid;
    const baselineOid = await functionOid();
    assert.equal(baseline.body_hash, upgrade.manifest.baselineBodySha256);
    const rowsBefore = await snapshot(db);
    await db.exec(upgrade.forward);
    const patched = await metadata(db);
    assert.equal(await functionOid(), baselineOid, 'replacement preserves function OID');
    assert.equal(patched.body_hash, upgrade.manifest.patchedBodySha256);
    assert.deepEqual(security(patched), security(baseline));
    assert.equal(patched.body.replace("errcode='PT409'", "errcode='40001'"), baseline.body);
    assert.deepEqual(await snapshot(db), rowsBefore, 'DDL changes no existing records');

    await unchangedDenial(db, () => typedSeal(db, [invalid]), 'PT409', /^shared_typed_identity_changed$/);
    await unchangedDenial(db, () => typedSeal(db, [{ ...resolved.identity, authority_hash: null }]), 'PT409', /^shared_typed_identity_changed$/);
    const missingHash = { ...resolved.identity };
    delete missingHash.authority_hash;
    await unchangedDenial(db, () => typedSeal(db, [missingHash]), 'PT409', /^shared_typed_identity_changed$/);
    await unchangedDenial(db, () => typedSeal(db, [{ ...resolved.identity, arbitrary: 'unissued' }]), '22023', /identity_invalid/);
    await unchangedDenial(db, () => typedSeal(db, [{ ...resolved.identity, connection_id: 'not-a-uuid' }]), '42501', /square_denied/);
    await unchangedDenial(db, () => typedSeal(db, [{ ...resolved.identity, kind: 'invented_provider' }]), '42501', /source_kind_denied/);

    await admin(db);
    await db.query("update square_customer_private.payments set amount_minor=12346 where payment_id='payment:1'");
    await unchangedDenial(db, () => typedSeal(db, [resolved.identity]), 'PT409', /^shared_typed_identity_changed$/);
    await admin(db);
    await db.query("update square_customer_private.payments set amount_minor=12345 where payment_id='payment:1'");

    await unchangedDenial(db, () => typedSeal(db, [resolved.identity]), '42501', undefined, () => login(db, member, memberSession));
    await unchangedDenial(db, () => typedSeal(db, [resolved.identity]), '42501', undefined, () => login(db, owner, secondSession));
    await unchangedDenial(db, () => typedSeal(db, [resolved.identity]), '42501', undefined, () => login(db, owner, session, 'service_role'));
    await unchangedDenial(db, () => typedSeal(db, [resolved.identity]), '42501', undefined, () => login(db, owner, session, 'anon'));
    await unchangedDenial(db, () => db.query('select public.seal_shared_evidence_manifest_v1($1,$2,$3,1,$4,$5,$6)',
      [other, 'vsi_request', uuid(103), uuid(101), JSON.stringify([resolved.identity]), []]), '42501');
    await unchangedDenial(db, () => db.query(`select ${signature.split('(')[0]}($1,$2,$3)`,
      [w, JSON.stringify(resolved.identity), owner]), '42501', /permission denied/);

    await admin(db);
    await db.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1", [session]);
    await unchangedDenial(db, () => typedSeal(db, [resolved.identity]), '42501');
    await admin(db);
    await db.query('delete from auth.sessions where id=$1', [session]);
    await unchangedDenial(db, () => typedSeal(db, [resolved.identity]), '42501');
    await admin(db);
    await db.query('insert into auth.sessions(id,user_id,revoked,not_after) values($1,$2,false,null)', [session, owner]);
    await db.query("update square_customer_private.connections set state='disconnected'");
    await unchangedDenial(db, () => typedSeal(db, [resolved.identity]), '42501', /square_denied/);
    await admin(db);
    await db.query("update square_customer_private.connections set state='connected'");

    const atomicBefore = await snapshot(db);
    await db.exec('begin; insert into private.identity_conflict_atomic_probe values(1);');
    await login(db);
    await denyOnce(() => typedSeal(db, [invalid]), 'PT409', /^shared_typed_identity_changed$/);
    await db.exec('rollback;');
    assert.deepEqual(await snapshot(db), atomicBefore, 'preceding transaction writes roll back with invalid identity');

    await login(db);
    const valid = await typedSeal(db, [resolved.identity]);
    assert.equal(valid.stage, 'database_bound');
    assert.deepEqual(valid.projections[0].identity, resolved.identity);
    assert.equal(valid.projections[0].hash, resolved.hash);
    cases++;
    await admin(db);
    const admitted = await snapshot(db);
    await db.exec(upgrade.rollback);
    assert.equal(await functionOid(), baselineOid, 'definition reversal preserves function OID');
    assert.deepEqual(await metadata(db), baseline, 'review-only rollback restores exact prior definition and properties');
    assert.deepEqual(await snapshot(db), admitted, 'rollback does not rewrite admitted/saved/source records');
    await unchangedDenial(db, () => typedSeal(db, [invalid]), '40001', /^shared_typed_identity_changed$/);
    admissionQualified = true;
  } finally { await db.close(); }
});

test('forward and rollback abort on missing, body, authority, configuration and security drift', async () => {
  const db = await setup();
  try {
    const upgrade = assemble();
    await admin(db);
    const baseline = await metadata(db);
    const mutations = [
      ['body', async meta => db.exec(meta.definition.replace(meta.body, `${meta.body}\n-- unexpected drift\n`))],
      ['owner', async () => db.exec(`alter function ${signature} owner to service_role;`)],
      ['security_definer', async () => db.exec(`alter function ${signature} security invoker;`)],
      ['search_path', async () => db.exec(`alter function ${signature} set search_path=public;`)],
      ['execute_acl', async () => db.exec(`grant execute on function ${signature} to authenticated;`)],
      ['volatility', async () => db.exec(`alter function ${signature} immutable;`)],
      ['strict', async () => db.exec(`alter function ${signature} strict;`)],
      ['parallel', async () => db.exec(`alter function ${signature} parallel safe;`)],
      ['cost', async () => db.exec(`alter function ${signature} cost 101;`)],
      ['missing', async () => db.exec(`drop function ${signature};`)]
    ];
    async function restore(meta) {
      if (await metadata(db)) await db.exec(`alter function ${signature} owner to postgres;`);
      await db.exec(meta.definition);
      await db.exec(`revoke all on function ${signature} from public,anon,authenticated,service_role;`);
      assert.deepEqual(await metadata(db), meta);
    }
    for (const direction of ['forward', 'rollback']) {
      await restore(baseline);
      if (direction === 'rollback') await db.exec(upgrade.forward);
      const expected = await metadata(db);
      for (const [name, mutate] of mutations) {
        await restore(expected);
        await mutate(expected);
        const changed = await metadata(db);
        await assert.rejects(db.exec(upgrade[direction]), error => {
          assert.match(error.message, new RegExp(`^identity_conflict_${direction}_before_(body_drift|security_drift|missing_function)$`), name);
          return true;
        });
        await db.exec('rollback;');
        assert.deepEqual(await metadata(db), changed, `${direction}/${name}: failed guard changes nothing`);
        cases++;
      }
      await restore(expected);
    }
    for (const direction of ['forward', 'rollback']) {
      await restore(baseline);
      if (direction === 'rollback') await db.exec(upgrade.forward);
      const expected = await metadata(db);
      const intendedCode = direction === 'forward' ? 'PT409' : '40001';
      const corruptReplacement = upgrade[direction].replace(`using errcode='${intendedCode}'`, "using errcode='P0001'");
      assert.notEqual(corruptReplacement, upgrade[direction]);
      await assert.rejects(db.exec(corruptReplacement), new RegExp(`identity_conflict_${direction}_after_body_drift`));
      await db.exec('rollback;');
      assert.deepEqual(await metadata(db), expected, `${direction}: failed postcondition rolls back the replacement`);
      cases++;
    }
    await db.exec(upgrade.rollback);
    await assert.rejects(db.exec(upgrade.rollback), /identity_conflict_rollback_before_body_drift/);
    await db.exec('rollback;');
    assert.deepEqual(await metadata(db), baseline);
    await db.exec(upgrade.forward);
    const patched = await metadata(db);
    await assert.rejects(db.exec(upgrade.forward), /identity_conflict_forward_before_body_drift/);
    await db.exec('rollback;');
    assert.deepEqual(await metadata(db), patched);
    cases += 2;
  } finally { await db.close(); }
  console.log(JSON.stringify({ passed: admissionQualified, cases, actualPostgresSQL: true, pglite: true,
    exactConditionAndMessage: true, failClosedAuthority: true, atomicRollback: true,
    exactFunctionProperties: true, forwardRollbackDriftGuards: true,
    localOneSubmissionRejection: true, actualPostgrest14RetryBehaviorProved: false,
    privateScreenedFixtures: true, externalCalls: 0, productionChanges: 0 }));
});

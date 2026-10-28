// Credential-free bootstrap-tail regression. PGlite executes the exact wrapper,
// rename and assembled upgrade; synthetic dependencies are not hosted RLS proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
const { assemble, sources, identityConflictUpgrade: upgrade, verifyIdentityConflictTail } = require('./shared-evidence-release-package.cjs');
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const rename = 'alter function private.shared_evidence_original_v1(uuid,jsonb,uuid) rename to shared_evidence_before_memory_receipts_v1;';
const marker = `-- SOURCE: ${upgrade.path}\n`;
const workspace = '00000000-0000-4000-8000-000000000001';
const actor = '00000000-0000-4000-8000-000000000002';
const identity = { kind: 'square_payment', authority_hash: 'a'.repeat(64) };

function tail(sql = assemble().sql) {
  verifyIdentityConflictTail(sql);
  return 'begin;\n' + sql.slice(sql.indexOf(marker));
}

async function fixture({ renamed = true } = {}) {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema private;
      create table private.synthetic_context(workspace uuid,actor uuid,identity jsonb);
      create table private.synthetic_writes(id int);
      create function private.shared_evidence_typed_v1(w uuid,a uuid,j jsonb) returns jsonb
        language plpgsql security definer set search_path='' as $$
      declare issued jsonb;
      begin
        select c.identity into issued from private.synthetic_context c where c.workspace=w and c.actor=a;
        if issued is null then raise exception 'synthetic_authority_denied' using errcode='42501'; end if;
        insert into private.synthetic_writes values(1);
        return jsonb_build_object('identity',issued,'hash',issued->>'authority_hash');
      end $$;
      create function private.shared_evidence_legacy_original_v1(w uuid,j jsonb,a uuid) returns jsonb
        language plpgsql security definer set search_path='' as $$
      begin raise exception 'synthetic_legacy_denied' using errcode='42501'; end $$;`);
    await db.query('insert into private.synthetic_context values($1,$2,$3)', [workspace, actor, identity]);
    const source = read('docs/security-drafts/06-typed-source-admission.sql');
    const start = source.indexOf('create function private.shared_evidence_original_v1(w uuid,j jsonb,a uuid) returns jsonb');
    const end = source.indexOf('end $$;', start) + 'end $$;'.length;
    assert(start >= 0 && end > start);
    await db.exec(source.slice(start, end));
    await db.exec('revoke all on function private.shared_evidence_original_v1(uuid,jsonb,uuid) from public,anon,authenticated,service_role;');
    if (renamed) {
      assert.equal(read('docs/security-drafts/10-memory-semantic-receipts.sql').split(rename).length, 2);
      await db.exec(rename);
    }
    return db;
  } catch (error) { await db.close(); throw error; }
}

async function metadata(db) {
  return (await db.query(`select oid,encode(sha256(convert_to(prosrc,'UTF8')),'hex') body_hash,
    proowner::regrole::text owner,proacl::text acl,prosecdef,proconfig,provolatile,proisstrict,proleakproof,proparallel
    from pg_proc where oid=to_regprocedure($1)`, [upgrade.function])).rows[0];
}

test('bootstrap ends with the exact applied PT409 artifact and its final security/body guard', () => {
  const value = assemble();
  assert.equal(sources.at(-1), 'identity-conflict-upgrade/forward.sql');
  assert.equal(value.manifest.files.at(-1).sha256, upgrade.forwardSha256);
  assert.equal(value.manifest.identityConflictUpgrade.finalBodySha256, upgrade.finalBodySha256);
  assert.equal(value.manifest.identityConflictUpgrade.automaticApplication, false);
  assert.equal(value.manifest.identityConflictUpgrade.alreadyAppliedProductionMigration, '20261027181014');
  assert.equal((value.sql.match(/^begin;\s*$/gm) || []).length, 1);
  assert.equal((value.sql.match(/^commit;\s*$/gm) || []).length, 1);
  assert(!value.sql.includes('-- SOURCE: docs/security-drafts/identity-conflict-upgrade/rollback.sql'));
  assert(value.sql.includes("if p_identity ? 'authority_hash' and p_identity is distinct from r->'identity' then raise exception 'shared_typed_identity_changed' using errcode='40001'"), 'unrelated preview branch remains unchanged');
  assert.match(tail(value.sql), /identity_conflict_forward_after_security_drift/);
  verifyIdentityConflictTail(value.sql);
});

test('assembly rejects modified or missing upgrade bytes, missing rename, reordering and code after its guard', () => {
  const value = assemble();
  assert.throws(() => assemble({ read: file => file === upgrade.path ? read(file).replace("errcode='PT409'", "errcode='40001'") : read(file) }), /exact reviewed PT409 upgrade/);
  assert.throws(() => assemble({ read: file => file === upgrade.path ? '' : read(file) }), /exact outer BEGIN/);
  assert.throws(() => assemble({ read: file => read(file).replace(rename, '-- rename removed') }), /must follow the exact function rename/);
  const index = value.sql.indexOf(marker);
  assert.throws(() => verifyIdentityConflictTail(value.sql.slice(index) + value.sql.slice(0, index)), /must follow the exact function rename/);
  assert.throws(() => verifyIdentityConflictTail(value.sql.replace(/commit;\n$/, '-- SOURCE: unexpected.sql\ncommit;\n')), /must be the final source/);
  assert.throws(() => verifyIdentityConflictTail(value.sql.replace(/commit;\n$/, "select 1;\ncommit;\n")), /final installation step/);
  assert.throws(() => verifyIdentityConflictTail(value.sql.replace(upgrade.finalBodySha256, '0'.repeat(64))), /final installation step/);
});

test('the actual assembled tail preserves function identity/security and rejects changed identities once without writes', async () => {
  const db = await fixture();
  try {
    const before = await metadata(db);
    assert.equal(before.body_hash, '525df2decebd8c4dce1bdbc2aef1593acbea6470572b58260b1047fee242c576');
    await db.exec(tail());
    const after = await metadata(db);
    assert.equal(after.body_hash, upgrade.finalBodySha256);
    assert.deepEqual({ ...after, body_hash: before.body_hash }, before);
    assert.equal(after.acl, '{postgres=X/postgres}');
    const invoke = (j, w = workspace, a = actor) => db.query('select private.shared_evidence_before_memory_receipts_v1($1,$2,$3) result', [w, j, a]);
    for (const [j, w, a, code, message] of [
      [{ ...identity, authority_hash: 'b'.repeat(64) }, workspace, actor, 'PT409', 'shared_typed_identity_changed'],
      [{ ...identity, kind: 'approved_note' }, workspace, actor, '42501', 'shared_typed_semantic_admission_unqualified'],
      [identity, actor, actor, '42501', 'synthetic_authority_denied'],
      [identity, workspace, workspace, '42501', 'synthetic_authority_denied']
    ]) {
      let attempts = 0;
      await assert.rejects(async () => { attempts++; return invoke(j, w, a); }, error => error.code === code && error.message === message);
      assert.equal(attempts, 1);
      assert.equal((await db.query('select count(*)::int n from private.synthetic_writes')).rows[0].n, 0);
    }
    const result = (await invoke(identity)).rows[0].result;
    assert.deepEqual(result, { identity, hash: identity.authority_hash });
    assert.equal((await db.query('select count(*)::int n from private.synthetic_writes')).rows[0].n, 1);
    await db.exec('grant usage on schema private to authenticated;set role authenticated;');
    await assert.rejects(invoke(identity), error => error.code === '42501' && /permission denied/.test(error.message));
  } finally { await db.close(); }
});

test('tail fails atomically on an omitted rename, permission drift or corrupt replacement', async () => {
  for (const variant of ['missing_rename', 'permission_drift', 'corrupt_replacement']) {
    const db = await fixture({ renamed: variant !== 'missing_rename' });
    try {
      if (variant === 'permission_drift') await db.exec(`grant execute on function ${upgrade.function} to authenticated;`);
      const before = await metadata(db);
      const sql = variant === 'corrupt_replacement' ? tail().replace("errcode='PT409'", "errcode='P0001'") : tail();
      const expected = variant === 'missing_rename' ? /forward_before_missing_function/ : variant === 'permission_drift' ? /forward_before_security_drift/ : /forward_after_body_drift/;
      await assert.rejects(db.exec(sql), expected);
      await db.exec('rollback;');
      assert.deepEqual(await metadata(db), before, 'failed pre/postconditions leave the prior state unchanged');
    } finally { await db.close(); }
  }
});

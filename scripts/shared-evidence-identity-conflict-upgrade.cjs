/* eslint-disable @typescript-eslint/no-require-imports -- Local-only SQL assembly; no database or credential access. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'docs/security-drafts/identity-conflict-upgrade');
const sourcePath = 'docs/security-drafts/06-typed-source-admission.sql';
const target = 'private.shared_evidence_before_memory_receipts_v1';
const signature = `${target}(uuid,jsonb,uuid)`;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function definitions() {
  const source = fs.readFileSync(path.join(root, sourcePath), 'utf8');
  const marker = 'create function private.shared_evidence_original_v1(w uuid,j jsonb,a uuid) returns jsonb';
  const start = source.indexOf(marker);
  assert(start >= 0 && source.indexOf(marker, start + 1) < 0, 'one original typed-wrapper definition');
  const bodyStart = source.indexOf('as $$', start) + 5;
  const end = source.indexOf('$$;', bodyStart);
  assert(bodyStart > start && end > bodyStart);
  const originalBody = source.slice(bodyStart, end);
  const before = "if j is distinct from resolved->'identity' then raise exception 'shared_typed_identity_changed' using errcode='40001';end if;";
  const after = before.replace("errcode='40001'", "errcode='PT409'");
  assert.equal(originalBody.split(before).length, 2, 'one exact integrity rejection');
  assert.equal((originalBody.match(/40001/g) || []).length, 1, 'no hidden second retryable branch in this body');
  const patchedBody = originalBody.replace(before, after);
  const original = source.slice(start, end + 3)
    .replace('create function private.shared_evidence_original_v1', `create or replace function ${target}`);
  const patched = original.replace(before, after);
  assert.equal(patched.replace(after, before), original, 'only SQLSTATE changes');
  return { original, patched, originalBody, patchedBody, sourceSha256: sha(source) };
}

function guard(bodyHash, phase) {
  return `do $guard$\ndeclare p pg_catalog.pg_proc;\nbegin\n select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('${signature}');\n if not found then raise exception 'identity_conflict_${phase}_missing_function';end if;\n if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')<>'${bodyHash}' then\n  raise exception 'identity_conflict_${phase}_body_drift';end if;\n if p.proowner<>'postgres'::pg_catalog.regrole or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')\n  or p.prokind<>'f' or p.prorettype<>'jsonb'::pg_catalog.regtype or p.proretset or p.provariadic<>0\n  or p.pronargdefaults<>0 or p.proargnames is distinct from array['w','j','a']::text[]\n  or p.provolatile<>'v' or not p.prosecdef or p.proisstrict or p.proleakproof or p.proparallel<>'u'\n  or p.procost<>100 or p.prorows<>0 or p.prosupport<>0\n  or p.proconfig is distinct from array['search_path=""']::text[]\n  or p.proacl is distinct from array['postgres=X/postgres']::pg_catalog.aclitem[] then\n  raise exception 'identity_conflict_${phase}_security_drift';end if;\nend $guard$;`;
}

function assemble() {
  const d = definitions();
  const baseline = sha(d.originalBody), patched = sha(d.patchedBody);
  const script = (direction, expected, result, definition) => `-- LOCAL REVIEW ONLY. Never executed by the assembler.\n-- ${direction === 'forward' ? 'One deterministic identity-change rejection: 40001 -> PT409; condition/message/authority unchanged.' : 'EMERGENCY REVIEW ONLY: restores the known vulnerable 40001 contract. Never automatic.'}\n-- No source data, saved records, ACLs, credentials, gates, schedules or sessions are changed.\n-- Guard failures abort the entire transaction. Concurrent schema changes must be excluded operationally.\nbegin;\nset local lock_timeout='5s';\nset local statement_timeout='120s';\n${guard(expected, `${direction}_before`)}\n\n${definition}\n\n${guard(result, `${direction}_after`)}\ncommit;\n`;
  const forward = script('forward', baseline, patched, d.patched);
  const rollback = script('rollback', patched, baseline, d.original);
  return { forward, rollback, manifest: {
    status: 'local_review_only_not_applied', function: signature,
    source: sourcePath, sourceSha256: d.sourceSha256,
    installedNameEstablishedBy: 'docs/security-drafts/10-memory-semantic-receipts.sql:33',
    baselineBodySha256: baseline, patchedBodySha256: patched,
    forwardSha256: sha(forward), rollbackSha256: sha(rollback),
    oldCode: '40001', newCode: 'PT409', message: 'shared_typed_identity_changed',
    owner: 'postgres', executeACL: ['postgres=X/postgres'], sourceAndSavedDataChanges: false,
    permissionChanges: false, loopCleanupIncluded: false, other40001BranchesChanged: false,
    actualPostgrest14ExecutionProved: false, requiresSeparateHostedApproval: true,
    rollbackRisk: 'Restores the vulnerable retryable code; separate decision required. Does not clear already in-flight retries.'
  } };
}

function main(args = process.argv.slice(2)) {
  assert(args.length === 1 && ['--write', '--check'].includes(args[0]));
  const result = assemble();
  if (args[0] === '--write') {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'forward.sql'), result.forward);
    fs.writeFileSync(path.join(directory, 'rollback.sql'), result.rollback);
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(result.manifest, null, 2) + '\n');
  } else {
    assert.equal(fs.readFileSync(path.join(directory, 'forward.sql'), 'utf8'), result.forward);
    assert.equal(fs.readFileSync(path.join(directory, 'rollback.sql'), 'utf8'), result.rollback);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')), result.manifest);
  }
  console.log(JSON.stringify(result.manifest));
}
module.exports = { assemble };
if (require.main === module) main();

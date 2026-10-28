/* eslint-disable @typescript-eslint/no-require-imports -- Temporary-artifact offline qualification only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const offBase = '041b9c111f949af3b807404879993621b51134bd';
const offTree = '07c8f7b47b0d49b5d0c1c628135784bea27cfcbb';
const branch = 'codex/vsi-overhead-hosted-acceptance';
const gateFiles = Object.freeze([
  'lib/ai/shared-evidence/qualitative-policy.ts',
  'lib/ai/shared-evidence/runtime-gate.ts',
  'lib/vsi/failure-accounting-gate.ts',
]);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const baseline = file => execFileSync('git', ['show', `${offBase}:${file}`], { cwd: root, encoding: 'utf8' });

function assertTemporaryActivation() {
  assert.equal(git('rev-parse', `${offBase}^{tree}`), offTree, 'exact reviewed OFF source baseline required');
  assert.deepEqual(git('diff', '--name-only', offBase, '--', 'app', 'lib', 'components').split('\n'), gateFiles,
    'only the three reviewed gates may change application runtime');
  assert.equal(git('ls-files', '--others', '--', 'app', 'lib', 'components'), '', 'untracked runtime denied');
  for (const file of gateFiles) {
    const before = baseline(file);
    assert.equal((before.match(/return false;/g) || []).length, 1);
    assert.equal(read(file), before.replace('return false;', 'return true;'), 'exact gate-only replacement required');
  }
  const before = JSON.parse(baseline('vercel.json')), current = JSON.parse(read('vercel.json'));
  assert.deepEqual(current, { ...before, git: { ...before.git, deploymentEnabled: {
    ...before.git.deploymentEnabled, [branch]: false,
  } } }, 'all existing deployment holds and cron configuration must remain unchanged');
  assert.equal(current.git.deploymentEnabled.main, false);
  // The inactive SQL source and its assembler stay byte-identical to the reviewed OFF source baseline.
  assert.equal(git('diff', '--name-only', offBase, '--', 'docs/security-drafts', 'scripts/shared-evidence-release-package.cjs'), '');
  assert.equal(git('ls-files', '--others', '--', 'docs/security-drafts'), '');
  return { offBase, offTree, branch, gatesOn: 3, inactiveSqlUnchanged: true };
}

function inactivePackageReader(sourceRead = read) {
  assertTemporaryActivation();
  return file => {
    const value = sourceRead(file);
    if (!gateFiles.includes(file)) return value;
    const before = baseline(file);
    assert.equal(value, before.replace('return false;', 'return true;'), 'reader cannot mask an unexpected gate value');
    return before;
  };
}

function assembleInactivePackage({ read: sourceRead = read } = {}) {
  // This is a view of the pinned OFF installation package, never a relaxation
  // of its unchanged assembler guard or a declaration that this artifact is OFF.
  const { assemble } = require('./shared-evidence-release-package.cjs');
  return assemble({ read: inactivePackageReader(sourceRead) });
}

function checkInactivePackage() {
  const boundary = assertTemporaryActivation();
  const { assemble } = require('./shared-evidence-release-package.cjs');
  assert.throws(() => assemble(), /runtime gate must remain false/, 'default assembler must still reject ON artifacts');
  const value = assembleInactivePackage();
  assert.equal(value.sql, read('docs/security-drafts/release/forward.sql'));
  assert.equal(value.pauseSql, read('docs/security-drafts/release/pause.sql'));
  assert.deepEqual(value.manifest, JSON.parse(read('docs/security-drafts/release/manifest.json')));
  for (const file of gateFiles) {
    const malformed = inactivePackageReader(input => input === file ? baseline(file) : read(input));
    assert.throws(() => malformed(file), /reader cannot mask an unexpected gate value/);
  }
  console.log(JSON.stringify({ ...boundary, defaultAssemblerRejectsOn: true, inactivePackageVerified: true, applied: false, modelCalls: 0 }));
}

if (require.main === module) {
  assert.deepEqual(process.argv.slice(2), ['--check-inactive-package'], 'read-only inactive package check only');
  checkInactivePackage();
}
module.exports = { assertTemporaryActivation, inactivePackageReader, assembleInactivePackage, offBase, offTree, branch };

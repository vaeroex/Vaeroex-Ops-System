/* eslint-disable @typescript-eslint/no-require-imports -- Offline tests use a disposable checkout of the evaluator's reviewed runtime. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

// Reviewed runtime ancestor with the exact app/lib trees pinned by the evaluator.
// Do not repin the evaluator merely because unrelated application code changes.
const reviewedRuntimeCommit = 'f92a5d63f15ca79e144d47aa7e18114dca461b8e';
const fixtureArgument = '--pinned-evaluation-test-fixture';

function runInPinnedEvaluationFixture(testFile) {
  if (process.argv.includes(fixtureArgument)) return false;
  const root = path.resolve(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vsi-pinned-tests-'));
  const fixture = path.join(temporary, 'checkout');
  try {
    execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', root, fixture]);
    const git = (...args) => execFileSync('git', ['-C', fixture, ...args], { stdio: 'pipe' });
    git('read-tree', reviewedRuntimeCommit);
    git('update-ref', 'HEAD', reviewedRuntimeCommit);
    git('checkout-index', '--all');
    // Exercise current tests and the actual unchanged evaluator, not old tests
    // from the snapshot. Only app/lib identity is the evaluator's runtime gate.
    fs.cpSync(path.join(root, 'scripts'), path.join(fixture, 'scripts'), { recursive: true });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
    const result = spawnSync(process.execPath, [path.join(fixture, 'scripts', path.basename(testFile)), fixtureArgument], {
      cwd: fixture,
      stdio: 'inherit'
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    return true;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { runInPinnedEvaluationFixture };

/* eslint-disable @typescript-eslint/no-require-imports -- Disposable local Git fixtures exercise the actual evaluator guard without dispatch. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vsi-runtime-guard-'));
const fixture = path.join(temporary, 'checkout');
let dispatches = 0, sequence = 0, rejected = 0;
const git = (...args) => execFileSync('git', ['-C', fixture, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
try {
  // Local object sharing is read-only; all index, worktree and commit mutations
  // below belong to this disposable checkout, never the source repository.
  execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', root, fixture]);
  git('read-tree', 'HEAD');
  execFileSync('git', ['-C', fixture, 'checkout-index', '--force', '-z', '--stdin'], {
    input: git('ls-files', '-z', '--', 'app', 'lib')
  });
  fs.mkdirSync(path.join(fixture, 'scripts'), { recursive: true });
  const modulePath = path.join(fixture, 'scripts/vsi-isolated-contract-evaluation.cjs');
  fs.copyFileSync(path.join(__dirname, 'vsi-isolated-contract-evaluation.cjs'), modulePath);
  const { createEvaluation, candidate } = require(modulePath);
  const acceptedHead = git('rev-parse', 'HEAD').trim();
  const output = () => path.join(temporary, `output-${++sequence}`);
  const dispatch = () => { dispatches++; throw new Error('dispatch_forbidden'); };
  const accepts = () => {
    const evaluation = createEvaluation({ outputDir: output(), dispatch });
    assert.equal(evaluation.snapshot().candidate, candidate);
    assert.equal(evaluation.snapshot().realModelQualified, false);
  };
  const denies = () => {
    const outputDir = output();
    assert.throws(() => createEvaluation({ outputDir, dispatch }), /candidate_runtime_changed/);
    assert.equal(fs.existsSync(outputDir), false, 'reject before creating evaluation artifacts');
    rejected++;
  };
  accepts();
  for (const relative of ['app/app/legal/actions.ts', 'lib/supabase/types.ts']) {
    const filename = path.join(fixture, relative);
    const original = fs.readFileSync(filename, 'utf8');
    fs.appendFileSync(filename, '\n// Synthetic unreviewed runtime mutation.\n');
    denies(); // Modified worktree file.
    git('add', '--', relative);
    denies(); // Staging the mutation does not authorize it.
    git('-c', 'user.name=Runtime guard fixture', '-c', 'user.email=fixture@example.invalid',
      'commit', '--quiet', '--no-gpg-sign', '-m', 'Synthetic runtime mutation');
    assert.equal(git('status', '--porcelain', '--', 'app', 'lib').trim(), '');
    denies(); // A clean worktree at an unreviewed committed tree still rejects.
    git('reset', '--quiet', acceptedHead);
    fs.writeFileSync(filename, original);
    accepts();
    const untracked = path.join(fixture, relative.split('/')[0], 'unreviewed-runtime-fixture.ts');
    fs.writeFileSync(untracked, '// Synthetic untracked runtime mutation.\n');
    denies();
    fs.unlinkSync(untracked);
    accepts();
  }
  assert.equal(dispatches, 0);
  console.log(JSON.stringify({ passed: true, rejected, realGitTreesAndWorktrees: true,
    modifiedStagedCommittedAndUntrackedDenied: true, dispatches, externalCalls: 0 }));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { test } from 'node:test';
import { identifyWorktree, inspectWorktree, removeCheckout, removeLocalBranch } from '../cleanup/git';

function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), 'workspace-tools-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' }).toString().trim();
  git('init', '-b', 'main');
  writeFileSync(join(root, 'tracked.md'), 'base');
  git('add', 'tracked.md');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '-m', 'Base');
  const path = join(root, 'task');
  git('worktree', 'add', '-b', 'feature/task', path);
  return { root, path, git, target: { path, defaultBranch: 'main', baseBranch: 'main' } };
}

test('inspects and removes a detached worktree after its branch was deleted', async t => {
  const { git, path, target } = fixture(t);
  git('-C', path, 'switch', '--detach');
  git('branch', '-d', 'feature/task');
  writeFileSync(join(path, 'local.txt'), 'draft');
  const inspection = await inspectWorktree(target);
  assert.equal(inspection.branch, null);
  assert.equal(inspection.fileCount, 1);
  assert.equal(inspection.unmergedCount, 0);
  await assert.rejects(removeCheckout(target, inspection, false), /подтверждение/i);
  await removeCheckout(target, inspection, true);
  assert.equal(existsSync(path), false);
  assert.ok(git('branch', '--list', 'main'));
});

test('cleans a clean linked worktree and its branch, preserving main', async t => {
  const { root, path, git, target } = fixture(t);
  const inspection = await inspectWorktree(target);
  assert.deepEqual(inspection.files, []);
  assert.equal(inspection.unmergedCount, 0);
  await removeCheckout(target, inspection, false);
  await removeLocalBranch(inspection, false);
  assert.equal(existsSync(path), false);
  assert.equal(git('branch', '--list', 'feature/task'), '');
  assert.ok(existsSync(root));
  assert.ok(git('branch', '--list', 'main'));
});

test('lists staged, unstaged and untracked changes and requires fresh confirmation', async t => {
  const { path, target } = fixture(t);
  const clean = await inspectWorktree(target);
  writeFileSync(join(path, 'plan.md'), 'plan');
  writeFileSync(join(path, 'tracked.md'), 'staged');
  execFileSync('git', ['-C', path, 'add', 'tracked.md']);
  writeFileSync(join(path, 'tracked.md'), 'unstaged');
  const dirty = await inspectWorktree(target);
  assert.deepEqual(dirty.files, ['MM tracked.md', '?? plan.md']);
  await assert.rejects(removeCheckout(target, clean, true), /состояние изменилось/i);
  await assert.rejects(removeCheckout(target, dirty, false), /подтверждение/i);
  assert.equal(existsSync(path), true);
  await removeCheckout(target, dirty, true);
  assert.equal(existsSync(path), false);
});

test('protects the primary checkout and requires explicit consent for unmerged commits', async t => {
  const { root, path, target } = fixture(t);
  await assert.rejects(inspectWorktree({ ...target, path: root }), /отдельн.*worktree/i);
  execFileSync('git', ['-C', path, '-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '--allow-empty', '-m', 'Task']);
  const inspection = await inspectWorktree(target);
  assert.equal(inspection.unmergedCount, 1);
  await removeCheckout(target, inspection, false);
  await assert.rejects(removeLocalBranch(inspection, false), /подтверждение/i);
  await removeLocalBranch(inspection, true);
});


test('checks the current branch ref before deletion and protects a non-main default', async t => {
  const { root, path, git, target } = fixture(t);
  await assert.rejects(inspectWorktree({ ...target, defaultBranch: 'feature/task' }), /защищена/i);
  const inspection = await inspectWorktree(target);
  await removeCheckout(target, inspection, false);
  git('switch', 'feature/task');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '--allow-empty', '-m', 'New tip');
  git('switch', 'main');
  await assert.rejects(removeLocalBranch(inspection, true), /ветка изменилась/i);
  assert.ok(git('branch', '--list', 'feature/task'));
  assert.ok(existsSync(root));
  assert.equal(existsSync(path), false);
});

test('preserves a branch that became the remote default after checkout removal', async t => {
  const { git, target } = fixture(t);
  const inspection = await inspectWorktree(target);
  await removeCheckout(target, inspection, false);
  git('update-ref', 'refs/remotes/origin/feature/task', inspection.head);
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/feature/task');
  await assert.rejects(removeLocalBranch(inspection, true), /ветка feature\/task защищена/i);
  assert.ok(git('branch', '--list', 'feature/task'));
});

test('protects the remote default in a native checkout even if BB cached a different default', async t => {
  const { git, target, path } = fixture(t);
  git('update-ref', 'refs/remotes/origin/feature/task', git('rev-parse', 'main'));
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/feature/task');
  await assert.rejects(inspectWorktree(target), /ветка feature\/task защищена/i);
  assert.ok(existsSync(path));
});


test('includes ignored files in review and preserves them without consent', async t => {
  const { path, target, git } = fixture(t);
  git('config', 'core.excludesFile', join(path, 'ignore'));
  writeFileSync(join(path, 'ignore'), '.env\nignore\n');
  writeFileSync(join(path, '.env'), 'private value');
  const inspection = await inspectWorktree(target);
  assert.deepEqual(inspection.files, ['!! .env', '!! ignore']);
  await assert.rejects(removeCheckout(target, inspection, false), /подтверждение/i);
  assert.ok(existsSync(join(path, '.env')));
});

test('requires a fresh confirmation when only the Git index changed', async t => {
  const { root, path, target } = fixture(t);
  writeFileSync(join(path, 'tracked.md'), 'worktree');
  execFileSync('git', ['-C', path, 'add', 'tracked.md']);
  const tip = await inspectWorktree(target);
  const staged = execFileSync('git', ['-C', root, 'hash-object', '-w', '--stdin'], { input: 'another staged version' })
    .toString().trim();
  execFileSync('git', ['-C', path, 'update-index', '--cacheinfo', `100644,${staged},tracked.md`]);
  const current = await inspectWorktree(target);
  assert.deepEqual(current.files, ['MM tracked.md']);
  assert.notEqual(tip.fingerprint, current.fingerprint);
  await assert.rejects(removeCheckout(target, tip, true), /состояние изменилось/i);
  assert.ok(existsSync(path));
});

test('rechecks edits inside an ignored directory', async t => {
  const { path, target, git } = fixture(t);
  git('config', 'core.excludesFile', join(path, 'ignore'));
  writeFileSync(join(path, 'ignore'), 'artifacts/\nignore\n');
  mkdirSync(join(path, 'artifacts'));
  const file = join(path, 'artifacts', 'private.txt');
  writeFileSync(file, 'original');
  const inspection = await inspectWorktree(target);
  assert.ok(inspection.files.includes('!! artifacts/private.txt'));
  writeFileSync(file, 'new unconfirmed content');
  await assert.rejects(removeCheckout(target, inspection, true), /состояние изменилось/i);
  assert.ok(existsSync(file));
});

test('preserves the branch if rewinding the base reveals additional unmerged commits', async t => {
  const { path, git, target } = fixture(t);
  const first = git('rev-parse', 'main');
  execFileSync('git', ['-C', path, '-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '--allow-empty', '-m', 'Integrated']);
  git('reset', '--hard', 'feature/task');
  execFileSync('git', ['-C', path, '-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '--allow-empty', '-m', 'Unmerged']);
  const inspection = await inspectWorktree(target);
  assert.equal(inspection.unmergedCount, 1);
  await removeCheckout(target, inspection, false);
  git('reset', '--hard', first);
  await assert.rejects(removeLocalBranch(inspection, true), /набор невлитых коммитов изменился/i);
  assert.ok(git('branch', '--list', 'feature/task'));
});

test('preserves a managed worktree whose BB teardown hook needs its checkout', async t => {
  const { path, target } = fixture(t);
  writeFileSync(join(path, '.bb-env-teardown.sh'), '#!/bin/sh\n');
  await assert.rejects(inspectWorktree({ ...target, managed: true }), /bb-env-teardown.sh/);
  assert.ok(existsSync(path));
});

test('rejects a locked worktree before asking for confirmation', async t => {
  const { path, git, target } = fixture(t);
  git('worktree', 'lock', path);
  await assert.rejects(inspectWorktree(target), /заблокирован/i);
  assert.ok(existsSync(path));
});

test('does not treat a branch pushed to origin as merged into itself', async t => {
  const { path, git, target } = fixture(t);
  execFileSync('git', ['-C', path, '-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '--allow-empty', '-m', 'Task']);
  git('update-ref', 'refs/remotes/origin/feature/task', 'feature/task');
  const inspection = await inspectWorktree({ ...target, baseBranch: 'feature/task' });
  assert.equal(inspection.baseRef, 'refs/heads/main');
  assert.equal(inspection.unmergedCount, 1);
});

test('rejects filenames that cannot be shown and rechecked as UTF-8', async t => {
  const { path, target } = fixture(t);
  try {
    writeFileSync(Buffer.concat([Buffer.from(path + '/'), Buffer.from([0xff])]), 'untracked');
  } catch (error) {
    if (!['EPERM', 'EINVAL', 'EILSEQ'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    t.skip('Filesystem rejects non-UTF-8 filenames');
    return;
  }
  await assert.rejects(inspectWorktree(target), /UTF-8/);
});

test('refuses an on-disk file Git hides via assume-unchanged', async t => {
  const { path, target } = fixture(t);
  const git = (...args: string[]) => execFileSync('git', ['-C', path, ...args]).toString().trim();
  git('update-index', '--assume-unchanged', 'tracked.md');
  writeFileSync(join(path, 'tracked.md'), 'Git status does not show this edit');
  assert.equal(git('status', '--porcelain'), '');
  await assert.rejects(inspectWorktree(target), /tracked\.md.*assume-unchanged/);
});

test('locks the base ref while deleting the approved branch ref', async t => {
  const { root, git, target } = fixture(t);
  const previousBase = git('rev-parse', 'main');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '--allow-empty', '-m', 'Advance main');
  const checkedBase = git('rev-parse', 'main');
  const inspection = await inspectWorktree(target);
  await removeCheckout(target, inspection, false);
  const hook = join(root, '.git', 'hooks', 'reference-transaction');
  writeFileSync(hook, `#!/bin/sh
test "$1" = prepared || exit 0
if grep -q ' refs/heads/feature/task$'; then
  git -c core.filesRefLockTimeout=0 update-ref refs/heads/main ${previousBase} ${checkedBase} || :
fi
`, { mode: 0o755 });
  await removeLocalBranch(inspection, false);
  assert.equal(git('rev-parse', 'main'), checkedBase);
});

test('preserves an embedded Git repository that status only reports as a directory', async t => {
  const { path, target } = fixture(t);
  execFileSync('git', ['-C', path, 'init', '-q', 'nested']);
  const file = join(path, 'nested', 'local.txt');
  writeFileSync(file, 'uncommitted in another repository');
  await assert.rejects(inspectWorktree(target), /вложенный Git репозиторий.*nested/i);
  assert.ok(existsSync(file));
});

test('resolves remote-qualified bases returned by the worktree provider', async t => {
  const { git, target } = fixture(t);
  git('update-ref', 'refs/remotes/origin/release', 'main');
  for (const baseBranch of ['origin/release', 'refs/remotes/origin/release', 'refs/heads/main']) {
    const preview = await inspectWorktree({ ...target, baseBranch });
    assert.equal(preview.baseRef, baseBranch === 'refs/heads/main' ? baseBranch : 'refs/remotes/origin/release');
  }
});

test('keeps a clean checkout when a merge is still in progress', async t => {
  const { git, path, target } = fixture(t);
  git('switch', '-c', 'merge-source');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '--allow-empty', '-m', 'An empty commit');
  const taskGit = (...args: string[]) => execFileSync('git', ['-C', path, ...args], { stdio: 'pipe' }).toString().trim();
  taskGit('-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'merge', '--no-commit', '--no-ff', 'merge-source');
  assert.equal(taskGit('status', '--porcelain'), '');
  await assert.rejects(inspectWorktree(target), /Git.*не завершена.*MERGE_HEAD/);
});

test('keeps local files inside an uninitialized submodule directory', async t => {
  const { git, path, target } = fixture(t);
  const head = git('rev-parse', 'main');
  const taskGit = (...args: string[]) => execFileSync('git', ['-C', path, ...args], { stdio: 'pipe' }).toString().trim();
  taskGit('update-index', '--add', '--cacheinfo', `160000,${head},vendor`);
  taskGit('-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '-m', 'Add gitlink');
  mkdirSync(join(path, 'vendor'), { recursive: true });
  writeFileSync(join(path, 'vendor', 'local.txt'), 'local');
  assert.equal(taskGit('status', '--porcelain'), '');
  await assert.rejects(inspectWorktree(target), /submodule vendor/);
});

test('locks every existing worktree HEAD against a checkout while deleting a branch', async t => {
  const { root, git, target } = fixture(t);
  const linked = join(root, 'other');
  git('worktree', 'add', '--detach', linked);
  git('update-ref', 'refs/remotes/origin/main', 'main');
  const inspection = await inspectWorktree({ ...target, baseBranch: 'origin/main' });
  await removeCheckout({ ...target, baseBranch: 'origin/main' }, inspection, false);
  const hook = join(root, '.git', 'hooks', 'reference-transaction');
  writeFileSync(hook, `#!/bin/sh
test "$1" = prepared || exit 0
if grep -q ' refs/heads/feature/task$'; then
  git switch feature/task || :
  env -u GIT_DIR -u GIT_WORK_TREE git -C "${linked}" switch feature/task || :
fi
`, { mode: 0o755 });
  await removeLocalBranch(inspection, false);
  assert.equal(git('branch', '--show-current'), 'main');
  assert.equal(execFileSync('git', ['-C', linked, 'branch', '--show-current']).toString().trim(), '');
  assert.equal(git('branch', '--list', 'feature/task'), '');
});

test('honors a bare local base selected by BB even if origin contains the change', async t => {
  const { git, path, target } = fixture(t);
  execFileSync('git', ['-C', path, '-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '--allow-empty', '-m', 'Task']);
  git('update-ref', 'refs/remotes/origin/main', 'feature/task');
  const preview = await inspectWorktree(target);
  assert.equal(preview.baseRef, 'refs/heads/main');
  assert.equal(preview.unmergedCount, 1);
});

test('aborts branch deletion when Git adds a checkout after ref preparation', async t => {
  const { root, git, target } = fixture(t);
  const inspection = await inspectWorktree(target);
  await removeCheckout(target, inspection, false);
  const hook = join(root, '.git', 'hooks', 'reference-transaction');
  writeFileSync(hook, `#!/bin/sh
test "$1" = prepared || exit 0
if grep -q ' refs/heads/feature/task$'; then
  git worktree add --no-checkout "${root}/new" feature/task
fi
`, { mode: 0o755 });
  await assert.rejects(removeLocalBranch(inspection, false), /другом worktree/);
  assert.equal(git('rev-parse', 'feature/task'), inspection.head);
});

test('identifies a linked worktree for another project and rejects a different repository', async t => {
  const { root, path, target } = fixture(t);
  const binding = await identifyWorktree({ repo: root, path, baseBranch: 'main' });
  assert.equal(binding.path, await realpath(path));
  assert.equal(binding.branch, 'feature/task');
  assert.equal(binding.defaultBranch, 'main');
  const other = fixture(t);
  await assert.rejects(identifyWorktree({ repo: other.root, path, baseBranch: 'main' }), /другому репозиторию/);
  execFileSync('git', ['-C', path, 'branch', '-m', 'another-task']);
  await assert.rejects(inspectWorktree({ ...target, expected: binding }), /привязанный worktree/i);
});

test('uses the repository default for cleanup when the worktree was created from a tag or SHA', async t => {
  const { root, path, git } = fixture(t);
  git('tag', 'preview-base', 'main');
  for (const baseBranch of ['preview-base', git('rev-parse', 'main')]) {
    const binding = await identifyWorktree({ repo: root, path, baseBranch });
    assert.equal(binding.baseBranch, 'refs/heads/main');
  }
  await assert.rejects(identifyWorktree({ repo: root, path, baseBranch: 'missing-ref' }), /missing-ref/);
});

test('rejects registration if the just-created worktree is now on another branch', async t => {
  const { root, path } = fixture(t);
  await assert.rejects(identifyWorktree({
    repo: root, path, baseBranch: 'main', expectedBranch: 'feature/other',
  }), /ветка.*изменилась/i);
});

test('protects master when the remote default is unknown and a local main also exists', async t => {
  const { root, path } = fixture(t);
  execFileSync('git', ['-C', path, 'branch', '-m', 'master']);
  await assert.rejects(identifyWorktree({ repo: root, path, baseBranch: 'main' }), /ветка master защищена/i);
});

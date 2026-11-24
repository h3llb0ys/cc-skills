import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import host from '../host';

test('protects live environment paths inside the worktree, including aliases', async t => {
  const root = mkdtempSync(join(tmpdir(), 'workspace-tools-paths-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const worktree = join(root, 'task');
  const child = join(worktree, 'backend');
  const sibling = join(root, 'task-other');
  const alias = join(root, 'alias');
  const outward = join(worktree, 'plugin');
  mkdirSync(child, { recursive: true });
  mkdirSync(sibling);
  symlinkSync(child, alias, 'dir');
  symlinkSync(sibling, outward, 'dir');
  const candidates = [worktree, child, sibling, alias, outward, join(root, 'missing')];
  const result = await host.handlers.worktreePathsInUse({ path: worktree, candidates }, {} as never);
  assert.deepEqual(result, [worktree, child, alias, outward]);
});

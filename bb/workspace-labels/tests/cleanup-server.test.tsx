import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BbPluginApi, PluginRpcHandlers } from '@get-bb/plugin-sdk';
import { cleanupRpc, type LinkedWorktree } from '../cleanup/contract';
import { registerCleanup } from '../cleanup/server';

function fixture() {
  const inspection = {
    path: '/worktree', gitDir: '/repo/.git', branch: 'feature/task', head: 'commit', baseRef: 'refs/heads/main',
    files: [], fileCount: 0, commits: [], unmergedCount: 0, unmergedFingerprint: 'clean', fingerprint: 'same',
  };
  const thread = { id: 'thread', environmentId: 'env', status: 'idle', archivedAt: null as number | null };
  const environment = {
    id: 'env', hostId: 'host', path: '/worktree', isWorktree: true, defaultBranch: 'main', status: 'ready', managed: false,
    environmentProviderId: 'git-worktree',
  };
  const steps: string[] = [];
  const tags: string[] = [];
  const diskBinding = { path: '/fraudcore/task', gitDir: '/fraudcore/.git', worktreeId: 'worktree',
    branch: 'feature/task', defaultBranch: 'main', baseBranch: 'refs/remotes/origin/main' };
  let binding: LinkedWorktree | undefined;
  let cli!: Parameters<BbPluginApi['cli']['register']>[0];
  const faults = { git: false, close: false, resume: false, pluginInWorktree: false };
  type Dispatch = (context: { thread: typeof thread; environment: typeof environment }) => { action: string };
  let dispatch!: Dispatch;
  let rpc!: PluginRpcHandlers<typeof cleanupRpc>;
  let dispatchDuringRemoval: string | undefined;
  let beforeSave: (() => Promise<void>) | undefined;
  const bb = {
    cli: { register: (registration: typeof cli) => { cli = registration; } },
    experimental_hooks: { on: (_name: string, handler: Dispatch) => { dispatch = handler; } },
    hosts: { experimental_client: () => ({
      call: async (method: string, input?: { path?: string }) => {
        if (method === 'identify') return diskBinding;
        if (method === 'worktreePathsInUse') return faults.pluginInWorktree ? ['/worktree/plugin'] : [];
        if (method === 'inspect') {
          if (faults.resume) thread.status = 'active';
          return input?.path ? { ...inspection, path: input.path } : inspection;
        }
        steps.push(method);
        if (method === 'removeCheckout') {
          dispatchDuringRemoval = dispatch({ thread, environment }).action;
          if (faults.git) throw new Error('Git отказал');
        }
        return true;
      },
    }) },
    sdk: {
      threads: {
        get: async () => thread,
        getPluginMetadata: async () => ({ worktree: binding }),
        updatePluginMetadata: async ({ set, remove }: { set?: { worktree: LinkedWorktree }; remove?: string[] }) => {
          if (set) {
            await beforeSave?.();
            binding = set.worktree;
          }
          if (remove?.includes('worktree')) binding = undefined;
        },
        experimental_listPluginMetadata: async () => ({
          threads: binding ? [{ threadId: thread.id, metadata: { worktree: binding } }] : [],
        }),
        list: async () => thread.archivedAt === null ? [thread] : [],
        archive: async () => {
          steps.push('archive');
          if (faults.close) throw new Error('BB отказал');
          thread.archivedAt = 1;
          return { ok: true, archivedThreadIds: [thread.id] };
        },
        delete: async () => {
          steps.push('delete');
          if (faults.close) throw new Error('BB отказал');
        },
      },
      plugins: { list: async () => ({ plugins: faults.pluginInWorktree
        ? [{ source: 'path:/worktree/plugin', rootDir: '/worktree/plugin' }] : [] }) },
      environments: { get: async () => environment, list: async () => [environment] },
    },
    rpc: { experimental_invalidate: (changed: string[]) => tags.push(...changed), register: (contract: unknown, value: typeof rpc) => {
      assert.equal(contract, cleanupRpc);
      rpc = value;
    } },
  };
  registerCleanup(bb as unknown as BbPluginApi);
  async function approval(action: 'archive' | 'delete') {
    const request = { threadId: thread.id, action };
    const { token } = await rpc.prepare(request);
    return { ...request, token, discardFiles: false, discardCommits: false, confirmDelete: action === 'delete' };
  }
  return {
    steps, faults, thread, environment, approval, rpc, tags,
    beforeNextLinkSave: (callback: () => Promise<void>) => { beforeSave = callback; },
    link: () => cli.run(['link', '/fraudcore', '/fraudcore/task', 'origin/main'], { threadId: thread.id }),
    dispatchNow: () => dispatch({ thread, environment }).action,
    get dispatchDuringRemoval() { return dispatchDuringRemoval; },
  };
}

test('retains external thread history if Git refuses to remove the worktree', async () => {
  const { approval, rpc, steps, faults } = fixture();
  const input = await approval('delete');
  faults.git = true;
  const result = await rpc.execute(input);
  assert.equal(result.state, 'failed');
  assert.deepEqual(steps, ['removeCheckout']);
  assert.match(result.message, /Тред сохранён/);
});

test('keeps the branch if BB cannot close the thread after worktree removal', async () => {
  const { approval, rpc, steps, faults } = fixture();
  const input = await approval('archive');
  faults.close = true;
  const result = await rpc.execute(input);
  assert.equal(result.state, 'failed');
  assert.deepEqual(steps, ['removeCheckout', 'archive']);
  assert.match(result.message, /ветка сохранена/);
});

test('rejects a confirmation if the thread was archived since the preview', async () => {
  const { approval, rpc, steps, thread } = fixture();
  const input = await approval('archive');
  thread.archivedAt = 1;
  await assert.rejects(async () => rpc.execute(input), /состояние изменилось/i);
  assert.deepEqual(steps, []);
});


test('removes the branch only after BB confirms archive', async () => {
  const { approval, rpc, steps } = fixture();
  const result = await rpc.execute(await approval('archive'));
  assert.equal(result.state, 'done');
  assert.deepEqual(steps, ['removeCheckout', 'archive', 'removeBranch']);
});


test('keeps the worktree if the thread starts working during revalidation', async () => {
  const { approval, rpc, steps, faults } = fixture();
  const input = await approval('archive');
  faults.resume = true;
  const result = await rpc.execute(input);
  assert.equal(result.state, 'failed');
  assert.match(result.message, /состояние треда изменилось/i);
  assert.deepEqual(steps, []);
});


test('keeps live sources of path-installed BB plugins', async () => {
  const { approval, rpc, steps, faults } = fixture();
  const input = await approval('archive');
  faults.pluginInWorktree = true;
  await assert.rejects(async () => rpc.execute(input), /плагина BB/);
  assert.deepEqual(steps, []);
});


test('rejects new turns during cleanup and releases the dispatch guard after a failure', async () => {
  const fixtureState = fixture();
  const input = await fixtureState.approval('archive');
  fixtureState.faults.git = true;
  await fixtureState.rpc.execute(input);
  assert.equal(fixtureState.dispatchDuringRemoval, 'reject');
  assert.equal(fixtureState.dispatchNow(), 'proceed');
});


test('cleans a linked project checkout without touching the thread’s managed personal workspace', async () => {
  const { environment, link, rpc, thread, tags, approval, steps } = fixture();
  environment.isWorktree = false;
  environment.managed = true;
  environment.environmentProviderId = 'personal-workspace';
  assert.equal((await link()).exitCode, 0);
  assert.equal(environment.path, '/worktree');
  const request = { threadId: thread.id, action: 'archive' as const };
  const preview = await rpc.prepare(request);
  const bindings = await rpc.linkedWorktrees({ keys: [thread.id] });
  assert.equal(bindings[thread.id]?.path, '/fraudcore/task');
  assert.equal(preview.path, '/fraudcore/task');
  assert.deepEqual(tags, ['linked-worktree:thread']);
  assert.equal((await rpc.execute(await approval('archive'))).state, 'done');
  assert.deepEqual(steps, ['removeCheckout', 'archive', 'removeBranch']);
});

test('does not link another checkout over a native BB worktree', async () => {
  const { link, rpc, thread } = fixture();
  await assert.rejects(async () => link(), /собственный Git worktree/);
  assert.deepEqual(await rpc.linkedWorktrees({ keys: [thread.id] }), {});
});

test('rejects cleanup while the current thread binding is being persisted', async () => {
  const { environment, link, approval, rpc, steps, beforeNextLinkSave } = fixture();
  environment.isWorktree = false;
  await link();
  const input = await approval('archive');
  let signalStarted!: () => void;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  let resume!: () => void;
  const paused = new Promise<void>(resolve => { resume = resolve; });
  beforeNextLinkSave(() => {
    signalStarted();
    return paused;
  });
  const linking = link();
  await started;
  try {
    await assert.rejects(async () => rpc.execute(input), /операция очистки уже выполняется/i);
    assert.deepEqual(steps, []);
  } finally {
    resume();
    await linking;
  }
  assert.equal((await rpc.execute(input)).state, 'done');
});

test('clears the binding after checkout removal even when closing the thread fails', async () => {
  const { environment, link, rpc, thread, tags, approval, faults } = fixture();
  environment.isWorktree = false;
  await link();
  const input = await approval('archive');
  faults.close = true;
  assert.equal((await rpc.execute(input)).state, 'failed');
  assert.deepEqual(await rpc.linkedWorktrees({ keys: [thread.id] }), {});
  assert.deepEqual(tags, ['linked-worktree:thread', 'linked-worktree:thread']);
});

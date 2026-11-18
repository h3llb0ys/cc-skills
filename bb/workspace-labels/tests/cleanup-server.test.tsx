import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BbPluginApi, PluginRpcHandlers } from '@get-bb/plugin-sdk';
import { cleanupRpc } from '../cleanup-contract';
import { registerCleanup } from '../cleanup-server';

function fixture() {
  const inspection = {
    path: '/worktree', gitDir: '/repo/.git', branch: 'feature/task', head: 'commit', baseRef: 'refs/heads/main',
    files: [], fileCount: 0, commits: [], unmergedCount: 0, unmergedFingerprint: 'clean', fingerprint: 'same',
  };
  const thread = { id: 'thread', environmentId: 'env', status: 'idle', archivedAt: null as number | null };
  const environment = {
    id: 'env', hostId: 'host', path: '/worktree', isWorktree: true, defaultBranch: 'main', status: 'ready', managed: false,
  };
  const steps: string[] = [];
  const faults = { git: false, close: false, resume: false, pluginInWorktree: false };
  type Dispatch = (context: { thread: typeof thread; environment: typeof environment }) => { action: string };
  let dispatch!: Dispatch;
  let rpc!: PluginRpcHandlers<typeof cleanupRpc>;
  let dispatchDuringRemoval: string | undefined;
  const bb = {
    experimental_hooks: { on: (_name: string, handler: Dispatch) => { dispatch = handler; } },
    hosts: { experimental_client: () => ({
      call: async (method: string) => {
        if (method === 'worktreePathsInUse') return faults.pluginInWorktree ? ['/worktree/plugin'] : [];
        if (method === 'inspect') {
          if (faults.resume) thread.status = 'active';
          return inspection;
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
    rpc: { register: (contract: unknown, value: typeof rpc) => {
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
    steps, faults, thread, approval, rpc,
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

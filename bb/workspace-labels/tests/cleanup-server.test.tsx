import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import type { BbPluginApi, PluginRpcHandlers } from '@get-bb/plugin-sdk';
import { cleanupRpc, type LinkedWorktree } from '../cleanup/contract';
import { registerCleanup } from '../cleanup/server';

function fixture(t?: { after: (callback: () => void) => void }) {
  const db = new Database(':memory:');
  t?.after(() => db.close());
  const inspection = {
    path: '/worktree', gitDir: '/repo/.git', worktreeId: 'worktree', branch: 'feature/task', head: 'commit', baseRef: 'refs/heads/main',
    files: [], fileCount: 0, commits: [], unmergedCount: 0, unmergedFingerprint: 'clean', fingerprint: 'same',
  };
  const thread = {
    id: 'thread', title: 'Подзадача', environmentId: 'env', status: 'idle', archivedAt: null as number | null,
    activity: { activeBackgroundCommandCount: 0 },
  };
  const peer = { ...thread, id: 'peer' };
  let includePeer = false;
  const environment = {
    id: 'env', hostId: 'host', path: '/worktree', isWorktree: true, defaultBranch: 'main', status: 'ready', managed: false,
    environmentProviderId: 'git-worktree', createdAt: 1, branchName: 'feature/task',
  };
  const steps: string[] = [];
  const tags: string[] = [];
  const diskBinding = { path: '/fraudcore/task', gitDir: '/fraudcore/.git', worktreeId: 'worktree',
    branch: 'feature/task', defaultBranch: 'main', baseBranch: 'refs/remotes/origin/main' };
  const bindings = new Map<string, LinkedWorktree>();
  let cli!: Parameters<BbPluginApi['cli']['register']>[0];
  const faults = { git: false, close: false, resume: false, pluginInWorktree: false };
  type Dispatch = (context: { thread: typeof thread; environment: typeof environment }) => { action: string };
  let dispatch!: Dispatch;
  let rpc!: PluginRpcHandlers<typeof cleanupRpc>;
  let dispatchDuringRemoval: string | undefined;
  let beforeSave: (() => Promise<void>) | undefined;
  let parent = 'parent';
  let nativeState = 'available';
  let onEnvironmentRemoved!: (event: { removal: { providerOwnedPath: boolean; environmentId: string } }) => void;
  const bb = {
    storage: { database: () => db, migrate: (_db: Database.Database, statements: string[]) => statements.forEach(sql => db.exec(sql)) },
    events: { on(name: string, handler: typeof onEnvironmentRemoved) {
      if (name === 'experimental_environment.removed') onEnvironmentRemoved = handler;
    } },
    cli: { register: (registration: typeof cli) => { cli = registration; } },
    experimental_hooks: { on: (_name: string, handler: Dispatch) => { dispatch = handler; } },
    hosts: { experimental_client: () => ({
      call: async (method: string, input?: { path?: string; expected?: LinkedWorktree; paths?: { key: string }[] }) => {
        if (method === 'identify') return diskBinding;
        if (method === 'worktreeStates') return Object.fromEntries(input!.paths!.map(({ key }) => [
          key, key.startsWith('native:') ? nativeState : 'available',
        ]));
        if (method === 'worktreePathsInUse') return faults.pluginInWorktree ? ['/worktree/plugin'] : [];
        if (method === 'inspect') {
          if (faults.resume) thread.status = 'active';
          return input?.path ? {
            ...inspection, path: input.path, gitDir: input.expected?.gitDir ?? inspection.gitDir,
            worktreeId: input.expected?.worktreeId ?? inspection.worktreeId,
          } : inspection;
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
        get: async ({ threadId }: { threadId: string }) => threadId === 'peer' ? peer : thread,
        experimental_listAncestors: async () => ({ threads: [{ threadId: thread.id, ancestorIds: [parent] }] }),
        experimental_listDescendants: async ({ threadIds }: { threadIds: string[] }) => ({
          threads: threadIds.map(threadId => ({ threadId, descendantIds: threadId === parent ? [thread.id] : [] })),
        }),
        getPluginMetadata: async ({ threadId }: { threadId: string }) => ({ worktree: bindings.get(threadId) }),
        updatePluginMetadata: async ({ threadId, set, remove }: { threadId: string; set?: { worktree: LinkedWorktree }; remove?: string[] }) => {
          if (set) {
            await beforeSave?.();
            bindings.set(threadId, set.worktree);
          }
          if (remove?.includes('worktree')) bindings.delete(threadId);
        },
        experimental_listPluginMetadata: async ({ threadIds }: { threadIds: string[] }) => ({
          threads: threadIds.flatMap(threadId => {
            const worktree = bindings.get(threadId);
            return worktree ? [{ threadId, metadata: { worktree } }] : [];
          }),
        }),
        list: async ({ threadIds, archived }: { threadIds?: string[]; archived?: boolean }) =>
          (includePeer ? [thread, peer] : [thread]).filter(row =>
            (!threadIds || threadIds.includes(row.id)) && (archived !== false || row.archivedAt === null)),
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
    steps, faults, thread, environment, approval, rpc, tags, diskBinding,
    moveUnder: (parentId: string) => { parent = parentId; },
    beforeNextLinkSave: (callback: () => Promise<void>) => { beforeSave = callback; },
    link: (threadId = thread.id) => cli.run(['link', '/fraudcore', '/fraudcore/task', 'origin/main'], { threadId }),
    enablePeer: () => { includePeer = true; return peer; },
    removeNative: () => {
      nativeState = 'removed';
      environment.status = 'destroyed';
      onEnvironmentRemoved({ removal: { providerOwnedPath: true, environmentId: environment.id } });
    },
    restoreNative: () => {
      nativeState = 'available';
      environment.status = 'ready';
    },
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

test('retains sequential worktrees in a parent widget and cleans the chosen row without closing either thread', async t => {
  const { environment, link, rpc, thread, steps, diskBinding } = fixture(t);
  environment.isWorktree = false;
  await link();
  diskBinding.path = '/fraudcore/task-2';
  diskBinding.worktreeId = 'worktree-2';
  await link();
  const rows = await rpc.worktreeHistory({ threadId: 'parent' });
  assert.deepEqual(rows.map(row => row.path), ['/fraudcore/task-2', '/fraudcore/task']);
  const request = { threadId: 'parent', action: 'worktree' as const, worktreeKey: rows[1].key };
  const { token } = await rpc.prepare(request);
  const outcome = await rpc.execute({ ...request, token, confirmDelete: false, discardFiles: false, discardCommits: false });
  assert.equal(outcome.state, 'done');
  assert.deepEqual(steps, ['removeCheckout', 'removeBranch']);
  assert.equal(thread.archivedAt, null);
  const history = await rpc.worktreeHistory({ threadId: 'parent' });
  assert.equal(history.find(row => row.path === '/fraudcore/task')?.state, 'removed');
  assert.equal((await rpc.linkedWorktrees({ keys: [thread.id] }))[thread.id]?.path, '/fraudcore/task-2');
});

test('keeps former child history but does not expose worktrees registered after it moves', async t => {
  const { environment, link, rpc, diskBinding, moveUnder } = fixture(t);
  environment.isWorktree = false;
  await link();
  moveUnder('new-parent');
  diskBinding.path = '/fraudcore/task-2';
  diskBinding.worktreeId = 'worktree-2';
  await link();
  const oldHistory = await rpc.worktreeHistory({ threadId: 'parent' });
  assert.deepEqual(oldHistory.map(row => row.path), ['/fraudcore/task']);
  assert.equal((await rpc.worktreeHistory({ threadId: 'new-parent' })).length, 2);
  await assert.rejects(async () => rpc.prepare({
    threadId: 'unrelated', action: 'worktree', worktreeKey: oldHistory[0].key,
  }), /очистка недоступна/i);
});

test('shows native BB worktrees and refuses standalone cleanup of their environments', async t => {
  const { rpc, steps } = fixture(t);
  const [row] = await rpc.worktreeHistory({ threadId: 'parent' });
  assert.equal(row.path, '/worktree');
  assert.match(row.blockedReason ?? '', /окружение BB/);
  await assert.rejects(async () => rpc.prepare({
    threadId: 'parent', action: 'worktree', worktreeKey: row.key,
  }), /очистка недоступна/i);
  assert.deepEqual(steps, []);
});

test('shows a native checkout again after BB restores the same environment', async t => {
  const { rpc, removeNative, restoreNative, moveUnder } = fixture(t);
  const list = () => rpc.worktreeHistory({ threadId: 'parent' });
  assert.equal((await list())[0].state, 'available');
  removeNative();
  assert.equal((await list())[0].state, 'removed');
  restoreNative();
  assert.equal((await list())[0].state, 'available');
  moveUnder('new-parent');
  assert.equal((await list())[0].state, 'available');
});

test('both archive entry points protect a checkout while the thread has a background command', async t => {
  const { approval, environment, link, rpc, steps, thread } = fixture(t);
  environment.isWorktree = false;
  await link();
  const [row] = await rpc.worktreeHistory({ threadId: thread.id });
  const threadApproval = await approval('archive');
  const request = { threadId: thread.id, action: 'worktree' as const, worktreeKey: row.key };
  const { token } = await rpc.prepare(request);
  thread.activity.activeBackgroundCommandCount = 1;
  await assert.rejects(async () => rpc.execute({
    ...request, token, confirmDelete: false, discardFiles: false, discardCommits: false,
  }), /дождитесь окончания работы/i);
  await assert.rejects(async () => rpc.execute(threadApproval), /дождитесь окончания работы/i);
  assert.deepEqual(steps, []);
});

test('protects shared historical worktrees from the thread cleanup action while another owner is working', async t => {
  const { environment, enablePeer, link, rpc, thread, diskBinding, steps } = fixture(t);
  environment.isWorktree = false;
  const peer = enablePeer();
  await link();
  await link(peer.id);
  diskBinding.path = '/fraudcore/task-2';
  diskBinding.worktreeId = 'worktree-2';
  await link(peer.id);
  peer.status = 'active';
  await assert.rejects(async () => rpc.prepare({ threadId: thread.id, action: 'archive' }), /дождитесь окончания работы/i);
  assert.deepEqual(steps, []);
});

test('protects a native checkout recorded in another running thread’s history', async t => {
  const { environment, enablePeer, link, rpc, thread, diskBinding, steps } = fixture(t);
  environment.isWorktree = false;
  const peer = enablePeer();
  diskBinding.gitDir = '/repo/.git';
  await link(peer.id);
  diskBinding.path = '/fraudcore/task-2';
  diskBinding.worktreeId = 'worktree-2';
  await link(peer.id);
  environment.isWorktree = true;
  environment.path = '/fraudcore/task';
  peer.status = 'active';
  await assert.rejects(async () => rpc.prepare({ threadId: thread.id, action: 'archive' }), /дождитесь окончания работы/i);
  assert.deepEqual(steps, []);
});

test('rechecks running work and the confirmation before removing a historical worktree', async t => {
  const { environment, link, rpc, thread, steps, faults } = fixture(t);
  environment.isWorktree = false;
  await link();
  const [row] = await rpc.worktreeHistory({ threadId: 'parent' });
  const request = { threadId: 'parent', action: 'worktree' as const, worktreeKey: row.key };
  const { token } = await rpc.prepare(request);
  const approved = { ...request, token, confirmDelete: false, discardFiles: false, discardCommits: false };
  await assert.rejects(async () => rpc.execute({ ...approved, token: 'old' }), /состояние изменилось/i);
  faults.resume = true;
  await assert.rejects(async () => rpc.execute(approved), /дождитесь окончания работы/i);
  assert.equal(thread.status, 'active');
  assert.deepEqual(steps, []);
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
  assert.deepEqual(tags, ['linked-worktree:thread', 'worktree-history']);
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
  assert(tags.includes('worktree-history'));
  assert(tags.filter(tag => tag === 'linked-worktree:thread').length >= 2);
});

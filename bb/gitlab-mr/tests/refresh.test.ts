import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { mrKey, mrUrl, type MergeRequest, type Snapshot } from '../contract';
import { presentation } from '../presentation';
import plugin from '../server';

const threadId = 'thr_test';
const repo = { hostname: 'gitlab.example.com', project: 'group/repo', projectId: 42 };
const first: MergeRequest = {
  ...repo, iid: 12, title: 'First', branch: 'feature/one', target: 'main',
  state: 'opened', pipeline: 'warning',
};
const second: MergeRequest = {
  ...first, iid: 13, title: 'Second', branch: 'feature/two', pipeline: 'failed',
};

function fixture() {
  let value: Snapshot | undefined;
  let discoveryReads = 0;
  let detailReads = 0;
  let readSnapshots!: (input: { keys: string[] }) => Promise<Record<string, Snapshot>>;
  const batches: string[][] = [];
  let select!: (input: { threadId: string; key: string }, context: { experimental_signal: AbortSignal }) => Promise<boolean>;
  let watch!: (read: { key: string }, signal: AbortSignal) => Promise<void>;
  let minutes = 0;
  let settingsChanged!: () => void;
  const details = new Map([first, second].map(mr => [mrKey(mr), mr]));
  const fixture = {
    candidates: [first],
    active: first.branch,
    details,
    current: () => value,
    snapshot: (keys: string[]) => readSnapshots({ keys }),
    batches,
    requests: () => [discoveryReads, detailReads],
    choose: (mr: MergeRequest) => select({ threadId, key: mrKey(mr) }, { experimental_signal: new AbortController().signal }),
    interval: (value: number) => { minutes = value; settingsChanged(); },
    enter: () => {
      const controller = new AbortController();
      const done = watch({ key: threadId }, controller.signal);
      return async () => { controller.abort(); await done; };
    },
  };
  plugin({
    hosts: { experimental_client: () => ({
      call: async (method: string, input: { mr: MergeRequest }) => {
        if (method === 'discover') {
          discoveryReads++;
          return { active: { ...repo, branch: fixture.active }, candidates: fixture.candidates };
        }
        detailReads++;
        const result = details.get(mrKey(input.mr));
        if (!result) throw new Error('offline');
        return result;
      },
    }) },
    settings: { define: () => ({
      get: async () => ({ gitlabHosts: repo.hostname, refreshMinutes: minutes }),
      onChange: (callback: () => void) => { settingsChanged = callback; },
    }) },
    sdk: {
      threads: {
        experimental_listPluginMetadata: async ({ threadIds }: { threadIds: string[] }) => {
          batches.push(threadIds);
          const threads = value && threadIds.includes(threadId)
            ? [{ threadId, metadata: { mergeRequests: value } }] : [];
          return { threads };
        },
        getPluginMetadata: async () => ({ mergeRequests: value }),
        updatePluginMetadata: async ({ set }: { set: { mergeRequests: Snapshot } }) => { value = set.mergeRequests; },
        get: async () => ({ environmentId: 'env_test' }),
      },
      environments: { get: async () => ({ hostId: 'host_test', path: '/checkout' }) },
      hosts: { get: async () => ({ status: 'connected', lifecycle: { phase: 'active' } }) },
    },
    rpc: {
      register: (_contract: unknown, handlers: { choose: typeof select; snapshot: typeof readSnapshots }) => {
        select = handlers.choose;
        readSnapshots = handlers.snapshot;
      },
      experimental_whileWatched: (_name: string, handler: typeof watch) => { watch = handler; },
      experimental_invalidate: () => {},
    },
    log: { warn: () => {} },
  } as unknown as BbPluginApi);
  return fixture;
}

async function eventually(check: () => void) {
  for (let attempt = 0; ; attempt++) {
    try {
      check();
      return;
    } catch (error) {
      if (attempt === 100) throw error;
      await delay(5);
    }
  }
}

test('links the new branch and retains the prior merged MR', async () => {
  const env = fixture();
  let leave = env.enter();
  try {
    await eventually(() => assert.equal(env.current()?.links[0]?.iid, 12));
    assert.equal(presentation(env.current()!.links[0]).color, 'orange');
    await leave();
    env.candidates = [second];
    env.active = second.branch;
    env.details.set(mrKey(first), { ...first, state: 'merged' });
    leave = env.enter();
    await eventually(() => assert.deepEqual(env.current()?.links.map(link => [link.iid, presentation(link).color]),
      [[12, 'purple'], [13, 'red']]));
  } finally {
    await leave();
  }
});

test('requires a choice when the current branch has multiple open MRs', async () => {
  const env = fixture();
  const alternative = { ...second, branch: first.branch, target: 'release' };
  env.candidates = [first, alternative];
  env.details.set(mrKey(alternative), alternative);
  const leave = env.enter();
  try {
    await eventually(() => assert.equal(env.current()?.candidates.length, 2));
    assert.deepEqual(env.current()?.links, []);
    assert.equal(await env.choose(alternative), true);
    assert.deepEqual(env.current()?.links.map(mr => mr.iid), [13]);
    assert.deepEqual(env.current()?.candidates, []);
  } finally {
    await leave();
  }
});

test('does no periodic reads at zero and stops refreshing when the thread is left', async () => {
  const env = fixture();
  const leave = env.enter();
  try {
    await eventually(() => assert.deepEqual(env.requests(), [1, 1]));
    await delay(25);
    assert.deepEqual(env.requests(), [1, 1]);
    // A short clock interval exercises the same watcher used for minute settings.
    env.interval(0.0002);
    await eventually(() => assert.ok(env.requests()[0] > 1));
  } finally {
    await leave();
  }
  const afterLeave = env.requests();
  await delay(40);
  assert.deepEqual(env.requests(), afterLeave);
});

test('offers an additional MR even when the thread already has a link for the branch', async () => {
  const env = fixture();
  let leave = env.enter();
  try {
    await eventually(() => assert.equal(env.current()?.links[0]?.iid, 12));
    await leave();
    const alternative = { ...second, branch: first.branch, target: 'release' };
    env.candidates = [first, alternative];
    env.details.set(mrKey(alternative), alternative);
    leave = env.enter();
    await eventually(() => assert.deepEqual(env.current()?.candidates.map(mr => mr.iid), [13]));
    assert.equal(await env.choose(alternative), true);
    assert.deepEqual(env.current()?.links.map(mr => mr.iid), [12, 13]);
  } finally {
    await leave();
  }
});

test('refreshes a saved MR using its stable project ID when its project path changes', async () => {
  const env = fixture();
  let leave = env.enter();
  try {
    await eventually(() => assert.equal(env.current()?.links[0]?.iid, 12));
    await leave();
    const moved = { ...first, project: 'group/moved-repo' };
    env.candidates = [];
    env.details.set(mrKey(first), moved);
    leave = env.enter();
    await eventually(() => {
      const links = env.current()!.links;
      assert.equal(links.length, 1);
      assert.equal(mrUrl(links[0]), 'https://gitlab.example.com/group/moved-repo/-/merge_requests/12');
    });
  } finally {
    await leave();
  }
});

test('reads cached sidebar statuses in one batch and fills in missing threads without contacting GitLab', async () => {
  const env = fixture();
  const leave = env.enter();
  try {
    await eventually(() => assert.equal(env.current()?.links[0]?.iid, 12));
  } finally {
    await leave();
  }
  const before = env.requests();
  const keys = [threadId, 'thr_missing'];
  const result = await env.snapshot(keys);
  assert.deepEqual(env.batches, [keys]);
  assert.equal(result[threadId].links[0].iid, 12);
  assert.deepEqual(result.thr_missing.links, []);
  assert.deepEqual(env.requests(), before);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from '../server';

test('saves colors independently even when two windows save at the same time', async () => {
  const { bb, harness } = createFakePluginHost();
  plugin(bb);
  await Promise.all([
    harness.callRpc('saveLabelColors', { worktree: '#8b5cf6' }),
    harness.callRpc('saveLabelColors', { branch: '#22c55e' }),
  ]);
  assert.deepEqual(await harness.callRpc('labelColors', null), { worktree: '#8b5cf6', branch: '#22c55e' });
  await harness.callRpc('saveLabelColors', { worktree: null });
  assert.deepEqual(await harness.callRpc('labelColors', null), { worktree: null, branch: '#22c55e' });
});

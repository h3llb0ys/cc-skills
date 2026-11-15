import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BindingStore } from '../lib/store.ts';
function setup() {
 const data = new Map<string, unknown>();
 return new BindingStore({ get: async key => data.get(key) ?? null, set: async (key, value) => { data.set(key,value); } });
}
test('stale agent cannot overwrite a manual removal, including an empty binding', async () => {
 const store = setup();
 await store.save('t', 0, ['AFT-1'], 'user asked');
 await store.save('t', 1, [], 'manual');
 await assert.rejects(store.save('t', 1, ['AFT-1'], 'stale'), /changed/);
 assert.deepEqual((await store.read('t')).keys, []);
 assert.equal((await store.read('t')).revision, 2);
});
test('concurrent edits cannot both commit the same revision', async () => {
 const store = setup();
 const results = await Promise.allSettled([store.save('t',0,['AFT-1'],'a'), store.save('t',0,['AFT-2'],'b')]);
 assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});

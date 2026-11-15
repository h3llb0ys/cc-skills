import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKeys, changeKeys } from '../lib/bindings.ts';
test('normalizes explicit keys and configured shorthand, deduplicates', () => {
  assert.deepEqual(normalizeKeys(['aft-1196', '1196', '1233'], 'AFT'), ['AFT-1196', 'AFT-1233']);
  assert.throws(() => normalizeKeys(['1196'], ''));
  assert.throws(() => normalizeKeys(['look at 1196'], 'AFT'));
});
test('add, remove and replace preserve independent concurrent tasks', () => {
  assert.deepEqual(changeKeys(['AFT-1'], 'add', ['AFT-2']), ['AFT-1','AFT-2']);
  assert.deepEqual(changeKeys(['AFT-1','AFT-2'], 'remove', ['AFT-1']), ['AFT-2']);
  assert.deepEqual(changeKeys(['AFT-1'], 'replace', []), []);
});

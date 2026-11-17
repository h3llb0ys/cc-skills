import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { experimental_scanPublicSdkOnly } from '@get-bb/plugin-sdk/testing';

test('plugin and tests depend only on public SDK and declared public packages', () => {
  const result = experimental_scanPublicSdkOnly(fileURLToPath(new URL('..', import.meta.url)), {
    allow: [/^jsdom$/, /^react$/, /^react-dom\/server$/],
  });
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.privateDependencies, []);
});

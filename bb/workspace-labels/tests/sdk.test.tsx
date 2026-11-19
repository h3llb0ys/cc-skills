import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { experimental_scanPublicSdkOnly } from '@get-bb/plugin-sdk/testing';

test('plugin and its shared palette depend only on public SDK and declared public packages', () => {
  const result = experimental_scanPublicSdkOnly(fileURLToPath(new URL('..', import.meta.url)), {
    allow: [/^better-sqlite3$/, /^jsdom$/, /^react$/, /^react-dom\/(?:client|server)$/, /^@radix-ui\/react-(?:dialog|tooltip)$/, /^sonner$/],
  });
  const violations = result.violations.filter(({ file, reason, specifier }) =>
    !(reason === 'outside-package' && (
      (file === 'color-settings.tsx' && specifier === '../shared-ui/color-palette') ||
      (file === 'tests/color-picker.test.tsx' && specifier === '../../shared-ui/color-palette')
    )),
  );
  assert.deepEqual(violations, []);
  assert.deepEqual(result.privateDependencies, []);

  const shared = experimental_scanPublicSdkOnly(fileURLToPath(new URL('../../shared-ui', import.meta.url)), {
    allow: [/^react$/],
  });
  assert.deepEqual(shared.violations, []);
  assert.deepEqual(shared.privateDependencies, []);
});

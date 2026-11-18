import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ColorPalette } from '../../shared-ui/color-palette';

test('an unrelated render preserves the native color draft and commits it once to the latest callback', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.querySelector('#root')!);
  const calls: (string | null)[] = [];
  try {
    await act(async () => root.render(<ColorPalette color={null} commitCustomColor
      onChange={() => assert.fail('stale callback')} />));
    const input = dom.window.document.querySelector('input')!;
    input.value = '#123456';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await act(async () => root.render(<ColorPalette color={null} commitCustomColor
      onChange={color => calls.push(color)} />));

    assert.equal(input.value, '#123456');
    assert.equal(calls.length, 0);
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.deepEqual([...calls], ['#123456']);

    await act(async () => root.render(<ColorPalette color="#22c55e" commitCustomColor
      onChange={color => calls.push(color)} />));
    assert.equal(input.value, '#22c55e');
    assert.deepEqual([...calls], ['#123456']);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

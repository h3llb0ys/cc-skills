import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  CustomEvent: dom.window.CustomEvent,
  HTMLElement: dom.window.HTMLElement,
  MutationObserver: dom.window.MutationObserver,
});
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

test('Jira sections show the current thread’s links and open its editor', async t => {
  const { loadPluginApp, renderSlot } = await import('@get-bb/plugin-sdk/testing/app');
  const app = await loadPluginApp(() => import('../app'));
  assert.equal(app.composerCustomizations.length, 0);

  const card = app.threadContextCardSections.find(section => section.id === 'jira-task-links');
  const info = app.threadInfoSections.find(section => section.id === 'jira-task-links');
  assert.ok(card);
  assert.equal(card.title, 'Задачи Jira');
  assert.ok(info);

  for (const section of [card, info]) {
    await t.test(section === card ? 'context card' : 'Info tab', async () => {
      const props = { threadId: 'thr_one', projectId: 'proj_one', environment: null };
      let keys: string[] = [];
      let openedThread: string | undefined;
      const onEdit = (event: Event) => { openedThread = (event as CustomEvent<string>).detail; };
      window.addEventListener('jira-thread-links:edit', onEdit);
      const slot = renderSlot(section, props, {
        rpc: {
          list: ({ threadIds }: { threadIds: string[] }) => Object.fromEntries(threadIds.map(id => [
            id,
            { keys: id === props.threadId ? keys : [], issues: id === props.threadId ? keys.filter(key => key !== 'AFT-404').map(key => ({
              key,
              summary: `Task ${key}`,
              url: `https://jira.example/browse/${key}`,
            })) : [] },
          ])),
        },
      });

      try {
        assert.equal(slot.queryByRole('navigation'), null);
        keys = ['AFT-1196'];
        await slot.behavior.emitRealtime('bindings-changed', { threadId: 'thr_one' });
        const link = await slot.findByRole('link', { name: 'AFT-1196 · Task AFT-1196' });
        assert.equal(link.getAttribute('href'), 'https://jira.example/browse/AFT-1196');
        assert.equal(link.getAttribute('target'), '_blank');
        assert.equal(slot.getAllByRole('link').length, 1);
        slot.getByRole('button', { name: 'Изменить' }).click();
        assert.equal(openedThread, 'thr_one');

        keys.push('AFT-1233');
        await slot.behavior.emitRealtime('bindings-changed', { threadId: 'thr_one' });
        await slot.findByRole('link', { name: 'AFT-1233 · Task AFT-1233' });
        assert.equal(slot.getAllByRole('link').length, 2);

        keys = ['AFT-404'];
        await slot.behavior.emitRealtime('bindings-changed', { threadId: 'thr_one' });
        assert.ok(slot.getByText('AFT-404'));
        assert.equal(slot.queryByRole('link'), null);
        assert.ok(slot.getByRole('button', { name: 'Изменить' }));

        keys = [];
        await slot.behavior.emitRealtime('bindings-changed', { threadId: 'thr_one' });
        assert.equal(slot.queryByRole('navigation'), null);
        assert.equal(slot.queryByRole('button', { name: 'Изменить' }), null);

        keys = ['AFT-1196'];
        await slot.behavior.emitRealtime('bindings-changed', { threadId: 'thr_one' });
        await slot.findByRole('link', { name: 'AFT-1196 · Task AFT-1196' });
        slot.lifecycle.rerender(createElement(section.component, { ...props, threadId: 'thr_two' }));
        assert.equal(slot.queryByRole('navigation'), null);
      } finally {
        window.removeEventListener('jira-thread-links:edit', onEdit);
        slot.lifecycle.unmount();
      }
    });
  }
});

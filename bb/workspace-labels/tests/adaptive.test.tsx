import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { adaptiveRows } from '../adaptive';

function fixture(t: TestContext) {
  const dom = new JSDOM(`<section class="list"><div data-sidebar-rename-row><span class="content"><a data-sidebar-thread-id="t"></a><span class="title-line"><span class="bb-thread-title">Title</span><a data-jira-task-link href="https://jira.example/T-1">T-1</a></span><span class="metadata-line"><span data-thread-row-metadata><div><span class="workspace-labels" data-workspace-auto-inline="true"><span data-workspace-kind="branch">main</span></span></div></span></span></span></div></section>`);
  const { window: win } = dom;
  const doc = win.document;
  const content = doc.querySelector<HTMLElement>('.content')!;
  const title = doc.querySelector('.bb-thread-title')!;
  const link = doc.querySelector('[data-jira-task-link]')!;
  const label = doc.querySelector<HTMLElement>('.workspace-labels')!;
  const size = { available: 300, required: 200 };
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  win.requestAnimationFrame = callback => { frames.set(++serial, callback); return serial; };
  win.cancelAnimationFrame = id => { frames.delete(id); };
  win.HTMLElement.prototype.getBoundingClientRect = function () {
    return { width: this.closest('[data-workspace-labels-measure]') ? size.required : size.available } as DOMRect;
  };
  async function flush() {
    for (let step = 0; step < 6; step++) {
      await Promise.resolve();
      const callbacks = [...frames.values()]; frames.clear();
      for (const callback of callbacks) callback(0);
    }
    await Promise.resolve();
    assert.equal(frames.size, 0, 'measurement must settle, not create an observer loop');
  }
  const dispose = adaptiveRows(doc);
  const inline = () => content.classList.contains('workspace-labels-inline-content');
  t.after(() => { dispose(); win.close(); });
  return { win, doc, content, title, link, label, size, frames, flush, dispose, inline };
}

test('adaptive lifecycle: resize, text mutations, opt-out and cleanup preserve existing nodes', async t => {
  const f = fixture(t);
  await f.flush();
  assert.ok(f.inline());
  f.size.available = 150; f.win.dispatchEvent(new f.win.Event('resize')); await f.flush();
  assert.ok(!f.inline());
  f.size.available = 300; f.win.dispatchEvent(new f.win.Event('resize')); await f.flush();
  assert.ok(f.inline());
  f.size.required = 350; f.title.textContent = 'Long title'; await f.flush();
  assert.ok(!f.inline());
  f.size.required = 200; f.title.textContent = 'Title'; await f.flush();
  f.label.dataset.workspaceAutoInline = 'false'; await f.flush();
  assert.ok(!f.inline());
  f.label.dataset.workspaceAutoInline = 'true'; await f.flush();
  assert.ok(f.inline());
  assert.equal(f.doc.querySelector('.bb-thread-title'), f.title);
  assert.equal(f.doc.querySelector('[data-jira-task-link]'), f.link);
  assert.equal(f.link.getAttribute('href'), 'https://jira.example/T-1');
  assert.ok(f.doc.querySelector('[data-workspace-labels-inline-style]'));
  f.dispose(); f.dispose();
  assert.equal(f.doc.querySelector('[data-workspace-labels-measure]'), null);
  assert.equal(f.doc.querySelector('[data-workspace-labels-inline-style]'), null);
  assert.equal(f.doc.querySelector('[class*="workspace-labels-inline"]'), null);
  assert.equal(f.doc.querySelector('[data-jira-task-link]'), f.link);
  f.win.dispatchEvent(new f.win.Event('resize')); assert.equal(f.frames.size, 0);
});

test('removing and reinserting a nested row releases its layout without ResizeObserver', async t => {
  const f = fixture(t);
  await f.flush(); assert.ok(f.inline());
  const native = f.content.closest<HTMLElement>('[data-sidebar-rename-row]')!;
  native.remove(); await f.flush();
  assert.ok(!f.inline(), 'a detached row must not retain layout classes');
  f.doc.querySelector('.list')!.append(native); await f.flush();
  assert.ok(f.inline());
});

test('another plugin with a CSS-only icon retains its native metadata line', async t => {
  const f = fixture(t);
  await f.flush(); assert.ok(f.inline());
  const other = f.doc.createElement('div');
  other.innerHTML = '<span style="display:inline-block;width:14px;height:14px;background:currentColor"></span>';
  f.label.closest('[data-thread-row-metadata]')!.append(other); await f.flush();
  assert.ok(!f.inline(), 'metadata without text/SVG still occupies space');
  other.remove(); await f.flush(); assert.ok(f.inline());
});

test('two details labels remain below the title and React replacements release old classes', async t => {
  const f = fixture(t);
  await f.flush(); assert.ok(f.inline());
  const second = f.doc.createElement('span'); second.dataset.workspaceKind = 'worktree';
  f.label.append(second); await f.flush(); assert.ok(!f.inline());
  second.remove(); await f.flush(); assert.ok(f.inline());
  const old = f.label.closest<HTMLElement>('.metadata-line')!;
  const next = old.cloneNode(true) as HTMLElement;
  next.classList.remove('workspace-labels-inline-line'); old.replaceWith(next); await f.flush();
  assert.ok(!old.classList.contains('workspace-labels-inline-line'));
  assert.ok(next.classList.contains('workspace-labels-inline-line'));
});

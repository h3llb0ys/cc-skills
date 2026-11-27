import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { threadRowWorkspace, workspaceRowDetails } from '../../shared-ui/thread-row';
import { mountCompactRows } from '../lib/compact-rows';

test('presents the first link of each kind and keeps remaining links and workspace in one menu', async () => {
 const dom = new JSDOM(`<div data-testid="app-sidebar-body"><div data-sidebar-rename-row>
   <span id="content"><a data-sidebar-thread-id="t" href="/thread/t"></a>
    <span><span class="bb-thread-title" title="Реализация консьюмера AuthEvent">AuthEvent</span>
     <span data-bb-thread-row-links="jira" data-bb-thread-row-color="#4488ff">
      <a href="https://jira.example/AFT-1346">AFT-1346</a><a href="https://jira.example/AFT-863">AFT-863</a>
     </span>
    </span>
    <span data-bb-thread-row-links="mr">
     <a href="https://git.example/mr/629">!629</a><a href="https://git.example/mr/628">!628</a>
    </span>
    <span id="workspace"></span>
   </span>
 </div></div>`, { pretendToBeVisual: true });
 const doc = dom.window.document;
 const source = doc.getElementById('workspace')!;
 source.setAttribute(threadRowWorkspace, workspaceRowDetails([
  { kind: 'worktree', text: 'fraudcore/AFT-1346', title: '/local/fraudcore/AFT-1346', color: '#d9bb72' },
  { kind: 'branch', text: 'feature/auth', color: '#6bd598' },
 ])[threadRowWorkspace]);
 const anchor = doc.querySelector<HTMLAnchorElement>('a[data-sidebar-thread-id]')!;
 const dispose = mountCompactRows(doc);
 const inline = () => [...doc.querySelectorAll('.section-style-compact-links > a')].map(a => a.textContent);
 const extra = () => [...doc.querySelectorAll('.section-style-compact-popup a')].map(a => a.textContent);
 const more = () => doc.querySelector('.section-style-compact-more')?.textContent;

 try {
  assert.deepEqual(inline(), ['AFT-1346', '!629']);
  assert.deepEqual(extra(), ['AFT-863', '!628']);
  assert.equal(more(), '+2');
  assert.equal(anchor.title, 'Реализация консьюмера AuthEvent');
  assert.equal(doc.querySelector('.section-style-compact-popup-title')?.textContent, anchor.title);
  const button = doc.querySelector<HTMLButtonElement>('.section-style-compact-more')!;
  button.getBoundingClientRect = () => new dom.window.DOMRect(173, 710, 24, 20);
  button.click();
  const popup = doc.querySelector<HTMLElement>('.section-style-compact-popup')!;
  assert.equal(popup.style.maxWidth, '189px');
  assert.equal(popup.style.bottom, `${dom.window.innerHeight - 706}px`);
  const worktree = popup.querySelector<HTMLElement>('[data-kind="worktree"] > span')!;
  const branch = popup.querySelector<HTMLElement>('[data-kind="branch"] > span')!;
  assert.equal(worktree.textContent, 'fraudcore/AFT-1346');
  assert.equal(worktree.title, '/local/fraudcore/AFT-1346');
  assert.equal(worktree.style.color, 'rgb(217, 187, 114)');
  assert.equal(branch.textContent, 'feature/auth');
  assert.equal(branch.style.color, 'rgb(107, 213, 152)');
  doc.querySelector('[data-bb-thread-row-links="mr"]')!.remove();
  await new Promise(resolve => dom.window.setTimeout(resolve, 35));
  assert.deepEqual(inline(), ['AFT-1346']);
  assert.deepEqual(extra(), ['AFT-863']);
  assert.equal(more(), '+1');
  assert.equal(doc.querySelector('.section-style-compact-more'), button);
  assert.equal(doc.querySelector('.section-style-compact-popup'), popup);

  doc.querySelector('.bb-thread-title')!.setAttribute('title', 'Новое полное название треда');
  await new Promise(resolve => dom.window.setTimeout(resolve, 35));
  assert.equal(anchor.title, 'Новое полное название треда');
  assert.equal(doc.querySelector('.section-style-compact-popup-title')?.textContent, anchor.title);

  const content = doc.getElementById('content')!;
  Object.defineProperty(content, 'clientWidth', { value: 200 });
  source.setAttribute(threadRowWorkspace, workspaceRowDetails([
   { kind: 'branch', text: 'feature/auth', color: '#5588ff' },
  ])[threadRowWorkspace]);
  await new Promise(resolve => dom.window.setTimeout(resolve, 35));
  assert.deepEqual(inline(), []);
  assert.deepEqual(extra(), ['AFT-1346', 'AFT-863']);
  assert.equal(doc.querySelector<HTMLElement>('.section-style-compact-workspace [data-kind="branch"] > span')?.style.color,
   'rgb(85, 136, 255)');

  button.focus();
  assert.equal(doc.activeElement, button);
  source.remove();
  doc.querySelector('[data-bb-thread-row-links="jira"]')!.remove();
  await new Promise(resolve => dom.window.setTimeout(resolve, 35));
  assert.equal(doc.activeElement, anchor);
  assert.equal(doc.querySelector('.section-style-compact-popup'), null);
 } finally {
  dispose();
  assert.equal(doc.querySelector('.section-style-compact-links'), null);
  assert.equal(anchor.hasAttribute('title'), false);
  assert.equal(doc.querySelector('[data-bb-compact-thread-row]'), null);

  dom.window.close();
 }
});

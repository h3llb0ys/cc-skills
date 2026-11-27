import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { mountSidebarCollapse } from '../lib/sidebar-collapse';

const control = '[data-section-style-collapse] button';

test('collapses rendered child branches before their parents and optionally closes groups', () => {
 const dom = new JSDOM(`
  <div data-testid="app-sidebar-body">
   <div data-testid="app-sidebar-top-reserve-row">
    <div data-testid="sidebar-header-slot"><button id="new">New thread</button></div>
   </div>
   <div data-sidebar-visibility-group="threads" id="group">
    <div data-sidebar-rename-row>
     <button data-sidebar-rename-anchor aria-expanded="true" aria-label="Collapse Threads section" id="section"></button>
    </div>
    <div id="rows">
     <div data-sidebar-rename-row>
      <a data-sidebar-thread-id="thr_parent"></a>
      <button data-sidebar-rename-anchor aria-expanded="true" aria-label="Collapse Parent threads" id="parent"></button>
     </div>
     <div id="children">
      <div data-sidebar-rename-row>
       <button data-sidebar-rename-anchor aria-expanded="true" aria-label="Collapse Worktree threads" id="environment"></button>
      </div>
      <div data-sidebar-rename-row>
       <a data-sidebar-thread-id="thr_child"></a>
       <button data-sidebar-rename-anchor aria-expanded="true" aria-label="Collapse Child threads" id="child"></button>
       <button aria-expanded="true" aria-label="Thread actions" id="menu"></button>
      </div>
     </div>
    </div>
   </div>
   <div data-sidebar-overflow="true">
    <button data-sidebar-rename-anchor aria-expanded="true" aria-label="Collapse Hidden section" id="overflow"></button>
   </div>
  </div>`);
 const doc = dom.window.document;
 const get = (id: string) => doc.getElementById(id)!;
 const calls: string[] = [];
 for (const id of ['child', 'parent', 'section', 'menu', 'overflow', 'environment']) {
  get(id).addEventListener('click', event => {
   calls.push(id);
   (event.currentTarget as HTMLElement).setAttribute('aria-expanded', 'false');
   if (id === 'parent') doc.getElementById('children')?.remove();
   if (id === 'section') get('rows').remove();
  });
 }
 const dispose = mountSidebarCollapse(doc);
 try {
  const [threads, all] = doc.querySelectorAll<HTMLButtonElement>(control);
  assert.equal(doc.querySelector('[data-testid="sidebar-header-slot"]')!.firstElementChild, get('new'));
  threads.click();
  assert.deepEqual(calls, ['child', 'parent']);
  assert.equal(get('section').getAttribute('aria-expanded'), 'true');
  get('parent').setAttribute('aria-expanded', 'true');
  all.click();
  all.click();
  assert.deepEqual(calls, ['child', 'parent', 'parent', 'section']);
 } finally {
  dispose();
  assert.equal(doc.querySelectorAll(control).length, 0);
  dom.window.close();
 }
});

test('attaches when the native list appears, follows a header remount and cleans up', async () => {
 const dom = new JSDOM(`
  <div data-testid="app-sidebar-body">
   <div data-testid="app-sidebar-top-reserve-row">
    <div data-testid="sidebar-header-slot"></div>
   </div>
  </div>`);
 const doc = dom.window.document;
 const dispose = mountSidebarCollapse(doc);
 try {
  assert.equal(doc.querySelectorAll(control).length, 0);
  const group = doc.createElement('div');
  group.setAttribute('data-sidebar-visibility-group', 'threads');
  doc.querySelector('[data-testid="app-sidebar-body"]')!.append(group);
  await Promise.resolve();
  assert.equal(doc.querySelectorAll(control).length, 2);
  const oldHeader = doc.querySelector('[data-testid="sidebar-header-slot"]')!;
  const newHeader = oldHeader.cloneNode() as HTMLElement;
  oldHeader.replaceWith(newHeader);
  await Promise.resolve();
  assert.equal(oldHeader.querySelectorAll(control).length, 0);
  assert.equal(newHeader.querySelectorAll(control).length, 2);
  group.remove();
  await Promise.resolve();
  assert.equal(doc.querySelectorAll(control).length, 0);
 } finally {
  dispose();
  dom.window.close();
 }
});

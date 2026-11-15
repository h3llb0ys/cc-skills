import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { decorateRows } from '../lib/rows.ts';
const issue = (key: string) => ({ key, summary: 'Task <script>', url: `https://jira.example/browse/${key}` });
function setup() {
 const dom = new JSDOM('<div data-sidebar-rename-row><span><a data-sidebar-thread-id="thr_a"></a><span><span><span class="bb-thread-title">Title</span></span></span></span></div>');
 return { doc: dom.window.document, dom };
}
test('single inline, multiple below, zero removes decoration; dispose cleans up', () => {
 const { doc } = setup();
 const decorate = decorateRows(doc);
 decorate.update({thr_a: [issue('AFT-1')]});
 assert.equal(doc.querySelectorAll('[data-jira-task-link]').length, 1);
 assert.ok(doc.querySelector('.jira-task-title-single'));
 decorate.update({thr_a: [issue('AFT-1'),issue('AFT-2')]});
 assert.ok(doc.querySelector('.jira-task-row-multiple'));
 assert.equal(doc.querySelectorAll('[data-jira-task-link]').length, 2);
 assert.equal(doc.querySelector('script'), null);
 decorate.update({});
 assert.equal(doc.querySelector('[data-jira-task-links]'), null);
 decorate.update({thr_a: [issue('AFT-1')]});
 decorate.dispose();
 assert.equal(doc.querySelector('[data-jira-task-links]'), null);
 assert.equal(doc.querySelector('[class*="jira-task-"]'), null);
});
test('links open Jira without activating the thread and unsafe URL is omitted', () => {
 const { doc, dom } = setup(); const decorate = decorateRows(doc);
 decorate.update({thr_a: [issue('AFT-1'), {...issue('AFT-2'), url:'javascript:alert(1)'}]});
 let clicks=0; doc.body.addEventListener('click', () => clicks++);
 doc.querySelector('[data-jira-task-link]')!.dispatchEvent(new dom.window.MouseEvent('click', {bubbles:true, cancelable:true}));
 assert.equal(clicks,0);
 assert.equal(doc.querySelectorAll('[data-jira-task-link]').length,1);
 decorate.dispose();
});
test('host rerender that resets row classes restores multiple-task layout', async () => {
 const { doc } = setup(); const decorate = decorateRows(doc);
 decorate.update({thr_a:[issue('AFT-1'),issue('AFT-2')]});
 const row=doc.querySelector('[data-sidebar-rename-row]')!;
 row.className='selected';
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.ok(row.classList.contains('jira-task-row-multiple'));
 decorate.dispose();
});

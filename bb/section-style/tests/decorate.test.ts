import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { decorateHeaders, editEvent } from '../lib/decorate';
const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
function setup() {
 const dom=new JSDOM(`<html><head></head><body><div data-sidebar-project-id="proj_a"><div data-sidebar-rename-row><div class="text-left"><span class="truncate">Project</span><button aria-haspopup="menu" aria-controls="heading-menu">…</button></div></div><div data-sidebar-section-id="sec_a"><div data-sidebar-rename-row><div class="text-left"><span class="truncate">Section</span><button aria-haspopup="menu" aria-controls="heading-menu">…</button></div></div><div data-sidebar-rename-row><a data-sidebar-thread-id="thr_a">Thread</a></div></div></div></body></html>`,{pretendToBeVisual:true});
 const doc=dom.window.document;
 return {dom,doc,dec:decorateHeaders(doc)};
}
test('targets nested sections separately, keeps host text, controls and rows, and cleans up',async()=>{
 const {dom,doc,dec}=setup();const body=doc.body.innerHTML;
 const rows=[...doc.querySelectorAll('[data-sidebar-rename-row]')];
 const controls=[...doc.querySelectorAll('button')];
 dec.update({'section:sec_a':{color:'#ec4899',icon:'folder',emoji:null},'project:proj_a':{color:'#14b8a6',icon:null,emoji:'🚀'}});
 await tick();
 const titles=[...doc.querySelectorAll<HTMLElement>('.truncate')];
 assert.equal(titles[0].style.getPropertyValue('--heading-appearance-color'),'#14b8a6');
 assert.equal(titles[1].style.getPropertyValue('--heading-appearance-color'),'#ec4899');
 assert.equal(titles[1].textContent,'Section');
 assert.deepEqual([...doc.querySelectorAll('[data-sidebar-rename-row]')],rows);
 assert.deepEqual([...doc.querySelectorAll('button')],controls);
 titles[1].className='truncate'; // React rewrites host classes.
 await tick();assert.ok(titles[1].classList.contains('bb-heading-appearance-icon'));
 dec.update({});await tick();
 assert.ok(!doc.querySelector('.bb-heading-appearance'));
 dec.dispose();assert.equal(doc.head.innerHTML,'');
 // Empty style/class attributes are harmless, but remove them when comparing ownership.
 for(const title of titles){if(!title.getAttribute('style'))title.removeAttribute('style');}
 assert.equal(doc.body.innerHTML,body);
 dom.window.close();
});
test('adds a single menu entry only after a heading trigger and removes it on unload',async()=>{
 const {dom,doc,dec}=setup();
 const trigger=doc.querySelector('button')!;
 trigger.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
 const menu=doc.createElement('div');menu.id='heading-menu';menu.role='menu';menu.dataset.state='open';menu.innerHTML='<button role="menuitem">Rename</button>';doc.body.append(menu);
 await tick();assert.equal(menu.querySelectorAll('[data-section-style-menu]').length,1);
 let target:unknown;
 dom.window.addEventListener(editEvent,event=>{target=(event as CustomEvent).detail;});
 (menu.querySelector('[data-section-style-menu]') as HTMLElement).click();
 await tick();assert.deepEqual(target,{key:'project:proj_a',name:'Project'});
 dec.dispose();assert.equal(menu.querySelector('[data-section-style-menu]'),null);dom.window.close();
});
test('replaces a title during rename and reapplies by ID without touching thread labels',async()=>{
 const {dom,doc,dec}=setup();
 dec.update({'section:sec_a':{color:'#ec4899',icon:null,emoji:null}});
 const old=doc.querySelector('[data-sidebar-section-id] .truncate')!;
 const replacement=old.cloneNode() as HTMLElement;replacement.className='truncate';replacement.textContent='Renamed';replacement.removeAttribute('style');old.replaceWith(replacement);
 await tick();assert.equal(replacement.style.getPropertyValue('--heading-appearance-color'),'#ec4899');
 assert.equal(doc.querySelector('[data-sidebar-thread-id]')!.getAttribute('style'),null);
 dec.dispose();dom.window.close();
});
test('project headings nested inside sections keep their own appearance',()=>{
 const dom=new JSDOM('<html><head></head><body><div data-sidebar-section-id="sec_a"><div class="text-left"><span class="truncate">Section</span></div><div data-sidebar-project-id="proj_a"><div class="text-left"><span class="truncate">Project</span></div></div></div></body></html>');
 const doc=dom.window.document;const dec=decorateHeaders(doc);
 dec.update({'section:sec_a':{color:'#ec4899',icon:null,emoji:null},'project:proj_a':{color:'#14b8a6',icon:'folder',emoji:null}});
 assert.equal((doc.querySelector('[data-sidebar-project-id] .truncate') as HTMLElement).style.getPropertyValue('--heading-appearance-color'),'#14b8a6');
 dec.dispose();dom.window.close();
});
test('heading menu entry is keyboard reachable and does not enter unrelated menus',async()=>{
 const {dom,doc,dec}=setup();
 const menu=doc.createElement('div');menu.id='heading-menu';menu.role='menu';menu.dataset.state='open';menu.innerHTML='<button role="menuitem">Rename</button>';doc.body.append(menu);
 await tick();assert.equal(menu.querySelector('[data-section-style-menu]'),null);
 doc.querySelector('button')!.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
 menu.append(doc.createElement('span'));await tick();
 const host=menu.querySelector<HTMLElement>('[role="menuitem"]:not([data-section-style-menu])')!;host.focus();
 host.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
 const own=menu.querySelector('[data-section-style-menu]')!;assert.equal(doc.activeElement,own);
 own.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));assert.equal(doc.activeElement,host);
 dec.dispose();dom.window.close();
});
test('does not decorate unrelated menus or portalled submenus after a heading click',async()=>{
 const {dom,doc,dec}=setup();
 doc.querySelector('button')!.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
 const unrelated=doc.createElement('div');unrelated.role='menu';unrelated.dataset.state='open';unrelated.id='thread-menu';doc.body.append(unrelated);
 await tick();assert.equal(unrelated.querySelector('[data-section-style-menu]'),null);
 const root=doc.createElement('div');root.role='menu';root.dataset.state='open';root.id='heading-menu';doc.body.append(root);
 await tick();assert.ok(root.querySelector('[data-section-style-menu]'));
 const submenu=doc.createElement('div');submenu.role='menu';submenu.dataset.state='open';submenu.id='sort-menu';doc.body.append(submenu);
 await tick();assert.equal(submenu.querySelector('[data-section-style-menu]'),null);
 root.remove();await tick();assert.equal(submenu.querySelector('[data-section-style-menu]'),null);
 dec.dispose();dom.window.close();
});
test('opening a heading menu by keyboard identifies the target',async()=>{
 const {dom,doc,dec}=setup();
 const trigger=doc.querySelector('button')!;
 trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
 const menu=doc.createElement('div');menu.id='heading-menu';menu.role='menu';menu.dataset.state='open';doc.body.append(menu);
 await tick();assert.ok(menu.querySelector('[data-section-style-menu]'));
 dec.dispose();dom.window.close();
});

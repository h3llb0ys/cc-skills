import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', {url:'http://localhost'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,MutationObserver:dom.window.MutationObserver});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
test('composer shows its own task links, follows realtime, and clears on thread switch', async () => {
 const {loadPluginApp,renderSlot} = await import('@get-bb/plugin-sdk/testing/app');
 const app=await loadPluginApp(()=>import('../app'));
 const banner=app.composerCustomizations.find(c=>c.id==='jira-active-tasks')?.banners?.[0];
 assert.ok(banner, 'task banner is registered');
 let keys=['AFT-1196','AFT-1233'];
 const slot=renderSlot(banner,{}, {composer:{scope:{kind:'thread',threadId:'thr_one'}},rpc:{list:({threadIds}: {threadIds:string[]})=>Object.fromEntries(threadIds.map(id=>[id,{keys,revision:1,reason:'test',updatedAt:1,prefix:'AFT',issues:id==='thr_one'?keys.map(key=>({key,summary:`Task ${key}`,url:`https://jira.example/browse/${key}`})):[]}]))}});
 try {
   const link=await slot.findByRole('link',{name:'AFT-1196 · Task AFT-1196'});
   assert.equal(link.getAttribute('href'),'https://jira.example/browse/AFT-1196');
   assert.equal(link.getAttribute('target'),'_blank');
   await slot.findByRole('link',{name:'AFT-1233 · Task AFT-1233'});
   keys=[];
   await slot.behavior.emitRealtime('bindings-changed',{threadId:'thr_one'});
   assert.equal(slot.queryByRole('link'),null);
   keys=['AFT-1196'];
   await slot.behavior.emitRealtime('bindings-changed',{threadId:'thr_one'});
   await slot.findByRole('link',{name:'AFT-1196 · Task AFT-1196'});
   await slot.behavior.setComposerScope({kind:'thread',threadId:'thr_two'});
   assert.equal(slot.queryByRole('link'),null);
 } finally {slot.lifecycle.unmount();}
});

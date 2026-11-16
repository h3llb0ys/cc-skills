import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0)});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};

test('editor selects multiple suggestions with manual input and saves only on confirmation',async()=>{
 const {loadPluginApp,renderSlot}=await import('@get-bb/plugin-sdk/testing/app');
 const {fireEvent,waitFor,act}=await import('@testing-library/react');
 const app=await loadPluginApp(()=>import('../app'));
 const view={keys:['AFT-1'],revision:3,reason:'test',updatedAt:1,issues:[],prefix:'AFT'};
 const edits:any[]=[];
 const slot=renderSlot(app.appOverlays[0],{}, {rpc:{
   list:()=>({thr_test:view}),
   candidates:()=>({candidates:[{key:'AFT-1',context:'First'},{key:'AFT-2',context:'Second'}],truncated:false}),
   edit:(input:any)=>{edits.push(input);return view;},
 }});
 try {
   await act(async()=>{window.dispatchEvent(new dom.window.CustomEvent('jira-thread-links:edit',{detail:'thr_test'}));});
   const first=await slot.findByRole('checkbox',{name:'AFT-1'}) as HTMLInputElement;
   const second=await slot.findByRole('checkbox',{name:'AFT-2'}) as HTMLInputElement;
   assert.equal(first.checked,true);
   assert.equal(second.checked,false);
   const input=slot.getByLabelText('Номера задач через запятую') as HTMLInputElement;
   fireEvent.change(input,{target:{value:'AFT-1, AFT-9'}});
   fireEvent.click(second);
   assert.equal(input.value,'AFT-1, AFT-9, AFT-2');
   fireEvent.click(first);
   assert.equal(input.value,'AFT-9, AFT-2');
   assert.equal(edits.length,0);
   fireEvent.click(slot.getByRole('button',{name:'Сохранить'}));
   await waitFor(()=>assert.equal(edits.length,1));
   assert.deepEqual(edits[0].keys,['AFT-9','AFT-2']);
   assert.equal(edits[0].expectedRevision,3);
 } finally {slot.lifecycle.unmount();}
});

test('manual input remains usable when history lookup fails and cancel does not save',async()=>{
 const {loadPluginApp,renderSlot}=await import('@get-bb/plugin-sdk/testing/app');
 const {fireEvent,act}=await import('@testing-library/react');
 const app=await loadPluginApp(()=>import('../app'));
 let edits=0;
 const slot=renderSlot(app.appOverlays[0],{}, {rpc:{
   list:()=>({thr_test:{keys:[],revision:0,reason:'',updatedAt:0,issues:[],prefix:''}}),
   candidates:()=>{throw new Error('history unavailable');},
   edit:()=>{edits++;},
 }});
 try {
   await act(async()=>{window.dispatchEvent(new dom.window.CustomEvent('jira-thread-links:edit',{detail:'thr_test'}));});
   await slot.findByRole('alert');
   const input=slot.getByLabelText('Номера задач через запятую') as HTMLInputElement;
   assert.equal(input.disabled,false);
   fireEvent.change(input,{target:{value:'PRGROW-589'}});
   fireEvent.click(slot.getByRole('button',{name:'Отмена'}));
   assert.equal(edits,0);
 } finally {slot.lifecycle.unmount();}
});

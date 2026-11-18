import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,MutationObserver:dom.window.MutationObserver});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};

async function mount(rpc: Record<string, (...args:any[])=>any>) {
 const {loadPluginApp,renderSlot}=await import('@get-bb/plugin-sdk/testing/app');
 const app=await loadPluginApp(()=>import('../app'));
 const section=app.settingsSections.find(s=>s.id==='sidebar-color');assert.ok(section);
 const slot=renderSlot(section,{}, {rpc});
 await slot.findByRole('button',{name:'#8b5cf6'});
 return slot;
}

test('palette, custom color and reset save immediately without action buttons',async()=>{
 const {fireEvent,waitFor}=await import('@testing-library/react');
 const saved:unknown[]=[];
 const slot=await mount({sidebarAppearance:()=>({color:null}),saveSidebarAppearance:(input)=>{saved.push(input);return input;}});
 try {
  assert.equal(Boolean(slot.queryByRole('button',{name:'Сохранить'})),false);
  assert.equal(Boolean(slot.queryByRole('button',{name:'Отменить изменения'})),false);
  assert.equal(Boolean(slot.queryByRole('dialog')),false);
  fireEvent.click(slot.getByRole('button',{name:'#8b5cf6'}));
  await waitFor(()=>assert.equal(slot.container.querySelector('fieldset')!.disabled,false));
  assert.deepEqual(saved,[{color:'#8b5cf6'}]);
  fireEvent.change(slot.getByLabelText('Произвольный цвет'),{target:{value:'#123456'}});
  await waitFor(()=>assert.equal(slot.container.querySelector('fieldset')!.disabled,false));
  assert.deepEqual(saved[1],{color:'#123456'});
  fireEvent.click(slot.getByRole('button',{name:'По умолчанию'}));
  await waitFor(()=>assert.equal(slot.container.querySelector('fieldset')!.disabled,false));
  assert.deepEqual(saved[2],{color:null});
  fireEvent.click(slot.getByRole('button',{name:'По умолчанию'}));
  assert.equal(saved.length,3);
 }finally{slot.lifecycle.unmount();}
});

test('failed save restores the latest remote color and allows retry',async()=>{
 const {fireEvent,waitFor,act}=await import('@testing-library/react');
 let stored={color:null as string|null};let rejectSave:(error:Error)=>void=()=>{};
 let fail=true;
 const slot=await mount({sidebarAppearance:()=>stored,saveSidebarAppearance:(input)=>fail?new Promise((_,reject)=>{rejectSave=reject;}):input});
 try {
  fireEvent.click(slot.getByRole('button',{name:'#8b5cf6'}));
  assert.equal(slot.container.querySelector('fieldset')!.disabled,true);
  assert.equal(slot.getByRole('button',{name:'#8b5cf6'}).getAttribute('aria-pressed'),'true');
  stored={color:'#22c55e'};
  await act(async()=>{slot.behavior.emitRealtime('sidebar-appearance-changed',{});});
  await act(async()=>{rejectSave(new Error('offline'));});
  assert.equal(slot.getByRole('button',{name:'#22c55e'}).getAttribute('aria-pressed'),'true');
  assert.match(slot.getByRole('alert').textContent!,/offline/);
  fail=false;
  fireEvent.click(slot.getByRole('button',{name:'#8b5cf6'}));
  await waitFor(()=>assert.equal(slot.container.querySelector('fieldset')!.disabled,false));
  assert.equal(Boolean(slot.queryByRole('alert')),false);
  assert.equal(slot.getByRole('button',{name:'#8b5cf6'}).getAttribute('aria-pressed'),'true');
 }finally{slot.lifecycle.unmount();}
});

test('successful immediate save ignores an older read and follows later remote updates',async()=>{
 const {fireEvent,act}=await import('@testing-library/react');
 let reads=0;let finishRead:(value:{color:null})=>void=()=>{};
 const slot=await mount({sidebarAppearance:()=>{reads++;if(reads===1)return {color:null};if(reads===2)return new Promise(resolve=>{finishRead=resolve;});return {color:'#ef4444'};},saveSidebarAppearance:input=>input});
 try {
  await act(async()=>{slot.behavior.emitRealtime('sidebar-appearance-changed',{});});
  await act(async()=>{fireEvent.click(slot.getByRole('button',{name:'#8b5cf6'}));});
  await act(async()=>{finishRead({color:null});});
  assert.equal(reads,2);
  assert.equal(slot.getByRole('button',{name:'#8b5cf6'}).getAttribute('aria-pressed'),'true');
  await act(async()=>{slot.behavior.emitRealtime('sidebar-appearance-changed',{});});
  assert.equal(slot.getByRole('button',{name:'#ef4444'}).getAttribute('aria-pressed'),'true');
 }finally{slot.lifecycle.unmount();}
});

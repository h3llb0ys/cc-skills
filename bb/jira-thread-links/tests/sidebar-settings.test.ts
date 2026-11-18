import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,MutationObserver:dom.window.MutationObserver});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
test('settings expose the palette inline, support custom color and save/reset without a dialog',async()=>{
 const {loadPluginApp,renderSlot}=await import('@get-bb/plugin-sdk/testing/app');
 const {fireEvent,waitFor}=await import('@testing-library/react');
 const app=await loadPluginApp(()=>import('../app'));
 const saved:any[]=[];let stored={color:null as string|null};
 const section=app.settingsSections.find(s=>s.id==='sidebar-color');assert.ok(section);
 const slot=renderSlot(section,{}, {rpc:{sidebarAppearance:()=>stored,saveSidebarAppearance:(input:any)=>{saved.push(input);stored=input;return input;}}});
 try {
  const purple=await slot.findByRole('button',{name:'#8b5cf6'});
  assert.equal(Boolean(slot.queryByRole('dialog')),false);
  assert.equal(Boolean(slot.queryByRole('button',{name:'Цвет задач…'})),false);
  fireEvent.click(purple);
  fireEvent.click(slot.getByRole('button',{name:'Отменить изменения'}));
  assert.equal(saved.length,0);
  assert.equal(slot.getByRole('button',{name:'По умолчанию'}).getAttribute('aria-pressed'),'true');
  fireEvent.change(slot.getByLabelText('Произвольный цвет'),{target:{value:'#123456'}});
  fireEvent.click(slot.getByRole('button',{name:'Сохранить'}));
  await waitFor(()=>assert.equal(saved.length,1));
  assert.deepEqual(saved[0],{color:'#123456'});
  await waitFor(()=>assert.equal((slot.getByRole('button',{name:'Сохранить'}) as HTMLButtonElement).disabled,true));
  fireEvent.click(slot.getByRole('button',{name:'По умолчанию'}));
  fireEvent.click(slot.getByRole('button',{name:'Сохранить'}));
  await waitFor(()=>assert.equal(saved.length,2));
  assert.deepEqual(saved[1],{color:null});
 }finally{slot.lifecycle.unmount();}
});

test('remote updates preserve a draft and cancel restores the latest saved color',async()=>{
 const {loadPluginApp,renderSlot}=await import('@get-bb/plugin-sdk/testing/app');
 const {fireEvent,waitFor,act}=await import('@testing-library/react');
 const app=await loadPluginApp(()=>import('../app'));
 let stored={color:null as string|null};
 const section=app.settingsSections.find(s=>s.id==='sidebar-color');assert.ok(section);
 const slot=renderSlot(section,{}, {rpc:{sidebarAppearance:()=>stored}});
 try {
  fireEvent.click(await slot.findByRole('button',{name:'#8b5cf6'}));
  stored={color:'#22c55e'};
  await act(async()=>{slot.behavior.emitRealtime('sidebar-appearance-changed',{});});
  assert.equal(slot.getByRole('button',{name:'#8b5cf6'}).getAttribute('aria-pressed'),'true');
  fireEvent.click(slot.getByRole('button',{name:'Отменить изменения'}));
  assert.equal(slot.getByRole('button',{name:'#22c55e'}).getAttribute('aria-pressed'),'true');
  stored={color:'#ef4444'};
  await act(async()=>{slot.behavior.emitRealtime('sidebar-appearance-changed',{});});
  await waitFor(()=>assert.equal(slot.getByRole('button',{name:'#ef4444'}).getAttribute('aria-pressed'),'true'));
 }finally{slot.lifecycle.unmount();}
});

test('successful save uses its response and ignores an older pending read',async()=>{
 const {loadPluginApp,renderSlot}=await import('@get-bb/plugin-sdk/testing/app');
 const {fireEvent,waitFor,act}=await import('@testing-library/react');
 const app=await loadPluginApp(()=>import('../app'));
 let reads=0;let finishRead:((value:{color:null})=>void)|undefined;
 const section=app.settingsSections.find(s=>s.id==='sidebar-color');assert.ok(section);
 const slot=renderSlot(section,{}, {rpc:{
  sidebarAppearance:()=>{reads++;if(reads===1)return {color:null};if(reads===2)return new Promise(resolve=>{finishRead=resolve;});throw new Error('Read unavailable');},
  saveSidebarAppearance:(input:unknown)=>input,
 }});
 try {
  fireEvent.click(await slot.findByRole('button',{name:'#8b5cf6'}));
  await act(async()=>{slot.behavior.emitRealtime('sidebar-appearance-changed',{});});
  fireEvent.click(slot.getByRole('button',{name:'Сохранить'}));
  await waitFor(()=>assert.equal((slot.getByRole('button',{name:'Сохранить'}) as HTMLButtonElement).disabled,true));
  await act(async()=>{finishRead!({color:null});});
  assert.equal(reads,2);
  assert.equal(slot.getByRole('button',{name:'#8b5cf6'}).getAttribute('aria-pressed'),'true');
  assert.equal((slot.getByRole('button',{name:'Отменить изменения'}) as HTMLButtonElement).disabled,true);
  assert.equal(Boolean(slot.queryByRole('alert')),false);
 }finally{slot.lifecycle.unmount();}
});

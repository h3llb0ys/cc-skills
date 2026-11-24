import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
async function mount(handlers: {list:()=>unknown;save:(input:unknown)=>unknown},onClose=()=>{}) {
 const {createElement}=await import('react');
 const {definePluginApp}=await import('@get-bb/plugin-sdk/app');
 const {loadPluginApp,renderSlot}=await import('@get-bb/plugin-sdk/testing/app');
 const {EditorLoader}=await import('../components/editor');
 const app=await loadPluginApp(async()=>({default:definePluginApp(app=>{
  app.slots.experimental_appOverlay({id:'editor',component:()=>createElement(EditorLoader,{target:{key:'section:sec_a',name:'Section'},onClose,onSaved:()=>{}})});
 })}));
 return renderSlot(app.appOverlays[0],{},{rpc:handlers});
}
test('editor cannot save before settings load and preserves the saved choice',async()=>{
 const {act,fireEvent,waitFor}=await import('@testing-library/react');
 let resolve!:(value:unknown)=>void;const edits:unknown[]=[];
 const slot=await mount({list:()=>new Promise(done=>{resolve=done;}),save:input=>{edits.push(input);return null;}});
 try {
  await slot.findByRole('status');
  assert.equal(slot.queryByRole('button',{name:'Сохранить'}),null);
  await act(async()=>resolve({'section:sec_a':{color:'#ec4899',icon:'rocket',emoji:null}}));
  const icon=await slot.findByRole('button',{name:'rocket'});
  assert.equal(icon.getAttribute('aria-pressed'),'true');
  fireEvent.click(slot.getByRole('button',{name:'Сохранить'}));
  await waitFor(()=>assert.equal(edits.length,1));
  assert.deepEqual(edits[0],{target:'section:sec_a',appearance:{color:'#ec4899',icon:'rocket',emoji:null}});
 } finally {slot.lifecycle.unmount();}
});
test('failed load requires retry, and no-icon preview contains no fallback icon',async()=>{
 const {fireEvent}=await import('@testing-library/react');
 let calls=0;let edits=0;
 const slot=await mount({list:()=>{if(++calls===1)throw new Error('offline');return {};},save:()=>{edits++;return null;}});
 try {
  await slot.findByRole('alert');
  assert.equal(slot.queryByRole('button',{name:'Сохранить'}),null);
  fireEvent.click(slot.getByRole('button',{name:'Повторить'}));
  await slot.findByRole('button',{name:'Сохранить'});
  assert.equal(slot.container.querySelector('.section-style-avatar svg'),null);
  assert.equal(slot.queryByRole('button',{name:'Эмодзи'}),null);
  assert.equal(edits,0);
 } finally {slot.lifecycle.unmount();}
});
test('search finds new icons in Russian and saves font size with the selected icon',async()=>{
 const {fireEvent,waitFor}=await import('@testing-library/react');
 const edits:unknown[]=[];
 const slot=await mount({list:()=>({}),save:input=>{edits.push(input);return null;}});
 try {
  await slot.findByRole('button',{name:'Сохранить'});
  const search=slot.getByRole('searchbox',{name:'Поиск значка'});
  fireEvent.change(search,{target:{value:'сервер'}});
  fireEvent.click(slot.getByRole('button',{name:'server'}));
  assert.equal(slot.queryByRole('button',{name:'rocket'}),null);
  fireEvent.change(slot.getByRole('slider',{name:'Размер шрифта'}),{target:{value:'18'}});
  assert.equal((slot.container.querySelector('.section-style-preview-title') as HTMLElement).style.fontSize,'18px');
  assert.equal(edits.length,0);
  fireEvent.click(slot.getByRole('button',{name:'Сохранить'}));
  await waitFor(()=>assert.equal(edits.length,1));
  assert.deepEqual(edits[0],{target:'section:sec_a',appearance:{color:null,icon:'server',emoji:null,fontSize:18}});
 } finally {slot.lifecycle.unmount();}
});
test('resetting font size preserves the icon and color and empty searches are recoverable',async()=>{
 const {fireEvent,waitFor}=await import('@testing-library/react');
 const edits:unknown[]=[];
 const slot=await mount({list:()=>({'section:sec_a':{color:'#ec4899',icon:'rocket',emoji:null,fontSize:16}}),save:input=>{edits.push(input);return null;}});
 try {
  await slot.findByRole('button',{name:'Сохранить'});
  assert.equal((slot.getByRole('slider') as HTMLInputElement).value,'16');
  fireEvent.change(slot.getByRole('searchbox'),{target:{value:'not-an-icon'}});
  await slot.findByText('Значки не найдены. Попробуйте другое название.');
  fireEvent.change(slot.getByRole('searchbox'),{target:{value:''}});
  assert.equal(slot.getByRole('button',{name:'rocket'}).getAttribute('aria-pressed'),'true');
  fireEvent.click(slot.getByRole('button',{name:'Размер по умолчанию'}));
  fireEvent.click(slot.getByRole('button',{name:'Сохранить'}));
  await waitFor(()=>assert.equal(edits.length,1));
  assert.deepEqual(edits[0],{target:'section:sec_a',appearance:{color:'#ec4899',icon:'rocket',emoji:null,fontSize:null}});
 } finally {slot.lifecycle.unmount();}
});
test('default size and reset preview use the native heading font size',async()=>{
 const {fireEvent}=await import('@testing-library/react');
 const root=document.createElement('div');
 root.dataset.sidebarSectionId='sec_a';
 root.innerHTML='<div class="text-left" style="font-size:14px"><span class="truncate" style="font-size:18px">Section</span></div>';
 document.body.append(root);
 const slot=await mount({list:()=>({'section:sec_a':{color:null,icon:null,emoji:null,fontSize:18}}),save:()=>null});
 try {
  await slot.findByRole('slider');
  fireEvent.click(slot.getByRole('button',{name:'Размер по умолчанию'}));
  assert.equal((slot.getByRole('slider') as HTMLInputElement).value,'14');
  assert.equal((slot.container.querySelector('.section-style-preview-title') as HTMLElement).style.fontSize,'14px');
 } finally {slot.lifecycle.unmount();root.remove();}
});
test('Enter in icon search does not submit the editor',async()=>{
 const {fireEvent}=await import('@testing-library/react');
 let edits=0;
 const slot=await mount({list:()=>({}),save:()=>{edits++;return null;}});
 try {
  const search=await slot.findByRole('searchbox');
  fireEvent.change(search,{target:{value:'git'}});
  assert.equal(fireEvent.keyDown(search,{key:'Enter',code:'Enter'}),false);
  assert.equal(edits,0);
  assert.ok(slot.getByRole('button',{name:'Сохранить'}));
 } finally {slot.lifecycle.unmount();}
});

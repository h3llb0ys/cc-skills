import { useCallback, useEffect, useRef, useState } from 'react';
import { definePluginApp, experimental_useSidebarThreads, useRealtime, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './server';
import { emptyAppearance, appearanceSchema, icons, palette, type Appearance, type IconName, type Target } from './lib/appearance';
import { decorateHeaders, editEvent } from './lib/decorate';
import './app.css';

let decorator: ReturnType<typeof decorateHeaders> | undefined;
let latest: Record<string, Appearance> = {};
function Glyph({name}:{name:IconName}) {
 return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[name]}/></svg>;
}
function Editor({target, initial, onClose, onSaved}:{target:Target; initial:Appearance; onClose:()=>void; onSaved:()=>void}) {
 const rpc=useRpc<typeof rpcContract>();
 const ref=useRef<HTMLDialogElement>(null);
 const [value,setValue]=useState(initial);
 const [pending,setPending]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{ const previous=document.activeElement; ref.current?.showModal(); return ()=>{ref.current?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({preventScroll:true});}; },[]);
 async function save(reset=false) {
  if(pending) return;
  const parsed=appearanceSchema.safeParse(value);
  if(!reset && !parsed.success) {setError(parsed.error.issues[0].message);return;}
  setPending(true);setError('');
  try {await rpc.call('save',{target:target.key,appearance:reset?null:parsed!.data!});onSaved();onClose();}
  catch(cause) {setError(`Не удалось сохранить: ${String(cause)}`);setPending(false);}
 }
 return <dialog ref={ref} className="section-style-dialog" aria-labelledby="section-style-heading" onCancel={event=>{event.preventDefault();if(!pending)onClose();}}>
  <form onSubmit={event=>{event.preventDefault();void save();}}>
   <h2 id="section-style-heading">Оформление</h2><p className="section-style-name">{target.name}</p>
   <fieldset disabled={pending}>
    <legend className="sr-only">Значок и цвет заголовка</legend>
    <div className="section-style-preview" style={{color:value.color??'var(--foreground)'}}>
     <span className="section-style-avatar">{value.emoji || <Glyph name={value.icon??'folder'}/>}</span>
     <span>{target.name}</span>
    </div>
    <p className="section-style-label">Цвет заголовка и значка</p>
    <div className="section-style-colors">
     <button type="button" className="section-style-default" aria-pressed={!value.color} onClick={()=>setValue({...value,color:null})}>По умолчанию</button>
     {palette.map(color=><button key={color} type="button" className="section-style-swatch" style={{background:color}} aria-label={color} aria-pressed={value.color===color} onClick={()=>setValue({...value,color})}/>)}
     <label className="section-style-custom" title="Произвольный цвет"><input type="color" aria-label="Произвольный цвет" value={value.color??'#808080'} onChange={event=>setValue({...value,color:event.target.value})}/>Свой</label>
    </div>
    <div className="section-style-tabs" role="group" aria-label="Тип значка">
     <button type="button" aria-pressed={!value.icon&&!value.emoji} onClick={()=>setValue({...value,icon:null,emoji:null})}>Без значка</button>
    </div>
    <div className="section-style-icons">{(Object.keys(icons) as IconName[]).map(name=><button key={name} type="button" title={name} aria-label={name} aria-pressed={value.icon===name} onClick={()=>setValue({...value,icon:name,emoji:null})}><Glyph name={name}/></button>)}</div>
   </fieldset>
   {error&&<p role="alert">{error}</p>}
   <footer><button type="button" disabled={pending} onClick={()=>void save(true)}>Сбросить</button><span/><button type="button" disabled={pending} onClick={onClose}>Отмена</button><button type="submit" disabled={pending} className="section-style-save">{pending?'Сохранение…':'Сохранить'}</button></footer>
  </form>
 </dialog>;
}
function AppearanceUI({settings=false}:{settings?:boolean}) {
 const rpc=useRpc<typeof rpcContract>();
 const connection=useRealtimeConnectionState();
 const {projects,sections}=experimental_useSidebarThreads();
 const [data,setData]=useState(latest);
 const [editing,setEditing]=useState<Target|null>(null);
 const [error,setError]=useState('');
 const generation=useRef(0);
 const refresh=useCallback(async()=>{
  const run=++generation.current;
  try {const next=await rpc.call('list',null); if(run!==generation.current)return;latest=next;setData(next);decorator?.update(next);setError('');}
  catch(cause){if(run===generation.current)setError(`Не удалось загрузить оформление: ${String(cause)}`);}
 },[rpc]);
 useEffect(()=>{void refresh();return()=>{generation.current++;};},[refresh,connection]);
 useRealtime('appearance-changed',()=>{void refresh();});
 useEffect(()=>{
  if(settings)return;
  const listener=(event:Event)=>setEditing((event as CustomEvent<Target>).detail);
  window.addEventListener(editEvent,listener);return()=>window.removeEventListener(editEvent,listener);
 },[settings]);
 const targets=[...sections.map(s=>({key:`section:${s.id}`,name:s.name})),...projects.map(p=>({key:`project:${p.id}`,name:p.name}))];
 return <div className="section-style-ui" data-bb-plugin="section-style">
  {settings&&<><p>Иконки и цвет заголовков стандартного списка BB. Порядок, группировка и высота строк сохраняются.</p><div className="section-style-targets">{targets.map(target=><button key={target.key} type="button" onClick={()=>setEditing(target)}><span style={{color:data[target.key]?.color??'inherit'}}>{data[target.key]?.emoji}{data[target.key]?.icon&&<Glyph name={data[target.key].icon!}/>} {target.name}</span><span>Оформление…</span></button>)}</div><p className="section-style-hint">Также доступно в меню заголовка секции или проекта. Работает со стандартным Thread list.</p></>}
  {error&&settings&&<p role="alert">{error} <button onClick={()=>void refresh()}>Повторить</button></p>}
  {editing&&<Editor key={editing.key} target={editing} initial={data[editing.key]??emptyAppearance} onClose={()=>setEditing(null)} onSaved={()=>void refresh()}/>}
 </div>;
}
function Settings(){return <AppearanceUI settings/>;}
export default definePluginApp(app=>{
 app.contentScripts.register({id:'heading-appearance',mount:()=>{
  decorator=decorateHeaders(document);decorator.update(latest);
  return()=>{decorator?.dispose();decorator=undefined;};
 }});
 app.slots.experimental_appOverlay({id:'heading-editor',component:AppearanceUI});
 app.slots.settingsSection({id:'appearance',title:'Заголовки секций и проектов',component:Settings});
});

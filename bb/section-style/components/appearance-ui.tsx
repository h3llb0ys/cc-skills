import { useCallback, useEffect, useRef, useState } from 'react';
import { experimental_useSidebarThreads, useRealtime, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from '../server';
import type { Appearance, Target } from '../lib/appearance';
import { EditorLoader, Glyph } from './editor';
import { decorateHeaders, editEvent } from '../lib/decorate';

let decorator: ReturnType<typeof decorateHeaders> | undefined;
let latest: Record<string, Appearance> = {};

export function mountHeadingAppearance() {
  decorator=decorateHeaders(document);decorator.update(latest);
  return()=>{decorator?.dispose();decorator=undefined;};
}

export function AppearanceUI({settings=false}:{settings?:boolean}) {
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
  {editing&&<EditorLoader key={editing.key} target={editing} onClose={()=>setEditing(null)} onSaved={()=>void refresh()}/>}
 </div>;
}
export function Settings(){return <AppearanceUI settings/>;}

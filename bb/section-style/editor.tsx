import { useEffect, useRef, useState } from 'react';
import { useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './server';
import { emptyAppearance, appearanceSchema, icons, palette, type Appearance, type IconName, type Target } from './lib/appearance';

export function Glyph({name}:{name:IconName}) {
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
     <span className="section-style-avatar">{value.emoji || (value.icon && <Glyph name={value.icon}/>) }</span>
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
export function EditorLoader({target,onClose,onSaved}:{target:Target;onClose:()=>void;onSaved:()=>void}) {
 const rpc=useRpc<typeof rpcContract>();
 const [initial,setInitial]=useState<Appearance>();
 const [error,setError]=useState('');
 const [attempt,setAttempt]=useState(0);
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  let active=true;
  setError('');
  rpc.call('list',null).then(data=>{if(active)setInitial(data[target.key]??emptyAppearance);})
   .catch(cause=>{if(active)setError(`Не удалось загрузить оформление: ${String(cause)}`);});
  return()=>{active=false;};
 },[rpc,target.key,attempt]);
 useEffect(()=>{if(!initial){const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();}},[initial]);
 if(initial)return <Editor target={target} initial={initial} onClose={onClose} onSaved={onSaved}/>;
 return <dialog ref={ref} className="section-style-dialog" aria-label="Загрузка оформления" onCancel={event=>{event.preventDefault();onClose();}}>
  {error?<p role="alert">{error}</p>:<p role="status">Загрузка оформления…</p>}
  <footer>{error&&<button onClick={()=>setAttempt(attempt+1)}>Повторить</button>}<button onClick={onClose}>Отмена</button></footer>
 </dialog>;
}

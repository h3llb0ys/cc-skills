import { useEffect, useRef, useState } from 'react';
import { useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './server';
import { getHeadingDefaultFontSize } from './lib/decorate';
import { emptyAppearance, appearanceSchema, icons, iconLabels, fontSizeMin, fontSizeMax, fontSizeDefault, palette, type Appearance, type IconName, type Target } from './lib/appearance';

export function Glyph({name}:{name:IconName}) {
 return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[name]}/></svg>;
}
function Editor({target, initial, onClose, onSaved}:{target:Target; initial:Appearance; onClose:()=>void; onSaved:()=>void}) {
 const rpc=useRpc<typeof rpcContract>();
 const ref=useRef<HTMLDialogElement>(null);
 const [value,setValue]=useState(initial);
 const [defaultSize]=useState(()=>getHeadingDefaultFontSize(document,target.key)??fontSizeDefault);
 const defaultSliderSize=Math.min(fontSizeMax,Math.max(fontSizeMin,Math.round(defaultSize)));
 const [pending,setPending]=useState(false);
 const [error,setError]=useState('');
 const [search,setSearch]=useState('');
 useEffect(()=>{ const previous=document.activeElement; ref.current?.showModal(); return ()=>{ref.current?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({preventScroll:true});}; },[]);
 async function save(reset=false) {
  if(pending) return;
  const parsed=appearanceSchema.safeParse(value);
  if(!reset && !parsed.success) {setError(parsed.error.issues[0].message);return;}
  setPending(true);setError('');
  try {await rpc.call('save',{target:target.key,appearance:reset?null:parsed!.data!});onSaved();onClose();}
  catch(cause) {setError(`Не удалось сохранить: ${String(cause)}`);setPending(false);}
 }
 const query=search.trim().toLocaleLowerCase();
 const names=(Object.keys(icons) as IconName[]).filter(name=>`${name} ${iconLabels[name]}`.toLocaleLowerCase().includes(query));
 return <dialog ref={ref} className="section-style-dialog" aria-labelledby="section-style-heading" onCancel={event=>{event.preventDefault();if(!pending)onClose();}}>
  <form onSubmit={event=>{event.preventDefault();void save();}}>
   <h2 id="section-style-heading">Оформление</h2><p className="section-style-name">{target.name}</p>
   <div className="section-style-editor-body"><fieldset disabled={pending}>
    <legend className="sr-only">Значок и цвет заголовка</legend>
    <div className="section-style-preview" style={{color:value.color??'var(--foreground)'}}>
     <span className="section-style-avatar">{value.emoji || (value.icon && <Glyph name={value.icon}/>) }</span>
     <span className="section-style-preview-title" style={{fontSize:value.fontSize??defaultSize}}>{target.name}</span>
    </div>
    <p className="section-style-label">Цвет заголовка и значка</p>
    <div className="section-style-colors">
     <button type="button" className="section-style-default" aria-pressed={!value.color} onClick={()=>setValue({...value,color:null})}>По умолчанию</button>
     {palette.map(color=><button key={color} type="button" className="section-style-swatch" style={{background:color}} aria-label={color} aria-pressed={value.color===color} onClick={()=>setValue({...value,color})}/>)}
     <label className="section-style-custom" title="Произвольный цвет"><input type="color" aria-label="Произвольный цвет" value={value.color??'#808080'} onChange={event=>setValue({...value,color:event.target.value})}/>Свой</label>
    </div>
    <div className="section-style-font">
     <label htmlFor="section-style-font-size">Размер шрифта</label>
     <output htmlFor="section-style-font-size">{value.fontSize==null?'По умолчанию':`${value.fontSize} px`}</output>
     <input id="section-style-font-size" type="range" min={fontSizeMin} max={fontSizeMax} step="1" value={value.fontSize??defaultSliderSize} aria-valuetext={value.fontSize==null?'По умолчанию':`${value.fontSize} px`} onChange={event=>setValue({...value,fontSize:Number(event.target.value)})}/>
     <button type="button" onClick={()=>setValue({...value,fontSize:null})} disabled={pending||value.fontSize==null}>Размер по умолчанию</button>
    </div>
    <label className="section-style-label" htmlFor="section-style-icon-search">Значки · {names.length}{query?` / ${Object.keys(icons).length}`:''}</label>
    <input id="section-style-icon-search" type="search" className="section-style-search" value={search} onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}} placeholder="Поиск: папка, сервер, git…" aria-label="Поиск значка"/>
    <div className="section-style-tabs" role="group" aria-label="Тип значка">
     <button type="button" aria-pressed={!value.icon&&!value.emoji} onClick={()=>setValue({...value,icon:null,emoji:null})}>Без значка</button>
    </div>
    <div className="section-style-icons">{names.map(name=><button key={name} type="button" title={`${iconLabels[name]} (${name})`} aria-label={name} aria-pressed={value.icon===name} onClick={()=>setValue({...value,icon:name,emoji:null})}><Glyph name={name}/></button>)}</div>
    {!names.length&&<p role="status" className="section-style-hint">Значки не найдены. Попробуйте другое название.</p>}
   </fieldset></div>
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

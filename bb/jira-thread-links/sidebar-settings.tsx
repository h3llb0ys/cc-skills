import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './server';
import { palette, type SidebarAppearance } from './lib/sidebar-appearance';

export function useSidebarAppearance() {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [value, setValue] = useState<SidebarAppearance>();
  const [error, setError] = useState('');
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++version.current;
    try {
      const next = await rpc.call('sidebarAppearance', null);
      if (request === version.current) { setValue(next); setError(''); }
    } catch (cause) {
      if (request === version.current) setError(`Не удалось загрузить цвет: ${String(cause)}`);
    }
  }, [rpc]);
  useEffect(() => { void refresh(); return () => { version.current++; }; }, [refresh, connection]);
  useRealtime('sidebar-appearance-changed', () => { void refresh(); });
  const acceptSaved = useCallback((next: SidebarAppearance) => {
    version.current++;
    setValue(next);
    setError('');
  }, []);
  return { value, error, refresh, acceptSaved };
}

function ColorControls({initial,onSaved}:{initial:SidebarAppearance;onSaved:(saved:SidebarAppearance)=>void}) {
  const rpc = useRpc<typeof rpcContract>();
  const [color,setColor] = useState(initial.color);
  const [pending,setPending] = useState(false);
  const [error,setError] = useState('');
  const previousSavedColor = useRef(initial.color);
  useEffect(() => {
    const previous = previousSavedColor.current;
    previousSavedColor.current = initial.color;
    setColor(draft => draft === previous ? initial.color : draft);
  }, [initial.color]);
  const changed = color !== initial.color;
  async function save() {
    if (pending || !changed) return;
    setPending(true); setError('');
    try {
      const saved = await rpc.call('saveSidebarAppearance',{color});
      setColor(saved.color);
      onSaved(saved);
    }
    catch (cause) { setError(`Не удалось сохранить: ${String(cause)}`); }
    finally { setPending(false); }
  }
  return <form onSubmit={event=>{event.preventDefault();void save();}}>
      <fieldset disabled={pending} style={{border:0,padding:0,margin:0,display:'flex',alignItems:'center',flexWrap:'wrap',gap:8}}>
        <legend style={{position:'absolute',width:1,height:1,overflow:'hidden'}}>Цвет Jira-номеров</legend>
        <button type="button" aria-pressed={color===null} onClick={()=>setColor(null)} style={{padding:'6px 10px',border:'1px solid var(--border)',borderRadius:7,fontSize:12}}>По умолчанию</button>
        {palette.map(swatch=><button key={swatch} type="button" aria-label={swatch} aria-pressed={color?.toLowerCase()===swatch} onClick={()=>setColor(swatch)} style={{width:26,height:26,background:swatch,borderRadius:5,outline:color?.toLowerCase()===swatch?'2px solid var(--foreground)':undefined,outlineOffset:3}} />)}
        <label style={{display:'inline-flex',alignItems:'center',gap:6,padding:'4px 7px',border:'1px solid var(--border)',borderRadius:7,fontSize:12,cursor:'pointer'}}>
          <input type="color" aria-label="Произвольный цвет" value={color??'#808080'} onChange={event=>setColor(event.target.value)} style={{width:20,height:20,padding:0,border:0,background:'transparent',cursor:'pointer'}}/>Свой
        </label>
      </fieldset>
    {error&&<p role="alert" style={{color:'var(--destructive)',marginTop:12}}>{error}</p>}
    <div style={{display:'flex',gap:16,marginTop:14,fontSize:12}}>
      <button type="submit" disabled={pending||!changed}>{pending?'Сохранение…':'Сохранить'}</button>
      <button type="button" disabled={pending||!changed} onClick={()=>{setColor(initial.color);setError('');}}>Отменить изменения</button>
    </div>
  </form>;
}
export function SidebarColorSettings() {
  const {value,error,refresh,acceptSaved} = useSidebarAppearance();
  return <div>
    <p style={{fontSize:13,color:'var(--muted-foreground)',marginBottom:12}}>Цвет номеров задач в левом списке тредов. На виджет задач не влияет.</p>
    {value ? <ColorControls initial={value} onSaved={acceptSaved}/> : !error&&<p role="status">Загрузка…</p>}
    {error&&<p role="alert">{error} <button onClick={()=>void refresh()}>Повторить</button></p>}
  </div>;
}

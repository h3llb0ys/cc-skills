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
  const [pendingColor,setPendingColor] = useState<string | null>();
  const saving = useRef(false);
  const [error,setError] = useState('');
  const pending = pendingColor !== undefined;
  const color = pending ? pendingColor : initial.color;
  async function save(next: string | null) {
    if (saving.current || next === initial.color) return;
    saving.current = true;
    setPendingColor(next);
    setError('');
    try {
      onSaved(await rpc.call('saveSidebarAppearance',{color:next}));
    } catch (cause) {
      setError(`Не удалось сохранить: ${String(cause)}`);
    } finally {
      saving.current = false;
      setPendingColor(undefined);
    }
  }
  return <div aria-busy={pending}>
      <fieldset disabled={pending} style={{border:0,padding:0,margin:0,display:'flex',alignItems:'center',flexWrap:'wrap',gap:8}}>
        <legend style={{position:'absolute',width:1,height:1,overflow:'hidden'}}>Цвет Jira-номеров</legend>
        <button type="button" aria-pressed={color===null} onClick={()=>void save(null)} style={{padding:'6px 10px',border:'1px solid var(--border)',borderRadius:7,fontSize:12}}>По умолчанию</button>
        {palette.map(swatch=><button key={swatch} type="button" aria-label={swatch} aria-pressed={color?.toLowerCase()===swatch} onClick={()=>void save(swatch)} style={{width:26,height:26,background:swatch,borderRadius:5,outline:color?.toLowerCase()===swatch?'2px solid var(--foreground)':undefined,outlineOffset:3}} />)}
        <label style={{display:'inline-flex',alignItems:'center',gap:6,padding:'4px 7px',border:'1px solid var(--border)',borderRadius:7,fontSize:12,cursor:'pointer'}}>
          <input type="color" aria-label="Произвольный цвет" value={color??'#808080'} onChange={event=>void save(event.target.value)} style={{width:20,height:20,padding:0,border:0,background:'transparent',cursor:'pointer'}}/>Свой
        </label>
      </fieldset>
    {error&&<p role="alert" style={{color:'var(--destructive)',marginTop:12}}>{error}</p>}
  </div>;
}
export function SidebarColorSettings() {
  const {value,error,refresh,acceptSaved} = useSidebarAppearance();
  return <div>
    <p style={{fontSize:13,color:'var(--muted-foreground)',marginBottom:12}}>Цвет номеров задач в левом списке тредов. На виджет задач не влияет.</p>
    {value ? <ColorControls initial={value} onSaved={acceptSaved}/> : !error&&<p role="status">Загрузка…</p>}
    {error&&<p role="alert">{error} <button onClick={()=>void refresh()}>Повторить</button></p>}
  </div>;
}

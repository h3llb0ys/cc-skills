import { ColorPalette } from '../../shared-ui/color-palette';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from '../server';
import type { SidebarAppearance } from '../lib/sidebar-appearance';

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
      <fieldset disabled={pending} style={{border:0,padding:0,margin:0,minWidth:0}}>
        <legend style={{position:'absolute',width:1,height:1,overflow:'hidden'}}>Цвет Jira-номеров</legend>
        <ColorPalette color={color} onChange={next => void save(next)} />
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

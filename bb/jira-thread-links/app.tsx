import { useCallback, useEffect, useRef, useState } from 'react';
import { definePluginApp, experimental_useSidebarThreads, useRealtime, useRpc, useRealtimeConnectionState } from '@get-bb/plugin-sdk/app';
import { ComposerTasks } from './composer';
import type { rpcContract } from './server';
import { decorateRows, type TaskLink } from './lib/rows';

type View = { keys: string[]; revision: number; reason: string; updatedAt: number; issues: TaskLink[]; prefix: string };
let decorator: ReturnType<typeof decorateRows> | undefined;
let latest: Record<string, TaskLink[]> = {};
const editEvent = 'jira-thread-links:edit';
function Overlay() {
 const rpc = useRpc<typeof rpcContract>();
 const { threads } = experimental_useSidebarThreads();
 const connection = useRealtimeConnectionState();
 const ids = JSON.stringify(threads.map(t => t.id).sort());
 const [editing, setEditing] = useState<string | null>(null);
 const [view, setView] = useState<View | null>(null);
 const [value, setValue] = useState('');
 const [error, setError] = useState('');
 const [pending, setPending] = useState(false);
 const dialog = useRef<HTMLDialogElement>(null);
 const generation = useRef(0);
 const refresh = useCallback(async () => {
   const run = ++generation.current;
   const all = JSON.parse(ids) as string[];
   const result: Record<string, TaskLink[]> = {};
   try {
     for (let i=0; i<all.length; i+=200) {
       const rows = await rpc.call('list', { threadIds: all.slice(i,i+200) });
       for (const [id, state] of Object.entries(rows)) result[id] = state.issues;
     }
     if (run !== generation.current) return;
     latest = result; decorator?.update(result);
   } catch (cause) { console.warn('Jira task badges could not refresh', cause); }
 }, [rpc, ids]);
 useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh, connection]);
 useRealtime('bindings-changed', () => { void refresh(); });
 useEffect(() => {
   const listener = (event: Event) => setEditing((event as CustomEvent<string>).detail);
   window.addEventListener(editEvent, listener);
   return () => window.removeEventListener(editEvent, listener);
 }, []);
 useEffect(() => {
   if (!editing) return;
   let active = true;
   setView(null); setError(''); setValue('');
   dialog.current?.showModal();
   rpc.call('list', { threadIds:[editing] }).then(rows => {
     if (!active) return;
     setView(rows[editing]); setValue(rows[editing].keys.join(', '));
     requestAnimationFrame(() => { if (active) dialog.current?.querySelector<HTMLInputElement>('input')?.focus(); });
   }).catch(cause => { if (active) setError(String(cause)); });
   return () => { active=false; };
 }, [editing, rpc]);
 async function reloadEditor(refreshJira = false) {
   if (!editing || pending) return;
   setPending(true); setError('');
   try {
     const next = refreshJira ? await rpc.call('refresh', {threadId:editing}) : (await rpc.call('list', {threadIds:[editing]}))[editing];
     setView(next); setValue(next.keys.join(', '));
   } catch (cause) { setError(String(cause)); } finally { setPending(false); }
 }
 function close() { dialog.current?.close(); setEditing(null); }
 async function save() {
   if (!editing || !view || pending) return;
   setPending(true); setError('');
   try {
     await rpc.call('edit', { threadId:editing, expectedRevision:view.revision, operation:'replace', keys:value.split(/[\s,;]+/).filter(Boolean), reason:'Ручное изменение в меню треда' });
     close(); await refresh();
   } catch (cause) { setError(String(cause)); } finally { setPending(false); }
 }
 return <dialog ref={dialog} onCancel={() => setEditing(null)} onClose={() => setEditing(null)} style={{background:'var(--background)',color:'var(--foreground)',border:'1px solid var(--border)',borderRadius:12,padding:24,width:'min(440px, 90vw)',boxShadow:'0 12px 60px #0006'}}>
   <form onSubmit={e => { e.preventDefault(); void save(); }}>
     <h2 style={{fontSize:18,fontWeight:600,marginBottom:12}}>Актуальные задачи Jira</h2>
     <label htmlFor="jira-task-keys">Номера задач через запятую</label>
     <input id="jira-task-keys" autoFocus value={value} onChange={e=>setValue(e.target.value)} disabled={!view || pending} placeholder="AFT-1196, AFT-1233" style={{display:'block',width:'100%',padding:8,border:'1px solid var(--border)',borderRadius:6,marginTop:6,background:'var(--background)'}} />
     <p style={{fontSize:12,opacity:.7,marginTop:8}}>Пустое поле убирает все привязки.{view?.prefix ? ` Короткие номера относятся к ${view.prefix}.` : ' Указывай полный ключ задачи.'}</p>
     {view?.issues.filter(issue => value.split(/[\s,;]+/).some(key=>key.toUpperCase()===issue.key)).map(issue => <div key={issue.key} style={{display:'flex',gap:8,marginTop:8,fontSize:12}}><span style={{flex:1}}>{issue.key} · {issue.summary}</span><button type="button" disabled={pending} onClick={()=>setValue(value.split(/[\s,;]+/).filter(k=>k.toUpperCase()!==issue.key).join(', '))} aria-label={`Убрать ${issue.key}`}>×</button></div>)}
     <button type="button" disabled={pending || !view} onClick={()=>void reloadEditor(true)} style={{fontSize:12,marginTop:12,textDecoration:'underline'}}>Обновить названия из Jira</button>
     {error && <button type="button" disabled={pending} onClick={()=>void reloadEditor()}>Перечитать привязку</button>}
     {error && <p role="alert" style={{marginTop:12,color:'var(--destructive)'}}>{error}</p>}
     <div style={{display:'flex',justifyContent:'flex-end',gap:16,marginTop:20}}><button type="button" onClick={close} disabled={pending}>Отмена</button><button type="submit" disabled={!view || pending}>{pending?'Сохранение…':'Сохранить'}</button></div>
   </form>
 </dialog>;
}
export default definePluginApp(app => {
 app.composer.customize({ id:'jira-active-tasks', scopes:['thread','queued-message'], banners:[{id:'jira-task-links',chrome:'bare',component:ComposerTasks}] });
 app.contentScripts.register({ id:'jira-row-links', mount:() => {
   decorator=decorateRows(document); decorator.update(latest);
   return () => { decorator?.dispose(); decorator=undefined; };
 } });
 app.slots.experimental_appOverlay({ id:'jira-task-editor', component:Overlay });
 app.slots.experimental_threadAction({ id:'edit-tasks', title:'Задачи Jira', icon:'Link', group:'organize', item:({thread}) => ({label:'Задачи Jira…', icon:'Link', run:async () => { window.dispatchEvent(new CustomEvent(editEvent,{detail:thread.id})); }}) });
});

import { useCallback, useEffect, useRef } from 'react';
import { experimental_useSidebarThreads, useRealtime, useRpc, useRealtimeConnectionState } from '@get-bb/plugin-sdk/app';
import { useSidebarAppearance } from '../components/sidebar-settings';
import type { rpcContract } from '../server';
import { decorateRows, type TaskLink } from '../lib/rows';

let decorator: ReturnType<typeof decorateRows> | undefined;
let latest: Record<string, TaskLink[]> = {};
let sidebarColor: string | null = null;

export function mountSidebarBadges() {
   decorator=decorateRows(document); decorator.setColor(sidebarColor); decorator.update(latest);
   return () => { decorator?.dispose(); decorator=undefined; };
}

export function useSidebarBadges() {
 const {value: appearance} = useSidebarAppearance();
 useEffect(() => {
   if (appearance) { sidebarColor=appearance.color; decorator?.setColor(sidebarColor); }
 }, [appearance]);
 const rpc = useRpc<typeof rpcContract>();
 const { threads } = experimental_useSidebarThreads();
 const connection = useRealtimeConnectionState();
 const ids = JSON.stringify(threads.map(t => t.id).sort());
 const generation = useRef(0);
 const refresh = useCallback(async () => {
   const run = ++generation.current;
   const all = JSON.parse(ids) as string[];
   const result: Record<string, TaskLink[]> = Object.fromEntries(all.map(id => [id, latest[id] ?? []]));
   for (let i=0; i<all.length; i+=200) {
     if (run !== generation.current) return;
     try {
       const rows = await rpc.call('list', { threadIds: all.slice(i,i+200) });
       for (const [id, state] of Object.entries(rows)) result[id] = state.issues;
     } catch (cause) { console.warn('Jira task badges could not refresh', cause); }
   }
   if (run !== generation.current) return;
   latest = result; decorator?.update(result);
 }, [rpc, ids]);
 useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh, connection]);
 useRealtime('bindings-changed', () => { void refresh(); });
 return refresh;
}

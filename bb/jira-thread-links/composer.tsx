import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useComposer, useRealtime, useRealtimeConnectionState, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './server';
import type { TaskLink } from './lib/rows';

function ThreadTasks({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [issues, setIssues] = useState<TaskLink[]>([]);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++request.current;
    try {
      const rows = await rpc.call('list', { threadIds: [threadId] });
      if (version === request.current) setIssues(rows[threadId]?.issues ?? []);
    } catch (error) {
      // Keep this thread's saved links during a transient disconnect.
      console.warn('Could not refresh composer Jira links', error);
    }
  }, [rpc, threadId]);
  useEffect(() => {
    void refresh();
    return () => { request.current++; };
  }, [refresh, connection]);
  useRealtime('bindings-changed', () => { void refresh(); });

  if (!issues.length) return null;
  return <nav aria-label="Задачи Jira этого треда" data-jira-composer-links=""
    style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:6,padding:'0 4px 8px',fontSize:12}}>
    <span style={{color:'var(--muted-foreground)',marginRight:2}}>Jira</span>
    {issues.map(issue => <a key={issue.key} href={issue.url} target="_blank" rel="noopener noreferrer"
      title={`${issue.key} · ${issue.summary}`} aria-label={`${issue.key} · ${issue.summary}`}
      style={{display:'inline-flex',padding:'3px 8px',border:'1px solid var(--border)',borderRadius:6,color:'var(--foreground)',textDecoration:'none'}}>
      {issue.key}
    </a>)}
  </nav>;
}

export function ComposerTasks() {
  const { scope } = useComposer();
  // A keyed owner drops the previous thread's links immediately in split views
  // and when navigating, before the new thread's asynchronous read completes.
  return scope.kind === 'new-thread' ? null : <ThreadTasks key={scope.threadId} threadId={scope.threadId} />;
}

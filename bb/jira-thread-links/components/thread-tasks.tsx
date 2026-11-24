import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  experimental_InfoSection as InfoSection,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from '@get-bb/plugin-sdk/app';
import type { rpcContract } from '../server';
import type { TaskLink } from '../lib/rows';

export const taskSectionTitle = 'Задачи Jira';
export const editEvent = 'jira-thread-links:edit';

export function editThreadTasks(threadId: string) {
  window.dispatchEvent(new CustomEvent(editEvent, { detail: threadId }));
}

type ThreadTasksProps = { threadId: string; inInfoTab?: boolean };

function ThreadTasks({ threadId, inInfoTab }: ThreadTasksProps) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [tasks, setTasks] = useState<{ keys: string[]; issues: TaskLink[] }>({ keys: [], issues: [] });
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++request.current;
    try {
      const rows = await rpc.call('list', { threadIds: [threadId] });
      if (version === request.current) setTasks(rows[threadId] ?? { keys: [], issues: [] });
    } catch (error) {
      // Keep this thread's saved links during a transient disconnect.
      console.warn('Could not refresh thread Jira links', error);
    }
  }, [rpc, threadId]);
  useEffect(() => {
    void refresh();
    return () => { request.current++; };
  }, [refresh, connection]);
  useRealtime('bindings-changed', () => { void refresh(); });

  if (!tasks.keys.length) return null;

  const editButton = (
    <button type="button" className="rounded px-1 text-xs text-muted-foreground hover:text-foreground"
      onClick={() => editThreadTasks(threadId)}>
      Изменить
    </button>
  );
  const links = (
    <nav aria-label="Задачи Jira этого треда" className="grid min-w-0 gap-1">
      {tasks.keys.map(key => {
        const issue = tasks.issues.find(item => item.key === key);
        if (!issue) return <span key={key} className="px-1 py-1 text-xs text-muted-foreground">{key}</span>;
        const label = issue.summary ? `${key} · ${issue.summary}` : key;
        return (
          <a key={issue.key} href={issue.url} target="_blank" rel="noopener noreferrer"
            aria-label={label} title={label}
            className="flex min-w-0 items-baseline gap-2 rounded px-1 py-1 text-xs hover:bg-accent">
            <span className="shrink-0 font-medium text-foreground">{issue.key}</span>
            <span className="truncate text-muted-foreground">{issue.summary}</span>
          </a>
        );
      })}
    </nav>
  );

  return inInfoTab
    ? <InfoSection label={taskSectionTitle} trailing={editButton}>{links}</InfoSection>
    : <div className="grid min-w-0 gap-1">
        <div className="justify-self-end">{editButton}</div>
        {links}
      </div>;
}

export function TaskCardSection({ threadId }: ThreadTasksProps) {
  return <ThreadTasks key={threadId} threadId={threadId} />;
}

export function TaskInfoSection({ threadId }: ThreadTasksProps) {
  return <ThreadTasks key={threadId} threadId={threadId} inInfoTab />;
}

import {
  experimental_Icon as Icon,
  experimental_InfoSection as InfoSection,
  experimental_useRpcQuery,
  useSettings,
} from '@get-bb/plugin-sdk/app';
import * as Tooltip from '@radix-ui/react-tooltip';
import { cleanupRpc, type WorktreeRow } from './cleanup/contract';
import { archiveWorktree } from './cleanup/overlay';
import { useWorkspaceColors } from './components/color-settings';
import { colorStyle } from './sidebar/colors';

function WorktreeList({ threadId, inInfo }: { threadId: string; inInfo?: boolean }) {
  const { values } = useSettings();
  const enabled = values?.showWorktreeWidget !== false;
  const history = experimental_useRpcQuery({
    contract: cleanupRpc, method: 'worktreeHistory', input: { threadId }, enabled,
  });
  const { data: colors } = useWorkspaceColors();
  if (!enabled) return null;

  const rows = history.data ?? [];
  const visible = values?.worktreeWidgetMode === 'latest'
    ? rows.filter(row => row.state === 'available').slice(0, 1) : rows;
  if (!visible.length && !history.error) return null;
  const content = (
    <>
      {history.error && <p className="workspace-history-error" role="alert">
        Не удалось загрузить worktree. <button type="button" onClick={() => void history.refetch()}>Повторить</button>
      </p>}
      {visible.length > 0 && (
        <Tooltip.Provider delayDuration={250}>
          <ul className="workspace-history" style={colorStyle(colors)} aria-label="Связанные worktree">
            {visible.map(row => <WorktreeItem key={row.key} row={row} threadId={threadId}/>)}
          </ul>
        </Tooltip.Provider>
      )}
    </>
  );
  return inInfo ? <InfoSection label="Worktrees">{content}</InfoSection> : content;
}

function WorktreeItem({ row, threadId }: { row: WorktreeRow; threadId: string }) {
  const name = row.repository ?? row.path.split(/[\\/]/).filter(Boolean).at(-1) ?? row.path;
  const source = row.sourceId === threadId ? 'Этот тред' : row.sourceTitle
    ? `Сабтред «${row.sourceTitle}»` : 'Сабтред';
  const status = row.state === 'removed' ? 'Удалён' : row.state === 'unavailable' ? 'Недоступен' : null;
  const action = 'Архивировать worktree';
  return (
    <li className="workspace-history-row">
      <div className="workspace-history-details">
        <strong className="workspace-history-name workspace-labels-item" data-workspace-kind="worktree" title={row.path}>{name}</strong>
        {row.branch && <span className="workspace-history-branch workspace-labels-item" data-workspace-kind="branch" title={row.branch}>
          {row.branch}
        </span>}
        <small className="workspace-history-source" title={source}>{source}</small>
      </div>
      {status ? <small className="workspace-history-status">{status}</small> : (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button type="button" className="workspace-history-action"
              aria-label={`${action} ${row.branch ?? name}`} aria-disabled={Boolean(row.blockedReason)}
              onClick={() => { if (!row.blockedReason) archiveWorktree(threadId, row.key); }}>
              <Icon name="Archive" aria-hidden/>
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="workspace-history-tooltip" side="left" sideOffset={6}>
              {row.blockedReason ?? 'Удалить worktree и локальную ветку'}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      )}
    </li>
  );
}

export function WorktreeCardSection({ threadId }: { threadId: string }) {
  return <WorktreeList key={threadId} threadId={threadId}/>;
}

export function WorktreeInfoSection({ threadId }: { threadId: string }) {
  return <WorktreeList key={threadId} threadId={threadId} inInfo/>;
}

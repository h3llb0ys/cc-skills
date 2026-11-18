import type { PluginThreadActionRegistration } from '@get-bb/plugin-sdk';
import * as Dialog from '@radix-ui/react-dialog';
import {
  experimental_THREAD_ACTION_GROUPS,
  useRpc,
} from '@get-bb/plugin-sdk/app';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { cleanupRpc, type CleanupAction, type Preview } from './cleanup-contract';

const labels = { archive: 'Архивировать и очистить', delete: 'Удалить и очистить' };
type Request = { threadId: string; action: CleanupAction };
let request: Request | null = null;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function setRequest(next: Request | null) {
  request = next;
  for (const listener of listeners) listener();
}

export function cleanupAction(action: CleanupAction): PluginThreadActionRegistration<undefined> {
  const label = labels[action];
  const icon = action === 'archive' ? 'FolderMinus' : 'Trash2';
  return {
    id: action + '-and-cleanup',
    title: label,
    icon,
    group: experimental_THREAD_ACTION_GROUPS.lifecycle,
    item({ thread }) {
      if (!thread.environment?.path && thread.archivedAt === null) return null;
      return { label, icon, run: () => {
        if (!request) setRequest({ threadId: thread.id, action });
      } };
    },
  };
}

export function CleanupOverlay() {
  const current = useSyncExternalStore(subscribe, () => request);
  return current && <CleanupRequest key={current.threadId + current.action} current={current} />;
}

function CleanupRequest({ current }: { current: Request }) {
  const { call } = useRpc<typeof cleanupRpc>();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [discardFiles, setDiscardFiles] = useState(false);
  const [discardCommits, setDiscardCommits] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const deleting = current.action === 'delete';

  async function execute(plan: Preview, files: boolean, commits: boolean) {
    const toastId = toast.loading('Очистка рабочего окружения…');
    setBusy(true);
    try {
      const result = await call('execute', {
        ...current, token: plan.token, discardFiles: files, discardCommits: commits, confirmDelete: deleting,
      });
      if (result.state === 'done') {
        toast.success(result.message, { id: toastId });
      } else {
        toast.error(result.message, { id: toastId });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error), { id: toastId });
    } finally {
      setRequest(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void call('prepare', current).then(plan => {
      if (cancelled) return;
      if (!deleting && !plan.inspection.fileCount && !plan.inspection.unmergedCount) {
        void execute(plan, false, false);
      } else {
        setPreview(plan);
      }
    }).catch(error => {
      if (cancelled) return;
      toast.error(error instanceof Error ? error.message : String(error));
      setRequest(null);
    });
    return () => { cancelled = true; };
  }, [current, call, deleting]);

  if (!preview) return null;
  const { inspection } = preview;
  const destructive = inspection.fileCount > 0 || inspection.unmergedCount > 0;
  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !busy) setRequest(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="workspace-cleanup-backdrop" />
        <Dialog.Content className="workspace-cleanup-dialog" onOpenAutoFocus={event => {
          event.preventDefault();
          cancelButton.current?.focus();
        }}>
          <Dialog.Title>{labels[current.action]}</Dialog.Title>
          <Dialog.Description>
            {preview.title} · {inspection.branch}
          </Dialog.Description>
          <p className="workspace-cleanup-path">{preview.path}</p>
          {deleting && <p>История треда будет удалена без возможности восстановления.</p>}
          {inspection.fileCount > 0 && <label>
            <input type="checkbox" checked={discardFiles} disabled={busy} onChange={event => setDiscardFiles(event.target.checked)} />
            Удалить незакоммиченные и игнорируемые файлы (файлов: {inspection.fileCount})
          </label>}
          {inspection.unmergedCount > 0 && <label>
            <input type="checkbox" checked={discardCommits} disabled={busy} onChange={event => setDiscardCommits(event.target.checked)} />
            Удалить ветку с коммитами вне {inspection.baseRef} ({inspection.unmergedCount})
          </label>}
          {showReview && <div className="workspace-cleanup-review">
            {[{ title: 'Файлы', entries: inspection.files, total: inspection.fileCount },
              { title: 'Коммиты', entries: inspection.commits, total: inspection.unmergedCount }]
              .filter(section => section.total > 0)
              .map(section => <section key={section.title}>
                <strong>{section.title}</strong>
                <pre>{section.entries.join('\n')}</pre>
                {section.total > section.entries.length && <p>Показано {section.entries.length} из {section.total}.</p>}
              </section>)}
          </div>}
          <footer>
            {destructive && <button type="button" onClick={() => setShowReview(!showReview)} aria-expanded={showReview}>Просмотр</button>}
            <button type="button" ref={cancelButton} disabled={busy} onClick={() => setRequest(null)}>Отмена</button>
            <button type="button" className="workspace-cleanup-danger"
              disabled={busy || (inspection.fileCount > 0 && !discardFiles) || (inspection.unmergedCount > 0 && !discardCommits)}
              onClick={() => void execute(preview, discardFiles, discardCommits)}>
              {destructive ? 'Удалить принудительно' : labels[current.action]}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

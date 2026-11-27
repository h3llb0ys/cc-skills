import type { MergeRequest, Snapshot } from './contract';

const pipelineStatus = {
  passed: { color: 'green', label: 'Passed', detail: 'Пайплайн прошёл.' },
  warning: { color: 'orange', label: 'Warning', detail: 'Пайплайн прошёл с предупреждениями.' },
  failed: { color: 'red', label: 'Failed', detail: 'Пайплайн упал.' },
  pending: { color: 'gray', label: 'Running', detail: 'CI ожидает запуска или выполняется.' },
  manual: { color: 'gray', label: 'Manual', detail: 'CI ждёт ручного запуска.' },
  canceled: { color: 'gray', label: 'Canceled', detail: 'Пайплайн отменён.' },
  skipped: { color: 'gray', label: 'Skipped', detail: 'Пайплайн пропущен.' },
  none: { color: 'gray', label: 'No CI', detail: 'У MR нет пайплайна.' },
  unknown: { color: 'gray', label: 'Unknown', detail: 'Статус CI недоступен.' },
} as const;

export function presentation(link: Pick<MergeRequest, 'state' | 'pipeline'> & { stale: boolean }) {
  if (link.state === 'merged') return { color: 'purple', label: 'Merged', detail: 'MR влит.' };
  if (link.stale) {
    const previous = link.state === 'closed' ? 'MR закрыт.' : pipelineStatus[link.pipeline].detail;
    return { color: 'gray', label: 'Stale', detail: `Обновление недоступно. Последний результат: ${previous}` };
  }
  if (link.state === 'closed') return { color: 'gray', label: 'Closed', detail: 'MR закрыт без merge.' };
  if (link.state === 'locked') return { color: 'gray', label: 'Locked', detail: 'MR заблокирован.' };
  return pipelineStatus[link.pipeline];
}

export function orderedLinks({ links, active }: Snapshot) {
  if (!active) return links;
  const isActive = (link: Snapshot['links'][number]) => link.hostname === active.hostname &&
    link.project === active.project && link.branch === active.branch;
  return [...links].sort((a, b) => Number(isActive(b)) - Number(isActive(a)));
}

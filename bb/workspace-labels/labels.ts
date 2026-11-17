import type { GitStatus } from './git';
export const layouts = ['subtitle', 'badges', 'details'] as const;
export type Layout = typeof layouts[number];
export type Environment = {
  path: string | null; name: string | null; branchName: string | null; isWorktree: boolean | null;
};
export type Label = { kind: 'branch' | 'worktree'; text: string };

export function parseLayout(value: unknown): Layout {
  return layouts.find(layout => layout === value) ?? 'subtitle';
}

export function workspaceLabels(environment: Environment | null, status: GitStatus | undefined, layout: Layout, hideMain = false) {
  if (!environment || status?.outcome === 'not_applicable') return null;
  const live = status?.outcome === 'available' ? status.workspace : undefined;
  const knownCheckout = live && live.checkout.kind !== 'unknown';
  const branch = knownCheckout
    ? live.branch.currentBranch ?? (live.checkout.kind === 'detached'
      ? `detached ${live.checkout.headSha?.slice(0, 7) ?? 'HEAD'}` : null)
    : environment.branchName;
  const worktree = environment.isWorktree === true;
  const parts = environment.path?.split(/[\\/]/).filter(Boolean) ?? [];
  const parent = parts.at(-2);
  const pathName = parent && !['worktrees', '.worktrees', 'workspaces'].includes(parent)
    ? parts.slice(-2).join('/') : parts.at(-1);
  const name = pathName || environment.name;
  const labels: Label[] = [];
  if (worktree && name) labels.push({ kind: 'worktree', text: name });
  const defaultBranch = live?.branch.defaultBranch ?? 'main';
  if (branch && !(hideMain && branch === defaultBranch) && (!labels.length || layout === 'details')) labels.push({ kind: 'branch', text: branch });
  if (!labels.length) return null;
  const tooltip = [
    worktree ? `Worktree: ${environment.path ?? name ?? ''}` : environment.path,
    branch ? `Ветка: ${branch}` : null,
    !knownCheckout && branch ? 'Ветка из данных BB; Git сейчас не подтверждён' : null,
  ].filter(Boolean).join('\n');
  return { labels, tooltip };
}

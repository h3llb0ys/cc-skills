import type { Environment, Layout } from './labels';
import { workspaceLabels } from './labels';
import type { GitStatus } from './git';
import { colorStyle, type WorkspaceColors } from './colors';

function Glyph({ kind }: { kind: 'branch' | 'worktree' }) {
  return <svg className="workspace-labels-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'branch' ? <><circle cx="6" cy="5" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="19" r="2.5"/><path d="M6 7.5v9M18 8.5c0 6-12 2-12 8"/></> : <><path d="M21 11V7a2 2 0 0 0-2-2h-7L10 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6"/><circle cx="14" cy="12" r="1.5"/><circle cx="21" cy="14" r="1.5"/><circle cx="14" cy="21" r="1.5"/><path d="M14 13.5v6M21 15.5c0 4-7 0-7 4"/></>}
  </svg>;
}

export function WorkspaceMetadata({ environment, status, layout, autoInline = true, hideMain = false, colors }: { environment: Environment | null; status?: GitStatus; layout: Layout; autoInline?: boolean; hideMain?: boolean; colors?: WorkspaceColors }) {
  const model = workspaceLabels(environment, status, layout, hideMain);
  if (!model) return null;
  return <span className={`workspace-labels workspace-labels-${layout}`} data-workspace-auto-inline={String(autoInline)} style={colorStyle(colors)} title={model.tooltip} aria-label={model.tooltip}>
    {model.labels.map(label => <span key={label.kind} className="workspace-labels-item" data-workspace-kind={label.kind}>
      <Glyph kind={label.kind}/><span className="workspace-labels-text">{label.text}</span>
    </span>)}
  </span>;
}

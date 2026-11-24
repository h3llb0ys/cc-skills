import { definePluginApp, experimental_useRpcKeyedQuery, useSettings } from '@get-bb/plugin-sdk/app';
import type { ExperimentalThreadRowMetadataDataInput, ExperimentalThreadRowMetadataProps } from '@get-bb/plugin-sdk';
import { git, type GitStatus } from './sidebar/git';
import { parseLayout, type Layout } from './sidebar/labels';
import { WorkspaceMetadata } from './components/metadata';
import './app.css';
import { adaptiveRows } from './sidebar/adaptive';
import { LayoutPreview } from './components/preview';
import { CleanupOverlay, cleanupAction } from './cleanup/overlay';
import { cleanupRpc, type LinkedWorktree } from './cleanup/contract';
import { WorkspaceColorSettings, useWorkspaceColors } from './components/color-settings';
import type { WorkspaceColors } from './sidebar/colors';
import { WorktreeCardSection, WorktreeInfoSection } from './worktree-widget';

type Data = { colors?: WorkspaceColors; layout: Layout; autoInline: boolean; hideMain: boolean; statuses: Record<string, GitStatus> | undefined; linkedWorktrees: Record<string, LinkedWorktree> | undefined };
function useData({ threads }: ExperimentalThreadRowMetadataDataInput): Data {
  const { values } = useSettings();
  const keys = [...new Set(threads.flatMap(thread => thread.environment?.id ? [thread.environment.id] : []))];
  const { data } = experimental_useRpcKeyedQuery({
    pluginId: 'bb--git', contract: git, method: 'status', keys, enabled: keys.length > 0,
  });
  const threadIds = threads.filter(thread => !thread.environment?.isWorktree).map(thread => thread.id);
  const { data: linkedWorktrees } = experimental_useRpcKeyedQuery({
    pluginId: 'workspace-labels', contract: cleanupRpc, method: 'linkedWorktrees', keys: threadIds, enabled: threadIds.length > 0,
  });
  const { data: colors } = useWorkspaceColors();
  return { colors, linkedWorktrees, layout: parseLayout(values?.layout), autoInline: values?.autoInline !== false, hideMain: values?.hideMain === true, statuses: data };
}
function Metadata({ thread, data }: ExperimentalThreadRowMetadataProps<Data>) {
  const linked = !thread.environment?.isWorktree ? data.linkedWorktrees?.[thread.id] : undefined;
  if (linked) {
    const environment = { path: linked.path, name: null, branchName: linked.branch, isWorktree: true, linked: true };
    return <WorkspaceMetadata environment={environment} layout={data.layout} colors={data.colors} autoInline={data.autoInline} hideMain={data.hideMain}/>;
  }
  return <WorkspaceMetadata environment={thread.environment} layout={data.layout} colors={data.colors} autoInline={data.autoInline} hideMain={data.hideMain}
    status={thread.environment?.id ? data.statuses?.[thread.environment.id] : undefined}/>;
}
function SettingsPreview() {
  const { values } = useSettings();
  return <WorkspaceColorSettings preview={colors => (
    <LayoutPreview layout={parseLayout(values?.layout)} autoInline={values?.autoInline !== false}
      hideMain={values?.hideMain === true} colors={colors}/>
  )}/>;
}
export default definePluginApp(app => {
  app.slots.experimental_threadAction(cleanupAction('archive'));
  app.slots.experimental_threadAction(cleanupAction('delete'));
  app.slots.experimental_appOverlay({ id: 'workspace-cleanup', component: CleanupOverlay });
  app.slots.experimental_threadContextCardSection({
    id: 'worktrees', title: 'Worktrees', group: '2_changes_jira', order: 60, component: WorktreeCardSection,
  });
  app.slots.experimental_threadInfoSection({
    id: 'worktrees', group: '2_changes_jira', order: 60, component: WorktreeInfoSection,
  });
  app.slots.settingsSection({ id: 'preview', title: 'Цвета и предпросмотр', component: SettingsPreview });
  app.contentScripts.register({ id: 'adaptive-row', mount: () => adaptiveRows(document) });
  app.slots.experimental_threadRowMetadata<Data>({ id: 'workspace', order: 50, useData, component: Metadata });
});

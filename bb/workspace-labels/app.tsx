import { definePluginApp, experimental_useRpcKeyedQuery, useSettings } from '@get-bb/plugin-sdk/app';
import type { ExperimentalThreadRowMetadataDataInput, ExperimentalThreadRowMetadataProps } from '@get-bb/plugin-sdk';
import { git, type GitStatus } from './git';
import { parseLayout, type Layout } from './labels';
import { WorkspaceMetadata } from './metadata';
import './app.css';
import { adaptiveRows } from './adaptive';
import { LayoutPreview } from './preview';
import { CleanupOverlay, cleanupAction } from './cleanup-ui';

type Data = { layout: Layout; autoInline: boolean; hideMain: boolean; statuses: Record<string, GitStatus> | undefined };
function useData({ threads }: ExperimentalThreadRowMetadataDataInput): Data {
  const { values } = useSettings();
  const keys = [...new Set(threads.flatMap(thread => thread.environment?.id ? [thread.environment.id] : []))];
  const { data } = experimental_useRpcKeyedQuery({
    pluginId: 'bb--git', contract: git, method: 'status', keys, enabled: keys.length > 0,
  });
  return { layout: parseLayout(values?.layout), autoInline: values?.autoInline !== false, hideMain: values?.hideMain === true, statuses: data };
}
function Metadata({ thread, data }: ExperimentalThreadRowMetadataProps<Data>) {
  return <WorkspaceMetadata environment={thread.environment} layout={data.layout} autoInline={data.autoInline} hideMain={data.hideMain}
    status={thread.environment?.id ? data.statuses?.[thread.environment.id] : undefined}/>;
}
function SettingsPreview() {
  const { values } = useSettings();
  return <LayoutPreview layout={parseLayout(values?.layout)} autoInline={values?.autoInline !== false} hideMain={values?.hideMain === true}/>;
}
export default definePluginApp(app => {
  app.slots.experimental_threadAction(cleanupAction('archive'));
  app.slots.experimental_threadAction(cleanupAction('delete'));
  app.slots.experimental_appOverlay({ id: 'workspace-cleanup', component: CleanupOverlay });
  app.slots.settingsSection({ id: 'preview', title: 'Как это выглядит', component: SettingsPreview });
  app.contentScripts.register({ id: 'adaptive-row', mount: () => adaptiveRows(document) });
  app.slots.experimental_threadRowMetadata<Data>({ id: 'workspace', order: 50, useData, component: Metadata });
});

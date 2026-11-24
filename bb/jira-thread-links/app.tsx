import '../shared-ui/color-palette.css';
import { definePluginApp } from '@get-bb/plugin-sdk/app';
import { editThreadTasks, TaskCardSection, TaskInfoSection, taskSectionTitle } from './components/thread-tasks';
import { SidebarColorSettings } from './components/sidebar-settings';
import { mountSidebarBadges } from './hooks/sidebar-badges';
import { TaskEditor } from './components/task-editor';

export default definePluginApp(app => {
 app.slots.settingsSection({id:'sidebar-color',title:'Цвет задач в сайдбаре',component:SidebarColorSettings});
 app.slots.experimental_threadContextCardSection({
   id:'jira-task-links', group:'2_changes_jira', title:taskSectionTitle, component:TaskCardSection,
 });
 app.slots.experimental_threadInfoSection({
   id:'jira-task-links', group:'2_changes_jira', component:TaskInfoSection,
 });
 app.contentScripts.register({ id:'jira-row-links', mount:mountSidebarBadges });
 app.slots.experimental_appOverlay({ id:'jira-task-editor', component:TaskEditor });
 app.slots.experimental_threadAction({ id:'edit-tasks', title:taskSectionTitle, icon:'Link', group:'organize', item:({thread}) => ({label:'Задачи Jira…', icon:'Link', run:async () => editThreadTasks(thread.id)}) });
});

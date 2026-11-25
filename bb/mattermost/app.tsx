import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { MessageStatus } from "./components/status";
import { MattermostPanel } from "./components/board";
import { ThreadSection } from "./components/thread-section";
import { ColorSettings } from "./components/color-settings";
import { ConnectionSettings } from "./components/connection-settings";
import { SidebarOverlay } from "./components/sidebar-badges";
import { mountSidebarRows } from "./hooks/sidebar-rows";
import { SidebarSettings } from "./components/sidebar-settings";
import { Widget } from "./components/inbox";
import "../shared-ui/color-palette.css";
import "./app.css";

export default definePluginApp(app => {
  app.contentScripts.register({ id: "sidebar-watches", mount: mountSidebarRows });
  app.slots.experimental_appOverlay({ id: "sidebar-watches", component: SidebarOverlay });
  app.slots.settingsSection({ id: "sidebar-badges", title: "Бейджи в списке тредов", component: SidebarSettings });
  app.slots.settingsSection({ id: "connection", title: "Подключение к Mattermost", component: ConnectionSettings });
  app.slots.settingsSection({ id: "status-colors", title: "Цвета статусов", component: ColorSettings });
  app.slots.experimental_threadContextCardSection({
    id: "subscriptions", title: "Mattermost", group: "2_changes_mattermost", component: ThreadSection,
  });
  app.slots.experimental_threadInfoSection({
    id: "subscriptions", group: "2_changes_mattermost", component: props => <ThreadSection {...props} info />,
  });
  app.slots.messageDirective({ id: "mattermost-status", component: MessageStatus });
  app.slots.navPanel({ id: "subscriptions", path: "subscriptions", title: "Mattermost", icon: "MessageSquare", component: MattermostPanel });
  app.composer.customize({ id: "subscriptions", scopes: ["thread"], banners: [{ id: "watch", chrome: "bare", component: Widget }] });
});

import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { MessageStatus } from "./components/status";
import { MattermostPanel } from "./components/board";
import { ThreadSection } from "./components/thread-section";
import { ColorSettings } from "./components/color-settings";
import { ConnectionSettings } from "./components/connection-settings";
import { ThreadHeader } from "./components/thread-header";
import { HeaderSettings } from "./components/header-settings";
import { Widget } from "./components/inbox";
import "../shared-ui/color-palette.css";
import "./app.css";

export default definePluginApp(app => {
  if (app.slots.experimental_threadHeaderRow) {
    app.slots.experimental_threadHeaderRow({ id: "mattermost-watches", component: ThreadHeader });
    app.slots.settingsSection({ id: "thread-header", title: "Заголовок треда", component: HeaderSettings });
  }
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

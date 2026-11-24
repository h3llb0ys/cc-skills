import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { MessageStatus } from "./components/status";
import { Subscriptions } from "./components/subscriptions";
import { ThreadSection } from "./components/thread-section";
import { ConnectionSettings } from "./components/connection-settings";
import { Widget } from "./components/inbox";
import "../shared-ui/color-palette.css";
import "./app.css";

export default definePluginApp(app => {
  app.slots.settingsSection({ id: "connection", title: "Подключение к Mattermost", component: ConnectionSettings });
  app.slots.experimental_threadContextCardSection({
    id: "subscriptions", title: "Mattermost", group: "2_changes_mattermost", component: ThreadSection,
  });
  app.slots.experimental_threadInfoSection({
    id: "subscriptions", group: "2_changes_mattermost", component: props => <ThreadSection {...props} info />,
  });
  app.slots.messageDirective({ id: "mattermost-status", component: MessageStatus });
  app.slots.navPanel({ id: "subscriptions", path: "subscriptions", title: "Mattermost", icon: "MessageSquare", component: () => <Subscriptions /> });
  app.composer.customize({ id: "subscriptions", scopes: ["thread"], banners: [{ id: "watch", chrome: "bare", component: Widget }] });
});

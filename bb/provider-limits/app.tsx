import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Header, Rail } from "./components/navigation";
import { Settings } from "./components/settings";
import "./app.css";

export default definePluginApp((app) => {
  app.slots.experimental_sidebarNavigation({
    id: "rail",
    title: "Provider Limits",
    description: "Навигация с остатками лимитов провайдеров",
    placement: "rail",
    component: Rail,
    headerComponent: Header,
  });
  app.slots.settingsSection({
    id: "limits",
    title: "Лимиты провайдеров",
    component: Settings,
  });
});

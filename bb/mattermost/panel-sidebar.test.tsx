// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { expect, it } from "vitest";
import { contract, defaults, type Watch } from "./contract";
import type { ListLayout } from "./settings";

it("previews all layouts and saves the choice without loading real subscriptions", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const section = app.settingsSections.find(s => s.id === "list-layout")!;
  let saved: ListLayout = "flat";
  const view = renderSlot(section, {}, { rpc: {
    colors: () => defaults, listLayout: () => saved,
    setListLayout: value => { saved = contract.setListLayout.input.parse(value); return null; },
  } });
  try {
    const preview = await view.findByLabelText("Предпросмотр списка подписок");
    expect(preview.querySelectorAll("li")).toHaveLength(4);
    expect(preview.querySelector("button, a, summary")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "По статусам" }));
    await waitFor(() => expect(saved).toBe("status"));
    await waitFor(() => expect(preview.querySelectorAll("summary")).toHaveLength(4));
    const paused = preview.querySelector("li[data-muted=true]")!;
    expect(paused.textContent).toContain("promo-support");
    expect(paused.querySelector(".mm-list-indicator i")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "По тредам BB" }));
    await waitFor(() => expect(saved).toBe("thread"));
    expect(Array.from(preview.querySelectorAll("summary"), x => x.textContent)).toEqual(["Вопросы-ответы · 2", "Дежурство промо · 2"]);
    expect(view.inspection.rpcCalls.some(c => c.method === "list")).toBe(false);
  } finally { view.lifecycle.unmount(); }
});

it("opens the shared watch editor from the panel sidebar for a subscription in another thread", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const panel = app.navPanels[0]!;
  const watch: Watch = { id: "a".repeat(20), chat: "thread1", owner: "p", title: "Релиз", kind: "thread",
    url: "https://mm.example/team/pl/a", interval: 5, rule: "QA", draft: true, timezone: "UTC", status: "normal",
    until: null, push: null, schedule: null, paused: false };
  const options = { rpc: { listLayout: () => "flat", list: () => ({ watches: [watch, { ...watch,
    id: "b".repeat(20), chat: "thread2", title: "Дежурство" }], colors: defaults }) },
    settings: { subscriptionClick: "Редактировать подписку" } };
  const view = renderSlot({ component: panel.experimental_sidebar! }, { subPath: "" }, options);
  try {
    await view.findByText("Дежурство");
    fireEvent.click(view.getByText("Релиз"));
    expect(view.inspection.navigateCalls[0]).toMatchObject({ method: "toPluginPanel", path: "subscriptions", options: { subPath: "edit/" + watch.id } });
  } finally { view.lifecycle.unmount(); }
  const editor = renderSlot(panel, { subPath: "edit/" + watch.id }, options);
  try {
    expect((await editor.findByLabelText("Интервал, минуты") as HTMLInputElement).value).toBe("5");
  } finally { editor.lifecycle.unmount(); }
});

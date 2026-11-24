// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { expect, it } from "vitest";
import { contract } from "./contract";

it("navigates from the registry, edits conditions and applies the shared color picker", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const w = { id: "a".repeat(20), chat: "thread1", owner: "project1", url: "https://mm.example/team/pl/abc",
    interval: 5, rule: "QA", push: null, until: null, draft: false, schedule: "schedule1", timezone: "UTC",
    paused: false, status: "answer", title: "Релиз", kind: "thread" };
  const edits: unknown[] = [], choices: unknown[] = [];
  const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, {
    rpc: { list: () => ({ watches: [w], colors: { answer: null, attention: null, resolved: null } }),
      edit: input => { edits.push(input); return null; }, color: input => { choices.push(input); return null; } },
    openUrl: () => true,
  });
  try {
    await slot.findByText("Ждут ответа");
    fireEvent.click(slot.getByText("Релиз"));
    fireEvent.click(slot.getByLabelText("Открыть в Mattermost: Релиз"));
    const desktop = slot.getByRole("link", { name: "В приложении ↗" });
    expect(desktop.getAttribute("href")).toBe("mattermost://mm.example/team/pl/abc");
    fireEvent.click(desktop);
    expect(JSON.stringify(slot.inspection.navigateCalls)).toContain("mattermost://mm.example/team/pl/abc");
    expect(JSON.stringify(slot.inspection.navigateCalls)).toContain("thread1");
    fireEvent.click(slot.getByLabelText("Открыть в Mattermost: Релиз"));
    fireEvent.click(slot.getByText("В браузере ↗"));
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "openUrl", url: w.url });
    fireEvent.click(slot.getByLabelText("Настройки: Релиз"));
    fireEvent.change(slot.getByLabelText("Интервал, минуты"), { target: { value: "12" } });
    fireEvent.click(slot.getByText("Сохранить"));
    await waitFor(() => expect(edits).toMatchObject([{ interval: 12, rule: "QA" }]));
    fireEvent.click(slot.getByText("Цвета"));
    fireEvent.click(slot.getByLabelText("#8b5cf6"));
    await waitFor(() => expect(choices).toEqual([{ status: "answer", color: "#8b5cf6" }]));
  } finally { slot.lifecycle.unmount(); }
});

it("reads old subscriptions without inventing an alert and rejects foreign URL schemes", () => {
  const data = { id: "a".repeat(20), url: "https://mm.example/team/pl/abc", chat:"t", owner:"p", interval:5,
    rule:"QA", push:null, until:null, schedule:null, paused:false, timezone:"UTC" };
  const output = { colors:{answer:null, attention:null, resolved:null}, watches:[data] };
  const blank = { ...data, rule: "  " };
  expect(contract.list.output.parse({ ...output, watches: [blank, data] }).watches).toHaveLength(2);
  expect(contract.edit.input.safeParse({ ...blank, draft: false }).success).toBe(false);
  expect(contract.list.output.parse(output).watches[0].status).toBe("normal");
  expect(contract.list.output.safeParse({...output,watches:[{...data,url:"javascript:alert(1)"}]}).success).toBe(false);
});

it("renders a historical notification with its status and the configured palette", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const rendered = renderSlot(app.messageDirectives[0]!, {
    attributes: { status: "attention" }, source: "", openWorkspaceFile: null,
    message: { id: "m", threadId: "t", projectId: "p", turnId: null },
  }, { rpc: { colors: () => ({ answer: null, attention: "#123456", resolved: null }) } });
  try {
    const label = await rendered.findByText("Стоит посмотреть");
    await waitFor(() => expect(label.querySelector("i")?.style.backgroundColor).toBe("rgb(18, 52, 86)"));
  } finally { rendered.lifecycle.unmount(); }
});

it("shows only the current chat's subscriptions in its collapsed widget", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const base = { id: "a".repeat(20), chat:"target", owner:"p", title:"Своя ветка",
    url:"https://mm.example/team/pl/abc", interval:5, rule:"QA", until:null, push:null,
    schedule:null, paused:false, timezone:"UTC" };
  const rendered = renderSlot(app.composerCustomizations[0]!.banners![0]!, {}, {
    composer: { scope: { kind:"thread", threadId:"target" } },
    rpc: { list: () => ({ watches:[base, {...base, id:"b".repeat(20), chat:"other", title:"Чужая ветка"}],
      colors:{answer:null,attention:null,resolved:null} }) },
  });
  try {
    const toggle = await rendered.findByText(/Наблюдение Mattermost · 1/);
    expect(rendered.queryByText("Своя ветка")).toBeNull();
    fireEvent.click(toggle);
    expect(rendered.getByText("Своя ветка")).toBeTruthy();
    expect(rendered.queryByText("Чужая ветка")).toBeNull();
    expect(rendered.container.querySelector(".mm-marker")).toBeNull();
  } finally { rendered.lifecycle.unmount(); }
});

it("checks the entered cookie before saving and can retest the stored session", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const section = app.settingsSections.find(s => s.id === "connection")!;
  let stored = { url: "", hasCookie: false };
  const checks: unknown[] = [];
  const saves: unknown[] = [];
  const view = renderSlot(section, {}, { rpc: {
    connection: () => stored,
    testConnection: input => { checks.push(input); return { username: "alice" }; },
    saveConnection: input => {
      saves.push(input);
      stored = { url: "https://mm.example", hasCookie: true };
      return stored;
    },
  } });
  try {
    const url = await view.findByLabelText("Адрес сервера Mattermost");
    const cookie = view.getByLabelText("Cookie") as HTMLInputElement;
    expect(cookie.type).toBe("password");
    fireEvent.change(url, { target: { value: "https://mm.example" } });
    fireEvent.change(cookie, { target: { value: "session=test" } });
    fireEvent.click(view.getByText("Проверить соединение"));
    await view.findByText("Соединение установлено · @alice");
    expect(checks).toEqual([{ url: "https://mm.example", cookie: "session=test" }]);
    expect(saves).toEqual([]);
    fireEvent.click(view.getByText("Сохранить"));
    await view.findByText("Подключение сохранено");
    expect(saves).toEqual(checks);
    expect(cookie.value).toBe("");
    fireEvent.click(view.getByText("Проверить соединение"));
    await waitFor(() => expect(checks[1]).toEqual({ url: stored.url, cookie: "" }));
    fireEvent.change(url, { target: { value: "https://other.example" } });
    expect((view.getByText("Проверить соединение") as HTMLButtonElement).disabled).toBe(true);
  } finally { view.lifecycle.unmount(); }
});

it("shows this thread's subscriptions in the card and Info with a check time and shared color", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const props = { threadId: "target", projectId: "p", environment: null };
  const own = { id: "a".repeat(20), chat: "target", owner: "p", title: "Promo", kind: "channel",
    url: "https://mm.example/team/channels/promo", interval: 10, rule: "QA", until: null, push: null,
    schedule: "schedule", paused: false, timezone: "UTC", status: "answer", last_checked_at: 1800000000 };
  const rpc = { list: () => ({ watches: [own, { ...own, chat: "other", title: "Other channel" }],
    colors: { answer: "#123456", attention: null, resolved: null } }) };
  for (const section of [app.threadContextCardSections[0]!, app.threadInfoSections[0]!]) {
    const view = renderSlot(section, props, { rpc });
    try {
      const link = await view.findByLabelText("Открыть в Mattermost: Promo");
      expect(link.getAttribute("href")).toBe(own.url);
      expect(view.queryByText("Other channel")).toBeNull();
      expect(view.getByText("Ждут ответа").querySelector("i")?.style.backgroundColor).toBe("rgb(18, 52, 86)");
      expect(view.container.querySelector("time")?.dateTime).toBe(new Date(own.last_checked_at * 1000).toISOString());
    } finally { view.lifecycle.unmount(); }
    const hidden = renderSlot(section, props, { settings: { showThreadSubscriptions: false }, rpc });
    try {
      expect(hidden.container.textContent).toBe("");
      expect(hidden.inspection.rpcCalls).toHaveLength(0);
    } finally { hidden.lifecycle.unmount(); }
  }
});

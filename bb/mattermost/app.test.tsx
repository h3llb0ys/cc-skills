// @vitest-environment jsdom
import { act, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { expect, it, vi } from "vitest";
import { mountSidebarRows } from "./hooks/sidebar-rows";
import { contract } from "./contract";

it("navigates from the registry, edits conditions and leaves the palette in plugin settings", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const w = { id: "a".repeat(20), chat: "thread1", owner: "project1", url: "https://mm.example/team/pl/abc",
    interval: 5, rule: "QA", push: null, until: null, draft: false, schedule: "schedule1", timezone: "UTC",
    paused: false, status: "answer", title: "Релиз", kind: "thread", source_problem: "Сессия истекла", source_link_blocked: false };
  const edits: unknown[] = [];
  const slot = renderSlot(app.navPanels[0]!, { subPath: "list" }, {
    sidebarThreads: { threads: [{ id: "thread2", displayTitle: "Дежурство", projectId: "p2",
      environment: { id: "env2" } } as ReturnType<typeof import("@get-bb/plugin-sdk/app").experimental_useSidebarThreads>["threads"][number]] },
    rpc: { list: () => ({ watches: [w], colors: { answer: null, attention: null, resolved: null } }),
      edit: input => { edits.push(input); return null; } },
    openUrl: () => true,
  });
  try {
    await slot.findByText("Ждут ответа");
    fireEvent.click(slot.getByText("Релиз"));
    expect(slot.inspection.navigateCalls).toContainEqual(expect.objectContaining({ method: "toThread", threadId: "thread1" }));
    const primary = slot.getByRole("link", { name: "Открыть в браузере: Релиз" });
    fireEvent.click(primary);
    const arrow = slot.getByRole("button", { name: "Выбрать, где открыть: Релиз" });
    fireEvent.keyDown(arrow, { key: "Enter" });
    const menu = await slot.findByRole("menu");
    const desktop = menu.querySelector('a[href^="mattermost:"]')!;
    expect(desktop.getAttribute("href")).toBe("mattermost://mm.example/team/pl/abc");
    fireEvent.click(desktop);
    expect(slot.queryByRole("menu")).toBeNull();
    fireEvent.click(primary);
    expect(slot.inspection.navigateCalls.filter(call => call.method === "openUrl")).toEqual([
      { method: "openUrl", url: w.url },
      { method: "openUrl", url: "mattermost://mm.example/team/pl/abc" },
      { method: "openUrl", url: w.url },
    ]);
    fireEvent.click(slot.getByLabelText("Настройки: Релиз"));
    const target = slot.getByLabelText("Куда присылать") as HTMLSelectElement;
    expect(target.value).toBe("thread1");
    expect(Array.from(target.options, option => option.text)).toContain("Дежурство");
    fireEvent.change(target, { target: { value: "thread2" } });
    fireEvent.click(slot.getByRole("checkbox", { name: /общий сабтред сводок/ }));
    fireEvent.change(slot.getByLabelText("Интервал, минуты"), { target: { value: "12" } });
    fireEvent.click(slot.getByText("Сохранить"));
    await waitFor(() => expect(edits).toMatchObject([{ id: w.id, interval: 12, rule: "QA", chat: "thread2", destination: "shared" }]));
    expect(slot.queryByRole("button", { name: "Цвета" })).toBeNull();
    expect(slot.queryByLabelText("#8b5cf6")).toBeNull();
  } finally { slot.lifecycle.unmount(); }
});

it("keeps the native application link when BB cannot handle it and leaves modified clicks to the browser", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const watch = { id: "a".repeat(20), chat: "thread1", owner: "project", url: "HTTPS://mm.example/team/pl/abc",
    title: "Релиз", interval: 5, rule: "QA", until: null, push: null, schedule: null, paused: false, timezone: "UTC" };
  const view = renderSlot(app.navPanels[0]!, { subPath: "list" }, {
    rpc: { list: () => ({ watches: [watch], colors: { answer: null, attention: null, resolved: null } }) },
    settings: { subscriptionClick: "Открыть в приложении" }, openUrl: () => false,
  });
  const native: string[] = [];
  const captureNavigation = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    const link = (event.target as Element).closest("a");
    if (link) native.push(link.href);
    event.preventDefault(); // jsdom has no external app or browser to hand the link to.
  };
  document.addEventListener("click", captureNavigation);
  try {
    const row = (await view.findByText("Релиз")).closest("a")!;
    const appUrl = "mattermost://mm.example/team/pl/abc";
    expect(row.href).toBe(appUrl);
    fireEvent.click(row);
    fireEvent.click(view.getByRole("link", { name: "Открыть в браузере: Релиз" }), { ctrlKey: true });
    expect(native).toEqual([appUrl, new URL(watch.url).href]);
    expect(view.inspection.navigateCalls).toEqual([{ method: "openUrl", url: appUrl }]);
  } finally {
    document.removeEventListener("click", captureNavigation);
    view.lifecycle.unmount();
  }
});

it("edits and resets a saved status color from plugin settings without loading watches", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const section = app.settingsSections.find(s => s.title === "Цвета статусов")!;
  let resolved: string | null = "#14b8a6";
  const view = renderSlot(section, {}, { rpc: {
    colors: () => ({ answer: null, attention: null, resolved }),
    color: input => {
      const change = contract.color.input.parse(input);
      expect(change.status).toBe("resolved");
      resolved = change.color;
      return null;
    },
  } });
  try {
    fireEvent.click(await view.findByRole("button", { name: "Решено" }));
    expect(view.getByLabelText("#14b8a6").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(view.getByLabelText("#8b5cf6"));
    await waitFor(() => expect(resolved).toBe("#8b5cf6"));
    await view.behavior.emitRealtime("colors", {});
    await waitFor(() => expect(view.getByLabelText("#8b5cf6").getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(view.getByRole("button", { name: "По умолчанию" }));
    await waitFor(() => expect(resolved).toBeNull());
    await view.behavior.emitRealtime("colors", {});
    await waitFor(() => expect(view.getByText("По умолчанию").getAttribute("aria-pressed")).toBe("true"));
  } finally { view.lifecycle.unmount(); }
});

it("groups the same subscriptions by BB thread from the top navigation", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const watch = { id: "a".repeat(20), chat: "thread-1", owner: "project", title: "Промо",
    url: "https://mm.example/team/channels/promo", interval: 10, rule: "QA", paused: false,
    schedule: "job", timezone: "UTC", until: null, push: null };
  const view = renderSlot(app.navPanels[0]!, { subPath: "threads" }, { rpc: {
    list: () => ({ watches: [watch, { ...watch, id: "b".repeat(20), title: "Релизы" }],
      colors: { answer: null, attention: null, resolved: null } }),
  } });
  try {
    const group = (await view.findByText("thread-1 · 2")).closest("details")!;
    expect(group.textContent).toContain("Промо");
    expect(group.textContent).toContain("Релизы");
    const tab = view.getByRole("button", { name: "По тредам BB", pressed: true });
    expect(tab.closest("nav")).toBe(view.getByText("Входящие").closest("nav"));
    expect(view.queryByText("Список подписок")).toBeNull();
    fireEvent.click(tab);
    expect(JSON.stringify(view.inspection.navigateCalls)).toContain('"subPath":"threads"');
  } finally { view.lifecycle.unmount(); }
});

it("confirms removal, keeps the row after an error and retries only the selected watch", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const w = { id: "a".repeat(20), chat: "t", owner: "p", url: "https://mm.example/team/pl/a", title: "Релиз",
    interval: 5, rule: "QA", push: null, until: null, schedule: "schedule", paused: false, timezone: "UTC" };
  let rows = [w, { ...w, id: "b".repeat(20), title: "Дежурство" }];
  const attempts: unknown[] = [];
  const view = renderSlot(app.navPanels[0]!, { subPath: "list" }, { rpc: {
    list: () => ({ watches: rows, colors: { answer:null, attention:null, resolved:null } }),
    unwatch: input => {
      attempts.push(input);
      if (attempts.length === 1) throw Error("BB временно недоступен");
      rows = rows.filter(row => row.id !== w.id);
      return null;
    },
  } });
  try {
    const trash = await view.findByRole("button", { name: "Удалить подписку: Релиз" });
    fireEvent.click(trash);
    await view.findByText("Удалить подписку «Релиз» и её автоматизацию в BB?");
    fireEvent.click(view.getByText("Отмена"));
    expect(attempts).toEqual([]);
    fireEvent.click(trash);
    fireEvent.click(view.getByText("Удалить"));
    await view.findByRole("alert");
    fireEvent.click(view.getByText("Удалить"));
    await waitFor(() => expect(view.queryByText("Релиз")).toBeNull());
    expect(attempts).toEqual([{ id: w.id }, { id: w.id }]);
    expect(view.getByText("Дежурство")).toBeTruthy();
  } finally { view.lifecycle.unmount(); }
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

it("opens the newest unread summary, then history, draft and current-thread settings", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const w = { id: "a".repeat(20), chat:"target", owner:"p", title:"Своя ветка", url:"https://mm.example/team/pl/abc",
    interval:5, rule:"Уведомляй о QA", until:null, push:null, schedule:null, paused:false, timezone:"UTC" };
  const item = { id: 1, headline: "Когда обновляется кэш?", source: "Канал", status: "attention", created: 1800000000, url: w.url };
  let opened = 0;
  const rendered = renderSlot(app.composerCustomizations[0]!.banners![0]!, {}, {
    composer: { scope: { kind:"thread", threadId:"target" } },
    rpc: {
      list: () => ({ watches: [w, { ...w, chat:"other", title:"Чужая ветка" }], colors:{answer:null,attention:null,resolved:null} }),
      inbox: () => ({ rows:[{...item, opened}], latest: opened ? null : {...item,opened}, unread:1-opened, more:false, child:null }),
      openSummary: input => { expect(input).toEqual({chat:"target",id:1}); opened=1; return {...item,opened,body:"Вопрос о кэше",draft:"Уточню у команды."}; },
    },
  });
  try {
    fireEvent.click(await rendered.findByText("Открыть сводку →"));
    await rendered.findByText("Вопрос о кэше");
    fireEvent.click(rendered.getByText("Черновик ответа"));
    expect((rendered.getByLabelText("Черновик ответа") as HTMLTextAreaElement).value).toBe("Уточню у команды.");
    fireEvent.click(rendered.getByText("← Назад"));
    await rendered.findByText("Все сводки просмотрены");
    fireEvent.click(rendered.getByRole("button", { name: "Сводки" }));
    await rendered.findByText(item.headline);
    fireEvent.click(rendered.getByText("Подписки · 1"));
    const settings = await rendered.findByRole("button", { name: "Настройки: Своя ветка" });
    for (const [label, icon] of [["Выбрать, где открыть: Своя ветка", "ChevronDown"], ["Настройки: Своя ветка", "Settings"], ["Удалить подписку: Своя ветка", "Trash2"]]) {
      const button = rendered.getByRole("button", { name: label });
      expect(button.querySelector(".mm-action-glyph")?.getAttribute("data-icon")).toBe(icon);
    }
    fireEvent.click(settings);
    expect(rendered.queryByText("Чужая ветка")).toBeNull();
    expect((rendered.getByLabelText("Куда присылать") as HTMLSelectElement).value).toBe(w.chat);
    expect((rendered.getByLabelText("Полное правило") as HTMLTextAreaElement).value).toBe(w.rule);
  } finally { rendered.lifecycle.unmount(); }
});

it("explains how to subscribe when only summary history remains", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const view = renderSlot(app.composerCustomizations[0]!.banners![0]!, {}, {
    composer: { scope: { kind: "thread", threadId: "target" } },
    rpc: {
      list: () => ({ watches: [], colors: { answer: null, attention: null, resolved: null } }),
      inbox: () => ({ rows: [{ id: 1, source: "QA", headline: "Релиз", url: "https://mm.example/team/pl/a",
        status: "normal", created: 1800000000, opened: 1 }], more: false, unread: 0, latest: null, child: null }),
    },
  });
  try {
    fireEvent.click(await view.findByText("Подписки · 0"));
    await view.findByText(/Подписок пока нет/);
  } finally { view.lifecycle.unmount(); }
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
    schedule: "schedule", paused: false, timezone: "UTC", status: "answer", last_checked_at: 1800000000, last_processed_at: 1799999100, processing_pending: true };
  const rpc = { list: () => ({ watches: [own, { ...own, chat: "other", title: "Other channel" }],
    colors: { answer: "#123456", attention: null, resolved: null } }) };
  for (const section of [app.threadContextCardSections[0]!, app.threadInfoSections[0]!]) {
    const view = renderSlot(section, props, { rpc });
    try {
      const link = await view.findByLabelText("Открыть в браузере: Promo");
      expect(link.getAttribute("href")).toBe(own.url);
      expect(link.querySelector(".mm-action-glyph")?.getAttribute("data-icon")).toBe("Globe");
      expect(view.queryByText("Other channel")).toBeNull();
      expect(view.getByText("Ждут ответа").querySelector("i")?.style.backgroundColor).toBe("rgb(18, 52, 86)");
      expect(view.getByText(/Ожидает обработки/)).toBeTruthy();
      expect(view.getByText(/^Обработано/).getAttribute("datetime")).toBe(new Date(own.last_processed_at * 1000).toISOString());
      expect(view.container.querySelector("time")?.dateTime).toBe(new Date(own.last_checked_at * 1000).toISOString());
    } finally { view.lifecycle.unmount(); }
    for (const [action, archived] of [["Открыть тред BB", false], ["Открыть тред BB", true], ["Редактировать подписку", false]] as const) {
      const shared = {...own, destination: "shared", summary_thread: "child"};
      type Thread = Awaited<ReturnType<ReturnType<typeof import("@get-bb/plugin-sdk/app").useSdk>["threads"]["get"]>>;
      const configured = renderSlot(section, props, { settings: { subscriptionClick: action },
        sdk: { threads: { get: async () => ({ id: "child", parentThreadId: "target", archivedAt: archived ? 1 : null } as Thread) } },
        rpc: { list: () => ({...rpc.list(), watches: [shared]}) } });
      try {
        const button = await configured.findByRole("button", { name: "Promo" });
        expect(button.title).toBe(action);
        fireEvent.click(button);
        if (action === "Открыть тред BB") await waitFor(() => expect(configured.inspection.navigateCalls)
          .toContainEqual(expect.objectContaining({method:"toThread", threadId:archived ? "target" : "child"})));
        else await configured.findByRole("form", { name: "Настройки подписки" });
      } finally { configured.lifecycle.unmount(); }
    }
    const desktopDefault = renderSlot(section, props, {
      rpc, settings: { openTarget: "В приложении", subscriptionClick: "Открыть в Mattermost" }, openUrl: () => true,
    });
    try {
      const desktop = await desktopDefault.findByRole("link", { name: "Открыть в приложении: Promo" });
      expect(desktop.querySelector(".mm-action-glyph")?.getAttribute("data-icon")).toBe("Laptop");
      fireEvent.click(desktop);
      expect(desktopDefault.inspection.navigateCalls).toContainEqual({ method: "openUrl", url: own.url.replace("https:", "mattermost:") });
      expect(desktopDefault.getByText("Promo").getAttribute("href")).toBe(own.url);
      fireEvent.keyDown(desktopDefault.getByLabelText("Выбрать, где открыть: Promo"), { key: "Enter" });
      fireEvent.click(await desktopDefault.findByRole("menuitem", { name: "В браузере" }));
      expect(desktopDefault.inspection.navigateCalls).toContainEqual({ method: "openUrl", url: own.url });
      expect(desktopDefault.queryByRole("menu")).toBeNull();
      expect(desktop.getAttribute("href")).toBe(own.url.replace("https:", "mattermost:"));
    } finally { desktopDefault.lifecycle.unmount(); }
    const hidden = renderSlot(section, props, { settings: { showThreadSubscriptions: false }, rpc });
    try {
      expect(hidden.container.textContent).toBe("");
      expect(hidden.inspection.rpcCalls).toHaveLength(0);
    } finally { hidden.lifecycle.unmount(); }
  }
});

it("opens the board first, keeps read questions active and copies the edited reply before opening its post", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const item = { id: 42, revision: 1, url: "https://mm.example/team/pl/abc", headline: "Уточнить дату", body: "Ира ждёт дату",
    source: "#qa", draft: "В четверг", author: "ira", opened: false, updated: 1800000000, chat: "target" };
  const empty = { total: 0, rows: [] };
  const view = renderSlot(app.navPanels[0]!, { subPath: "" }, {
    rpc: { list: () => ({ watches: [], colors: { answer: null, attention: null, resolved: null } }),
      board: () => ({ answer: { total: 1, rows: [item] }, attention: empty, resolved: empty }),
      readCard: () => { item.opened = true; return null; } },
    openUrl: () => true,
  });
  try {
    fireEvent.click(await view.findByText("Ответить"));
    await waitFor(() => expect(item.opened).toBe(true));
    fireEvent.change(view.getByLabelText("Черновик ответа"), { target: { value: "В пятницу" } });
    fireEvent.click(view.getByText("Скопировать и открыть в Mattermost"));
    await view.findByText("Черновик скопирован");
    expect(view.inspection.experimental_clipboardWrites).toEqual([{ text: "В пятницу" }]);
    expect(view.inspection.navigateCalls).toContainEqual({ method: "openUrl", url: item.url });
    expect(view.getByText("Ждут ответа")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: /Подписки/ }));
    expect(view.inspection.navigateCalls.some(call => JSON.stringify(call).includes("list"))).toBe(true);
  } finally { view.lifecycle.unmount(); }
});

it("creates a watch from the empty subscriptions panel and keeps inputs when scheduling fails", async () => {
  const app = await loadPluginApp(() => import("./app"));
  type SidebarThread = ReturnType<typeof import("@get-bb/plugin-sdk/app").experimental_useSidebarThreads>["threads"][number];
  const sidebarThread = { id: "thread1", projectId: "project", displayTitle: "Дежурство",
    environment: { id: "env", name: "main" } } as SidebarThread;
  const inputs: unknown[] = [];
  const view = renderSlot(app.navPanels[0]!, { subPath: "list" }, {
    sidebarThreads: { threads: [sidebarThread, { ...sidebarThread, id: "thread2" }] },
    rpc: { list: () => ({ watches: [], colors: {answer:null, attention:null, resolved:null} }),
      create: input => {
        inputs.push(contract.create.input.parse(input));
        if (inputs.length === 1) throw Error("Расписание недоступно");
        return null;
      } },
  });
  try {
    fireEvent.click(await view.findByRole("button", { name: "Добавить подписку" }));
    const url = "https://mm.example/team/channels/qa";
    fireEvent.change(view.getByLabelText("Ссылка на канал или ветку Mattermost"), { target: { value: url } });
    expect(view.getByRole("option", { name: /Дежурство.*thread1/ })).toBeTruthy();
    expect(view.getByRole("option", { name: /Дежурство.*thread2/ })).toBeTruthy();
    fireEvent.change(view.getByLabelText("Куда присылать"), { target: { value: "thread1" } });
    fireEvent.click(view.getByRole("button", { name: "Создать подписку" }));
    await view.findByRole("alert");
    expect((view.getByLabelText("Ссылка на канал или ветку Mattermost") as HTMLInputElement).value).toBe(url);
    fireEvent.click(view.getByRole("button", { name: "Создать подписку" }));
    await waitFor(() => expect(view.queryByRole("form", { name: "Новая подписка" })).toBeNull());
    expect(inputs).toMatchObject([{ url, chat: "thread1", interval: 10, push: null }, { url, chat: "thread1" }]);
  } finally { view.lifecycle.unmount(); }
});

it("saves the sidebar mode alongside a live preview that uses sample subscriptions and the saved palette", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const section = app.settingsSections.find(s => s.id === "sidebar-badges")!;
  let saved = "combined";
  const view = renderSlot(section, {}, { rpc: {
    headerMode: () => saved,
    colors: () => ({ answer: "#123456", attention: null, resolved: null }),
    setHeaderMode: input => { saved = contract.setHeaderMode.input.parse(input); return null; },
  } });
  try {
    await view.findByRole("button", { name: "Mattermost · 3" });
    const answer = view.getByRole("button", { name: /Ждут ответа/ });
    await waitFor(() => expect(answer.querySelector("i")?.style.backgroundColor).toBe("rgb(18, 52, 86)"));
    fireEvent.click(answer);
    expect(view.getByRole("list").children).toHaveLength(1);
    fireEvent.change(view.getByLabelText("Рядом с названием треда"), { target: { value: "important" } });
    await waitFor(() => expect(saved).toBe("important"));
    expect(view.queryByRole("button", { name: /Mattermost/ })).toBeNull();
    fireEvent.change(view.getByLabelText("Сценарий для примера"), { target: { value: "Всё спокойно" } });
    expect(view.queryByRole("button", { name: /Ждут ответа/ })).toBeNull();
    expect(view.getByText("Вопросы команды промо")).toBeTruthy();
    expect(saved).toBe("important");
  } finally { view.lifecycle.unmount(); }
});

function mountTestSidebar() {
  const nav = document.createElement("nav");
  nav.innerHTML = '<div><a data-sidebar-thread-id="t"></a><span><span class="bb-thread-title">My thread</span></span></div>';
  document.body.append(nav);
  const stop = mountSidebarRows();
  return { nav, dispose() { stop(); nav.remove(); } };
}

it("places badges next to the sidebar title and filters counts and expanded subscriptions by thread, priority and mode", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const watch = { id: "a".repeat(20), chat: "t", owner: "p", title: "Релиз", url: "https://mm.example/t/pl/a",
    interval: 10, rule: "QA", paused: false, push: null, until: null, schedule: "job", timezone: "UTC", status: "answer" };
  let mode = "off";
  let listCalls = 0;
  const scans = vi.spyOn(document, "querySelectorAll");
  const sidebar = mountTestSidebar();
  expect(app.threadHeaderRows).toHaveLength(0);
  const view = renderSlot(app.appOverlays[0]!, {}, { rpc: {
    headerMode: () => mode,
    list: () => { listCalls++; return { colors: { answer: null, attention: null, resolved: null }, watches: [watch,
      { ...watch, id: "b".repeat(20), title: "Дежурство", paused: false, status: "normal", source_problem: "Сессия истекла" },
      { ...watch, id: "c".repeat(20), title: "Другая команда", chat: "other" }] }; },
  } });
  try {
    await waitFor(() => expect(view.inspection.rpcCalls.some(c => c.method === "headerMode")).toBe(true));
    expect(listCalls).toBe(0);
    expect(scans).not.toHaveBeenCalledWith("[data-sidebar-thread-id]");
    mode = "combined";
    await view.behavior.experimental_invalidateRpc(["header-mode"]);
    fireEvent.click(await view.findByRole("button", { name: "Ждут ответа · 1" }));
    expect(view.getByRole("list").textContent).toContain("Релиз");
    expect(view.queryByText("Дежурство")).toBeNull();
    const openDialog = view.getByRole("dialog");
    const inserted = document.createElement("div");
    inserted.innerHTML = '<a data-sidebar-thread-id="unrelated"></a><span><span class="bb-thread-title">New thread</span></span>';
    await act(async () => { sidebar.nav.prepend(inserted); });
    expect(view.queryByRole("dialog")).toBe(openDialog);
    await act(async () => { inserted.remove(); });
    fireEvent.keyDown(openDialog, { key: "Escape" });
    expect(sidebar.nav.contains(view.getByRole("button", { name: "Mattermost · 2" }))).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Mattermost · 2" }));
    expect(view.getByRole("list").children).toHaveLength(2);
    expect(view.queryByText("Другая команда")).toBeNull();
    watch.paused = true;
    await view.behavior.emitRealtime("changed", {});
    await view.findByRole("button", { name: "Сбой подписки · 1" });
    mode = "count";
    await view.behavior.experimental_invalidateRpc(["header-mode"]);
    await waitFor(() => expect(view.queryByRole("button", { name: /Сбой подписки/ })).toBeNull());
    expect(view.getByRole("button", { name: "Mattermost · 2" })).toBeTruthy();
    sidebar.nav.querySelector("a")!.dataset.sidebarThreadId = "other";
    await view.findByRole("button", { name: "Mattermost · 1" });
    expect(view.queryByRole("button", { name: "Mattermost · 2" })).toBeNull();
    mode = "off";
    await view.behavior.experimental_invalidateRpc(["header-mode"]);
    await waitFor(() => expect(view.queryByRole("button", { name: "Mattermost · 1" })).toBeNull());
    scans.mockClear();
    await act(async () => { sidebar.nav.prepend(inserted); });
    expect(scans).not.toHaveBeenCalledWith("[data-sidebar-thread-id]");
  } finally { view.lifecycle.unmount(); sidebar.dispose(); scans.mockRestore(); }
});

it("keeps the acknowledged choice if a refresh fails and rolls back a rejected change", async () => {
  const app = await loadPluginApp(() => import("./app"));
  let saved = "combined", readFails = false;
  const view = renderSlot(app.settingsSections.find(s => s.id === "sidebar-badges")!, {}, { rpc: {
    headerMode: () => { if (readFails) throw Error("offline"); return saved; },
    colors: () => ({ answer: null, attention: null, resolved: null }),
    setHeaderMode: input => {
      if (input === "important") throw Error("ошибка записи");
      saved = contract.setHeaderMode.input.parse(input);
      return null;
    },
  } });
  try {
    const select = await view.findByLabelText("Рядом с названием треда") as HTMLSelectElement;
    readFails = true;
    fireEvent.change(select, { target: { value: "off" } });
    await waitFor(() => expect(saved).toBe("off"));
    await view.behavior.experimental_invalidateRpc(["header-mode"]);
    await view.findByText(/Не удалось обновить режим/);
    expect(select.value).toBe("off");
    readFails = false;
    fireEvent.click(view.getByText("Повторить"));
    await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
    fireEvent.change(select, { target: { value: "important" } });
    await view.findByText(/Не удалось сохранить режим/);
    expect(select.value).toBe("off");
  } finally { view.lifecycle.unmount(); }
});

it("shares one list poll in split panes and forgets a filter when its badge disappears", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const slot = app.appOverlays[0]!;
  const sidebar = mountTestSidebar();
  const watch = { id: "a".repeat(20), chat: "t", owner: "p", url: "https://mm.example/t/pl/a",
    interval: 10, rule: "QA", paused: false, push: null, until: null, schedule: "job", timezone: "UTC", status: "answer" };
  const rpc = { headerMode: () => "important", list: () => ({
    colors: { answer: null, attention: null, resolved: null }, watches: [watch],
  }) };
  const timer = vi.spyOn(window, "setInterval");
  const clearTimer = vi.spyOn(window, "clearInterval");
  const first = renderSlot(app.threadContextCardSections[0]!, { threadId: "other", projectId: "p", environment: null }, { rpc });
  let firstMounted = true;
  const second = renderSlot(slot, {}, { rpc });
  try {
    fireEvent.click(await second.findByRole("button", { name: /Ждут ответа/ }));
    expect(second.getByRole("list").children).toHaveLength(1);
    await waitFor(() => expect(first.inspection.rpcCalls.some(call => call.method === "list")).toBe(true));
    const timers = timer.mock.calls.flatMap((args, i) => args[1] === 30000 ? [timer.mock.results[i]!.value] : []);
    expect(timers).toHaveLength(1);
    first.lifecycle.unmount();
    firstMounted = false;
    expect(clearTimer).not.toHaveBeenCalledWith(timers[0]);
    watch.status = "resolved";
    await second.behavior.emitRealtime("changed", {});
    await waitFor(() => expect(second.queryByRole("button")).toBeNull());
    watch.status = "answer";
    await second.behavior.emitRealtime("changed", {});
    expect((await second.findByRole("button", { name: /Ждут ответа/ })).getAttribute("aria-expanded")).toBe("false");
  } finally {
    if (firstMounted) first.lifecycle.unmount();
    second.lifecycle.unmount();
    sidebar.dispose();
    timer.mockRestore();
    clearTimer.mockRestore();
  }
});

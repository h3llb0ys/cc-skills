import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { contract, palette, type WatchSettings } from "./contract";

import { sourceTargets, watchActions } from "./settings";

const execute = promisify(execFile);
function watchOptions(input: WatchSettings) {
  const args = ["--interval", String(input.interval), "--rule=" + input.rule];
  if (input.destination) args.push("--destination", input.destination);
  if (input.push) args.push("--push=" + input.push);
  if (input.draft) args.push("--draft");
  if (input.until !== null) args.push("--until", new Date(input.until * 1000).toISOString());
  return args;
}

export default function mattermost(bb: BbPluginApi) {
  const config = bb.settings.define({
    openTarget: { type: "select", label: "Кнопка «Открыть»", options: Object.values(sourceTargets), default: sourceTargets.web },
    subscriptionClick: { type: "select", label: "При нажатии на подписку",
      options: Object.values(watchActions), experimental_optionLabels: { [watchActions.web]: "Открыть в браузере" }, default: watchActions.thread },
    showThreadSubscriptions: { type: "boolean", label: "Показывать подписки в правой панели", default: true },
    stateDirectory: { type: "string", label: "Каталог подписок (MM_STATE_DIR)", default: "" },
  });
  let script: string | undefined;
  async function cli(args: string[], input?: { url: string; cookie: string }) {
    if (!script) {
      const plugins = await bb.sdk.plugins.list();
      const own = plugins.plugins.find(p => p.id === bb.pluginId);
      if (!own) throw new Error("Не найден каталог плагина Mattermost");
      script = join(own.rootDir, "skills/mattermost/scripts/mm.py");
    }
    const { stateDirectory } = await config.get();
    const env = { ...process.env };
    if (stateDirectory) env.MM_STATE_DIR = stateDirectory;
    try {
      const task = execute("python3", ["-B", script, ...args], { env, timeout: 70000, maxBuffer: 8 * 1024 * 1024 });
      if (input) {
        task.child.stdin?.on("error", () => { /* execFile reports child failures below. */ });
        task.child.stdin?.end(JSON.stringify(input));
      }
      const { stdout } = await task;
      return JSON.parse(stdout);
    } catch (cause) {
      const err = cause as { stderr?: string; killed?: boolean };
      if (err.killed) throw new Error("Операция Mattermost не завершилась за 70 с. Проверьте состояние подписки и повторите попытку.");
      throw new Error(err.stderr?.trim().slice(0, 300) || "Не удалось прочитать хранилище подписок Mattermost");
    }
  }
  async function targetThread(chat: string) {
    const thread = await bb.sdk.threads.get({ threadId: chat });
    if (thread.archivedAt || thread.deletedAt || thread.visibility === "hidden" || !thread.environmentId)
      throw new Error("Выбери активный тред BB с рабочим окружением");
    return ["--chat", thread.id, "--owner", thread.projectId, "--environment", thread.environmentId];
  }
  async function finishSetup(id: string, target: string[]) {
    try {
      await cli(["finish-setup", id, ...target]);
    } catch (cause) {
      throw new Error("Расписание не включено. Нажми «Включить расписание» у подписки. " + String(cause));
    } finally {
      bb.realtime.publish("changed", {});
    }
    return null;
  }
  async function colors() {
    const [answer, attention, resolved] = await Promise.all(
      (["answer", "attention", "resolved"] as const).map(key => bb.storage.kv.get<string>(key)),
    );
    return palette.parse({ answer: answer ?? null, attention: attention ?? null, resolved: resolved ?? null });
  }
  bb.agents.contributeInstructions(() => 'When relaying a Mattermost watch notification, keep its summary and permalink. For a notification headed "Уведомление Mattermost · Ждут ответа", "Стоит посмотреть" or "Решено", show the corresponding status as a standalone ::mattermost-status{status="answer"} directive, using attention or resolved for the other two. An ordinary notification needs no directive.');
  bb.rpc.register(contract, {
    board: offsets => cli(["board", ...Object.entries(offsets).flatMap(([status, offset]) =>
      offset ? ["--" + status, String(offset)] : [])]),
    readCard: async ({ id, revision }) => {
      await cli(["read-card", String(id), String(revision)]);
      bb.realtime.publish("changed", {});
      return null;
    },
    check: async ({ id }) => {
      const result = await cli(["check", id]);
      bb.realtime.publish("changed", {});
      return result;
    },
    inbox: ({ chat, before }) => cli(["inbox", "--chat", chat, ...(before ? ["--before", String(before)] : [])]),
    openSummary: async ({ chat, id }) => {
      const detail = await cli(["open-summary", String(id), "--chat", chat]);
      bb.realtime.publish("changed", {});
      return detail;
    },
    connection: () => cli(["connection", "status"]),
    saveConnection: input => cli(["connection", "save"], input),
    testConnection: input => cli(["connection", "test"], input),
    colors,
    list: async () => {
      const [watches, currentColors] = await Promise.all([cli(["watch", "list", "--platform", "bb"]), colors()]);
      return { watches, colors: currentColors };
    },
    unwatch: async ({ id }) => {
      await cli(["unwatch", id, "--platform", "bb"]);
      bb.realtime.publish("changed", {});
      return null;
    },
    finishSetup: async ({ id, chat }) => finishSetup(id, await targetThread(chat)),
    create: async input => {
      const target = await targetThread(input.chat);
      const created = await cli(["watch", input.url, "--new", "--platform", "bb", ...target,
        "--timezone", input.timezone, ...watchOptions(input)]);
      return finishSetup(created.id, target);
    },
    edit: async input => {
      const target = input.chat ? await targetThread(input.chat) : [];
      await cli(["edit", input.id, ...target, ...watchOptions(input)]);
      bb.realtime.publish("changed", {});
      return null;
    },
    color: async input => {
      if (input.color === null) await bb.storage.kv.delete(input.status);
      else await bb.storage.kv.set(input.status, input.color);
      bb.realtime.publish("colors", {});
      bb.realtime.publish("changed", {});
      return null;
    },
  });
}

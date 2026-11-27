import assert from "node:assert/strict";
import { test } from "node:test";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import plugin from "../server";
import { action, board } from "../contract";
import { type Event } from "../model";

type Board = z.infer<typeof board>;
type ThreadSendArgs = Parameters<BbPluginApi["sdk"]["threads"]["send"]>[0];
type Handler = (...args: never[]) => unknown;

async function harness(providerId = "claude") {
  const thread = { id: "thread", projectId: "project", status: "idle", providerId, archivedAt: null };
  const events: Event[] = [];
  const tries: ThreadSendArgs[] = [];
  const storage = new Map<string, unknown>();
  const listeners = new Map<string, Handler>();
  let close: () => void | Promise<void> = () => {};
  const config = { companionRoot: "/example/companion", projectIds: "", handoffDirectory: "" };
  let operations!: {
    board_action(args: { threadId: string; action: z.infer<typeof action> }): Promise<Board>;
    board_get(args: { keys: string[] }): Promise<Record<string, Board>>;
  };
  let tool!: { execute(args: object, context: object): Promise<string | { isError: boolean }> };
  const api = {
    pluginId: "companion",
    settings: { define: () => ({ get: async () => config }) },
    storage: { kv: {
      get: async (key: string) => structuredClone(storage.get(key)),
      set: async (key: string, value: unknown) => { storage.set(key, structuredClone(value)); },
      delete: async (key: string) => { storage.delete(key); },
      list: async (prefix: string) => [...storage.keys()].filter(key => key.startsWith(prefix)),
    }},
    events: { on: (event: string, listener: Handler) => { listeners.set(event, listener); } },
    rpc: { register: (_: unknown, handlers: typeof operations) => { operations = handlers; }, experimental_invalidate() {} },
    agents: { registerTool: (item: typeof tool) => { tool = item; } },
    onDispose: (hook: () => void) => { close = hook; },
    sdk: { threads: {
      get: async () => thread,
      events: { list: async (q: {types: string[]; afterSeq?: string; beforeSeq?: string; order: string; limit: string}) => {
        const matches = events.filter(e => q.types.includes(e.type) && e.seq > Number(q.afterSeq ?? 0) && e.seq < Number(q.beforeSeq ?? Infinity));
        if (q.order === "desc") matches.reverse();
        return matches.slice(0, Number(q.limit));
      }},
      send: async (arg: ThreadSendArgs) => {
        tries.push(arg);
        return { ok: true, delivery: "queued", queuedMessage: { id: "queued" } };
      },
    }},
  } as unknown as BbPluginApi;
  await plugin(api);
  function event(type: string, data: unknown, turn?: string) {
    events.push({ type, data, scope: turn ? { kind: "turn", turnId: turn } : { kind: "thread" },
      seq: events.length + 1, createdAt: Date.now() + 1 });
  }
  async function idle() {
    await (listeners.get("thread.idle") as (args: { thread: typeof thread }) => unknown)({ thread });
  }
  function jobId() {
    const input = tries.at(-1)?.input[0];
    assert.ok(input?.type === "text");
    return input.text.match(/^COMPANION_JOB ([a-f0-9-]+)/)?.[1];
  }
  return {
    close: () => close(), config, event, idle, jobId, tries,
    current: async () => (await operations.board_get({ keys: [thread.id] }))[thread.id],
    action: (input: z.infer<typeof action>) => operations.board_action({ threadId: thread.id, action: input }),
    result: (arg: object) => tool.execute({ proposals: [], appliedIds: [], phase: "finish", incomplete: false, ...arg },
      { threadId: thread.id, projectId: thread.projectId }),
  };
}

test("a long turn keeps its early correction; child and service completions do not launch another scan", async () => {
  const h = await harness();
  try {
    h.event("client/turn/requested", { requestId: "r", initiator: "user",
      input: [{ type: "text", text: "Запомни важное новое правило" }] });
    h.event("turn/input/accepted", { clientRequestId: "r" }, "primary");
    for (let i = 0; i < 451; i++) h.event("item/completed", { item: { type: "reasoning" } }, "primary");
    h.event("turn/started", { parentToolCallId: "nested" }, "child");
    h.event("turn/completed", { status: "completed" }, "child");
    await h.idle();
    assert.equal(h.tries.length, 0);
    h.event("turn/completed", { status: "completed" }, "primary");
    await h.idle();
    assert.equal(h.tries.length, 1);
    const id = h.jobId();
    assert.ok(id);
    await h.result({ jobId: id, proposals: [{ title: "Проверять контракт", description: "Первичный источник", destination: "rules" }] });
    h.event("client/turn/requested", { requestId: "svc", initiator: "agent", originPluginId: "companion", input: h.tries[0].input });
    h.event("turn/input/accepted", { clientRequestId: "svc" }, "scan");
    h.event("turn/started", { parentToolCallId: "nested" }, "other-child");
    h.event("turn/completed", { status: "completed" }, "other-child");
    h.event("turn/completed", { status: "completed" }, "scan");
    await h.idle();
    assert.equal(h.tries.length, 1);
    assert.equal((await h.current()).proposals.length, 1);
  } finally { await h.close(); }
});

test("a queued Apply cannot write once the configured Companion path has changed", async () => {
  const h = await harness();
  try {
    const { proposals: [one] } = await h.action({ kind: "add", text: "Проверка пути" });
    await h.action({ kind: "apply", ids: [one.id] });
    h.config.companionRoot = "/example/other-companion";
    const denied = await h.result({ jobId: h.jobId(), phase: "begin" });
    assert.equal(typeof denied !== "string" && denied.isError, true);
    assert.deepEqual((await h.current()).proposals, [one]);
  } finally { await h.close(); }
});

test("Apply retains pending proposals until a current job returns verified applied IDs", async () => {
  const h = await harness();
  try {
    const { proposals: [one, two] } = await h.action({ kind: "add", text: "Первый пункт" })
      .then(() => h.action({ kind: "add", text: "Второй пункт" }));
    await h.action({ kind: "defer", ids: [one.id] });
    assert.deepEqual((await h.current()).selected, [one.id]);
    const board = await h.action({ kind: "apply", ids: [one.id] });
    assert.deepEqual(board.applying, [one.id]);
    const id = h.jobId();
    const stale = await h.result({ jobId: id, appliedIds: [one.id], phase: "finish" });
    assert.equal(typeof stale !== "string" && stale.isError, true);
    const started = await h.result({ jobId: id, phase: "begin" });
    assert.deepEqual(JSON.parse(started as string), [one]);
    await h.result({ jobId: id, appliedIds: [one.id, two.id] });
    assert.deepEqual((await h.current()).proposals, [two]);
    assert.deepEqual((await h.action({ kind: "clear" })).proposals, []);
  } finally { await h.close(); }
});

test("Codex without a confirmed handoff keeps native Stop as the only automatic path", async () => {
  const h = await harness("codex");
  try {
    h.event("client/turn/requested", { requestId: "r", initiator: "user",
      input: [{ type: "text", text: "Запомни важное новое правило" }] });
    h.event("turn/input/accepted", { clientRequestId: "r" }, "one");
    h.event("turn/completed", { status: "completed", providerCheckpointId: "raw-turn" }, "one");
    await h.idle();
    assert.equal(h.tries.length, 0);
  } finally { await h.close(); }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectEvents, type Event } from "../model";

const thread = { kind: "thread" } as const;
const turn = { kind: "turn", turnId: "one" } as const;
const jobId = "11000000-0000-4000-8000-000000000001";

function event(type: string, data: unknown, scope: Event["scope"] = thread): Event {
  return { type, data, scope, seq: 1, createdAt: 1 };
}
function request(id: string, text: string) {
  return event("client/turn/requested", { requestId: id, initiator: "user", input: [{ type: "text", text }] });
}
function accepted(id: string) {
  return event("turn/input/accepted", { clientRequestId: id }, turn);
}
const complete = event("turn/completed", { status: "completed", providerCheckpointId: "raw-turn" }, turn);
const inspect = (events: Event[], turns = 0) => inspectEvents(events, "companion", turns, false);

test("counts only accepted substantive user input and preserves a request across reads", () => {
  const p = inspect([request("r", "Запомни это правило для будущих проверок"), request("dropped", "Очень длинный дубликат")]);
  assert.equal(p.turns, 0);
  const found = inspectEvents([accepted("r"), accepted("r"), complete], "companion", p.turns, false, p.requests);
  assert.equal(found.turns, 1);
  assert.deepEqual(found.reasons, ["коррекция или просьба запомнить"]);
  assert.equal(found.lastTurn, "raw-turn");
});

test("short confirmation stays quiet; the fifth real input fires the periodic trigger", () => {
  assert.deepEqual(inspect([request("r", "да"), accepted("r"), complete], 4).reasons, []);
  assert.deepEqual(
    inspect([request("r", "Как связаны эти четыре параметра?"), accepted("r"), complete], 4).reasons,
    ["плановая проверка после пяти сообщений"],
  );
});

test("service job completion carries its own ID and does not trigger another scan", () => {
  const service = event("client/turn/requested", {
    requestId: "r", originPluginId: "companion", initiator: "agent",
    input: [{ type: "text", visibility: "agent-only", text: `COMPANION_JOB ${jobId}\nпроверь правила` }],
  });
  const result = inspect([
    service, accepted("r"),
    event("item/completed", { item: { type: "fileChange", changes: [{ path: "src/tool.py" }] } }, turn),
    complete,
  ]);
  assert.deepEqual(result.finishedJobs, [jobId]);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.completed, false);
});

test("tool successes and compaction are visible without reading tool output", () => {
  const found = inspect([
    event("thread/compacted", {}),
    event("item/completed", { item: { type: "toolCall", tool: "grafana_query", status: "completed" } }, turn),
    event("item/completed", { item: { type: "fileChange", changes: [{ path: ".knowledge/topics/p.md" }] } }, turn),
    event("item/completed", { item: { type: "commandExecution", command: "git commit", exitCode: 1 } }, turn),
    complete,
  ]);
  assert.deepEqual(found.reasons, ["ревью или внешний источник", "работа после свёртки контекста"]);
});

test("correlates the native Stop by provider checkpoint ID, not the BB turn ID", () => {
  const stopped = event("provider/unhandled", {
    rawType: "hook/completed",
    rawEvent: { params: { turnId: "raw-turn", run: {
      eventName: "stop", status: "blocked", entries: [{ text: "Companion insight/memory sync" }],
    } } },
  });
  const found = inspect([stopped, complete]);
  assert.equal(found.lastTurn, "raw-turn");
  assert.deepEqual(found.nativeStop, ["raw-turn"]);
});

import { describe, expect, it } from "vitest";

import { runCli, USAGE } from "./cli";
import { newCycle, type Cycle } from "./model";
import type { CycleStore } from "./store";

const NOW = "2026-11-16T00:00:00.000Z";
const THREAD = "thr_a";

function memoryStore(initial: Record<string, Cycle> = {}) {
  const cycles = new Map(Object.entries(initial));
  const store: CycleStore = {
    read: async (threadId) => cycles.get(threadId) ?? null,
    readMany: async (threadIds) => Object.fromEntries(threadIds.map((id) => [id, cycles.get(id) ?? null])),
    write: async (threadId, cycle) => {
      expect(JSON.parse(JSON.stringify(cycle))).toStrictEqual(cycle);
      cycles.set(threadId, cycle);
    },
    clear: async (threadId) => void cycles.delete(threadId),
  };

  return { store, cycles };
}

const run = (store: CycleStore, ...argv: string[]) => runCli(store, argv, THREAD, () => NOW);

describe("runCli", () => {
  it("prints usage without a command", async () => {
    const { store } = memoryStore();

    expect(await run(store)).toEqual({ exitCode: 0, stdout: USAGE });
  });

  it("fails without a thread", async () => {
    const { store } = memoryStore();
    const got = await runCli(store, ["show"], undefined, () => NOW);

    expect(got.exitCode).toBe(1);
    expect(got.stderr).toContain("no thread");
  });

  it("writes to the thread given by --thread", async () => {
    const { store, cycles } = memoryStore();
    await run(store, "stage", "0", "running", "--thread", "thr_b");

    expect([...cycles.keys()]).toEqual(["thr_b"]);
  });

  it("starts a cycle on the first stage update", async () => {
    const { store, cycles } = memoryStore();
    const got = await run(store, "stage", "0", "running", "--note", "  writing  ");

    expect(got).toEqual({ exitCode: 0, stdout: "MR cycle · iteration 1 · 0/10 · stage 0 running" });
    expect(cycles.get(THREAD)?.stages[0]).toEqual({ status: "running", note: "writing", runs: 1, substeps: [] });
  });

  it("starts a cycle for another MR at iteration 1 and replaces the old one", async () => {
    const { store, cycles } = memoryStore();
    await run(store, "start", "--title", "feature/a");
    await run(store, "stage", "0", "done", "--note", "old");
    await run(store, "check", "lint", "fail");
    const got = await run(store, "start", "--title", " feature/b ");

    expect(got.stdout).toBe("MR cycle · feature/b · iteration 1 · 0/10 · stage 0 pending");
    expect(cycles.get(THREAD)).toMatchObject({ iteration: 1, title: "feature/b", checks: {} });
    expect(cycles.get(THREAD)?.stages[0]).toStrictEqual({ status: "pending", runs: 0, substeps: [] });
  });

  it("counts a rerun of the same MR as the next iteration", async () => {
    const { store, cycles } = memoryStore();
    await run(store, "start", "--title", "feature/a");
    await run(store, "start", "--title", "feature/a");

    expect(cycles.get(THREAD)?.iteration).toBe(2);
  });

  it("starts the next iteration", async () => {
    const { store, cycles } = memoryStore({ [THREAD]: newCycle(null, NOW) });
    await run(store, "start");

    expect(cycles.get(THREAD)?.iteration).toBe(2);
  });

  it("records substeps and checks", async () => {
    const { store, cycles } = memoryStore();
    await run(store, "sub", "7", "mutation", "done");
    await run(store, "check", "unit", "fail");

    expect(cycles.get(THREAD)?.stages[7].substeps).toEqual(["mutation"]);
    expect(cycles.get(THREAD)?.checks).toEqual({ unit: "fail" });
  });

  it("prints JSON for --json", async () => {
    const { store } = memoryStore();
    const got = await run(store, "check", "lint", "ok", "--json");

    expect(JSON.parse(got.stdout ?? "").checks).toEqual({ lint: "ok" });
  });

  it("shows reruns in the text", async () => {
    const { store } = memoryStore();
    await run(store, "stage", "7", "running");
    await run(store, "stage", "8", "running");
    await run(store, "stage", "7", "running");

    expect((await run(store, "show")).stdout).toContain("[>] 7 Пирамида тестов — reruns 1 · bottom=pending top=pending mutation=pending");
    expect((await run(store, "show")).stdout).toContain("[ ] 8 Комментарии\n");
  });

  it("shows the cycle as text", async () => {
    const { store } = memoryStore();
    await run(store, "stage", "0", "done", "--note", "gen clean");
    await run(store, "stage", "7", "running");
    await run(store, "sub", "7", "bottom", "done");
    await run(store, "check", "build", "ok");
    const got = await run(store, "show");

    expect(got.stdout).toContain("[x] 0 Код и юнит-тесты — gen clean");
    expect(got.stdout).toContain("[>] 7 Пирамида тестов — bottom=done top=pending mutation=pending");
    expect(got.stdout).toContain("checks: build ok");
    expect(got.stdout).toContain("[ ] 8 Комментарии\n");
  });

  it("shows nothing for a thread without a cycle", async () => {
    const { store } = memoryStore();

    expect(await run(store, "show")).toEqual({ exitCode: 0, stdout: "No MR cycle in this thread." });
    expect(await run(store, "show", "--json")).toEqual({ exitCode: 0, stdout: "null" });
  });

  it("clears the cycle", async () => {
    const { store, cycles } = memoryStore({ [THREAD]: newCycle(null, NOW) });
    await run(store, "clear");

    expect(cycles.size).toBe(0);
  });

  it.each([
    [["stage", "10", "done"], "stage must be 0–9"],
    [["stage", "1.5", "done"], "stage must be 0–9"],
    [["stage", "1", "pending"], "running, done or skipped"],
    [["stage", "1", "done", "--note", "x".repeat(121)], "longer than 120"],
    [["stage", "1", "done", "--note"], "--note needs a value"],
    [["sub", "5", "bottom", "done"], "stage 5 substeps: none"],
    [["sub", "7", "middle", "done"], "bottom, top, mutation"],
    [["sub", "7", "top", "yes"], "done or pending"],
    [["check", "Build", "ok"], "check name"],
    [["check", "build", "green"], "ok or fail"],
    [["deploy"], "unknown command deploy"],
    [["start", "--title", "x".repeat(81)], "longer than 80"],
  ])("rejects %j", async (argv, message) => {
    const { store, cycles } = memoryStore();
    const got = await run(store, ...argv);

    expect(got.exitCode).toBe(1);
    expect(got.stderr).toContain(message);
    expect(cycles.size).toBe(0);
  });

  it("caps the number of checks but lets existing ones update", async () => {
    const { store, cycles } = memoryStore();
    for (let i = 0; i < 12; i++) await run(store, "check", `c${i}`, "ok");

    expect((await run(store, "check", "c12", "ok")).stderr).toContain("at most 12 checks");
    expect((await run(store, "check", "c0", "fail")).exitCode).toBe(0);
    expect(cycles.get(THREAD)?.checks.c0).toBe("fail");
  });
});

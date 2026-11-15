import { describe, expect, it } from "vitest";

import { cycleSchema, newCycle, progress, setCheck, setStage, setSubstep, type Cycle } from "./model";

const NOW = "2026-11-16T00:00:00.000Z";
const LATER = "2026-11-16T00:05:00.000Z";

const statuses = (cycle: Cycle) => cycle.stages.map((stage) => stage.status);

function through(index: number): Cycle {
  let cycle = newCycle(null, NOW);
  for (let i = 0; i < index; i++) cycle = setStage(setStage(cycle, i, "running", undefined, NOW), i, "done", undefined, NOW);

  return setStage(cycle, index, "running", undefined, NOW);
}

describe("newCycle", () => {
  it("starts at iteration 1 with every stage pending", () => {
    const cycle = newCycle(null, NOW);

    expect(cycle.iteration).toBe(1);
    expect(new Set(statuses(cycle))).toEqual(new Set(["pending"]));
    expect(cycle.checks).toEqual({});
    expect(cycleSchema.parse(cycle)).toEqual(cycle);
  });

  it("increments the iteration and resets a finished cycle", () => {
    const previous = setCheck({ ...through(9), dismissed: true }, "build", "ok", NOW);
    const cycle = newCycle(previous, LATER);

    expect(cycle.iteration).toBe(2);
    expect(cycle.dismissed).toBe(false);
    expect(cycle.checks).toEqual({});
    expect(new Set(statuses(cycle))).toEqual(new Set(["pending"]));
  });
});

describe("setStage", () => {
  it("closes an earlier running stage when the next one starts", () => {
    const cycle = setStage(setStage(newCycle(null, NOW), 0, "running", undefined, NOW), 1, "running", undefined, LATER);

    expect(statuses(cycle).slice(0, 3)).toEqual(["done", "running", "pending"]);
    expect(cycle.updatedAt).toBe(LATER);
  });

  it("leaves earlier pending stages pending", () => {
    const cycle = setStage(newCycle(null, NOW), 3, "running", undefined, NOW);

    expect(statuses(cycle).slice(0, 4)).toEqual(["pending", "pending", "pending", "running"]);
  });

  it("counts runs and does not count a repeated running call", () => {
    const cycle = setStage(setStage(newCycle(null, NOW), 0, "running", undefined, NOW), 0, "running", undefined, NOW);

    expect(cycle.stages[0].runs).toBe(1);
  });

  it("reopens a closed stage, counts the rerun and resets later stages", () => {
    let cycle = setSubstep(through(7), 7, "bottom", true, NOW);
    cycle = setStage(cycle, 7, "done", "all caught", NOW);
    cycle = setStage(cycle, 8, "running", "trimming", NOW);
    cycle = setStage(cycle, 7, "running", undefined, LATER);

    expect(statuses(cycle).slice(6)).toEqual(["done", "running", "pending", "pending"]);
    expect(cycle.stages[7]).toStrictEqual({ status: "running", runs: 2, substeps: [] });
    expect(cycle.stages[8]).toEqual({ status: "pending", runs: 1, substeps: [] });
  });

  it("keeps a later stage's run count when resetting it", () => {
    let cycle = setStage(through(8), 7, "running", undefined, NOW);
    cycle = setStage(setStage(cycle, 8, "running", undefined, NOW), 7, "running", undefined, NOW);

    expect(cycle.stages[8]).toEqual({ status: "pending", runs: 2, substeps: [] });
    expect(cycle.stages[7].runs).toBe(3);
  });

  it("clears the note when a stage starts again without a new one", () => {
    let cycle = setStage(through(1), 1, "done", "4 fixed", NOW);
    cycle = setStage(cycle, 1, "running", undefined, NOW);

    expect(cycle.stages[1]).not.toHaveProperty("note");
  });

  it("keeps the note when closing without a new one", () => {
    const cycle = setStage(setStage(newCycle(null, NOW), 1, "running", "4 found", NOW), 1, "done", undefined, NOW);

    expect(cycle.stages[1].note).toBe("4 found");
  });

  it("replaces the note when one is given", () => {
    const cycle = setStage(setStage(newCycle(null, NOW), 1, "running", "4 found", NOW), 1, "done", "4 fixed", NOW);

    expect(cycle.stages[1].note).toBe("4 fixed");
  });

  it("does not touch other stages when closing one", () => {
    const cycle = setStage(through(3), 5, "skipped", undefined, NOW);

    expect(statuses(cycle).slice(2, 6)).toEqual(["done", "running", "pending", "skipped"]);
  });

  it("brings a dismissed cycle back", () => {
    const cycle = setStage({ ...through(2), dismissed: true }, 2, "done", undefined, NOW);

    expect(cycle.dismissed).toBe(false);
  });
});

describe("setSubstep", () => {
  it("marks and unmarks a substep without duplicates", () => {
    let cycle = setSubstep(through(7), 7, "top", true, NOW);
    cycle = setSubstep(cycle, 7, "top", true, NOW);

    expect(cycle.stages[7].substeps).toEqual(["top"]);
    expect(setSubstep(cycle, 7, "top", false, NOW).stages[7].substeps).toEqual([]);
  });
});

describe("setCheck", () => {
  it("overwrites an existing check", () => {
    const cycle = setCheck(setCheck(newCycle(null, NOW), "lint", "fail", NOW), "lint", "ok", NOW);

    expect(cycle.checks).toEqual({ lint: "ok" });
  });
});

describe("progress", () => {
  it("points at the running stage", () => {
    expect(progress(through(5))).toEqual({ done: 5, total: 10, current: 5, complete: false });
  });

  it("points at the first pending stage when nothing runs", () => {
    const cycle = setStage(newCycle(null, NOW), 0, "done", undefined, NOW);

    expect(progress(cycle)).toEqual({ done: 1, total: 10, current: 1, complete: false });
  });

  it("counts skipped stages as closed", () => {
    let cycle = newCycle(null, NOW);
    for (let i = 0; i < 10; i++) cycle = setStage(cycle, i, i === 4 ? "skipped" : "done", undefined, NOW);

    expect(progress(cycle)).toEqual({ done: 10, total: 10, current: null, complete: true });
  });
});

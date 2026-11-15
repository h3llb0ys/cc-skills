import { z } from "zod";

export const STAGES = [
  "Код и юнит-тесты",
  "Ревью",
  "Упрощение",
  "Стиль и архитектура",
  "Интеграционные кейсы",
  "Повторное ревью",
  "Внешний ревьюер",
  "Пирамида тестов",
  "Комментарии",
  "Итоговый отчёт",
] as const;

export const SUBSTEPS: Readonly<Record<number, readonly { key: string; label: string }[]>> = {
  7: [
    { key: "bottom", label: "снизу" },
    { key: "top", label: "сверху" },
    { key: "mutation", label: "мутация" },
  ],
};

export const NOTE_MAX = 120;
export const CHECKS_MAX = 12;
export const CHECK_NAME = /^[a-z][a-z0-9-]{0,23}$/;

export const stageStatusSchema = z.enum(["pending", "running", "done", "skipped"]);
export const checkStatusSchema = z.enum(["ok", "fail"]);

const stageSchema = z.object({
  status: stageStatusSchema,
  note: z.string().max(NOTE_MAX).optional(),
  /** Times the stage entered running; above 1 means the cycle came back to it. */
  runs: z.number().int().min(0),
  substeps: z.array(z.string()),
});

export const cycleSchema = z.object({
  iteration: z.number().int().min(1),
  updatedAt: z.string(),
  stages: z.array(stageSchema).length(STAGES.length),
  checks: z.record(z.string(), checkStatusSchema),
  dismissed: z.boolean(),
});

export type StageStatus = z.infer<typeof stageStatusSchema>;
export type CheckStatus = z.infer<typeof checkStatusSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type Cycle = z.infer<typeof cycleSchema>;

const pendingStage = (): Stage => ({ status: "pending", runs: 0, substeps: [] });
const isClosed = (status: StageStatus) => status === "done" || status === "skipped";

export function newCycle(previous: Cycle | null, now: string): Cycle {
  return {
    iteration: (previous?.iteration ?? 0) + 1,
    updatedAt: now,
    stages: STAGES.map(pendingStage),
    checks: {},
    dismissed: false,
  };
}

// Starting a stage closes an earlier running one and reopens every later one:
// the skill reruns stage 7 when stage 8 changed production code.
export function setStage(
  cycle: Cycle,
  index: number,
  status: StageStatus,
  note: string | undefined,
  now: string,
): Cycle {
  const stages = cycle.stages.map((stage, i): Stage => {
    if (i === index) {
      const started = status === "running" && stage.status !== "running";
      const kept = note ?? (started ? undefined : stage.note);

      return {
        status,
        ...(kept === undefined ? {} : { note: kept }),
        runs: stage.runs + (started ? 1 : 0),
        substeps: started ? [] : stage.substeps,
      };
    }
    if (status !== "running") return stage;
    if (i < index && stage.status === "running") return { ...stage, status: "done" };
    if (i > index && stage.status !== "pending") return { ...pendingStage(), runs: stage.runs };

    return stage;
  });

  return { ...cycle, stages, dismissed: false, updatedAt: now };
}

export function setSubstep(
  cycle: Cycle,
  index: number,
  key: string,
  done: boolean,
  now: string,
): Cycle {
  const stages = cycle.stages.map((stage, i) => {
    if (i !== index) return stage;
    const substeps = stage.substeps.filter((existing) => existing !== key);

    return { ...stage, substeps: done ? [...substeps, key] : substeps };
  });

  return { ...cycle, stages, updatedAt: now };
}

export function setCheck(cycle: Cycle, name: string, status: CheckStatus, now: string): Cycle {
  return { ...cycle, checks: { ...cycle.checks, [name]: status }, updatedAt: now };
}

export interface Progress {
  done: number;
  total: number;
  /** The running stage, else the first pending one; null once every stage is closed. */
  current: number | null;
  complete: boolean;
}

export function progress(cycle: Cycle): Progress {
  const done = cycle.stages.filter((stage) => isClosed(stage.status)).length;
  const running = cycle.stages.findIndex((stage) => stage.status === "running");
  const pending = cycle.stages.findIndex((stage) => stage.status === "pending");
  const current = running >= 0 ? running : pending >= 0 ? pending : null;

  return { done, total: cycle.stages.length, current, complete: done === cycle.stages.length };
}

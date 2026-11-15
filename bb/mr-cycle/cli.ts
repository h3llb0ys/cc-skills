import type { PluginCliResult } from "@get-bb/plugin-sdk";

import {
  CHECK_NAME,
  CHECKS_MAX,
  NOTE_MAX,
  STAGES,
  SUBSTEPS,
  checkStatusSchema,
  newCycle,
  progress,
  setCheck,
  setStage,
  setSubstep,
  stageStatusSchema,
  type Cycle,
} from "./model";
import type { CycleStore } from "./store";

export const USAGE = [
  "Usage (inside a bb thread, or with --thread <id>):",
  "  bb mr-cycle start                                         begin a new iteration, every stage pending",
  "  bb mr-cycle stage <0-9> <running|done|skipped> [--note <text>]",
  "  bb mr-cycle sub <stage> <key> <done|pending>              stage 7 keys: bottom, top, mutation",
  "  bb mr-cycle check <name> <ok|fail>                        e.g. build, vet, lint, unit, integration",
  "  bb mr-cycle show [--json]",
  "  bb mr-cycle clear                                         remove the cycle from the thread",
].join("\n");

export const COMMANDS = [
  { name: "start", summary: "Begin a new MR cycle iteration", usage: "bb mr-cycle start" },
  { name: "stage", summary: "Set a stage's status", usage: "bb mr-cycle stage <0-9> <running|done|skipped> [--note <text>]" },
  { name: "sub", summary: "Mark a stage substep", usage: "bb mr-cycle sub <stage> <key> <done|pending>" },
  { name: "check", summary: "Record a check result", usage: "bb mr-cycle check <name> <ok|fail>" },
  { name: "show", summary: "Print the thread's MR cycle", usage: "bb mr-cycle show [--json]" },
  { name: "clear", summary: "Remove the thread's MR cycle", usage: "bb mr-cycle clear" },
];

interface Parsed {
  positional: string[];
  json: boolean;
  thread?: string;
  note?: string;
}

class UsageError extends Error {}

const STATUS_MARK = { pending: " ", running: ">", done: "x", skipped: "-" } as const;

function parseArgs(argv: readonly string[]): Parsed {
  const parsed: Parsed = { positional: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--thread" || arg === "--note") {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      parsed[arg === "--thread" ? "thread" : "note"] = value;
      continue;
    }
    parsed.positional.push(arg);
  }

  return parsed;
}

function stageIndex(raw: string | undefined): number {
  const index = Number(raw);
  if (raw === undefined || !Number.isInteger(index) || index < 0 || index >= STAGES.length) {
    throw new UsageError(`stage must be 0–${STAGES.length - 1}, got ${raw ?? "nothing"}`);
  }

  return index;
}

function note(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (trimmed !== undefined && trimmed.length > NOTE_MAX) throw new UsageError(`--note is longer than ${NOTE_MAX} characters`);

  return trimmed === "" ? undefined : trimmed;
}

export function summary(cycle: Cycle): string {
  const { done, total, current, complete } = progress(cycle);
  const where = complete || current === null ? "complete" : `stage ${current} ${cycle.stages[current].status}`;

  return `MR cycle · iteration ${cycle.iteration} · ${done}/${total} · ${where}`;
}

function describe(cycle: Cycle): string {
  const lines = cycle.stages.map((stage, i) => {
    const substeps = stage.status === "pending" ? [] : (SUBSTEPS[i] ?? []);
    const subs = substeps.map(({ key }) => `${key}=${stage.substeps.includes(key) ? "done" : "pending"}`);
    const extra = [stage.note, stage.runs > 1 ? `reruns ${stage.runs - 1}` : "", subs.join(" ")].filter(Boolean).join(" · ");

    return `[${STATUS_MARK[stage.status]}] ${i} ${STAGES[i]}${extra === "" ? "" : ` — ${extra}`}`;
  });
  const checks = Object.entries(cycle.checks).map(([name, status]) => `${name} ${status}`);

  return [summary(cycle), ...lines, `checks: ${checks.length === 0 ? "none" : checks.join(", ")}`].join("\n");
}

function apply(
  cycle: Cycle | null,
  command: string,
  args: readonly string[],
  rawNote: string | undefined,
  now: string,
): Cycle {
  const base = cycle ?? newCycle(null, now);
  switch (command) {
    case "start":
      return newCycle(cycle, now);
    case "stage": {
      const status = stageStatusSchema.exclude(["pending"]).safeParse(args[1]);
      if (!status.success) throw new UsageError("stage status must be running, done or skipped");

      return setStage(base, stageIndex(args[0]), status.data, note(rawNote), now);
    }
    case "sub": {
      const index = stageIndex(args[0]);
      const keys = (SUBSTEPS[index] ?? []).map(({ key }) => key);
      if (!keys.includes(args[1] ?? "")) throw new UsageError(`stage ${index} substeps: ${keys.join(", ") || "none"}`);
      if (args[2] !== "done" && args[2] !== "pending") throw new UsageError("substep status must be done or pending");

      return setSubstep(base, index, args[1], args[2] === "done", now);
    }
    case "check": {
      const [name, raw] = args;
      if (name === undefined || !CHECK_NAME.test(name)) throw new UsageError("check name: lowercase letters, digits and dashes");
      const status = checkStatusSchema.safeParse(raw);
      if (!status.success) throw new UsageError("check status must be ok or fail");
      if (!(name in base.checks) && Object.keys(base.checks).length >= CHECKS_MAX) {
        throw new UsageError(`at most ${CHECKS_MAX} checks`);
      }

      return setCheck(base, name, status.data, now);
    }
  }
  throw new UsageError(`unknown command ${command}`);
}

export async function runCli(
  store: CycleStore,
  argv: readonly string[],
  contextThreadId: string | undefined,
  now: () => string,
): Promise<PluginCliResult> {
  try {
    const parsed = parseArgs(argv);
    const [command, ...args] = parsed.positional;
    if (command === undefined || command === "help") return { exitCode: 0, stdout: USAGE };
    const threadId = parsed.thread ?? contextThreadId;
    if (threadId === undefined) throw new UsageError("no thread: run inside a bb thread or pass --thread <id>");

    const cycle = await store.read(threadId);
    if (command === "show") {
      if (parsed.json) return { exitCode: 0, stdout: JSON.stringify(cycle) };

      return { exitCode: 0, stdout: cycle === null ? "No MR cycle in this thread." : describe(cycle) };
    }
    if (command === "clear") {
      await store.clear(threadId);

      return { exitCode: 0, stdout: "MR cycle cleared." };
    }
    const next = apply(cycle, command, args, parsed.note, now());
    await store.write(threadId, next);

    return { exitCode: 0, stdout: parsed.json ? JSON.stringify(next) : summary(next) };
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;

    return { exitCode: 1, stderr: `${error.message}\n\n${USAGE}` };
  }
}

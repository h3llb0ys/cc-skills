import { z } from "zod";

export const MAX_PROPOSALS = 8;
export const EVOLUTION_INTERVAL = 14 * 86400_000;
const PERIODIC_MESSAGES = 5;

export const proposalInput = z.object({
  title: z.string().trim().min(1).max(120),
  destination: z.enum(["rules", "knowledge", "task", "undecided"]),
  description: z.string().trim().min(1).max(1200),
});
export const proposal = proposalInput.extend({ id: z.string().uuid() });
export type Proposal = z.infer<typeof proposal>;
export type ProposalInput = z.infer<typeof proposalInput>;

const promptSignal = /(?:^|[^\p{L}\p{N}_])(?:запомн|урок|инсайт|самоулучш|самокоррекц|замечани|неверн|неправильн|ошиб|remember|insight|reviewer feedback|incorrect|wrong)|(?:не\s+(?:делай|надо|забывай)|ты\s+уверен|почему\s+ты|зачем\s+ты|are you sure)/iu;
const memoryPath = /(?:^|\/)(?:Work\/|\.knowledge\/|rules\/|\.claude\/skills\/|(?:AGENTS|CLAUDE|LEAN-CTX)\.md$)/;
const ignoredPath = /(?:^|\/)(?:\.git|\.secrets|output|tmp)\//;

export const eventTypes = [
  "client/turn/requested", "turn/started", "turn/input/accepted", "turn/completed",
  "item/completed", "thread/compacted", "provider/unhandled",
] as const;

export interface Event {
  seq: number;
  createdAt: number;
  type: string;
  scope?: { kind: "thread" } | { kind: "turn"; turnId: string };
  data: unknown;
}

type Input = { type?: string; text?: string; visibility?: string };
type EventData = {
  requestId?: string;
  clientRequestId?: string;
  initiator?: string;
  originPluginId?: string;
  input?: Input[];
  status?: string;
  providerCheckpointId?: string;
  parentToolCallId?: string;
  item?: {
    type?: string; status?: string; exitCode?: number;
    command?: string; tool?: string; server?: string;
    changes?: { path?: string }[];
  };
  rawType?: string;
  rawEvent?: { params?: { turnId?: string; run?: { eventName?: string; status?: string; entries?: { text?: string }[] } } };
};

export type Request = { id: string; jobId?: string; meaningful?: boolean; correction?: boolean };

export interface Signals {
  turns: number;
  reasons: string[];
  resumePending: boolean;
  completed: boolean;
  finishedJobs: string[];
  nativeStop: string[];
  lastTurn?: string;
  requests: Request[];
}

export function inspectEvents(
  events: readonly Event[], pluginId: string, previousTurns: number, resumePending: boolean,
  priorRequests: Request[] = [],
): Signals {
  const requests = new Map(priorRequests.map(req => [req.id, req]));
  const serviceTurns = new Map<string, string>();
  const children = new Set<string>();
  const finishedJobs: string[] = [], nativeStop: string[] = [];
  const reasons = new Set<string>();
  let turns = previousTurns, completed = false, lastTurn: string | undefined;
  for (const event of events) {
    const data = event.data as EventData;
    const turnId = event.scope?.kind === "turn" ? event.scope.turnId : "";
    if (event.type === "turn/started" && data.parentToolCallId && turnId) children.add(turnId);
    if (event.type === "client/turn/requested" && data.requestId) {
      const input = data.input ?? [];
      const jobId = input.find(b => b.type === "text" && b.visibility === "agent-only")
        ?.text?.match(/^COMPANION_JOB ([a-f0-9-]{36})\n/i)?.[1];
      const text = data.initiator === "user"
        ? input.filter(b => b.type === "text" && b.visibility !== "agent-only").map(b => b.text).join(" ").trim() : "";
      requests.set(data.requestId, {
        id: data.requestId,
        jobId: data.originPluginId === pluginId || data.initiator !== "user" ? jobId : undefined,
        meaningful: text.length >= 24 || Boolean(text && text.split(/\s+/).length >= 4),
        correction: promptSignal.test(text),
      });
    }
    if (event.type === "turn/input/accepted" && data.clientRequestId) {
      const id = data.clientRequestId;
      const req = requests.get(id);
      requests.delete(id);
      if (req?.jobId && turnId) serviceTurns.set(turnId, req.jobId);
      else if (req) {
        if (req.correction || req.meaningful) turns++;
        if (req.correction) reasons.add("коррекция или просьба запомнить");
      }
    }
    if (event.type === "thread/compacted") {
      resumePending = true;
      continue;
    }
    const jobId = serviceTurns.get(turnId);
    if (event.type === "turn/completed" && !children.has(turnId)) {
      if (jobId) finishedJobs.push(jobId);
      else if (data.status === "completed") {
        completed = true;
        lastTurn = data.providerCheckpointId ?? turnId;
      }
    }
    if (event.type === "provider/unhandled" && data.rawType === "hook/completed") {
      const { run, turnId: providerTurnId } = data.rawEvent?.params ?? {};
      if (run?.eventName === "stop" && run.status === "blocked" &&
          providerTurnId && run.entries?.some(e => e.text?.includes("Companion insight/memory sync"))) nativeStop.push(providerTurnId);
    }
    const tool = event.type === "item/completed" && !jobId && (!children.has(turnId) || !serviceTurns.size) ? data.item : undefined;
    if (!tool || ["failed", "declined", "interrupted", "cancelled"].includes(tool.status ?? "") ||
        (typeof tool.exitCode === "number" && tool.exitCode !== 0)) continue;
    if (tool.type === "fileChange" && tool.changes?.some(c => c.path && !memoryPath.test(c.path) && !ignoredPath.test(c.path))) {
      reasons.add("существенные правки");
    }
    if (tool.type === "commandExecution" && /(?:\bgit\s+commit\b|companion_git\.py.+\bcommit\b)/.test(tool.command ?? "")) {
      reasons.add("коммит");
    }
    if (tool.type === "mcpToolCall" || tool.type === "toolCall") {
      const name = [tool.server, tool.tool].join(" ");
      if (/grafana|krisp|review/i.test(name)) reasons.add("ревью или внешний источник");
    }
  }
  if (completed && resumePending) reasons.add("работа после свёртки контекста");
  if (turns >= PERIODIC_MESSAGES) reasons.add("плановая проверка после пяти сообщений");
  return { turns, reasons: [...reasons], resumePending, completed, finishedJobs, nativeStop,
    lastTurn, requests: [...requests.values()].slice(-80) };
}

export function proposalKey(p: ProposalInput): string {
  return p.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const labels = { answer: "Ждут ответа", attention: "Стоит посмотреть", resolved: "Решено" } as const;
export type Signal = keyof typeof labels;
export const defaults = { answer: "#ef4444", attention: "#f97316", resolved: "#22c55e" };
const signal = z.enum(["answer", "attention", "resolved"]);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const id = z.string().regex(/^[a-f0-9]{20}$/);
const url = z.url({ protocol: /^https$/ }).refine(value => {
  return URL.canParse(value) && !new URL(value).username && !new URL(value).password;
}, "Нужна ссылка HTTPS на Mattermost");
const settings = z.object({
  interval: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  rule: z.string().trim().min(1), push: z.string().nullable(), draft: z.boolean().default(false),
  destination: z.enum(["chat", "shared"]).optional(),
  until: z.number().int().nullable(),
});
export const watch = settings.extend({
  rule: z.string(), // Existing records with an empty rule can still be opened and edited.
  id, url, chat: z.string(), owner: z.string(), title: z.string().optional(),
  kind: z.enum(["thread", "channel"]).default("thread"), channel: z.string().nullable().optional(),
  status: z.union([signal, z.literal("normal")]).default("normal"),
  last_checked_at: z.number().int().nonnegative().optional(),
  schedule: z.string().nullable(), paused: z.boolean(), timezone: z.string(),
  push_problem: z.string().optional(), source_problem: z.string().optional(),
});
export type Watch = z.infer<typeof watch>;
export const palette = z.object({ answer: color.nullable(), attention: color.nullable(), resolved: color.nullable() });
const credentials = z.object({ url: z.string().max(4096), cookie: z.string().max(65536) });
const connectionState = z.object({ url: z.string(), hasCookie: z.boolean(), needsRepair: z.boolean().optional() });
const summary = z.object({
  id: z.number().int().positive(), headline: z.string(), source: z.string(), url,
  status: z.union([signal, z.literal("normal")]), created: z.number().int(), opened: z.number().int(),
});
const thread = z.string().min(1);
const cursor = z.number().int().positive();
export type Summary = z.infer<typeof summary>;
const card = z.object({ id: cursor, revision: cursor, headline: z.string(), body: z.string(), draft: z.string(), author: z.string(),
  updated: z.number().int(), opened: z.boolean(), source: z.string(), url, chat: thread });
export type BoardCard = z.infer<typeof card>;
const section = z.object({ total: z.number().int().nonnegative(), rows: z.array(card) });
export const contract = defineRpcContract({
  board: { input: z.record(signal, z.number().int().nonnegative()), output: z.record(signal, section) },
  readCard: { input: z.object({ id: cursor, revision: cursor }), output: z.null() },
  check: { input: z.object({ id }), output: z.object({
    outcome: z.enum(["busy", "reviewing", "quiet", "failed"]), problem: z.string().optional() }) },
  inbox: { input: z.object({ chat: thread, before: cursor.optional() }), output: z.object({
    rows: z.array(summary), latest: summary.nullable(), unread: z.number(), more: z.boolean(), child: z.string().nullable(),
  }) },
  openSummary: { input: z.object({ chat: thread, id: cursor }), output: summary.extend({ body: z.string(), draft: z.string() }) },
  connection: { input: z.null(), output: connectionState },
  saveConnection: { input: credentials, output: connectionState },
  testConnection: { input: credentials, output: z.object({ username: z.string() }) },
  list: { input: z.null(), output: z.object({ watches: z.array(watch), colors: palette }) },
  colors: { input: z.null(), output: palette },
  unwatch: { input: z.object({ id }), output: z.null() },
  edit: { input: settings.extend({ id }), output: z.null() },
  color: { input: z.object({ status: signal, color: color.nullable() }), output: z.null() },
});
